import http from 'node:http';
import net from 'node:net';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { AppError } from '../../src/lib/errors.js';
import {
  type EgressProxy,
  startEgressProxy,
} from '../../src/security/egressProxy.js';
import {
  DEFAULT_EGRESS_POLICY,
  type EgressPolicy,
} from '../../src/security/urlGuard.js';
import {
  type FixtureProxy,
  type FixtureServer,
  startEchoServer,
  startFixtureProxy,
  startFixtureServer,
} from '../fixtures/servers.js';

const PUBLIC_IP = '93.184.216.34';

interface ConnectResult {
  statusLine: string;
  echoed: string;
}

function connectThrough(
  proxy: EgressProxy,
  target: string,
): Promise<ConnectResult> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(proxy.port, '127.0.0.1');
    let received = '';
    socket.on('error', reject);
    socket.on('data', (chunk) => {
      received += chunk.toString();
      if (received.includes('Established\r\n\r\n')) socket.write('ping');
      if (received.endsWith('ping')) socket.destroy();
    });
    socket.on('close', () =>
      resolve({
        statusLine: received.split('\r\n')[0] ?? '',
        echoed: received,
      }),
    );
    socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
  });
}

function forwardThrough(
  proxy: EgressProxy,
  absoluteUrl: string,
): Promise<{ status: number; body: string } | 'connection-closed'> {
  return new Promise((resolve) => {
    const req = http.request({
      host: '127.0.0.1',
      port: proxy.port,
      path: absoluteUrl,
      headers: { host: new URL(absoluteUrl).host },
    });
    req.on('response', (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', () => resolve('connection-closed'));
    req.end();
  });
}

describe('egress proxy', () => {
  let echo: FixtureServer;
  let web: FixtureServer;
  let internal: FixtureServer;
  let upstream: FixtureProxy;
  let policy: EgressPolicy;
  const opened: EgressProxy[] = [];

  async function open(
    options: Partial<Parameters<typeof startEgressProxy>[0]> = {},
  ): Promise<EgressProxy> {
    const proxy = await startEgressProxy({ policy, ...options });
    opened.push(proxy);
    return proxy;
  }

  beforeAll(async () => {
    [echo, web, internal, upstream] = await Promise.all([
      startEchoServer(),
      startFixtureServer(),
      startFixtureServer(),
      startFixtureProxy(),
    ]);
    policy = {
      allowedPorts: DEFAULT_EGRESS_POLICY.allowedPorts,
      exemptTargets: [
        `127.0.0.1:${echo.port}`,
        `127.0.0.1:${web.port}`,
        `127.0.0.1:${upstream.port}`,
      ],
    };
  });

  afterEach(async () => {
    await Promise.all(opened.splice(0).map((proxy) => proxy.close()));
  });

  afterAll(async () => {
    await Promise.all(
      [echo, web, internal, upstream].map((server) => server.close()),
    );
  });

  it('tunnels CONNECT to an allowed destination', async () => {
    const proxy = await open();

    const result = await connectThrough(proxy, `127.0.0.1:${echo.port}`);

    expect(result.statusLine).toBe('HTTP/1.1 200 Connection Established');
    expect(result.echoed).toContain('ping');
  });

  it('refuses CONNECT to a loopback port that is not exempted, without connecting', async () => {
    const proxy = await open();

    const result = await connectThrough(proxy, `127.0.0.1:${internal.port}`);

    expect(result.statusLine).toContain('403');
    expect(internal.hits).toHaveLength(0);
    expect(proxy.blocked).toHaveLength(1);
  });

  it.each([
    '169.254.169.254:80',
    '10.0.0.1:443',
    '[::1]:443',
    'example.com:22',
  ])('refuses CONNECT to %s', async (target) => {
    const proxy = await open({ resolve: async () => [PUBLIC_IP] });

    const result = await connectThrough(proxy, target);

    expect(result.statusLine).toContain('403');
    expect(proxy.blocked).toHaveLength(1);
  });

  it('refuses a name that resolves to an internal address', async () => {
    const proxy = await open({ resolve: async () => ['10.0.0.1'] });

    const result = await connectThrough(proxy, 'rebind.test:443');

    expect(result.statusLine).toContain('403');
  });

  it('refuses a name when any of its resolved addresses is internal', async () => {
    const proxy = await open({
      resolve: async () => [PUBLIC_IP, '169.254.169.254'],
    });

    const result = await connectThrough(proxy, 'mixed.test:443');

    expect(result.statusLine).toContain('403');
  });

  it('resolves a name once per connection and connects to that pinned address', async () => {
    let calls = 0;
    const proxy = await open({
      policy: { ...policy, allowedPorts: [...policy.allowedPorts, echo.port] },
      resolve: async () => {
        calls += 1;
        return ['127.0.0.1'];
      },
    });

    const result = await connectThrough(proxy, `pinned.test:${echo.port}`);

    expect(result.statusLine).toBe('HTTP/1.1 200 Connection Established');
    expect(calls).toBe(1);
  });

  it('forwards plain HTTP to an allowed destination', async () => {
    const proxy = await open();

    const result = await forwardThrough(proxy, `${web.origin}/article`);

    expect(result).toMatchObject({ status: 200 });
    expect(JSON.stringify(result)).toContain('Fixture Title');
  });

  it('closes the connection for plain HTTP to a destination that is not exempted', async () => {
    const proxy = await open();

    const result = await forwardThrough(proxy, `${internal.origin}/article`);

    expect(result).toBe('connection-closed');
    expect(internal.hits).toHaveLength(0);
    expect(proxy.blocked).toHaveLength(1);
  });

  it('chains plain HTTP through the upstream proxy with its credentials', async () => {
    const authorization = `Basic ${Buffer.from('u:p').toString('base64')}`;
    const proxy = await open({
      upstream: { host: '127.0.0.1', port: upstream.port, authorization },
      resolve: async () => [PUBLIC_IP],
    });

    const result = await forwardThrough(proxy, 'http://origin.test/page');

    expect(JSON.stringify(result)).toContain('via-proxy');
    expect(upstream.requests.at(-1)).toEqual({
      kind: 'forward',
      target: 'http://origin.test/page',
      proxyAuthorization: authorization,
    });
  });

  it('chains CONNECT through the upstream proxy', async () => {
    const proxy = await open({
      upstream: { host: '127.0.0.1', port: upstream.port },
      resolve: async () => [PUBLIC_IP],
    });

    const result = await connectThrough(proxy, 'origin.test:443');

    expect(result.statusLine).toBe('HTTP/1.1 200 Connection Established');
    expect(upstream.requests.at(-1)).toMatchObject({
      kind: 'connect',
      target: 'origin.test:443',
    });
  });

  it('still blocks internal destinations when an upstream proxy is configured', async () => {
    const before = upstream.requests.length;
    const proxy = await open({
      upstream: { host: '127.0.0.1', port: upstream.port },
    });

    const result = await connectThrough(proxy, '169.254.169.254:80');

    expect(result.statusLine).toContain('403');
    expect(upstream.requests).toHaveLength(before);
  });

  it('refuses to start with an upstream proxy on an internal address', async () => {
    const error = await startEgressProxy({
      policy: DEFAULT_EGRESS_POLICY,
      upstream: { host: '169.254.169.254', port: 3128 },
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('BLOCKED_URL');
  });
});
