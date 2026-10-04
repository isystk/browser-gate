import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import type { ApiKeyRecord } from '../auth/apiKey.js';
import { ID_PATTERN } from '../lib/patterns.js';

const apiKeySchema = z.strictObject({
  id: z.string().regex(ID_PATTERN),
  hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  profiles: z.array(z.string().regex(ID_PATTERN)),
  created_at: z.string(),
  revoked_at: z.string().optional(),
});

const profileSchema = z.strictObject({
  allowed_domains: z.array(z.string().min(1)),
});

const appConfigSchema = z.strictObject({
  api_keys: z.array(apiKeySchema).default([]),
  profiles: z.record(z.string().regex(ID_PATTERN), profileSchema).default({}),
});

/** 設定JSON（APIキーのハッシュ・プロファイル・許可ドメイン）。 */
export interface AppConfig {
  api_keys: ApiKeyRecord[];
  profiles: Record<string, { allowed_domains: string[] }>;
}

export type ConfigProvider = () => Promise<AppConfig>;

const CONFIG_RELOAD_INTERVAL_MS = 10_000;

/** Validates raw JSON as an AppConfig and throws with the offending path on failure. */
export function parseAppConfig(raw: unknown): AppConfig {
  const result = appConfigSchema.safeParse(raw);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  throw new Error(
    `Invalid config at ${issue?.path.join('.') ?? ''}: ${issue?.message ?? 'unknown'}`,
  );
}

/** Reads and validates a config file. */
export async function loadConfigFile(path: string): Promise<AppConfig> {
  return parseAppConfig(JSON.parse(await readFile(path, 'utf8')));
}

/**
 * Creates a provider that re-reads the file at most every CONFIG_RELOAD_INTERVAL_MS, so key revocation
 * takes effect without restart. Time-based (not mtime-based) because a Secret Manager volume on Cloud Run
 * does not guarantee a changing mtime. A failed reload keeps the last valid config.
 */
export async function createFileConfigProvider(
  path: string,
  onReloadError: (error: unknown) => void,
  now: () => number = Date.now,
): Promise<ConfigProvider> {
  let current = await loadConfigFile(path);
  let loadedAtMs = now();
  return async () => {
    if (now() - loadedAtMs < CONFIG_RELOAD_INTERVAL_MS) return current;
    loadedAtMs = now();
    try {
      current = await loadConfigFile(path);
    } catch (error) {
      onReloadError(error);
    }
    return current;
  };
}
