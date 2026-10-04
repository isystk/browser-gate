import { createHash, randomBytes } from 'node:crypto';

import { Hono } from 'hono';

export interface FakeGoogleOptions {
  clientId: string;
  clientSecret: string;
}

interface IssuedCode {
  email: string;
  nonce: string;
  challenge: string;
  redirectUri: string;
}

const FAKE_ISSUER = 'https://accounts.google.com';
const ID_TOKEN_LIFETIME_SECONDS = 600;
const CODE_BYTES = 16;
const BAD_REQUEST = 400;
const MS_PER_SECOND = 1000;

/** Builds an unsigned JWT-shaped ID token from the given claims. */
export function buildFakeIdToken(claims: Record<string, unknown>): string {
  const encode = (value: unknown): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(claims)}.`;
}

/**
 * Creates an in-process stand-in for Google's OAuth endpoints (authorize and token) for local development and tests.
 * It must never be mounted on Cloud Run; the environment loader refuses it there.
 */
export function createFakeGoogle(options: FakeGoogleOptions): { app: Hono } {
  const issued = new Map<string, IssuedCode>();
  const app = new Hono();

  app.get('/__fake_google/authorize', (c) => {
    const query = c.req.query();
    const email = query.fake_email;
    const redirectUri = query.redirect_uri;
    if (query.client_id !== options.clientId || !redirectUri) {
      return c.text('invalid request', BAD_REQUEST);
    }
    if (!email) return c.html(renderEmailForm(query));
    const code = randomBytes(CODE_BYTES).toString('hex');
    issued.set(code, {
      email,
      nonce: query.nonce ?? '',
      challenge: query.code_challenge ?? '',
      redirectUri,
    });
    const target = new URL(redirectUri);
    target.searchParams.set('code', code);
    target.searchParams.set('state', query.state ?? '');
    return c.redirect(target.toString(), 302);
  });

  app.post('/__fake_google/token', async (c) => {
    const form = new URLSearchParams(await c.req.text());
    const entry = issued.get(form.get('code') ?? '');
    issued.delete(form.get('code') ?? '');
    const isValid =
      entry !== undefined &&
      form.get('client_id') === options.clientId &&
      form.get('client_secret') === options.clientSecret &&
      form.get('redirect_uri') === entry.redirectUri &&
      sha256Base64Url(form.get('code_verifier') ?? '') === entry.challenge;
    if (!isValid) return c.json({ error: 'invalid_grant' }, BAD_REQUEST);
    return c.json({
      token_type: 'Bearer',
      id_token: buildFakeIdToken({
        iss: FAKE_ISSUER,
        aud: options.clientId,
        exp: Math.floor(Date.now() / MS_PER_SECOND) + ID_TOKEN_LIFETIME_SECONDS,
        nonce: entry.nonce,
        email: entry.email,
        email_verified: true,
      }),
    });
  });

  return { app };
}

function sha256Base64Url(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

function renderEmailForm(query: Record<string, string>): string {
  const hidden = Object.entries(query)
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`,
    )
    .join('');
  return `<!doctype html><meta charset="utf-8"><title>Fake Google</title><h1>Fake Google sign-in (local only)</h1><form method="get">${hidden}<input name="fake_email" type="email" placeholder="email" required autofocus><button>Sign in</button></form>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
