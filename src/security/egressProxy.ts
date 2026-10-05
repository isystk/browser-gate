import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import net, { type Socket } from 'node:net';

import { AppError } from '../lib/errors.js';
import {
  type EgressPolicy,
  assertHostPortAllowed,
  assertProxyAllowed,
  normalizeHost,
} from './urlGuard.js';

/** 利用者指定の上流プロキシ。authorization は Proxy-Authorization ヘッダーの値。 */
export interface UpstreamProxy {
  host: string;
  port: number;
  authorization?: string;
}

export type HostResolver = (host: string) => Promise<string[]>;

export interface BlockedEvent {
  target: string;
  reason: string;
}

export interface EgressProxyOptions {
  policy: EgressPolicy;
  upstream?: UpstreamProxy;
  resolve?: HostResolver;
}

/** Chromium の全通信を中継し、接続直前に宛先IPを検査して検証済みIPへ接続するローカルプロキシ。 */
export interface EgressProxy {
  readonly port: number;
  readonly blocked: readonly BlockedEvent[];
  close(): Promise<void>;
}

interface Target {
  host: string;
  port: number;
}

interface Tunnel {
  socket: Socket;
  head: Buffer;
}

type Lookup = NonNullable<net.TcpNetConnectOpts['lookup']>;

const LOOPBACK = '127.0.0.1';
const CONNECT_TARGET_PATTERN = /^(\[[0-9a-fA-F:.]+\]|[^:\s/@]+):(\d{1,5})$/;
const UPSTREAM_RESPONSE_LIMIT = 8192;
const UPSTREAM_HANDSHAKE_TIMEOUT_MS = 15_000;
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'proxy-connection',
  'proxy-authorization',
  'keep-alive',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/** Starts an egress proxy on a random loopback port and returns it with its blocked-request log. */
export async function startEgressProxy(
  options: EgressProxyOptions,
): Promise<EgressProxy> {
  const resolve = options.resolve ?? resolveWithDns;
  const upstreamAddresses = await resolveUpstream(options, resolve);
  const blocked: BlockedEvent[] = [];
  const sockets = new Set<Socket>();
  const context: ProxyContext = {
    options,
    resolve,
    upstreamAddresses,
    blocked,
    sockets,
  };

  const server = http.createServer(
    (req, res) => void handleForward(context, req, res),
  );
  server.on('connect', (req, socket, head) => {
    if (socket instanceof net.Socket)
      void handleConnect(context, req, socket, head);
    else socket.destroy();
  });
  server.on('upgrade', (_req, socket) => socket.destroy());
  server.on('connection', (socket) => trackSocket(sockets, socket));
  await new Promise<void>((resolveListen) =>
    server.listen(0, LOOPBACK, resolveListen),
  );

  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Egress proxy failed to listen');
  return {
    port: address.port,
    blocked,
    close: () => closeServer(server, sockets),
  };
}

/** Resolves a destination and returns its addresses, throwing BLOCKED_URL if the host, port, or any resolved address is not allowed. */
export async function resolveAllowedAddresses(
  target: Target,
  policy: EgressPolicy,
  resolve: HostResolver,
  role: 'destination' | 'proxy' = 'destination',
): Promise<string[]> {
  const host = normalizeHost(target.host);
  const assertAllowed =
    role === 'proxy' ? assertProxyAllowed : assertHostPortAllowed;
  assertAllowed(host, target.port, policy);
  if (net.isIP(host) !== 0) return [host];
  const addresses = await resolve(host);
  addresses.forEach((address) => assertAllowed(address, target.port, policy));
  return policy.preferIpv4 === true ? ipv4First(addresses) : addresses;
}

/** Moves IPv4 addresses before IPv6 ones, keeping the order within each family. */
function ipv4First(addresses: readonly string[]): string[] {
  return [
    ...addresses.filter((address) => net.isIPv4(address)),
    ...addresses.filter((address) => !net.isIPv4(address)),
  ];
}

interface ProxyContext {
  options: EgressProxyOptions;
  resolve: HostResolver;
  upstreamAddresses: string[] | undefined;
  blocked: BlockedEvent[];
  sockets: Set<Socket>;
}

async function resolveUpstream(
  options: EgressProxyOptions,
  resolve: HostResolver,
): Promise<string[] | undefined> {
  if (options.upstream === undefined) return undefined;
  return resolveAllowedAddresses(
    options.upstream,
    options.policy,
    resolve,
    'proxy',
  );
}

async function resolveWithDns(host: string): Promise<string[]> {
  const results = await dnsLookup(host, { all: true, verbatim: true });
  return results.map((result) => result.address);
}

async function handleConnect(
  context: ProxyContext,
  req: http.IncomingMessage,
  client: Socket,
  head: Buffer,
): Promise<void> {
  trackSocket(context.sockets, client);
  const target = parseConnectTarget(req.url ?? '');
  if (target === undefined) {
    client.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return;
  }
  try {
    const tunnel = await openTunnel(context, target, head);
    trackSocket(context.sockets, tunnel.socket);
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (tunnel.head.length > 0) client.write(tunnel.head);
    bridge(client, tunnel.socket);
  } catch (error) {
    client.end(
      `HTTP/1.1 ${failureStatus(context, target, error)} Egress Denied\r\n\r\n`,
    );
  }
}

async function openTunnel(
  context: ProxyContext,
  target: Target,
  head: Buffer,
): Promise<Tunnel> {
  const { options, resolve, upstreamAddresses } = context;
  const addresses = await resolveAllowedAddresses(
    target,
    options.policy,
    resolve,
  );
  if (options.upstream === undefined || upstreamAddresses === undefined) {
    const socket = await connectPinned(target, addresses);
    if (head.length > 0) socket.write(head);
    return { socket, head: Buffer.alloc(0) };
  }
  const socket = await connectPinned(options.upstream, upstreamAddresses);
  return negotiateUpstreamTunnel(socket, target, options.upstream);
}

async function negotiateUpstreamTunnel(
  socket: Socket,
  target: Target,
  upstream: UpstreamProxy,
): Promise<Tunnel> {
  const authLine =
    upstream.authorization === undefined
      ? ''
      : `Proxy-Authorization: ${upstream.authorization}\r\n`;
  const authority = `${target.host}:${target.port}`;
  socket.write(
    `CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n${authLine}\r\n`,
  );
  try {
    const response = await readUpstreamResponse(socket);
    if (response.status !== 200)
      throw new AppError(
        'NAVIGATION_FAILED',
        'The upstream proxy refused the connection',
      );
    return { socket, head: response.rest };
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

function readUpstreamResponse(
  socket: Socket,
): Promise<{ status: number; rest: Buffer }> {
  return new Promise((resolveResponse, reject) => {
    let buffered = Buffer.alloc(0);
    const timer = setTimeout(
      () =>
        fail(new AppError('NAVIGATION_FAILED', 'The upstream proxy timed out')),
      UPSTREAM_HANDSHAKE_TIMEOUT_MS,
    );
    const cleanup = (): void => {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', fail);
      socket.off('close', onClose);
    };
    const fail = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onClose = (): void =>
      fail(
        new AppError(
          'NAVIGATION_FAILED',
          'The upstream proxy closed the connection',
        ),
      );
    const onData = (chunk: Buffer): void => {
      buffered = Buffer.concat([buffered, chunk]);
      const end = buffered.indexOf('\r\n\r\n');
      if (end === -1 && buffered.length > UPSTREAM_RESPONSE_LIMIT)
        return fail(
          new AppError('NAVIGATION_FAILED', 'Invalid upstream proxy response'),
        );
      if (end === -1) return;
      cleanup();
      const status = Number(
        /^HTTP\/1\.[01] (\d{3})/.exec(
          buffered.toString('latin1', 0, end),
        )?.[1] ?? 0,
      );
      resolveResponse({ status, rest: buffered.subarray(end + 4) });
    };
    socket.on('data', onData);
    socket.once('error', fail);
    socket.once('close', onClose);
  });
}

function connectPinned(
  target: Target,
  addresses: readonly string[],
): Promise<Socket> {
  return new Promise((resolveConnect, reject) => {
    const socket = net.connect({
      host: normalizeHost(target.host),
      port: target.port,
      lookup: pinnedLookup(addresses),
    });
    socket.once('connect', () => resolveConnect(socket));
    socket.once('error', (error) => {
      socket.destroy();
      reject(
        new AppError(
          'NAVIGATION_FAILED',
          `Connection failed: ${(error as NodeJS.ErrnoException).code ?? 'unknown'}`,
        ),
      );
    });
  });
}

function pinnedLookup(addresses: readonly string[]): Lookup {
  return (_hostname, options, callback) => {
    const entries = addresses.map((address) => ({
      address,
      family: net.isIP(address),
    }));
    if (options.all === true) return callback(null, entries);
    const [first] = entries;
    if (first === undefined)
      return callback(new Error('No pinned address'), '', 0);
    return callback(null, first.address, first.family);
  };
}

async function handleForward(
  context: ProxyContext,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const url = parseForwardUrl(req.url ?? '');
  if (url === undefined) {
    res.writeHead(400).end();
    return;
  }
  const target: Target = {
    host: url.hostname,
    port: url.port === '' ? 80 : Number(url.port),
  };
  try {
    const addresses = await resolveAllowedAddresses(
      target,
      context.options.policy,
      context.resolve,
    );
    forwardRequest(context, { req, res, url, target, addresses });
  } catch (error) {
    failureStatus(context, target, error);
    req.socket.destroy();
  }
}

interface ForwardJob {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  target: Target;
  addresses: string[];
}

function forwardRequest(context: ProxyContext, job: ForwardJob): void {
  const { upstream } = context.options;
  const viaUpstream =
    upstream !== undefined && context.upstreamAddresses !== undefined;
  const headers = forwardHeaders(job.req.rawHeaders, upstream?.authorization);
  const outbound = http.request({
    host: viaUpstream
      ? normalizeHost(upstream.host)
      : normalizeHost(job.target.host),
    port: viaUpstream ? upstream.port : job.target.port,
    lookup: pinnedLookup(
      viaUpstream ? (context.upstreamAddresses ?? []) : job.addresses,
    ),
    method: job.req.method,
    path: viaUpstream ? job.url.href : `${job.url.pathname}${job.url.search}`,
    headers,
    agent: false,
  });
  trackOutbound(context, outbound);
  outbound.on('response', (response) => {
    job.res.writeHead(
      response.statusCode ?? 502,
      stripHopByHop(response.rawHeaders),
    );
    response.pipe(job.res);
  });
  outbound.on('error', () => job.req.socket.destroy());
  job.req.pipe(outbound);
}

function trackOutbound(
  context: ProxyContext,
  outbound: http.ClientRequest,
): void {
  outbound.on('socket', (socket) => trackSocket(context.sockets, socket));
}

function forwardHeaders(
  rawHeaders: readonly string[],
  proxyAuthorization: string | undefined,
): string[] {
  const headers = stripHopByHop(rawHeaders);
  return proxyAuthorization === undefined
    ? headers
    : [...headers, 'Proxy-Authorization', proxyAuthorization];
}

function stripHopByHop(rawHeaders: readonly string[]): string[] {
  const kept: string[] = [];
  for (let i = 0; i + 1 < rawHeaders.length; i += 2) {
    const name = rawHeaders[i] ?? '';
    if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase()))
      kept.push(name, rawHeaders[i + 1] ?? '');
  }
  return kept;
}

function parseConnectTarget(raw: string): Target | undefined {
  const match = CONNECT_TARGET_PATTERN.exec(raw);
  const port = Number(match?.[2]);
  if (match === null || match[1] === undefined || port < 1 || port > 65535)
    return undefined;
  return { host: match[1], port };
}

function parseForwardUrl(raw: string): URL | undefined {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' ? url : undefined;
  } catch {
    return undefined;
  }
}

/** Records a block event when the error is a policy violation and returns the HTTP status to answer with. */
function failureStatus(
  context: ProxyContext,
  target: Target,
  error: unknown,
): number {
  if (error instanceof AppError && error.code === 'BLOCKED_URL') {
    context.blocked.push({
      target: `${normalizeHost(target.host)}:${target.port}`,
      reason: error.message,
    });
    return 403;
  }
  return 502;
}

function bridge(a: Socket, b: Socket): void {
  a.pipe(b);
  b.pipe(a);
  const teardown = (): void => {
    a.destroy();
    b.destroy();
  };
  // 片側の切断・エラーは他方も閉じることで処理する
  [a, b].forEach((socket) =>
    socket.on('error', teardown).on('close', teardown),
  );
}

function trackSocket(sockets: Set<Socket>, socket: Socket): void {
  if (sockets.has(socket)) return;
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
  socket.on('error', () => socket.destroy());
}

function closeServer(server: http.Server, sockets: Set<Socket>): Promise<void> {
  return new Promise((resolveClose) => {
    server.close(() => resolveClose());
    sockets.forEach((socket) => socket.destroy());
  });
}
