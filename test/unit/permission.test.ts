import { beforeEach, describe, expect, it } from 'vitest';

import type { ApiKeyRecord } from '../../src/auth/apiKey.js';
import type { AppConfig } from '../../src/config/appConfig.js';
import { AppError } from '../../src/lib/errors.js';
import {
  assertFetchPermission,
  isDomainAllowed,
} from '../../src/security/permission.js';

function codeOf(run: () => void): string | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    return error instanceof AppError ? error.code : 'NOT_APP_ERROR';
  }
}

describe('isDomainAllowed', () => {
  it.each([
    ['example.com', ['example.com'], true],
    ['www.example.com', ['example.com'], true],
    ['a.b.example.com', ['example.com'], true],
    ['EXAMPLE.com', ['example.com'], true],
    ['evilexample.com', ['example.com'], false],
    ['example.com.evil.net', ['example.com'], false],
    ['example.org', ['example.com'], false],
    ['example.com', [], false],
    ['other.org', ['example.com', 'other.org'], true],
  ])('host %s against %j is %s', (host, allowed, expected) => {
    expect(isDomainAllowed(host, allowed)).toBe(expected);
  });
});

describe('assertFetchPermission', () => {
  let key: ApiKeyRecord;
  let config: AppConfig;

  beforeEach(() => {
    key = {
      id: 'caller',
      hash: 'sha256:x',
      profiles: ['p1'],
      created_at: '2026-10-04T00:00:00.000Z',
    };
    config = {
      api_keys: [key],
      profiles: {
        p1: { allowed_domains: ['example.com'] },
        p2: { allowed_domains: ['example.org'] },
      },
    };
  });

  it('allows anonymous fetch of any host for a valid key', () => {
    expect(
      codeOf(() =>
        assertFetchPermission({
          key,
          config,
          profile: undefined,
          host: 'anything.test',
        }),
      ),
    ).toBeUndefined();
  });

  it('allows a permitted profile on one of its allowed domains', () => {
    expect(
      codeOf(() =>
        assertFetchPermission({
          key,
          config,
          profile: 'p1',
          host: 'www.example.com',
        }),
      ),
    ).toBeUndefined();
  });

  it('rejects a profile the key is not permitted to use', () => {
    expect(
      codeOf(() =>
        assertFetchPermission({
          key,
          config,
          profile: 'p2',
          host: 'example.org',
        }),
      ),
    ).toBe('FORBIDDEN_PROFILE');
  });

  it('rejects an unknown profile as forbidden to avoid leaking existence', () => {
    key.profiles = ['ghost'];
    expect(
      codeOf(() =>
        assertFetchPermission({
          key,
          config,
          profile: 'ghost',
          host: 'example.com',
        }),
      ),
    ).toBe('FORBIDDEN_PROFILE');
  });

  it('rejects a host outside the profile allowed domains', () => {
    expect(
      codeOf(() =>
        assertFetchPermission({
          key,
          config,
          profile: 'p1',
          host: 'example.org',
        }),
      ),
    ).toBe('FORBIDDEN_DOMAIN');
  });
});
