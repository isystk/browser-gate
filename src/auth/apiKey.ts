import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 設定JSONに保存する APIキーの記録。平文キーは保持せずハッシュだけを持つ。 */
export interface ApiKeyRecord {
  id: string;
  hash: string;
  profiles: string[];
  created_at: string;
  revoked_at?: string;
}

const KEY_PREFIX = 'bg_';
const KEY_BYTES = 32;
const HASH_PREFIX = 'sha256:';
const MAX_TOKEN_LENGTH = 256;
const BEARER_PATTERN = /^bearer ([^\s]+)$/i;

/** Generates a new random API key. The plaintext must be shown to the operator only once. */
export function generateApiKey(): string {
  return `${KEY_PREFIX}${randomBytes(KEY_BYTES).toString('base64url')}`;
}

/** Returns the SHA-256 digest used to store an API key. Keys are random, so no salt is needed. */
export function hashApiKey(key: string): string {
  return `${HASH_PREFIX}${createHash('sha256').update(key).digest('hex')}`;
}

/** Returns the token of a `Bearer <token>` header, or undefined if the header is missing or malformed. */
export function extractBearerToken(
  header: string | undefined,
): string | undefined {
  if (header === undefined) return undefined;
  const token = BEARER_PATTERN.exec(header)?.[1];
  if (token === undefined || token.length > MAX_TOKEN_LENGTH) return undefined;
  return token;
}

/** Returns the matching non-revoked record for an Authorization header, or undefined. */
export function verifyApiKey(
  header: string | undefined,
  records: readonly ApiKeyRecord[],
): ApiKeyRecord | undefined {
  const token = extractBearerToken(header);
  if (token === undefined) return undefined;
  const presented = Buffer.from(hashApiKey(token));
  const matches = records.filter((record) =>
    isSameHash(presented, record.hash),
  );
  return matches.find((record) => record.revoked_at === undefined);
}

function isSameHash(presented: Buffer, stored: string): boolean {
  const expected = Buffer.from(stored);
  return (
    expected.length === presented.length && timingSafeEqual(presented, expected)
  );
}
