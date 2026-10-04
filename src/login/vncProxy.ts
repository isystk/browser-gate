import type http from 'node:http';
import net from 'node:net';
import type { Duplex } from 'node:stream';

import { parseCookieHeader } from '../lib/cookies.js';
import type { Logger } from '../lib/logger.js';

export interface VncProxyOptions {
  /** WebSocket を受け付けるパス（完全一致）。 */
  path: string;
  /** websockify がループバックで待ち受けるポート。 */
  upstreamPort: number;
  /** 許可する Origin（公開URLのオリジン）。 */
  allowedOrigin: string;
  isAuthorized(cookieHeader: string | undefined): boolean;
  hasActiveSession(): boolean;
  /** 上流へ接続できた利用者の通知。戻り値はその接続が閉じたときに呼ぶ解放関数。 */
  onClientConnected?(): () => void;
  logger: Logger;
}

const UPSTREAM_HOST = '127.0.0.1';
const STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  502: 'Bad Gateway',
};

/**
 * Relays WebSocket upgrades on the given path to websockify, but only for signed-in users.
 * Rejects (before touching the upstream): missing/invalid session, foreign Origin, wrong path, or no active login session.
 */
export function attachVncProxy(
  server: http.Server,
  options: VncProxyOptions,
): void {
  server.on('upgrade', (req, socket, head) =>
    handleUpgrade(options, req, socket, head),
  );
}

function handleUpgrade(
  options: VncProxyOptions,
  req: http.IncomingMessage,
  socket: Duplex,
  head: Buffer,
): void {
  const rejection = findRejection(options, req);
  if (rejection !== undefined) {
    options.logger.warn('vnc_upgrade_rejected', { status: rejection });
    reject(socket, rejection);
    return;
  }
  tunnel(options, req, socket, head);
}

function findRejection(
  options: VncProxyOptions,
  req: http.IncomingMessage,
): number | undefined {
  if (!options.isAuthorized(req.headers.cookie)) return 401;
  if (req.headers.origin !== options.allowedOrigin) return 403;
  if (req.headers.upgrade?.toLowerCase() !== 'websocket') return 400;
  if (
    new URL(req.url ?? '/', 'http://invalid.local').pathname !== options.path
  ) {
    return 404;
  }
  return options.hasActiveSession() ? undefined : 409;
}

function tunnel(
  options: VncProxyOptions,
  req: http.IncomingMessage,
  socket: Duplex,
  head: Buffer,
): void {
  const upstream = net.connect(options.upstreamPort, UPSTREAM_HOST);
  let connected = false;
  let release: (() => void) | undefined;
  upstream.once('connect', () => {
    connected = true;
    release = options.onClientConnected?.();
    upstream.write(serializeRequestHead(req));
    if (head.length > 0) upstream.write(head);
    socket.pipe(upstream);
    upstream.pipe(socket);
  });
  upstream.on('error', () => {
    if (!connected) reject(socket, 502);
    socket.destroy();
  });
  socket.on('error', () => upstream.destroy());
  socket.on('close', () => {
    release?.();
    upstream.destroy();
  });
  upstream.on('close', () => socket.destroy());
}

/** Rebuilds the upgrade request for the upstream without the Cookie header, so the session cookie never reaches websockify. */
function serializeRequestHead(req: http.IncomingMessage): string {
  const lines = [`${req.method ?? 'GET'} ${req.url ?? '/'} HTTP/1.1`];
  for (let index = 0; index < req.rawHeaders.length; index += 2) {
    const name = req.rawHeaders[index] ?? '';
    const value = req.rawHeaders[index + 1] ?? '';
    if (name.toLowerCase() !== 'cookie') lines.push(`${name}: ${value}`);
  }
  return `${lines.join('\r\n')}\r\n\r\n`;
}

function reject(socket: Duplex, status: number): void {
  socket.end(
    `HTTP/1.1 ${status} ${STATUS_TEXT[status] ?? 'Error'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
}

/** Builds an isAuthorized callback from a cookie-based session check. */
export function authorizeByCookie(
  cookieName: string,
  isValid: (value: string | undefined) => boolean,
): (cookieHeader: string | undefined) => boolean {
  return (cookieHeader) => isValid(parseCookieHeader(cookieHeader)[cookieName]);
}
