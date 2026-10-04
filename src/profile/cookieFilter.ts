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
    /** Playwright の storageState({ indexedDB: true }) が返す IndexedDB。中身は不透明なまま保存・復元する。 */
    indexedDB?: IndexedDbLike[];
  }[];
}

/** IndexedDB の1データベース分。name 以外の構造（ストア・レコード）は Playwright に任せ、ここでは解釈しない。 */
export interface IndexedDbLike {
  name: string;
  [key: string]: unknown;
}

export interface FilteredStorageState {
  state: StorageStateLike;
  droppedCookies: number;
  droppedOrigins: number;
  /** 除外した Cookie 本体（値を含む）。ログへは describeCookies を通した形でだけ出す。 */
  droppedCookieEntries: StorageStateLike['cookies'];
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
    droppedCookieEntries: state.cookies.filter(
      (cookie) => !cookies.includes(cookie),
    ),
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
