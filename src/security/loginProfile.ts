import type { AppConfig } from '../config/appConfig.js';
import { AppError } from '../lib/errors.js';
import { ID_PATTERN } from '../lib/patterns.js';

/** Returns the profile name if it matches the strict name pattern, otherwise throws INVALID_REQUEST. */
export function parseProfileName(raw: string | undefined): string {
  if (raw === undefined || !ID_PATTERN.test(raw)) {
    throw new AppError('INVALID_REQUEST', 'The profile name is invalid');
  }
  return raw;
}

/** Returns the profile name if it is well-formed and registered in the config, otherwise throws INVALID_REQUEST or PROFILE_NOT_FOUND. */
export function assertLoginProfile(
  raw: string | undefined,
  config: AppConfig,
): string {
  const profile = parseProfileName(raw);
  if (!Object.hasOwn(config.profiles, profile)) {
    throw new AppError('PROFILE_NOT_FOUND', 'The profile is not registered');
  }
  return profile;
}
