import { randomBytes } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import { AuthFlow } from '../../src/auth/authFlow.js';
import { CookieSigner } from '../../src/auth/sessionCookie.js';
import { OAuthClient } from '../../src/auth/oauth.js';
import { AppError } from '../../src/lib/errors.js';
import { createFakeGoogle } from '../../src/login/fakeGoogle.js';

const BASE = 'https://login.example.test';
const CLIENT_ID = 'client-id.example';
const OWNER = 'owner@example.com';

describe('AuthFlow', () => {
  let flow: AuthFlow;
  let fakeGoogle: ReturnType<typeof createFakeGoogle>;

  beforeEach(() => {
    fakeGoogle = createFakeGoogle({
      clientId: CLIENT_ID,
      clientSecret: 'secret',
    });
    const oauth = new OAuthClient(
      {
        clientId: CLIENT_ID,
        clientSecret: 'secret',
        redirectUri: `${BASE}/oauth/callback`,
        endpoints: {
          authorizationUrl: `${BASE}/__fake_google/authorize`,
          tokenUrl: `${BASE}/__fake_google/token`,
        },
      },
      async (url, init) => fakeGoogle.app.request(String(url), init),
    );
    flow = new AuthFlow({
      oauth,
      signer: new CookieSigner(randomBytes(32)),
      allowedEmails: [OWNER],
    });
  });

  /** ブラウザが Google で認証し、リダイレクトされる動きを再現する。 */
  async function authenticateAs(
    authorizationUrl: string,
    email: string,
  ): Promise<{ code: string; state: string }> {
    const url = new URL(authorizationUrl);
    url.searchParams.set('fake_email', email);
    const response = await fakeGoogle.app.request(url.toString());
    const location = new URL(response.headers.get('location') ?? '');
    return {
      code: location.searchParams.get('code') ?? '',
      state: location.searchParams.get('state') ?? '',
    };
  }

  async function codeOf(run: () => Promise<unknown>): Promise<string> {
    try {
      await run();
      return 'NO_ERROR';
    } catch (error) {
      return error instanceof AppError ? error.code : 'NOT_APP_ERROR';
    }
  }

  it('signs in an allowed email and returns an authenticated session for the profile', async () => {
    const { authorizationUrl, flowCookie } = flow.begin('google-main');
    const { code, state } = await authenticateAs(authorizationUrl, OWNER);

    const result = await flow.complete({ code, state, flowCookie });

    expect(result.profile).toBe('google-main');
    expect(flow.authenticate(result.sessionCookie)).toEqual({ email: OWNER });
  });

  it('rejects an email that is not on the allow list with FORBIDDEN_USER', async () => {
    const { authorizationUrl, flowCookie } = flow.begin('google-main');
    const { code, state } = await authenticateAs(
      authorizationUrl,
      'stranger@example.com',
    );

    expect(await codeOf(() => flow.complete({ code, state, flowCookie }))).toBe(
      'FORBIDDEN_USER',
    );
  });

  it('rejects a callback whose state does not match the flow cookie', async () => {
    const { authorizationUrl, flowCookie } = flow.begin('google-main');
    const { code } = await authenticateAs(authorizationUrl, OWNER);

    expect(
      await codeOf(() => flow.complete({ code, state: 'forged', flowCookie })),
    ).toBe('UNAUTHORIZED');
  });

  it.each([[undefined], ['garbage']])(
    'rejects a callback with the flow cookie %j',
    async (flowCookie) => {
      const { authorizationUrl } = flow.begin('google-main');
      const { code, state } = await authenticateAs(authorizationUrl, OWNER);

      expect(
        await codeOf(() => flow.complete({ code, state, flowCookie })),
      ).toBe('UNAUTHORIZED');
    },
  );

  it('rejects a code issued for another flow (PKCE verifier mismatch)', async () => {
    const first = flow.begin('google-main');
    const second = flow.begin('google-main');
    const { code } = await authenticateAs(first.authorizationUrl, OWNER);
    const { state } = await authenticateAs(second.authorizationUrl, OWNER);

    expect(
      await codeOf(() =>
        flow.complete({ code, state, flowCookie: second.flowCookie }),
      ),
    ).toBe('UNAUTHORIZED');
  });

  it.each([[undefined], [''], ['forged.value']])(
    'does not authenticate the session cookie %j',
    (value) => {
      expect(flow.authenticate(value)).toBeUndefined();
    },
  );

  it('does not accept a flow cookie as a session cookie', () => {
    const { flowCookie } = flow.begin('google-main');

    expect(flow.authenticate(flowCookie)).toBeUndefined();
  });
});
