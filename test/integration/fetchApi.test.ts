import { randomBytes } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import {
  type ApiKeyRecord,
  generateApiKey,
  hashApiKey,
} from '../../src/auth/apiKey.js';
import type { AppConfig } from '../../src/config/appConfig.js';
import { FetchService, type PageFetcher } from '../../src/fetch/service.js';
import { createLogger } from '../../src/lib/logger.js';
import { ProfileLoader } from '../../src/profile/loader.js';
import { type ObjectStore, ProfileStore } from '../../src/profile/store.js';
import {
  DEFAULT_EGRESS_POLICY,
  type EgressPolicy,
} from '../../src/security/urlGuard.js';
import {
  type FixtureProxy,
  type FixtureServer,
  SESSION_COOKIE,
  SESSION_VALUE,
  startFixtureProxy,
  startFixtureServer,
} from '../fixtures/servers.js';

const PUBLIC_IP = '93.184.216.34';
const SMALL_LIMIT_BYTES = 200_000;

const KEY = generateApiKey();
const KEY_NO_PROFILE = generateApiKey();
const KEY_REVOKED = generateApiKey();

function record(
  id: string,
  key: string,
  overrides: Partial<ApiKeyRecord> = {},
): ApiKeyRecord {
  return {
    id,
    hash: hashApiKey(key),
    profiles: [],
    created_at: '2026-10-04T00:00:00.000Z',
    ...overrides,
  };
}

const CONFIG: AppConfig = {
  api_keys: [
    record('full', KEY, { profiles: ['news', 'member', 'expiring'] }),
    record('anonymous-only', KEY_NO_PROFILE),
    record('revoked', KEY_REVOKED, { revoked_at: '2026-10-05T00:00:00.000Z' }),
  ],
  profiles: {
    news: { allowed_domains: ['example.com'] },
    member: { allowed_domains: ['127.0.0.1'] },
    expiring: {
      allowed_domains: ['127.0.0.1'],
      login_url_patterns: ['/login'],
    },
  },
};

class MemoryObjectStore implements ObjectStore {
  readonly objects = new Map<string, Buffer>();

  async put(name: string, data: Buffer): Promise<void> {
    this.objects.set(name, data);
  }

  async get(name: string): Promise<Buffer | undefined> {
    return this.objects.get(name);
  }
}

function sessionState(domain: string): Buffer {
  return Buffer.from(
    JSON.stringify({
      cookies: [
        {
          name: SESSION_COOKIE,
          value: SESSION_VALUE,
          domain,
          path: '/',
          expires: -1,
          httpOnly: true,
          secure: false,
          sameSite: 'Lax',
        },
      ],
      origins: [],
    }),
  );
}

interface ApiResult {
  status: number;
  json: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- テストでレスポンスJSONを緩く検査する
}

describe('POST /fetch', () => {
  let web: FixtureServer;
  let internal: FixtureServer;
  let control: FixtureServer;
  let upstream: FixtureProxy;
  let policy: EgressPolicy;
  let logLines: string[];
  let call: (
    body: unknown,
    authorization?: string | null,
  ) => Promise<ApiResult>;
  let callStrict: (
    body: unknown,
    authorization?: string | null,
  ) => Promise<ApiResult>;

  function buildCaller(
    egress: EgressPolicy,
    maxResponseBytes: number,
    resolve?: (host: string) => Promise<string[]>,
    profiles?: ProfileLoader,
    pageFetcher?: PageFetcher,
  ) {
    const logger = createLogger((line) => logLines.push(line));
    const service = new FetchService({
      getConfig: async () => CONFIG,
      policy: egress,
      maxResponseBytes,
      logger,
      resolve,
      profiles,
      pageFetcher,
    });
    const app = createApp('api', { fetchService: service, logger });
    return async (
      body: unknown,
      authorization: string | null = `Bearer ${KEY}`,
    ): Promise<ApiResult> => {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
      };
      if (authorization !== null) headers.authorization = authorization;
      const res = await app.request('/fetch', {
        method: 'POST',
        headers,
        body: typeof body === 'string' ? body : JSON.stringify(body),
      });
      return {
        status: res.status,
        json: (await res.json()) as ApiResult['json'],
      };
    };
  }

  beforeAll(async () => {
    [web, internal, control, upstream] = await Promise.all([
      startFixtureServer(),
      startFixtureServer(),
      startFixtureServer(),
      startFixtureProxy(),
    ]);
    logLines = [];
    policy = {
      allowedPorts: DEFAULT_EGRESS_POLICY.allowedPorts,
      exemptTargets: [
        `127.0.0.1:${web.port}`,
        `127.0.0.1:${control.port}`,
        `127.0.0.1:${upstream.port}`,
        '127.0.0.1:9',
      ],
    };
    const resolve = async (host: string): Promise<string[]> =>
      host === 'rebind.test' ? ['10.0.0.1'] : [PUBLIC_IP];
    call = buildCaller(policy, SMALL_LIMIT_BYTES * 100, resolve);
    callStrict = buildCaller(policy, SMALL_LIMIT_BYTES, resolve);
  });

  afterAll(async () => {
    await Promise.all(
      [web, internal, control, upstream].map((server) => server.close()),
    );
  });

  describe('outputs, extract and steps', () => {
    it('returns html, text, screenshot and extract', async () => {
      const { status, json } = await call({
        url: `${web.origin}/article`,
        outputs: ['html', 'text', 'screenshot'],
        extract: { title: 'h1', paragraphs: 'article p' },
      });

      expect(status).toBe(200);
      expect(json).toMatchObject({
        ok: true,
        status: 200,
        final_url: `${web.origin}/article`,
      });
      expect(json.html).toContain('Fixture Title');
      expect(json.text).toContain('First paragraph');
      expect(
        Buffer.from(json.screenshot, 'base64').subarray(1, 4).toString(),
      ).toBe('PNG');
      expect(json.extract).toEqual({
        title: ['Fixture Title'],
        paragraphs: ['First paragraph', 'Second paragraph'],
      });
      expect(typeof json.elapsed_ms).toBe('number');
    });

    it('returns only html when neither outputs nor extract is given', async () => {
      const { json } = await call({ url: `${web.origin}/article` });

      expect(Object.keys(json).sort()).toEqual([
        'elapsed_ms',
        'final_url',
        'html',
        'ok',
        'status',
        'url',
      ]);
    });

    it('returns only extract when outputs is empty', async () => {
      const { json } = await call({
        url: `${web.origin}/article`,
        outputs: [],
        extract: { title: 'h1' },
      });

      expect(json.html).toBeUndefined();
      expect(json.extract).toEqual({ title: ['Fixture Title'] });
    });

    it('runs wait_for, click and scroll steps', async () => {
      const { json } = await call({
        url: `${web.origin}/article`,
        steps: [
          { wait_for: 'article' },
          { click: '.more' },
          { wait_for: '#extra' },
          { scroll: 'bottom' },
        ],
        extract: { extra: '#extra' },
      });

      expect(json.extract).toEqual({ extra: ['Extra content'] });
    });

    it('fires scroll handlers when scrolling to the bottom', async () => {
      const { json } = await call({
        url: `${web.origin}/scroll`,
        steps: [{ scroll: 'bottom' }],
        outputs: ['html'],
      });

      expect(json.ok).toBe(true);
    });

    it('returns the site status as a successful fetch', async () => {
      const { status, json } = await call({
        url: `${web.origin}/status/403`,
        outputs: ['text'],
      });

      expect(status).toBe(200);
      expect(json).toMatchObject({ ok: true, status: 403 });
      expect(json.text).toContain('blocked by site');
    });

    it('reports an invalid selector as INVALID_REQUEST', async () => {
      const { status, json } = await call({
        url: `${web.origin}/article`,
        steps: [{ click: '[[[' }],
      });

      expect(status).toBe(400);
      expect(json.error.code).toBe('INVALID_REQUEST');
    });

    it('does not run page scripts supplied through the API', async () => {
      const { status, json } = await call({
        url: `${web.origin}/article`,
        steps: [{ evaluate: 'document.title' }],
      });

      expect(status).toBe(400);
      expect(json.error.code).toBe('INVALID_REQUEST');
    });
  });

  describe('error codes', () => {
    it('returns RESPONSE_TOO_LARGE when the result exceeds the limit', async () => {
      const { status, json } = await callStrict({ url: `${web.origin}/big` });

      expect(status).toBe(413);
      expect(json.error.code).toBe('RESPONSE_TOO_LARGE');
    });

    it('returns TIMEOUT when the page does not respond in time', async () => {
      const { status, json } = await call({
        url: `${web.origin}/slow`,
        timeout_ms: 1500,
      });

      expect(status).toBe(504);
      expect(json.error.code).toBe('TIMEOUT');
    });

    it('returns TIMEOUT when a step waits for a selector that never appears', async () => {
      const { json } = await call({
        url: `${web.origin}/article`,
        steps: [{ wait_for: '#never' }],
        timeout_ms: 2000,
      });

      expect(json.error.code).toBe('TIMEOUT');
    });

    it('returns NAVIGATION_FAILED when the connection is refused', async () => {
      const { status, json } = await call({ url: 'http://127.0.0.1:9/' });

      expect(status).toBe(502);
      expect(json.error.code).toBe('NAVIGATION_FAILED');
    });

    it('returns INVALID_REQUEST for malformed JSON', async () => {
      const { status, json } = await call('{not json');

      expect(status).toBe(400);
      expect(json.error.code).toBe('INVALID_REQUEST');
    });

    it('returns INVALID_REQUEST with 413 for an oversized request body', async () => {
      const { status, json } = await call({
        url: `${web.origin}/article`,
        extract: { pad: 'x'.repeat(70_000) },
      });

      expect(status).toBe(413);
      expect(json.error.code).toBe('INVALID_REQUEST');
    });

    it('returns a JSON error for unknown routes', async () => {
      const logger = createLogger(() => undefined);
      const app = createApp('api', { logger });

      const res = await app.request('/nope');

      expect(res.status).toBe(404);
    });
  });

  describe('authentication and authorization', () => {
    it.each([
      ['no Authorization header', null],
      ['a wrong key', `Bearer ${generateApiKey()}`],
      ['a non-bearer scheme', `Basic ${KEY}`],
      ['a revoked key', `Bearer ${KEY_REVOKED}`],
    ])('returns UNAUTHORIZED for %s', async (_label, authorization) => {
      const { status, json } = await call(
        { url: `${web.origin}/article` },
        authorization,
      );

      expect(status).toBe(401);
      expect(json.error.code).toBe('UNAUTHORIZED');
    });

    it('authenticates before validating the body', async () => {
      const { status } = await call('{not json', 'Bearer wrong');

      expect(status).toBe(401);
    });

    it('returns FORBIDDEN_PROFILE for a profile the key may not use', async () => {
      const { status, json } = await call(
        { url: 'https://example.com/', profile: 'news' },
        `Bearer ${KEY_NO_PROFILE}`,
      );

      expect(status).toBe(403);
      expect(json.error.code).toBe('FORBIDDEN_PROFILE');
    });

    it('returns FORBIDDEN_PROFILE for an unknown profile', async () => {
      const { json } = await call({
        url: 'https://example.com/',
        profile: 'ghost',
      });

      expect(json.error.code).toBe('FORBIDDEN_PROFILE');
    });

    it('returns FORBIDDEN_DOMAIN outside the profile allowed domains', async () => {
      const { status, json } = await call({
        url: 'https://example.org/',
        profile: 'news',
      });

      expect(status).toBe(403);
      expect(json.error.code).toBe('FORBIDDEN_DOMAIN');
    });
  });

  describe('profile fetching', () => {
    const OTHER_HOST = 'other.test';
    let objects: MemoryObjectStore;
    let profileStore: ProfileStore;
    let callWithProfiles: (body: unknown) => Promise<ApiResult>;
    let callWithoutProfiles: (body: unknown) => Promise<ApiResult>;

    beforeAll(() => {
      objects = new MemoryObjectStore();
      profileStore = new ProfileStore(objects, randomBytes(32));
      const resolve = async (host: string): Promise<string[]> =>
        host === OTHER_HOST ? ['127.0.0.1'] : [PUBLIC_IP];
      const otherPolicy: EgressPolicy = {
        ...policy,
        exemptTargets: [
          ...policy.exemptTargets,
          `${OTHER_HOST}:${control.port}`,
        ],
      };
      callWithProfiles = buildCaller(
        otherPolicy,
        SMALL_LIMIT_BYTES * 100,
        resolve,
        new ProfileLoader(profileStore),
      );
      callWithoutProfiles = buildCaller(policy, SMALL_LIMIT_BYTES * 100);
    });

    it('shows the signed-in page with the profile and the sign-in page without it', async () => {
      await profileStore.save('member', sessionState('127.0.0.1'));
      const url = `${web.origin}/whoami`;

      const withProfile = await callWithProfiles({
        url,
        profile: 'member',
        outputs: ['text'],
      });
      const anonymous = await callWithProfiles({ url, outputs: ['text'] });

      expect(withProfile.json.text).toContain('Signed in as alice');
      expect(anonymous.json.text).toContain('Please sign in');
    });

    it('does not write the session cookie value to the logs', async () => {
      await profileStore.save('member', sessionState('127.0.0.1'));
      logLines.length = 0;

      await callWithProfiles({
        url: `${web.origin}/whoami`,
        profile: 'member',
      });

      expect(logLines.length).toBeGreaterThan(0);
      expect(logLines.join('\n')).not.toContain(SESSION_VALUE);
    });

    it('returns PROFILE_NOT_FOUND for a registered profile that was never saved', async () => {
      const { status, json } = await callWithProfiles({
        url: 'https://example.com/',
        profile: 'news',
      });

      expect(status).toBe(404);
      expect(json.error.code).toBe('PROFILE_NOT_FOUND');
    });

    it('returns INTERNAL_ERROR without details when the stored data is corrupted', async () => {
      objects.objects.set('profiles/news.enc', Buffer.from('BGP1 corrupted'));

      const { status, json } = await callWithProfiles({
        url: 'https://example.com/',
        profile: 'news',
      });

      expect(status).toBe(500);
      expect(json.error.code).toBe('INTERNAL_ERROR');
      expect(JSON.stringify(json)).not.toContain('corrupted');
    });

    it('denies a key without the profile even when the saved data exists', async () => {
      await profileStore.save('member', sessionState('127.0.0.1'));

      const { json } = await callWithProfiles({
        url: `${web.origin}/whoami`,
        profile: 'member',
      });
      const forbidden = await buildCaller(
        policy,
        SMALL_LIMIT_BYTES,
        undefined,
        new ProfileLoader(profileStore),
      )(
        { url: `${web.origin}/whoami`, profile: 'member' },
        `Bearer ${KEY_NO_PROFILE}`,
      );

      expect(json.ok).toBe(true);
      expect(forbidden.json.error.code).toBe('FORBIDDEN_PROFILE');
    });

    it('returns INTERNAL_ERROR when profile storage is not configured on the server', async () => {
      const { status, json } = await callWithoutProfiles({
        url: `${web.origin}/whoami`,
        profile: 'member',
      });

      expect(status).toBe(500);
      expect(json.error.code).toBe('INTERNAL_ERROR');
    });

    beforeEach(() => {
      control.hits.length = 0;
      control.cookieHeaders.length = 0;
    });

    it('rejects a redirect to a domain outside the profile without sending it the session cookie', async () => {
      await profileStore.save('member', sessionState('127.0.0.1'));
      const target = `http://${OTHER_HOST}:${control.port}/whoami`;

      const { status, json } = await callWithProfiles({
        url: `${web.origin}/redirect?to=${encodeURIComponent(target)}`,
        profile: 'member',
      });

      expect(status).toBe(403);
      expect(json.error.code).toBe('FORBIDDEN_DOMAIN');
      expect(JSON.stringify(control.cookieHeaders)).not.toContain(
        SESSION_VALUE,
      );
    });

    it('blocks a navigation to a domain outside the profile triggered by a step', async () => {
      await profileStore.save('member', sessionState('127.0.0.1'));
      const target = `http://${OTHER_HOST}:${control.port}/whoami`;

      const { json } = await callWithProfiles({
        url: `${web.origin}/leave?to=${encodeURIComponent(target)}`,
        profile: 'member',
        steps: [{ click: '.leave' }],
      });

      expect(json.error.code).toBe('FORBIDDEN_DOMAIN');
      expect(control.hits).toEqual([]);
    });

    it('allows the same redirect for an anonymous fetch', async () => {
      const target = `http://${OTHER_HOST}:${control.port}/whoami`;

      const { json } = await callWithProfiles({
        url: `${web.origin}/redirect?to=${encodeURIComponent(target)}`,
        outputs: ['text'],
      });

      expect(json.text).toContain('Please sign in');
    });
  });

  describe('session expiry', () => {
    const EXPIRING_PROFILE = 'expiring';
    const LOGIN_TOKEN = 'SECRETQUERY';
    let loginPageUrl: string;
    let profileStore: ProfileStore;
    let callWithProfiles: (body: unknown) => Promise<ApiResult>;

    beforeAll(() => {
      const objects = new MemoryObjectStore();
      profileStore = new ProfileStore(objects, randomBytes(32));
      loginPageUrl = `${web.origin}/login?token=${LOGIN_TOKEN}`;
      const fetchLoginPage: PageFetcher = async () => ({
        finalUrl: loginPageUrl,
        status: 200,
        text: 'Please sign in',
      });
      callWithProfiles = buildCaller(
        policy,
        SMALL_LIMIT_BYTES * 100,
        undefined,
        new ProfileLoader(profileStore),
        fetchLoginPage,
      );
    });

    it('returns SESSION_EXPIRED without the page body when the profile lands on the login page', async () => {
      await profileStore.save(EXPIRING_PROFILE, sessionState('127.0.0.1'));

      const { status, json } = await callWithProfiles({
        url: `${web.origin}/whoami`,
        profile: EXPIRING_PROFILE,
        outputs: ['text'],
      });

      expect(status).toBe(409);
      expect(json.error.code).toBe('SESSION_EXPIRED');
      expect(json.text).toBeUndefined();
    });

    it('returns the fetched page for a profile without login_url_patterns', async () => {
      await profileStore.save('member', sessionState('127.0.0.1'));

      const { status, json } = await callWithProfiles({
        url: `${web.origin}/whoami`,
        profile: 'member',
        outputs: ['text'],
      });

      expect(status).toBe(200);
      expect(json).toMatchObject({ ok: true, final_url: loginPageUrl });
    });

    it('does not log the login URL query', async () => {
      await profileStore.save(EXPIRING_PROFILE, sessionState('127.0.0.1'));
      logLines.length = 0;

      await callWithProfiles({
        url: `${web.origin}/whoami`,
        profile: EXPIRING_PROFILE,
      });

      expect(logLines.length).toBeGreaterThan(0);
      expect(logLines.join('\n')).not.toContain(LOGIN_TOKEN);
    });
  });

  describe('SSRF protection', () => {
    const strictCall = (body: unknown): Promise<ApiResult> =>
      buildCaller(DEFAULT_EGRESS_POLICY, SMALL_LIMIT_BYTES * 100)(body);

    it.each([
      'http://169.254.169.254/computeMetadata/v1/',
      'http://metadata.google.internal/computeMetadata/v1/',
      'http://127.0.0.1/',
      'http://localhost/',
      'http://10.0.0.1/',
      'http://192.168.0.1/',
      'http://2130706433/',
      'http://[::1]/',
      'http://[::ffff:169.254.169.254]/',
      'file:///etc/passwd',
      'http://example.com:22/',
      'http://example.com:8080/',
      'http://user:pass@example.com/',
    ])('returns BLOCKED_URL for %s', async (url) => {
      const { status, json } = await strictCall({ url });

      expect(status).toBe(400);
      expect(json.error.code).toBe('BLOCKED_URL');
    });

    it('blocks a redirect from an allowed page to an internal address', async () => {
      const { status, json } = await call({
        url: `${web.origin}/redirect?to=${encodeURIComponent(`${internal.origin}/secret`)}`,
      });

      expect(status).toBe(400);
      expect(json.error.code).toBe('BLOCKED_URL');
      expect(internal.hits).toHaveLength(0);
    });

    it('blocks a redirect to the metadata server', async () => {
      const { json } = await call({
        url: `${web.origin}/redirect?to=${encodeURIComponent('http://169.254.169.254/computeMetadata/v1/')}`,
      });

      expect(json.error.code).toBe('BLOCKED_URL');
    });

    it('blocks a name that resolves to an internal address (DNS rebinding)', async () => {
      const { status, json } = await call({ url: 'http://rebind.test/' });

      expect(status).toBe(400);
      expect(json.error.code).toBe('BLOCKED_URL');
    });

    it('blocks page sub-resources and script requests aimed at internal addresses', async () => {
      const target = `${internal.origin}/pixel`;
      const metadata = 'http://169.254.169.254/latest/meta-data/';
      const query = [target, metadata]
        .map((src) => `src=${encodeURIComponent(src)}`)
        .join('&');

      const { json } = await call({
        url: `${web.origin}/with-subresources?${query}`,
        outputs: ['text'],
      });

      expect(json.ok).toBe(true);
      expect(json.text).toContain('with subresources');
      expect(internal.hits).toHaveLength(0);
    });

    it('reaches the same sub-resource when its address is exempted (positive control for the block tests)', async () => {
      const query = `src=${encodeURIComponent(`${control.origin}/pixel`)}`;

      await call({
        url: `${web.origin}/with-subresources?${query}`,
        outputs: ['text'],
      });

      expect(control.hits.length).toBeGreaterThan(0);
    });

    it('blocks a redirect to a name that resolves to an internal address', async () => {
      const { status, json } = await call({
        url: `${web.origin}/redirect?to=${encodeURIComponent('http://rebind.test/')}`,
      });

      expect(status).toBe(400);
      expect(json.error.code).toBe('BLOCKED_URL');
    });

    it('does not expose local files through file:// frames', async () => {
      const { json } = await call({
        url: `${web.origin}/with-file-iframe`,
        outputs: ['text', 'html'],
      });

      expect(json.ok).toBe(true);
      expect(JSON.stringify(json)).not.toContain('root:');
    });

    it.each([
      'http://127.0.0.1:3128',
      'http://169.254.169.254:80',
      'http://localhost:8000',
      'http://10.1.2.3:8000',
    ])('blocks the internal proxy address %s', async (server) => {
      const { status, json } = await strictCall({
        url: 'https://example.com/',
        proxy: { server },
      });

      expect(status).toBe(400);
      expect(json.error.code).toBe('BLOCKED_URL');
    });

    it.each([
      'socks5://proxy.example.net:1080',
      'ftp://proxy.example.net',
      'http://u:p@proxy.example.net:8000',
      'proxy.example.net:8000',
    ])('rejects the unsupported proxy form %s', async (server) => {
      const { json } = await strictCall({
        url: 'https://example.com/',
        proxy: { server },
      });

      expect(json.error.code).toBe('INVALID_REQUEST');
    });
  });

  describe('proxy option', () => {
    it('fetches through the specified proxy with its credentials', async () => {
      const { json } = await call({
        url: 'http://origin.test/page',
        outputs: ['text'],
        proxy: {
          server: `http://127.0.0.1:${upstream.port}`,
          username: 'u',
          password: 'p',
        },
      });

      expect(json.ok).toBe(true);
      expect(json.text).toContain('via-proxy');
      expect(
        upstream.requests.find((request) =>
          request.target.includes('origin.test'),
        ),
      ).toEqual({
        kind: 'forward',
        target: 'http://origin.test/page',
        proxyAuthorization: `Basic ${Buffer.from('u:p').toString('base64')}`,
      });
    });
  });

  describe('logging', () => {
    it('keeps API keys, proxy credentials and page content out of the logs', async () => {
      logLines.length = 0;

      await call({
        url: `${web.origin}/article?token=SECRETQUERY`,
        outputs: ['html', 'text'],
        extract: { title: 'h1' },
      });
      await call({
        url: 'http://origin.test/',
        proxy: {
          server: `http://127.0.0.1:${upstream.port}`,
          username: 'logUser',
          password: 'logPass',
        },
      });
      await call({ url: `${web.origin}/article` }, 'Bearer wrongSecretValue');

      const output = logLines.join('\n');
      expect(output).toContain('"event":"fetch"');
      for (const secret of [
        KEY,
        'wrongSecretValue',
        'logUser',
        'logPass',
        'SECRETQUERY',
        'Fixture Title',
        'First paragraph',
      ]) {
        expect(output).not.toContain(secret);
      }
    });
  });
});
