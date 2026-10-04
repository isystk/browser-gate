import http from 'node:http';
import net, { type AddressInfo } from 'node:net';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLogger } from '../../src/lib/logger.js';
import { attachVncProxy } from '../../src/login/vncProxy.js';

const ORIGIN = 'https://login.example.test';
const AUTHORIZED_COOKIE = 'bg_session=good';
const WS_PATH = '/ws';
const UPGRADE_HEAD_END = '\r\n\r\n';

interface Upstream {
  port: number;
  connections: number;
  receivedHeads: string[];
  close(): Promise<void>;
}

/** websockify 役。アップグレード要求を受け取ると 101 を返し、以降は受信データをそのまま返す。 */
async function startUpstream(): Promise<Upstream> {
  const upstream: Upstream = {
    port: 0,
    connections: 0,
    receivedHeads: [],
    close: async () => undefined,
  };
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    upstream.connections += 1;
    sockets.add(socket);
    socket.on('error', () => socket.destroy());
    let head = '';
    let upgraded = false;
    socket.on('data', (chunk) => {
      if (upgraded) return void socket.write(chunk);
      head += chunk.toString('latin1');
      const end = head.indexOf(UPGRADE_HEAD_END);
      if (end < 0) return;
      upgraded = true;
      upstream.receivedHeads.push(head.slice(0, end));
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n\r\n',
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  upstream.port = (server.address() as AddressInfo).port;
  upstream.close = () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
      sockets.forEach((socket) => socket.destroy());
    });
  return upstream;
}

function upgradeRequest(
  headers: Record<string, string>,
  path = WS_PATH,
): string {
  const lines = [
    `GET ${path} HTTP/1.1`,
    'Host: login.example.test',
    'Upgrade: websocket',
    'Connection: Upgrade',
    'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
    'Sec-WebSocket-Version: 13',
    ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
  ];
  return `${lines.join('\r\n')}\r\n\r\n`;
}

/** 生ソケットでアップグレード要求を送り、最初に受け取った応答を返す。 */
async function requestUpgrade(
  port: number,
  raw: string,
): Promise<{ firstLine: string; socket: net.Socket; data: string }> {
  const socket = net.connect(port, '127.0.0.1');
  socket.on('error', () => socket.destroy());
  socket.write(raw);
  const data = await new Promise<string>((resolve) => {
    let received = '';
    socket.on('data', (chunk) => {
      received += chunk.toString('latin1');
      if (received.includes(UPGRADE_HEAD_END)) resolve(received);
    });
    socket.on('close', () => resolve(received));
  });
  return { firstLine: data.split('\r\n')[0] ?? '', socket, data };
}

describe('attachVncProxy', () => {
  let upstream: Upstream;
  let server: http.Server;
  let port: number;
  let sessionActive: boolean;
  let sockets: net.Socket[];
  let connected: number;
  let released: number;

  beforeEach(async () => {
    upstream = await startUpstream();
    sessionActive = true;
    connected = 0;
    released = 0;
    sockets = [];
    server = http.createServer((_req, res) => res.writeHead(404).end());
    attachVncProxy(server, {
      path: WS_PATH,
      upstreamPort: upstream.port,
      allowedOrigin: ORIGIN,
      isAuthorized: (cookieHeader) =>
        cookieHeader?.includes(AUTHORIZED_COOKIE) === true,
      hasActiveSession: () => sessionActive,
      onClientConnected: () => {
        connected += 1;
        return () => {
          released += 1;
        };
      },
      logger: createLogger(() => undefined),
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    sockets.forEach((socket) => socket.destroy());
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await upstream.close();
  });

  async function attempt(
    headers: Record<string, string>,
    path = WS_PATH,
  ): ReturnType<typeof requestUpgrade> {
    const result = await requestUpgrade(port, upgradeRequest(headers, path));
    sockets.push(result.socket);
    return result;
  }

  it('relays an authorized WebSocket upgrade to the upstream and passes data through', async () => {
    const { firstLine, socket } = await attempt({
      Cookie: AUTHORIZED_COOKIE,
      Origin: ORIGIN,
    });

    expect(firstLine).toContain('101');
    const echoed = new Promise<string>((resolve) =>
      socket.once('data', (chunk) => resolve(chunk.toString())),
    );
    socket.write('hello');
    expect(await echoed).toBe('hello');
  });

  it('does not forward the session cookie to the upstream', async () => {
    await attempt({ Cookie: AUTHORIZED_COOKIE, Origin: ORIGIN });

    expect(upstream.receivedHeads.join('\n').toLowerCase()).not.toContain(
      'cookie',
    );
  });

  it.each([
    ['without a cookie', { Origin: ORIGIN }, 401],
    [
      'with an invalid cookie',
      { Cookie: 'bg_session=bad', Origin: ORIGIN },
      401,
    ],
    [
      'with a foreign Origin',
      { Cookie: AUTHORIZED_COOKIE, Origin: 'https://evil.example' },
      403,
    ],
    ['without an Origin', { Cookie: AUTHORIZED_COOKIE }, 403],
  ])(
    'rejects an upgrade %s without touching the upstream',
    async (_label, headers, status) => {
      const { firstLine } = await attempt(headers);

      expect(firstLine).toContain(String(status));
      expect(upstream.connections).toBe(0);
    },
  );

  it('rejects an authorized upgrade when no login session is active', async () => {
    sessionActive = false;

    const { firstLine } = await attempt({
      Cookie: AUTHORIZED_COOKIE,
      Origin: ORIGIN,
    });

    expect(firstLine).toContain('409');
    expect(upstream.connections).toBe(0);
  });

  it.each([['/'], ['/ws/extra'], ['/websockify']])(
    'rejects an upgrade to the path %s',
    async (path) => {
      const { firstLine } = await attempt(
        { Cookie: AUTHORIZED_COOKIE, Origin: ORIGIN },
        path,
      );

      expect(firstLine).toContain('404');
      expect(upstream.connections).toBe(0);
    },
  );

  it('reports a client as connected only after the upstream accepts it', async () => {
    await attempt({ Cookie: AUTHORIZED_COOKIE, Origin: ORIGIN });

    expect(connected).toBe(1);
    expect(released).toBe(0);
  });

  it('releases the client when its WebSocket closes', async () => {
    const { socket } = await attempt({
      Cookie: AUTHORIZED_COOKIE,
      Origin: ORIGIN,
    });

    socket.destroy();
    await vi.waitFor(() => expect(released).toBe(1));
  });

  it('does not report a client for a rejected upgrade', async () => {
    await attempt({ Origin: ORIGIN });

    expect(connected).toBe(0);
  });
});
