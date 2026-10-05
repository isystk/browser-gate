import { isIP } from 'node:net';

import { AppError } from '../lib/errors.js';
import { isBlockedIp } from './ipGuard.js';

/** 通信先として許可するポートと、テスト用の例外対象を表す方針。 */
export interface EgressPolicy {
  allowedPorts: readonly number[];
  /** "ip:port" 形式の例外。本番の配線では使わず、テストからのみ注入する。 */
  exemptTargets: readonly string[];
  /** true なら、名前解決した宛先の IPv4 アドレスを IPv6 より先に試す（IPv4 が無い宛先は IPv6 へ）。検査の対象は変わらない。 */
  preferIpv4?: boolean;
}

export const DEFAULT_EGRESS_POLICY: EgressPolicy = {
  allowedPorts: [80, 443],
  exemptTargets: [],
};

const ALLOWED_SCHEMES = ['http:', 'https:'];
const DEFAULT_PORTS: Record<string, number> = { 'http:': 80, 'https:': 443 };
const BLOCKED_HOSTNAMES = ['localhost', 'metadata.google.internal'];
const BLOCKED_HOSTNAME_SUFFIXES = ['.localhost', '.internal'];

/** Parses a user-supplied URL and throws BLOCKED_URL if its scheme, credentials, port, or host is not allowed. */
export function parseTargetUrl(raw: string, policy: EgressPolicy): URL {
  const url = parseUrl(raw);
  if (!ALLOWED_SCHEMES.includes(url.protocol)) {
    throw new AppError('BLOCKED_URL', 'Only http and https URLs are allowed');
  }
  if (url.username !== '' || url.password !== '') {
    throw new AppError(
      'BLOCKED_URL',
      'URLs with embedded credentials are not allowed',
    );
  }
  assertHostPortAllowed(url.hostname, resolvePort(url), policy);
  return url;
}

/** Throws BLOCKED_URL unless the destination host and port are permitted by the policy. */
export function assertHostPortAllowed(
  host: string,
  port: number,
  policy: EgressPolicy,
): void {
  const normalized = normalizeHost(host);
  if (isExempt(normalized, port, policy)) return;
  if (!policy.allowedPorts.includes(port)) {
    throw new AppError('BLOCKED_URL', `Port ${port} is not allowed`);
  }
  assertHostAllowed(normalized);
}

/** Throws BLOCKED_URL unless the upstream proxy host is permitted. The proxy port is not restricted. */
export function assertProxyAllowed(
  host: string,
  port: number,
  policy: EgressPolicy,
): void {
  const normalized = normalizeHost(host);
  if (isExempt(normalized, port, policy)) return;
  assertHostAllowed(normalized);
}

function isExempt(
  normalizedHost: string,
  port: number,
  policy: EgressPolicy,
): boolean {
  return policy.exemptTargets.includes(`${normalizedHost}:${port}`);
}

function assertHostAllowed(normalizedHost: string): void {
  if (isIP(normalizedHost) === 0) {
    if (isBlockedHostname(normalizedHost))
      throw new AppError('BLOCKED_URL', 'The host name is not allowed');
    return;
  }
  if (isBlockedIp(normalizedHost))
    throw new AppError('BLOCKED_URL', 'The destination address is not allowed');
}

/** Lowercases a host and strips IPv6 brackets and a trailing dot. */
export function normalizeHost(host: string): string {
  const unbracketed =
    host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  return unbracketed.toLowerCase().replace(/\.$/, '');
}

/** Returns the effective destination port of a URL. */
export function resolvePort(url: URL): number {
  if (url.port !== '') return Number(url.port);
  return DEFAULT_PORTS[url.protocol] ?? 0;
}

function parseUrl(raw: string): URL {
  try {
    return new URL(raw);
  } catch {
    throw new AppError('INVALID_REQUEST', 'url must be an absolute URL');
  }
}

function isBlockedHostname(host: string): boolean {
  return (
    BLOCKED_HOSTNAMES.includes(host) ||
    BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => host.endsWith(suffix))
  );
}
