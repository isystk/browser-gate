import type { AppConfig } from '../config/appConfig.js';
import { ID_PATTERN } from '../lib/patterns.js';
import { type ApiKeyRecord, generateApiKey, hashApiKey } from './apiKey.js';

export interface NewApiKey {
  id: string;
  profiles: string[];
}

export interface ApiKeySummary {
  id: string;
  profiles: string[];
  created_at: string;
  revoked_at: string | undefined;
}

/** Returns a config with a newly issued key and its plaintext, which must be shown once and never stored. */
export function addApiKey(
  config: AppConfig,
  input: NewApiKey,
  now: Date,
): { config: AppConfig; key: string } {
  assertValidNewKey(config, input);
  const key = generateApiKey();
  const record: ApiKeyRecord = {
    id: input.id,
    hash: hashApiKey(key),
    profiles: input.profiles,
    created_at: now.toISOString(),
  };
  return { config: { ...config, api_keys: [...config.api_keys, record] }, key };
}

/** Returns a config in which the key with the given id is revoked. */
export function revokeApiKey(
  config: AppConfig,
  id: string,
  now: Date,
): AppConfig {
  if (!config.api_keys.some((record) => record.id === id))
    throw new Error(`API key not found: ${id}`);
  const api_keys = config.api_keys.map((record) =>
    record.id === id ? { ...record, revoked_at: now.toISOString() } : record,
  );
  return { ...config, api_keys };
}

/** Returns a config in which the key may also use the given profiles. Fails for an unknown or revoked key, or an undefined profile. */
export function grantProfiles(
  config: AppConfig,
  id: string,
  profiles: readonly string[],
): AppConfig {
  const target = config.api_keys.find((record) => record.id === id);
  if (target === undefined) throw new Error(`API key not found: ${id}`);
  if (target.revoked_at !== undefined)
    throw new Error(`API key is revoked: ${id}`);
  assertProfilesDefined(config, profiles);
  const api_keys = config.api_keys.map((record) =>
    record.id === id
      ? { ...record, profiles: [...new Set([...record.profiles, ...profiles])] }
      : record,
  );
  return { ...config, api_keys };
}

/** Lists keys without their hashes. */
export function listApiKeys(config: AppConfig): ApiKeySummary[] {
  return config.api_keys.map(({ id, profiles, created_at, revoked_at }) => ({
    id,
    profiles,
    created_at,
    revoked_at,
  }));
}

function assertValidNewKey(config: AppConfig, input: NewApiKey): void {
  if (!ID_PATTERN.test(input.id))
    throw new Error('id must match ^[a-z0-9][a-z0-9_-]{0,63}$');
  if (config.api_keys.some((record) => record.id === input.id))
    throw new Error(`API key id already exists: ${input.id}`);
  assertProfilesDefined(config, input.profiles);
}

function assertProfilesDefined(
  config: AppConfig,
  profiles: readonly string[],
): void {
  const unknown = profiles.find(
    (profile) => !Object.hasOwn(config.profiles, profile),
  );
  if (unknown !== undefined)
    throw new Error(`Profile is not defined in the config: ${unknown}`);
}
