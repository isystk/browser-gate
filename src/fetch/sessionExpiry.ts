import { normalizeHost } from '../security/urlGuard.js';

/** Returns true if the final URL matches one of the login page patterns. */
export function isLoginUrl(
  finalUrl: string,
  patterns: readonly string[],
): boolean {
  if (patterns.length === 0) return false;
  const url = tryParseUrl(finalUrl);
  if (url === undefined) return false;
  const host = normalizeHost(url.hostname);
  return patterns.some((pattern) =>
    pattern.startsWith('/')
      ? isSamePath(url.pathname, pattern)
      : isSameHost(host, pattern),
  );
}

function tryParseUrl(raw: string): URL | undefined {
  try {
    return new URL(raw);
  } catch {
    return undefined;
  }
}

/** Returns true if the path equals the pattern or is below it. */
function isSamePath(pathname: string, pattern: string): boolean {
  return pathname === pattern || pathname.startsWith(`${pattern}/`);
}

/** Returns true if the host equals the pattern or is one of its subdomains. */
function isSameHost(host: string, pattern: string): boolean {
  const allowed = normalizeHost(pattern);
  return host === allowed || host.endsWith(`.${allowed}`);
}
