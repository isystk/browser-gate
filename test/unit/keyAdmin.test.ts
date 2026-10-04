import { beforeEach, describe, expect, it } from 'vitest';

import { verifyApiKey } from '../../src/auth/apiKey.js';
import {
  addApiKey,
  grantProfiles,
  listApiKeys,
  revokeApiKey,
} from '../../src/auth/keyAdmin.js';
import type { AppConfig } from '../../src/config/appConfig.js';

const NOW = new Date('2026-10-04T12:00:00.000Z');

describe('keyAdmin', () => {
  let config: AppConfig;

  beforeEach(() => {
    config = {
      api_keys: [],
      profiles: { p1: { allowed_domains: ['example.com'] } },
    };
  });

  it('adds a key whose plaintext verifies but is never stored', () => {
    const { config: next, key } = addApiKey(
      config,
      { id: 'musashi', profiles: [] },
      NOW,
    );

    expect(verifyApiKey(`Bearer ${key}`, next.api_keys)?.id).toBe('musashi');
    expect(JSON.stringify(next)).not.toContain(key);
    expect(next.api_keys[0]?.created_at).toBe(NOW.toISOString());
  });

  it('does not mutate the input config', () => {
    addApiKey(config, { id: 'musashi', profiles: [] }, NOW);

    expect(config.api_keys).toHaveLength(0);
  });

  it.each(['', 'Has Space', 'UPPER', '-lead', 'a'.repeat(65)])(
    'rejects invalid id "%s"',
    (id) => {
      expect(() => addApiKey(config, { id, profiles: [] }, NOW)).toThrow();
    },
  );

  it('rejects a duplicate id', () => {
    const { config: next } = addApiKey(
      config,
      { id: 'musashi', profiles: [] },
      NOW,
    );

    expect(() => addApiKey(next, { id: 'musashi', profiles: [] }, NOW)).toThrow(
      /already exists/,
    );
  });

  it('rejects a profile that is not defined in the config', () => {
    expect(() =>
      addApiKey(config, { id: 'musashi', profiles: ['ghost'] }, NOW),
    ).toThrow(/ghost/);
  });

  it('revokes a key so it no longer verifies', () => {
    const added = addApiKey(config, { id: 'musashi', profiles: [] }, NOW);
    const revoked = revokeApiKey(added.config, 'musashi', NOW);

    expect(
      verifyApiKey(`Bearer ${added.key}`, revoked.api_keys),
    ).toBeUndefined();
    expect(revoked.api_keys[0]?.revoked_at).toBe(NOW.toISOString());
  });

  it('fails to revoke an unknown id', () => {
    expect(() => revokeApiKey(config, 'ghost', NOW)).toThrow(/not found/);
  });

  it('lists keys without exposing hashes', () => {
    const { config: next } = addApiKey(
      config,
      { id: 'musashi', profiles: ['p1'] },
      NOW,
    );

    expect(listApiKeys(next)).toEqual([
      {
        id: 'musashi',
        profiles: ['p1'],
        created_at: NOW.toISOString(),
        revoked_at: undefined,
      },
    ]);
  });

  describe('grantProfiles', () => {
    beforeEach(() => {
      config = {
        api_keys: [],
        profiles: {
          p1: { allowed_domains: ['example.com'] },
          p2: { allowed_domains: ['example.org'] },
        },
      };
    });

    it('adds the profile to an existing key and keeps the key valid', () => {
      const { config: issued, key } = addApiKey(
        config,
        { id: 'musashi', profiles: ['p1'] },
        NOW,
      );

      const next = grantProfiles(issued, 'musashi', ['p2']);

      expect(next.api_keys[0]?.profiles).toEqual(['p1', 'p2']);
      expect(verifyApiKey(`Bearer ${key}`, next.api_keys)?.id).toBe('musashi');
    });

    it('does not duplicate a profile the key already has', () => {
      const { config: issued } = addApiKey(
        config,
        { id: 'musashi', profiles: ['p1'] },
        NOW,
      );

      expect(
        grantProfiles(issued, 'musashi', ['p1']).api_keys[0]?.profiles,
      ).toEqual(['p1']);
    });

    it('does not mutate the input config', () => {
      const { config: issued } = addApiKey(
        config,
        { id: 'musashi', profiles: [] },
        NOW,
      );

      grantProfiles(issued, 'musashi', ['p1']);

      expect(issued.api_keys[0]?.profiles).toEqual([]);
    });

    it('fails for an unknown key id', () => {
      expect(() => grantProfiles(config, 'ghost', ['p1'])).toThrow(/not found/);
    });

    it('fails for a profile that is not defined in the config', () => {
      const { config: issued } = addApiKey(
        config,
        { id: 'musashi', profiles: [] },
        NOW,
      );

      expect(() => grantProfiles(issued, 'musashi', ['nope'])).toThrow(
        /not defined/,
      );
    });

    it('fails for a revoked key', () => {
      const { config: issued } = addApiKey(
        config,
        { id: 'musashi', profiles: [] },
        NOW,
      );
      const revoked = revokeApiKey(issued, 'musashi', NOW);

      expect(() => grantProfiles(revoked, 'musashi', ['p1'])).toThrow(
        /revoked/,
      );
    });
  });
});
