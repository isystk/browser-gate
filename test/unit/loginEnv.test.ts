import { randomBytes } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import { loadLoginEnv } from '../../src/config/loginEnv.js';

const OAUTH_CLIENT_JSON = JSON.stringify({
  client_id: 'client-id.example',
  client_secret: 'client-secret',
});

describe('loadLoginEnv', () => {
  let source: NodeJS.ProcessEnv;

  beforeEach(() => {
    source = {
      PUBLIC_BASE_URL: 'https://login.example.test/',
      ALLOWED_EMAILS: 'Owner@Example.com',
      PROFILE_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      OAUTH_CLIENT_JSON,
      GCS_BUCKET: 'profiles-bucket',
    };
  });

  describe('login browser mode', () => {
    it('defaults to the Playwright mode', () => {
      expect(loadLoginEnv(source).browserMode).toBe('playwright');
    });

    it('can be switched to the plain mode', () => {
      source.LOGIN_BROWSER_MODE = 'plain';

      expect(loadLoginEnv(source).browserMode).toBe('plain');
    });

    it('treats an empty value as the default', () => {
      source.LOGIN_BROWSER_MODE = '';

      expect(loadLoginEnv(source).browserMode).toBe('playwright');
    });

    it('rejects an unknown mode', () => {
      source.LOGIN_BROWSER_MODE = 'chrome';

      expect(() => loadLoginEnv(source)).toThrow('LOGIN_BROWSER_MODE');
    });
  });

  describe('login disconnect grace', () => {
    it('defaults to 3 minutes', () => {
      expect(loadLoginEnv(source).disconnectGraceMs).toBe(180_000);
    });

    it('is configurable in seconds', () => {
      source.LOGIN_DISCONNECT_GRACE_SECONDS = '45';

      expect(loadLoginEnv(source).disconnectGraceMs).toBe(45_000);
    });

    it('treats an empty value as the default', () => {
      source.LOGIN_DISCONNECT_GRACE_SECONDS = '';

      expect(loadLoginEnv(source).disconnectGraceMs).toBe(180_000);
    });

    it.each(['abc', '0', '-5', '1.5', '9', '3601'])(
      'rejects the invalid value %s',
      (value) => {
        source.LOGIN_DISCONNECT_GRACE_SECONDS = value;

        expect(() => loadLoginEnv(source)).toThrow(
          'LOGIN_DISCONNECT_GRACE_SECONDS',
        );
      },
    );
  });

  it('loads a production-like configuration', () => {
    const env = loadLoginEnv(source);

    expect(env).toMatchObject({
      publicBaseUrl: 'https://login.example.test',
      allowedEmails: ['owner@example.com'],
      oauth: {
        kind: 'google',
        clientId: 'client-id.example',
        clientSecret: 'client-secret',
      },
      store: { kind: 'gcs', bucket: 'profiles-bucket' },
    });
    expect(env.encryptionKey).toHaveLength(32);
  });

  it.each([
    ['PUBLIC_BASE_URL', undefined],
    ['PUBLIC_BASE_URL', 'not a url'],
    ['PUBLIC_BASE_URL', 'ftp://login.example.test'],
    ['PUBLIC_BASE_URL', 'http://login.example.test'],
    ['ALLOWED_EMAILS', ''],
    ['PROFILE_ENCRYPTION_KEY', undefined],
    ['PROFILE_ENCRYPTION_KEY', 'short'],
    ['OAUTH_CLIENT_JSON', undefined],
    ['OAUTH_CLIENT_JSON', '{not json'],
    ['OAUTH_CLIENT_JSON', '{"client_id":"x"}'],
    ['GCS_BUCKET', undefined],
  ])('throws when %s is %j', (name, value) => {
    source[name] = value;

    expect(() => loadLoginEnv(source)).toThrow();
  });

  it.each([
    ['PROFILE_ENCRYPTION_KEY', 'secret-looking-value'],
    [
      'OAUTH_CLIENT_JSON',
      '{"client_id":"x","client_secret":"secret-looking-value"',
    ],
  ])('does not put the value of %s in the error message', (name, value) => {
    source[name] = value;

    expect(() => loadLoginEnv(source)).toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining('secret-looking-value'),
      }),
    );
  });

  describe('local development', () => {
    beforeEach(() => {
      source = {
        PUBLIC_BASE_URL: 'http://localhost:8081',
        ALLOWED_EMAILS: 'owner@example.com',
        PROFILE_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
        OAUTH_FAKE: '1',
        PROFILE_STORE_DIR: '/data/profiles',
      };
    });

    it('allows http on localhost, the fake OAuth provider and a local store', () => {
      expect(loadLoginEnv(source)).toMatchObject({
        publicBaseUrl: 'http://localhost:8081',
        oauth: { kind: 'fake' },
        store: { kind: 'local', dir: '/data/profiles' },
      });
    });

    it('refuses the fake OAuth provider on Cloud Run', () => {
      source.K_SERVICE = 'browser-gate-login';

      expect(() => loadLoginEnv(source)).toThrow();
    });

    it('refuses the local store on Cloud Run', () => {
      source.OAUTH_FAKE = undefined;
      source.OAUTH_CLIENT_JSON = OAUTH_CLIENT_JSON;
      source.K_SERVICE = 'browser-gate-login';

      expect(() => loadLoginEnv(source)).toThrow();
    });
  });
});
