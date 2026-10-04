import { randomBytes } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import { loadProfileEnv } from '../../src/config/profileEnv.js';

describe('loadProfileEnv', () => {
  let source: NodeJS.ProcessEnv;
  let key: string;

  beforeEach(() => {
    key = randomBytes(32).toString('base64');
    source = { PROFILE_ENCRYPTION_KEY: key, GCS_BUCKET: 'profiles-bucket' };
  });

  it('is disabled when neither the key nor a store is configured', () => {
    expect(loadProfileEnv({})).toBeUndefined();
  });

  it('reads the key and the GCS bucket', () => {
    const env = loadProfileEnv(source);

    expect(env?.store).toEqual({ kind: 'gcs', bucket: 'profiles-bucket' });
    expect(env?.encryptionKey.toString('base64')).toBe(key);
  });

  it('uses a local directory when PROFILE_STORE_DIR is set', () => {
    delete source.GCS_BUCKET;
    source.PROFILE_STORE_DIR = '/data/profiles';

    expect(loadProfileEnv(source)?.store).toEqual({
      kind: 'local',
      dir: '/data/profiles',
    });
  });

  it('refuses a local directory on Cloud Run', () => {
    source.PROFILE_STORE_DIR = '/data/profiles';
    source.K_SERVICE = 'browser-gate-api';

    expect(() => loadProfileEnv(source)).toThrow(/Cloud Run/);
  });

  it('fails when a store is configured without a key', () => {
    delete source.PROFILE_ENCRYPTION_KEY;

    expect(() => loadProfileEnv(source)).toThrow(/PROFILE_ENCRYPTION_KEY/);
  });

  it('fails when a key is configured without a store', () => {
    delete source.GCS_BUCKET;

    expect(() => loadProfileEnv(source)).toThrow(/GCS_BUCKET/);
  });

  it('fails with a message that does not contain the invalid key', () => {
    source.PROFILE_ENCRYPTION_KEY = 'short-secret-key-value';

    expect(() => loadProfileEnv(source)).toThrow(/32 byte/);
    expect(() => loadProfileEnv(source)).not.toThrow(/short-secret/);
  });
});
