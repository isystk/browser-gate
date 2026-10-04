import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { AuthFlow } from '../../src/auth/authFlow.js';
import { OAuthClient } from '../../src/auth/oauth.js';
import { CookieSigner } from '../../src/auth/sessionCookie.js';
import type { AppConfig } from '../../src/config/appConfig.js';
import { createLogger } from '../../src/lib/logger.js';
import { createFakeGoogle } from '../../src/login/fakeGoogle.js';
import {
  type LoginBrowserSession,
  type LoginSessionHost,
  LoginService,
} from '../../src/login/loginService.js';
import { createLoginRoutes } from '../../src/login/routes.js';
import type { StorageStateLike } from '../../src/profile/cookieFilter.js';
import { type ObjectStore, ProfileStore } from '../../src/profile/store.js';

const BASE = 'https://login.example.test';
const CLIENT_ID = 'client-id.example';
const OWNER = 'owner@example.com';
const PROFILE = 'google-main';

const CONFIG: AppConfig = {
  api_keys: [],
  profiles: {
    [PROFILE]: { allowed_domains: ['example.com'] },
    'no-domains': { allowed_domains: [] },
  },
};

const STATE: StorageStateLike = {
  cookies: [
    {
      name: 'sid',
      value: 'v',
      domain: 'www.example.com',
      path: '/',
      expires: -1,
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
    {
      name: 'other',
      value: 'v',
      domain: 'other.org',
      path: '/',
      expires: -1,
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ],
  origins: [],
};

class FakeSessionHost implements LoginSessionHost {
  active: LoginBrowserSession | undefined;
  started: string[] = [];

  async start(profile: string): Promise<LoginBrowserSession> {
    this.started.push(profile);
    this.active = { profile, storageState: async () => STATE };
    return this.active;
  }

  current(): LoginBrowserSession | undefined {
    return this.active;
  }

  async end(): Promise<void> {
    this.active = undefined;
  }
}

class MemoryObjectStore implements ObjectStore {
  readonly objects = new Map<string, Buffer>();

  get size(): number {
    return this.objects.size;
  }

  has(name: string): boolean {
    return this.objects.has(name);
  }

  async put(name: string, data: Buffer): Promise<void> {
    this.objects.set(name, data);
  }
}

describe('login routes', () => {
  let app: Hono;
  let sessions: FakeSessionHost;
  let objects: MemoryObjectStore;
  let uiDir: string;
  let logLines: string[];

  beforeEach(async () => {
    uiDir = await mkdtemp(path.join(tmpdir(), 'bg-ui-'));
    await writeFile(
      path.join(uiDir, 'login.html'),
      '<html><body data-profile="{{PROFILE}}"><iframe src="/novnc/vnc.html"></iframe></body></html>',
    );
    await writeFile(path.join(uiDir, 'login.js'), 'console.log("ui");');
    await writeFile(path.join(uiDir, 'login.css'), 'body{}');
    const fakeGoogle = createFakeGoogle({
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
    const authFlow = new AuthFlow({
      oauth,
      signer: new CookieSigner(randomBytes(32)),
      allowedEmails: [OWNER],
    });
    sessions = new FakeSessionHost();
    objects = new MemoryObjectStore();
    logLines = [];
    const logger = createLogger((line) => logLines.push(line));
    const loginService = new LoginService({
      getConfig: async () => CONFIG,
      sessions,
      profileStore: new ProfileStore(objects, randomBytes(32)),
      logger,
    });
    app = createApp('login', {
      logger,
      loginRoutes: createLoginRoutes({
        authFlow,
        loginService,
        publicBaseUrl: BASE,
        uiDir,
        novncDir: uiDir,
        logger,
      }),
    });
    fakeAuthorize = async (authorizationUrl, email) => {
      const url = new URL(authorizationUrl);
      url.searchParams.set('fake_email', email);
      return fakeGoogle.app.request(url.toString());
    };
  });

  afterEach(async () => {
    await rm(uiDir, { recursive: true, force: true });
  });

  let fakeAuthorize: (
    authorizationUrl: string,
    email: string,
  ) => Promise<Response>;

  function cookiesOf(response: Response): Record<string, string> {
    return Object.fromEntries(
      response.headers
        .getSetCookie()
        .map((line) => line.split(';')[0] ?? '')
        .map((pair) => [
          pair.slice(0, pair.indexOf('=')),
          pair.slice(pair.indexOf('=') + 1),
        ]),
    );
  }

  function cookieHeader(cookies: Record<string, string>): string {
    return Object.entries(cookies)
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }

  /** /login → Google → /oauth/callback を辿り、コールバックのレスポンスと送ったCookieを返す。 */
  async function signIn(
    email: string,
  ): Promise<{ callback: Response; cookie: string }> {
    const start = await app.request(`${BASE}/login?profile=${PROFILE}`);
    const flowCookie = cookieHeader(cookiesOf(start));
    const google = await fakeAuthorize(
      start.headers.get('location') ?? '',
      email,
    );
    const callbackUrl = google.headers.get('location') ?? '';
    const callback = await app.request(callbackUrl, {
      headers: { cookie: flowCookie },
    });
    return { callback, cookie: cookieHeader(cookiesOf(callback)) };
  }

  async function signedInCookie(): Promise<string> {
    const { cookie } = await signIn(OWNER);
    return cookie;
  }

  function saveRequest(
    cookie: string,
    headers: Record<string, string> = {},
  ): Promise<Response> {
    return Promise.resolve(
      app.request(`${BASE}/login/save`, {
        method: 'POST',
        headers: {
          cookie,
          origin: BASE,
          'x-requested-with': 'browser-gate',
          ...headers,
        },
      }),
    );
  }

  describe('fake Google endpoints (local development)', () => {
    it('answers the self-call from a host other than the public URL', async () => {
      const fakeGoogle = createFakeGoogle({
        clientId: CLIENT_ID,
        clientSecret: 'secret',
      });
      const withFake = createApp('login', {
        logger: createLogger(() => undefined),
        loginRoutes: createLoginRoutes({
          authFlow: {} as AuthFlow,
          loginService: {} as LoginService,
          publicBaseUrl: BASE,
          uiDir,
          novncDir: uiDir,
          logger: createLogger(() => undefined),
        }),
        fakeGoogleRoutes: fakeGoogle.app,
      });

      const res = await withFake.request(
        'http://127.0.0.1:8080/__fake_google/token',
        { method: 'POST', body: 'code=unknown' },
      );

      expect(await res.json()).toEqual({ error: 'invalid_grant' });
    });
  });

  describe('unauthenticated access', () => {
    it('serves /healthz without authentication', async () => {
      const res = await app.request(`${BASE}/healthz`);

      expect(res.status).toBe(200);
    });

    it('redirects /login for a well-formed profile name to Google', async () => {
      const res = await app.request(`${BASE}/login?profile=${PROFILE}`);

      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toContain('/__fake_google/authorize');
      expect(sessions.started).toEqual([]);
    });

    it.each([[''], ['?profile='], ['?profile=../etc'], ['?profile=A%20B']])(
      'rejects /login%s with 400 before any redirect',
      async (query) => {
        const res = await app.request(`${BASE}/login${query}`);

        expect(res.status).toBe(400);
        expect(res.headers.get('location')).toBeNull();
      },
    );

    it.each([
      ['GET', '/novnc/vnc.html'],
      ['GET', '/login/assets/login.js'],
      ['POST', '/login/save'],
      ['POST', '/login/cancel'],
    ])('rejects %s %s with 401', async (method, pathname) => {
      const res = await app.request(`${BASE}${pathname}`, { method });

      expect(res.status).toBe(401);
      expect(sessions.started).toEqual([]);
    });

    it('rejects a forged session cookie', async () => {
      const res = await app.request(`${BASE}/login/save`, {
        method: 'POST',
        headers: {
          cookie: 'bg_session=forged.value',
          origin: BASE,
          'x-requested-with': 'browser-gate',
        },
      });

      expect(res.status).toBe(401);
    });

    it('rejects a request whose Host is not the canonical host', async () => {
      const res = await app.request(
        'https://other.example.test/login?profile=google-main',
      );

      expect(res.status).toBe(400);
    });

    it('does not expose the fake Google endpoints', async () => {
      const res = await app.request(`${BASE}/__fake_google/authorize`);

      expect(res.status).toBe(404);
    });
  });

  describe('OAuth callback', () => {
    it('signs in the allowed email and redirects back to /login with a hardened cookie', async () => {
      const { callback } = await signIn(OWNER);

      expect(callback.status).toBe(302);
      expect(callback.headers.get('location')).toBe(
        `/login?profile=${PROFILE}`,
      );
      const setCookie = callback.headers
        .getSetCookie()
        .find((line) => line.startsWith('bg_session='));
      expect(setCookie).toMatch(/HttpOnly/i);
      expect(setCookie).toMatch(/Secure/i);
      expect(setCookie).toMatch(/SameSite=Lax/i);
    });

    it('rejects an email that is not allowed and sets no session cookie', async () => {
      const { callback } = await signIn('stranger@example.com');

      expect(callback.status).toBe(403);
      expect(cookiesOf(callback).bg_session ?? '').toBe('');
    });

    it('rejects a callback without the flow cookie', async () => {
      const start = await app.request(`${BASE}/login?profile=${PROFILE}`);
      const google = await fakeAuthorize(
        start.headers.get('location') ?? '',
        OWNER,
      );

      const res = await app.request(google.headers.get('location') ?? '');

      expect(res.status).toBe(401);
    });

    it('rejects a callback carrying an OAuth error', async () => {
      const res = await app.request(
        `${BASE}/oauth/callback?error=access_denied`,
      );

      expect(res.status).toBe(401);
    });

    it('does not echo the OAuth error text back', async () => {
      const res = await app.request(
        `${BASE}/oauth/callback?error=%3Cscript%3Ealert(1)%3C/script%3E`,
      );

      expect(await res.text()).not.toContain('<script>');
    });
  });

  describe('authenticated access', () => {
    it('opens the login page and starts a browser session for a registered profile', async () => {
      const cookie = await signedInCookie();

      const res = await app.request(`${BASE}/login?profile=${PROFILE}`, {
        headers: { cookie },
      });

      expect(res.status).toBe(200);
      expect(await res.text()).toContain(`data-profile="${PROFILE}"`);
      expect(sessions.started).toEqual([PROFILE]);
      expect(res.headers.get('content-security-policy')).toContain(
        "frame-ancestors 'none'",
      );
      expect(res.headers.get('cache-control')).toBe('no-store');
    });

    it('does not open the login page for an unregistered profile', async () => {
      const cookie = await signedInCookie();

      const res = await app.request(`${BASE}/login?profile=unknown-profile`, {
        headers: { cookie },
      });

      expect(res.status).toBe(404);
      expect(sessions.started).toEqual([]);
    });

    it('serves the static UI assets only to signed-in users', async () => {
      const cookie = await signedInCookie();

      const res = await app.request(`${BASE}/login/assets/login.js`, {
        headers: { cookie },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('javascript');
    });

    it.each([
      ['/novnc/../login.html'],
      ['/novnc/%2e%2e/login.html'],
      ['/novnc/missing.js'],
    ])('does not serve %s', async (pathname) => {
      const cookie = await signedInCookie();

      const res = await app.request(`${BASE}${pathname}`, {
        headers: { cookie },
      });

      expect(res.status).toBe(404);
    });
  });

  describe('POST /login/save', () => {
    async function openSession(cookie: string): Promise<void> {
      await app.request(`${BASE}/login?profile=${PROFILE}`, {
        headers: { cookie },
      });
    }

    it('encrypts and stores only the allowed-domain cookies, then ends the session', async () => {
      const cookie = await signedInCookie();
      await openSession(cookie);

      const res = await saveRequest(cookie);

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, profile: PROFILE });
      expect(objects.has(`profiles/${PROFILE}.enc`)).toBe(true);
      expect(sessions.current()).toBeUndefined();
    });

    it.each([
      ['no X-Requested-With header', { 'x-requested-with': '' }],
      ['a foreign Origin', { origin: 'https://evil.example' }],
    ])('rejects a save with %s', async (_label, headers) => {
      const cookie = await signedInCookie();
      await openSession(cookie);

      const res = await saveRequest(cookie, headers);

      expect(res.status).toBe(403);
      expect(objects.size).toBe(0);
      expect(sessions.current()).toBeDefined();
    });

    it('rejects a save when no login session is active', async () => {
      const cookie = await signedInCookie();

      const res = await saveRequest(cookie);

      expect(res.status).toBe(400);
      expect(objects.size).toBe(0);
    });

    it('does not write the cookie values or the profile contents to the log', async () => {
      const cookie = await signedInCookie();
      await openSession(cookie);

      await saveRequest(cookie);

      expect(logLines.join('\n')).not.toMatch(/sid|"v"|other\.org/);
    });
  });

  describe('POST /login/cancel', () => {
    it('ends the session without storing anything', async () => {
      const cookie = await signedInCookie();
      await app.request(`${BASE}/login?profile=${PROFILE}`, {
        headers: { cookie },
      });

      const res = await app.request(`${BASE}/login/cancel`, {
        method: 'POST',
        headers: {
          cookie,
          origin: BASE,
          'x-requested-with': 'browser-gate',
        },
      });

      expect(res.status).toBe(200);
      expect(sessions.current()).toBeUndefined();
      expect(objects.size).toBe(0);
    });
  });
});
