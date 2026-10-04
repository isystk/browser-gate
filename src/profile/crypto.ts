import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const ALGORITHM = 'aes-256-gcm';
const MAGIC = Buffer.from('BGP1');
const HEADER_BYTES = MAGIC.length + IV_BYTES + TAG_BYTES;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

/** Thrown when stored profile data has an invalid format or cannot be authenticated with the key. */
export class ProfileDecryptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProfileDecryptError';
  }
}

/** Decodes a base64 AES-256 key and throws if it is not exactly 32 bytes. The key value is never included in the error. */
export function parseEncryptionKey(base64: string): Buffer {
  const key = BASE64_PATTERN.test(base64.trim())
    ? Buffer.from(base64.trim(), 'base64')
    : Buffer.alloc(0);
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `The encryption key must be a base64 encoded ${KEY_BYTES} byte value`,
    );
  }
  return key;
}

/**
 * Encrypts a profile with AES-256-GCM.
 * Layout: magic(4) | IV(12) | auth tag(16) | ciphertext. The profile name is authenticated as AAD so that data cannot be swapped between profiles.
 */
export function encryptProfile(
  key: Buffer,
  profile: string,
  plaintext: Buffer,
): Buffer {
  assertKeyLength(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(profile));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
}

/** Decrypts data produced by encryptProfile and throws if the key, profile name, or data does not match. */
export function decryptProfile(
  key: Buffer,
  profile: string,
  payload: Buffer,
): Buffer {
  assertKeyLength(key);
  const magicEnd = MAGIC.length;
  const ivEnd = magicEnd + IV_BYTES;
  if (
    payload.length < HEADER_BYTES ||
    !payload.subarray(0, magicEnd).equals(MAGIC)
  ) {
    throw new ProfileDecryptError(
      'The encrypted profile has an invalid format',
    );
  }
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    payload.subarray(magicEnd, ivEnd),
  );
  decipher.setAAD(Buffer.from(profile));
  decipher.setAuthTag(payload.subarray(ivEnd, HEADER_BYTES));
  try {
    return Buffer.concat([
      decipher.update(payload.subarray(HEADER_BYTES)),
      decipher.final(),
    ]);
  } catch {
    throw new ProfileDecryptError(
      'The encrypted profile could not be decrypted',
    );
  }
}

function assertKeyLength(key: Buffer): void {
  if (key.length !== KEY_BYTES) {
    throw new Error(`The encryption key must be ${KEY_BYTES} bytes`);
  }
}
