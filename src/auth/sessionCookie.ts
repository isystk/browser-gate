import { createHmac, timingSafeEqual } from 'node:crypto';

const MIN_SECRET_BYTES = 32;
const SIGNATURE_ALGORITHM = 'sha256';

type CookieData = Record<string, string>;

interface CookieEnvelope {
  k: string;
  d: CookieData;
  e: number;
}

/** HMAC 署名付き・有効期限付きの Cookie 値を発行・検証する。種別（kind）が違う値は受け付けない。 */
export class CookieSigner {
  constructor(
    private readonly secret: Buffer,
    private readonly now: () => number = Date.now,
  ) {
    if (secret.length < MIN_SECRET_BYTES) {
      throw new Error(
        `The signing secret must be at least ${MIN_SECRET_BYTES} bytes`,
      );
    }
  }

  /** Returns "<payload>.<signature>" carrying the data until ttlMs from now. */
  sign(kind: string, data: CookieData, ttlMs: number): string {
    const envelope: CookieEnvelope = {
      k: kind,
      d: data,
      e: this.now() + ttlMs,
    };
    const payload = Buffer.from(JSON.stringify(envelope)).toString('base64url');
    return `${payload}.${this.signature(payload)}`;
  }

  /** Returns the data if the value is correctly signed, of the given kind, and not expired. */
  verify(kind: string, value: string | undefined): CookieData | undefined {
    const envelope = this.parseVerified(value);
    if (envelope === undefined) return undefined;
    if (envelope.k !== kind || envelope.e <= this.now()) return undefined;
    return envelope.d;
  }

  private parseVerified(value: string | undefined): CookieEnvelope | undefined {
    const parts = value?.split('.') ?? [];
    const [payload, signature] = parts;
    if (parts.length !== 2 || !payload || !signature) return undefined;
    if (!this.isSignatureValid(payload, signature)) return undefined;
    return parseEnvelope(payload);
  }

  private isSignatureValid(payload: string, signature: string): boolean {
    const expected = Buffer.from(this.signature(payload));
    const actual = Buffer.from(signature);
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  }

  private signature(payload: string): string {
    return createHmac(SIGNATURE_ALGORITHM, this.secret)
      .update(payload)
      .digest('base64url');
  }
}

function parseEnvelope(payload: string): CookieEnvelope | undefined {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    );
    return isEnvelope(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isEnvelope(value: unknown): value is CookieEnvelope {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Partial<CookieEnvelope>;
  return (
    typeof candidate.k === 'string' &&
    typeof candidate.e === 'number' &&
    candidate.d !== null &&
    typeof candidate.d === 'object'
  );
}
