import { describe, expect, it } from 'vitest';

import type { AppConfig } from '../../src/config/appConfig.js';
import { AppError } from '../../src/lib/errors.js';
import { assertLoginProfile } from '../../src/security/loginProfile.js';

const CONFIG: AppConfig = {
  api_keys: [],
  profiles: { 'google-main': { allowed_domains: ['example.com'] } },
};

function codeOf(raw: string | undefined): string | undefined {
  try {
    assertLoginProfile(raw, CONFIG);
    return undefined;
  } catch (error) {
    return error instanceof AppError ? error.code : 'NOT_APP_ERROR';
  }
}

describe('assertLoginProfile', () => {
  it('returns the name of a registered profile', () => {
    expect(assertLoginProfile('google-main', CONFIG)).toBe('google-main');
  });

  it.each([
    [undefined],
    [''],
    ['../etc/passwd'],
    ['a/b'],
    ['Google-Main'],
    ['google main'],
    ['google-main\n'],
    ['x'.repeat(65)],
    ['%2e%2e'],
  ])('rejects the malformed name %j as INVALID_REQUEST', (raw) => {
    expect(codeOf(raw)).toBe('INVALID_REQUEST');
  });

  it('rejects an unregistered name as PROFILE_NOT_FOUND', () => {
    expect(codeOf('unknown-profile')).toBe('PROFILE_NOT_FOUND');
  });

  it.each([['constructor'], ['toString'], ['__proto__']])(
    'does not treat the Object prototype member %s as registered',
    (raw) => {
      expect(['PROFILE_NOT_FOUND', 'INVALID_REQUEST']).toContain(codeOf(raw));
    },
  );
});
