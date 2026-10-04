import { parseEncryptionKey } from '../profile/crypto.js';
import { type StoreSettings, nonEmpty, parseStore } from './loginEnv.js';

/** 取得用サービスがプロファイルを読むための設定（暗号鍵と保存先）。 */
export interface ProfileEnv {
  encryptionKey: Buffer;
  store: StoreSettings;
}

/**
 * Loads the settings for reading saved profiles. Returns undefined when neither the key nor a store is configured
 * (profile fetching disabled). A partial or invalid configuration throws; error messages never contain secret values.
 */
export function loadProfileEnv(
  source: NodeJS.ProcessEnv = process.env,
): ProfileEnv | undefined {
  const key = nonEmpty(source.PROFILE_ENCRYPTION_KEY);
  const hasStore =
    nonEmpty(source.GCS_BUCKET) !== undefined ||
    nonEmpty(source.PROFILE_STORE_DIR) !== undefined;
  if (key === undefined && !hasStore) return undefined;
  if (key === undefined) {
    throw new Error('PROFILE_ENCRYPTION_KEY is required to read profiles');
  }
  return {
    encryptionKey: parseEncryptionKey(key),
    store: parseStore(source, nonEmpty(source.K_SERVICE) !== undefined),
  };
}
