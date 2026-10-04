import { createHash, randomBytes } from 'node:crypto';

import { AppError } from '../lib/errors.js';

export interface OAuthEndpoints {
  authorizationUrl: string;
  tokenUrl: string;
}

export interface OAuthClientConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  endpoints: OAuthEndpoints;
}

export interface VerifiedIdentity {
  email: string;
}

export interface AuthorizationParams {
  state: string;
  nonce: string;
  codeChallenge: string;
}

export interface CodeExchange {
  code: string;
  codeVerifier: string;
  nonce: string;
}

export const GOOGLE_ENDPOINTS: OAuthEndpoints = {
  authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
};

const PKCE_VERIFIER_BYTES = 32;
const TOKEN_REQUEST_TIMEOUT_MS = 10_000;
const MS_PER_SECOND = 1000;
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

/** Creates a PKCE code verifier and its S256 challenge. */
export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(PKCE_VERIFIER_BYTES).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/** Google OAuth 2.0 の認可コードフロー（PKCE 付き）を行うクライアント。 */
export class OAuthClient {
  constructor(
    private readonly config: OAuthClientConfig,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  /** Builds the URL the browser is redirected to in order to sign in. */
  buildAuthorizationUrl(params: AuthorizationParams): string {
    const url = new URL(this.config.endpoints.authorizationUrl);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: 'openid email',
      state: params.state,
      nonce: params.nonce,
      code_challenge: params.codeChallenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    return url.toString();
  }

  /** Exchanges the authorization code for an ID token and returns the verified identity, or throws UNAUTHORIZED. */
  async exchangeCode(exchange: CodeExchange): Promise<VerifiedIdentity> {
    const idToken = await this.requestIdToken(exchange);
    return this.verifyClaims(decodeClaims(idToken), exchange.nonce);
  }

  private async requestIdToken(exchange: CodeExchange): Promise<string> {
    const response = await this.postToken(exchange);
    const body: unknown = await response.json().catch(() => undefined);
    const idToken = (body as { id_token?: unknown } | undefined)?.id_token;
    if (!response.ok || typeof idToken !== 'string') throw unauthorized();
    return idToken;
  }

  private async postToken(exchange: CodeExchange): Promise<Response> {
    try {
      return await this.fetchFn(this.config.endpoints.tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: exchange.code,
          code_verifier: exchange.codeVerifier,
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          redirect_uri: this.config.redirectUri,
        }).toString(),
        signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw unauthorized();
    }
  }

  private verifyClaims(
    claims: Record<string, unknown>,
    nonce: string,
  ): VerifiedIdentity {
    const isValid =
      typeof claims.iss === 'string' &&
      GOOGLE_ISSUERS.includes(claims.iss) &&
      claims.aud === this.config.clientId &&
      typeof claims.exp === 'number' &&
      claims.exp * MS_PER_SECOND > this.now() &&
      claims.nonce === nonce &&
      claims.email_verified === true &&
      typeof claims.email === 'string' &&
      claims.email !== '';
    if (!isValid) throw unauthorized();
    return { email: claims.email as string };
  }
}

/**
 * Decodes the payload of an ID token without verifying its signature.
 * The token is received directly from the token endpoint over TLS together with the client secret, which Google documents as sufficient; issuer, audience, expiry and nonce are still checked by the caller.
 */
function decodeClaims(idToken: string): Record<string, unknown> {
  const parts = idToken.split('.');
  const payload = parts.length === 3 ? parts[1] : undefined;
  if (payload === undefined) throw unauthorized();
  try {
    const claims: unknown = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    );
    if (claims === null || typeof claims !== 'object') throw unauthorized();
    return claims as Record<string, unknown>;
  } catch {
    throw unauthorized();
  }
}

function unauthorized(): AppError {
  return new AppError('UNAUTHORIZED', 'Sign-in with Google failed');
}
