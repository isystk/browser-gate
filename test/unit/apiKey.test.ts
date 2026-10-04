import { describe, expect, it } from 'vitest';

import {
  type ApiKeyRecord,
  extractBearerToken,
  generateApiKey,
  hashApiKey,
  verifyApiKey,
} from '../../src/auth/apiKey.js';

const KEY_A = generateApiKey();
const KEY_B = generateApiKey();

function record(
  id: string,
  key: string,
  overrides: Partial<ApiKeyRecord> = {},
): ApiKeyRecord {
  return {
    id,
    hash: hashApiKey(key),
    profiles: [],
    created_at: '2026-10-04T00:00:00.000Z',
    ...overrides,
  };
}

describe('generateApiKey', () => {
  it('produces distinct high-entropy keys with the bg_ prefix', () => {
    expect(KEY_A).not.toBe(KEY_B);
    expect(KEY_A).toMatch(/^bg_[A-Za-z0-9_-]{43}$/);
  });
});

describe('hashApiKey', () => {
  it('is deterministic and does not contain the plaintext', () => {
    expect(hashApiKey(KEY_A)).toBe(hashApiKey(KEY_A));
    expect(hashApiKey(KEY_A)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(hashApiKey(KEY_A)).not.toContain(KEY_A);
  });
});

describe('extractBearerToken', () => {
  it.each([
    ['Bearer abc', 'abc'],
    ['bearer abc', 'abc'],
    ['BEARER abc', 'abc'],
  ])('extracts the token from "%s"', (header, token) => {
    expect(extractBearerToken(header)).toBe(token);
  });

  it.each([
    undefined,
    '',
    'Bearer',
    'Bearer ',
    'Basic abc',
    'abc',
    'Bearer a b',
    `Bearer ${'x'.repeat(300)}`,
  ])('returns undefined for malformed header %s', (header) => {
    expect(extractBearerToken(header)).toBeUndefined();
  });
});

describe('verifyApiKey', () => {
  const keys = [
    record('caller-a', KEY_A, { profiles: ['p1'] }),
    record('caller-b', KEY_B),
  ];

  it('returns the matching record for a correct key', () => {
    expect(verifyApiKey(`Bearer ${KEY_A}`, keys)?.id).toBe('caller-a');
    expect(verifyApiKey(`Bearer ${KEY_B}`, keys)?.id).toBe('caller-b');
  });

  it('rejects a wrong key', () => {
    expect(verifyApiKey(`Bearer ${generateApiKey()}`, keys)).toBeUndefined();
  });

  it('rejects a missing header', () => {
    expect(verifyApiKey(undefined, keys)).toBeUndefined();
  });

  it('rejects a revoked key', () => {
    const revoked = [
      record('caller-a', KEY_A, { revoked_at: '2026-10-05T00:00:00.000Z' }),
    ];
    expect(verifyApiKey(`Bearer ${KEY_A}`, revoked)).toBeUndefined();
  });

  it('rejects the stored hash presented as a key', () => {
    expect(verifyApiKey(`Bearer ${hashApiKey(KEY_A)}`, keys)).toBeUndefined();
  });

  it('rejects everything when no keys are registered', () => {
    expect(verifyApiKey(`Bearer ${KEY_A}`, [])).toBeUndefined();
  });
});
