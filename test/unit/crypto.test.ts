import { randomBytes } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import {
  decryptProfile,
  encryptProfile,
  parseEncryptionKey,
} from '../../src/profile/crypto.js';

const PROFILE = 'google-main';
const PLAINTEXT = Buffer.from('{"cookies":[{"name":"sid","value":"secret"}]}');

describe('parseEncryptionKey', () => {
  it('accepts a base64 encoded 32 byte key', () => {
    const raw = randomBytes(32);

    expect(parseEncryptionKey(raw.toString('base64')).equals(raw)).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['too short', randomBytes(16).toString('base64')],
    ['too long', randomBytes(48).toString('base64')],
    ['not base64', '!!!not-base64!!!'],
  ])('rejects a key that is %s', (_label, value) => {
    expect(() => parseEncryptionKey(value)).toThrow();
  });

  it('does not echo the key value in the error message', () => {
    const value = randomBytes(16).toString('base64');

    expect(() => parseEncryptionKey(value)).toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining(value),
      }),
    );
  });
});

describe('encryptProfile / decryptProfile', () => {
  let key: Buffer;

  beforeEach(() => {
    key = randomBytes(32);
  });

  it('round-trips the plaintext', () => {
    const encrypted = encryptProfile(key, PROFILE, PLAINTEXT);

    expect(decryptProfile(key, PROFILE, encrypted).equals(PLAINTEXT)).toBe(
      true,
    );
  });

  it('does not contain the plaintext in the encrypted data', () => {
    const encrypted = encryptProfile(key, PROFILE, PLAINTEXT);

    expect(encrypted.includes(Buffer.from('secret'))).toBe(false);
    expect(encrypted.includes(Buffer.from('cookies'))).toBe(false);
  });

  it('produces different ciphertext for the same input (random IV)', () => {
    const first = encryptProfile(key, PROFILE, PLAINTEXT);
    const second = encryptProfile(key, PROFILE, PLAINTEXT);

    expect(first.equals(second)).toBe(false);
  });

  it('fails to decrypt with a different key', () => {
    const encrypted = encryptProfile(key, PROFILE, PLAINTEXT);

    expect(() => decryptProfile(randomBytes(32), PROFILE, encrypted)).toThrow();
  });

  it('fails to decrypt when the profile name differs (ciphertext swap)', () => {
    const encrypted = encryptProfile(key, PROFILE, PLAINTEXT);

    expect(() => decryptProfile(key, 'other-profile', encrypted)).toThrow();
  });

  it.each([
    ['ciphertext body', -1],
    ['IV', 5],
    ['auth tag', 20],
  ])('fails to decrypt when the %s is tampered', (_label, offset) => {
    const encrypted = Buffer.from(encryptProfile(key, PROFILE, PLAINTEXT));
    const index = offset < 0 ? encrypted.length + offset : offset;
    encrypted[index] = (encrypted[index] ?? 0) ^ 0xff;

    expect(() => decryptProfile(key, PROFILE, encrypted)).toThrow();
  });

  it('fails to decrypt data without the format header', () => {
    expect(() =>
      decryptProfile(key, PROFILE, Buffer.from('plain text')),
    ).toThrow();
  });

  it('rejects a key that is not 32 bytes', () => {
    expect(() => encryptProfile(randomBytes(16), PROFILE, PLAINTEXT)).toThrow();
  });
});
