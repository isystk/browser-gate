import type { StorageStateLike } from './cookieFilter.js';

/** Cookie details that are safe to log: no value, only where it applies and how it is protected. */
export interface CookieDescription {
  domain: string;
  name: string;
  secure: boolean;
  http_only: boolean;
  same_site: string;
  has_expires: boolean;
}

/** Origin storage details that are safe to log: only counts, never key names or values. */
export interface OriginDescription {
  origin: string;
  local_storage_keys: number;
  indexeddb_databases: number;
}

/** Describes cookies for diagnostics. The value is never included. A session cookie (expires <= 0) has no expiry. */
export function describeCookies(
  cookies: StorageStateLike['cookies'],
): CookieDescription[] {
  return cookies.map((cookie) => ({
    domain: cookie.domain,
    name: cookie.name,
    secure: cookie.secure,
    http_only: cookie.httpOnly,
    same_site: cookie.sameSite,
    has_expires: cookie.expires > 0,
  }));
}

/** Describes the web storage of each origin by counts only. */
export function describeOrigins(
  origins: StorageStateLike['origins'],
): OriginDescription[] {
  return origins.map((item) => ({
    origin: item.origin,
    local_storage_keys: item.localStorage.length,
    indexeddb_databases: item.indexedDB?.length ?? 0,
  }));
}
