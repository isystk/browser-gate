import type { ApiKeyRecord } from '../auth/apiKey.js';
import type { AppConfig } from '../config/appConfig.js';
import { AppError } from '../lib/errors.js';
import { normalizeHost } from './urlGuard.js';

export interface FetchPermissionInput {
  key: ApiKeyRecord;
  config: AppConfig;
  profile: string | undefined;
  host: string;
}

/** Throws FORBIDDEN_PROFILE or FORBIDDEN_DOMAIN unless the key may fetch the host with the profile. Anonymous fetches are always allowed. */
export function assertFetchPermission({
  key,
  config,
  profile,
  host,
}: FetchPermissionInput): void {
  if (profile === undefined) return;
  const profileConfig = Object.hasOwn(config.profiles, profile)
    ? config.profiles[profile]
    : undefined;
  if (!key.profiles.includes(profile) || profileConfig === undefined) {
    throw new AppError(
      'FORBIDDEN_PROFILE',
      'This API key is not allowed to use the profile',
    );
  }
  if (!isDomainAllowed(host, profileConfig.allowed_domains)) {
    throw new AppError(
      'FORBIDDEN_DOMAIN',
      'The profile is not allowed to access this domain',
    );
  }
}

/** Returns true if the host equals an allowed domain or is one of its subdomains. */
export function isDomainAllowed(
  host: string,
  allowedDomains: readonly string[],
): boolean {
  const normalized = normalizeHost(host);
  return allowedDomains.some((domain) => {
    const allowed = normalizeHost(domain);
    return normalized === allowed || normalized.endsWith(`.${allowed}`);
  });
}
