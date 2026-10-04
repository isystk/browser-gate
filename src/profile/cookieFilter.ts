import { isDomainAllowed } from '../security/permission.js';
import { normalizeHost } from '../security/urlGuard.js';

/** Playwright の storageState と構造互換の最小型。 */
export interface StorageStateLike {
  cookies: {
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'Strict' | 'Lax' | 'None';
  }[];
  origins: {
    origin: string;
    localStorage: { name: string; value: string }[];
  }[];
}

export interface FilteredStorageState {
  state: StorageStateLike;
  droppedCookies: number;
  droppedOrigins: number;
}

/**
 * Keeps only the cookies and localStorage origins that belong to the allowed domains.
 * A cookie is kept if its domain is an allowed domain or a subdomain of one, or if it is scoped to a parent domain that covers an allowed domain.
 */
export function filterStorageState(
  state: StorageStateLike,
  allowedDomains: readonly string[],
): FilteredStorageState {
  const cookies = state.cookies.filter((cookie) =>
    isCookieAllowed(cookie.domain, allowedDomains),
  );
  const origins = state.origins.filter((item) =>
    isOriginAllowed(item.origin, allowedDomains),
  );
  return {
    state: { cookies, origins },
    droppedCookies: state.cookies.length - cookies.length,
    droppedOrigins: state.origins.length - origins.length,
  };
}

function isCookieAllowed(
  cookieDomain: string,
  allowedDomains: readonly string[],
): boolean {
  const domain = normalizeHost(cookieDomain.replace(/^\./, ''));
  return (
    isDomainAllowed(domain, allowedDomains) ||
    (domain.includes('.') &&
      allowedDomains.some((allowed) =>
        isDomainAllowed(normalizeHost(allowed), [domain]),
      ))
  );
}

function isOriginAllowed(
  origin: string,
  allowedDomains: readonly string[],
): boolean {
  const host = parseHost(origin);
  return host !== undefined && isDomainAllowed(host, allowedDomains);
}

function parseHost(origin: string): string | undefined {
  try {
    return new URL(origin).hostname;
  } catch {
    return undefined;
  }
}
