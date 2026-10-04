import { beforeEach, describe, expect, it } from 'vitest';

import {
  GOOGLE_ENDPOINTS,
  OAuthClient,
  createPkcePair,
} from '../../src/auth/oauth.js';
import { AppError } from '../../src/lib/errors.js';
import { buildFakeIdToken } from '../../src/login/fakeGoogle.js';

const CLIENT_ID = 'client-id.example';
const REDIRECT_URI = 'https://login.example.test/oauth/callback';
const NONCE = 'nonce-1';
const NOW_MS = 1_800_000_000_000;

function tokenResponse(idToken: string): typeof fetch {
  return async () => Response.json({ id_token: idToken });
}

describe('createPkcePair', () => {
  it('creates a verifier and its S256 challenge', async () => {
    const { verifier, challenge } = createPkcePair();
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(verifier),
    );

    expect(Buffer.from(digest).toString('base64url')).toBe(challenge);
    expect(verifier.length).toBeGreaterThanOrEqual(43);
  });
});

describe('OAuthClient', () => {
  let claims: Record<string, unknown>;

  beforeEach(() => {
    claims = {
      iss: 'https://accounts.google.com',
      aud: CLIENT_ID,
      exp: Math.floor(NOW_MS / 1000) + 600,
      nonce: NONCE,
      email: 'owner@example.com',
      email_verified: true,
    };
  });

  function clientWith(fetchFn: typeof fetch): OAuthClient {
    return new OAuthClient(
      {
        clientId: CLIENT_ID,
        clientSecret: 'client-secret',
        redirectUri: REDIRECT_URI,
        endpoints: GOOGLE_ENDPOINTS,
      },
      fetchFn,
      () => NOW_MS,
    );
  }

  async function exchange(
    override: Record<string, unknown> = {},
  ): Promise<{ email: string }> {
    const client = clientWith(
      tokenResponse(buildFakeIdToken({ ...claims, ...override })),
    );
    return client.exchangeCode({ code: 'c', codeVerifier: 'v', nonce: NONCE });
  }

  async function codeOf(run: () => Promise<unknown>): Promise<string> {
    try {
      await run();
      return 'NO_ERROR';
    } catch (error) {
      return error instanceof AppError ? error.code : 'NOT_APP_ERROR';
    }
  }

  it('builds an authorization URL with PKCE, state, nonce and the email scope', () => {
    const url = new URL(
      clientWith(fetch).buildAuthorizationUrl({
        state: 'st',
        nonce: NONCE,
        codeChallenge: 'ch',
      }),
    );

    expect(url.origin + url.pathname).toBe(GOOGLE_ENDPOINTS.authorizationUrl);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: 'openid email',
      state: 'st',
      nonce: NONCE,
      code_challenge: 'ch',
      code_challenge_method: 'S256',
    });
  });

  it('returns the verified email from the ID token', async () => {
    expect(await exchange()).toEqual({ email: 'owner@example.com' });
  });

  it('sends the code, verifier and client secret to the token endpoint', async () => {
    let received: URLSearchParams | undefined;
    const client = clientWith(async (_url, init) => {
      received = new URLSearchParams(String(init?.body));
      return Response.json({ id_token: buildFakeIdToken(claims) });
    });

    await client.exchangeCode({
      code: 'the-code',
      codeVerifier: 'the-verifier',
      nonce: NONCE,
    });

    expect(Object.fromEntries(received ?? [])).toMatchObject({
      grant_type: 'authorization_code',
      code: 'the-code',
      code_verifier: 'the-verifier',
      client_secret: 'client-secret',
      redirect_uri: REDIRECT_URI,
    });
  });

  it.each([
    ['audience mismatch', { aud: 'other-client' }],
    ['issuer mismatch', { iss: 'https://evil.example' }],
    ['expired token', { exp: Math.floor(NOW_MS / 1000) - 1 }],
    ['nonce mismatch', { nonce: 'other-nonce' }],
    ['unverified email', { email_verified: false }],
    ['missing email', { email: undefined }],
    ['non-string email', { email: 42 }],
  ])('rejects an ID token with %s', async (_label, override) => {
    expect(await codeOf(() => exchange(override))).toBe('UNAUTHORIZED');
  });

  it.each([
    ['a non-JWT string', 'not-a-jwt'],
    ['a JWT with an invalid payload', 'a.!!!.c'],
  ])('rejects %s', async (_label, idToken) => {
    const client = clientWith(tokenResponse(idToken));

    expect(
      await codeOf(() =>
        client.exchangeCode({ code: 'c', codeVerifier: 'v', nonce: NONCE }),
      ),
    ).toBe('UNAUTHORIZED');
  });

  it('rejects when the token endpoint returns an error status', async () => {
    const client = clientWith(async () => new Response('{}', { status: 400 }));

    expect(
      await codeOf(() =>
        client.exchangeCode({ code: 'c', codeVerifier: 'v', nonce: NONCE }),
      ),
    ).toBe('UNAUTHORIZED');
  });

  it('rejects when the token endpoint is unreachable', async () => {
    const client = clientWith(async () => {
      throw new TypeError('fetch failed');
    });

    expect(
      await codeOf(() =>
        client.exchangeCode({ code: 'c', codeVerifier: 'v', nonce: NONCE }),
      ),
    ).toBe('UNAUTHORIZED');
  });
});
