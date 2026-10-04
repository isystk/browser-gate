import { z } from 'zod';

import { AppError } from '../lib/errors.js';
import { type StorageStateLike, filterStorageState } from './cookieFilter.js';
import { ProfileDecryptError } from './crypto.js';
import type { ProfileStore } from './store.js';

const cookieSchema = z.object({
  name: z.string(),
  value: z.string(),
  domain: z.string().min(1),
  path: z.string(),
  expires: z.number(),
  httpOnly: z.boolean(),
  secure: z.boolean(),
  sameSite: z.enum(['Strict', 'Lax', 'None']),
});

const storageStateSchema = z.object({
  cookies: z.array(cookieSchema),
  origins: z.array(
    z.object({
      origin: z.string(),
      localStorage: z.array(z.object({ name: z.string(), value: z.string() })),
      indexedDB: z.array(z.looseObject({ name: z.string() })).optional(),
    }),
  ),
});

/** 取得用のプロファイル読み込み。保存データが無い・読めない場合は AppError を投げる。 */
export interface ProfileStateProvider {
  load(
    profile: string,
    allowedDomains: readonly string[],
  ): Promise<StorageStateLike>;
}

/**
 * Loads a saved profile as a Playwright storage state.
 * - Missing data -> PROFILE_NOT_FOUND
 * - Storage failure, decryption failure, or malformed data -> INTERNAL_ERROR with a generic message (no keys, paths, or contents)
 * - Cookies and origins outside the currently allowed domains are dropped (the config may have narrowed since the profile was saved)
 */
export class ProfileLoader implements ProfileStateProvider {
  constructor(private readonly store: ProfileStore) {}

  async load(
    profile: string,
    allowedDomains: readonly string[],
  ): Promise<StorageStateLike> {
    const plaintext = await this.read(profile);
    if (plaintext === undefined) {
      throw new AppError(
        'PROFILE_NOT_FOUND',
        'The profile has no saved login. Log in with /login first',
      );
    }
    return filterStorageState(parseState(plaintext), allowedDomains).state;
  }

  private async read(profile: string): Promise<Buffer | undefined> {
    try {
      return await this.store.load(profile);
    } catch (error) {
      throw new AppError(
        'INTERNAL_ERROR',
        error instanceof ProfileDecryptError
          ? 'The saved profile could not be decrypted'
          : 'The profile storage could not be read',
      );
    }
  }
}

function parseState(plaintext: Buffer): StorageStateLike {
  try {
    return storageStateSchema.parse(JSON.parse(plaintext.toString('utf8')));
  } catch {
    throw new AppError('INTERNAL_ERROR', 'The saved profile is malformed');
  }
}
