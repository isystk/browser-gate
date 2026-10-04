import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { guardArgs } from '../../src/browser/launcher.js';
import {
  buildPlainLoginArgs,
  minimalChildEnv,
} from '../../src/browser/plainLoginBrowser.js';

const GUARD_PORT = 4321;

describe('guardArgs', () => {
  it('forces every connection through the egress proxy and blocks the bypass paths', () => {
    expect(guardArgs(GUARD_PORT)).toEqual([
      `--proxy-server=http://127.0.0.1:${GUARD_PORT}`,
      '--proxy-bypass-list=<-loopback>',
      '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1',
      '--disable-quic',
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    ]);
  });
});

describe('buildPlainLoginArgs', () => {
  const args = buildPlainLoginArgs({
    userDataDir: '/tmp/profile-x',
    proxyPort: GUARD_PORT,
    startUrl: 'about:blank',
  });

  it('contains every guard argument', () => {
    for (const guard of guardArgs(GUARD_PORT)) expect(args).toContain(guard);
  });

  it('uses the given user data dir and opens the start URL last', () => {
    expect(args).toContain('--user-data-dir=/tmp/profile-x');
    expect(args.at(-1)).toBe('about:blank');
  });

  it('uses the same storage backends as the Playwright browser that imports the profile', () => {
    // Playwright は --disable-field-trial-config 付きで起動するため、これが無いと素の Chromium が書いた localStorage / IndexedDB を読めない
    expect(args).toContain('--disable-field-trial-config');
  });

  it('has no automation control or automation-concealing flag', () => {
    const joined = args.join(' ');
    expect(joined).not.toMatch(/remote-debugging/);
    expect(joined).not.toMatch(/enable-automation/);
    expect(joined).not.toMatch(/AutomationControlled/);
  });
});

describe('minimalChildEnv', () => {
  it('passes only the display and basic variables, never secrets', () => {
    const env = minimalChildEnv({
      DISPLAY: ':99',
      HOME: '/home/pwuser',
      PATH: '/usr/bin',
      LANG: 'C.UTF-8',
      PROFILE_ENCRYPTION_KEY: 'secret-key',
      OAUTH_CLIENT_JSON: '{"client_secret":"x"}',
      GOOGLE_APPLICATION_CREDENTIALS: '/gcloud/creds.json',
      K_SERVICE: 'browser-gate-login',
    });

    expect(env).toEqual({
      DISPLAY: ':99',
      HOME: '/home/pwuser',
      PATH: '/usr/bin',
      LANG: 'C.UTF-8',
    });
  });

  it('omits variables that are not set', () => {
    expect(minimalChildEnv({ PATH: '/usr/bin' })).toEqual({ PATH: '/usr/bin' });
  });
});

describe('Chromium managed policy file', () => {
  const policyPath = 'docker/chromium-policy.json';

  it('exists and keeps session cookies, blocks file access and downloads', () => {
    expect(existsSync(policyPath)).toBe(true);
    const policy = JSON.parse(readFileSync(policyPath, 'utf8')) as Record<
      string,
      unknown
    >;

    expect(policy.RestoreOnStartup).toBe(1);
    expect(policy.URLBlocklist).toEqual(
      expect.arrayContaining(['file://*', 'view-source:*']),
    );
    expect(policy.DownloadRestrictions).toBe(3);
  });
});
