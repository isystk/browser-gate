import { randomBytes } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import { CookieSigner } from '../../src/auth/sessionCookie.js';

const TTL_MS = 60_000;

describe('CookieSigner', () => {
  let nowMs: number;
  let signer: CookieSigner;

  beforeEach(() => {
    nowMs = 1_000_000;
    signer = new CookieSigner(randomBytes(32), () => nowMs);
  });

  it('verifies a value it signed', () => {
    const value = signer.sign('session', { email: 'a@example.com' }, TTL_MS);

    expect(signer.verify('session', value)).toEqual({ email: 'a@example.com' });
  });

  it('rejects an expired value', () => {
    const value = signer.sign('session', { email: 'a@example.com' }, TTL_MS);
    nowMs += TTL_MS + 1;

    expect(signer.verify('session', value)).toBeUndefined();
  });

  it('rejects a value signed for another kind', () => {
    const value = signer.sign('oauth', { email: 'a@example.com' }, TTL_MS);

    expect(signer.verify('session', value)).toBeUndefined();
  });

  it('rejects a value signed with another secret', () => {
    const other = new CookieSigner(randomBytes(32), () => nowMs);
    const value = other.sign('session', { email: 'a@example.com' }, TTL_MS);

    expect(signer.verify('session', value)).toBeUndefined();
  });

  it('rejects a value whose payload was modified', () => {
    const value = signer.sign('session', { email: 'a@example.com' }, TTL_MS);
    const [, signature] = value.split('.');
    const forged = Buffer.from(
      JSON.stringify({
        k: 'session',
        d: { email: 'evil@example.com' },
        e: nowMs + TTL_MS,
      }),
    ).toString('base64url');

    expect(signer.verify('session', `${forged}.${signature}`)).toBeUndefined();
  });

  it.each([[undefined], [''], ['no-dot'], ['a.b.c'], ['.'], ['!!.!!']])(
    'rejects the malformed value %j',
    (value) => {
      expect(signer.verify('session', value)).toBeUndefined();
    },
  );

  it('rejects a secret shorter than 32 bytes', () => {
    expect(() => new CookieSigner(randomBytes(8))).toThrow();
  });
});
