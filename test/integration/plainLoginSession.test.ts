import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { chromium } from 'playwright';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { AppError } from '../../src/lib/errors.js';
import { LoginService } from '../../src/login/loginService.js';
import type { StorageStateLike } from '../../src/profile/cookieFilter.js';
import { LocalObjectStore, ProfileStore } from '../../src/profile/store.js';
import { createLogger } from '../../src/lib/logger.js';
import {
  type PlainLoginSession,
  PlainLoginSessionManager,
} from '../../src/login/plainLoginSessionManager.js';
import {
  DEFAULT_EGRESS_POLICY,
  type EgressPolicy,
} from '../../src/security/urlGuard.js';
import { type FixtureServer, startFixtureServer } from '../fixtures/servers.js';

const WAIT_STEP_MS = 50;
const WAIT_LIMIT_MS = 15_000;
const GRACE_MS = 600;
// 素の Chromium は、起動して数秒以内に終了させると Cookie をディスクへ書き出さないことがある（実機調査で確認）。人のログイン操作は数十秒以上かかるため、テストでは起動後にこの時間だけ待つ。
const BROWSER_SETTLE_MS = 5000;
const SECRET_ENV = 'PROFILE_ENCRYPTION_KEY';

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + WAIT_LIMIT_MS;
  while (!condition() && Date.now() < deadline) await sleep(WAIT_STEP_MS);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('PlainLoginSessionManager (real Chromium without Playwright)', () => {
  let web: FixtureServer;
  let internal: FixtureServer;
  let policy: EgressPolicy;
  let manager: PlainLoginSessionManager;

  function createManager(options: {
    startUrl?: string;
    maxLifetimeMs?: number;
    disconnectGraceMs?: number;
  }): PlainLoginSessionManager {
    manager = new PlainLoginSessionManager({
      policy,
      maxLifetimeMs: options.maxLifetimeMs ?? 60_000,
      disconnectGraceMs: options.disconnectGraceMs ?? 60_000,
      startUrl: options.startUrl,
      logger: createLogger(() => undefined),
    });
    return manager;
  }

  async function startAndWaitForPage(
    path: string,
    settleMs = 500,
  ): Promise<PlainLoginSession> {
    const before = web.hits.length;
    createManager({ startUrl: `${web.origin}${path}` });
    const session = await manager.start('news');
    await waitUntil(() => web.hits.length > before);
    // ブラウザが Cookie を受け取り、ディスクへ書き出せる状態になるまで待つ
    await sleep(settleMs);
    return session;
  }

  beforeAll(async () => {
    [web, internal] = await Promise.all([
      startFixtureServer(),
      startFixtureServer(),
    ]);
    policy = {
      allowedPorts: DEFAULT_EGRESS_POLICY.allowedPorts,
      exemptTargets: [`127.0.0.1:${web.port}`],
    };
  });

  afterEach(async () => {
    await manager?.end();
  });

  afterAll(async () => {
    await Promise.all([web.close(), internal.close()]);
  });

  it('keeps a session cookie set in the login browser after the browser is closed and imported', async () => {
    const session = await startAndWaitForPage('/set-cookie', BROWSER_SETTLE_MS);

    const state = await session.storageState(['127.0.0.1']);

    expect(state.cookies.map((item) => item.name)).toContain('sid');
    expect(session.browserExited()).toBe(true);
  });

  it('keeps a session cookie that was set only moments before the save (the browser is quit so that it flushes to disk)', async () => {
    const session = await startAndWaitForPage('/set-cookie', 300);

    const state = await session.storageState(['127.0.0.1']);

    expect(state.cookies.map((item) => item.name)).toContain('sid');
  });

  it('returns the same state again after the import, so that a failed save can be retried', async () => {
    const session = await startAndWaitForPage('/set-cookie', BROWSER_SETTLE_MS);

    const first = await session.storageState(['127.0.0.1']);
    const second = await session.storageState(['127.0.0.1']);

    expect(second).toEqual(first);
  });

  it('starts the browser without automation flags and without secret environment variables', async () => {
    process.env[SECRET_ENV] = 'test-secret-value';
    try {
      const session = await startAndWaitForPage('/article');
      const environ = readFileSync(
        `/proc/${session.browserPid}/environ`,
        'utf8',
      );
      const cmdline = readFileSync(
        `/proc/${session.browserPid}/cmdline`,
        'utf8',
      );

      expect(environ).not.toContain(SECRET_ENV);
      expect(environ).not.toContain('test-secret-value');
      expect(cmdline).toContain('--user-data-dir=');
      expect(cmdline).toContain('--proxy-server=http://127.0.0.1:');
      expect(cmdline).not.toMatch(/remote-debugging|enable-automation/);
      expect(cmdline).not.toContain('AutomationControlled');
    } finally {
      delete process.env[SECRET_ENV];
    }
  });

  it('does not let a page reach an internal address through sub-resources', async () => {
    await startAndWaitForPage(
      `/with-subresources?src=${encodeURIComponent(`${internal.origin}/secret.png`)}`,
    );
    await sleep(1500);

    expect(internal.hits).toEqual([]);
  });

  it('refuses to open an internal address as the first page', async () => {
    createManager({ startUrl: `${internal.origin}/article` });
    await manager.start('news');
    await sleep(2500);

    expect(internal.hits).toEqual([]);
  });

  it('reuses the session for the same profile and refuses a different profile', async () => {
    createManager({});
    const first = await manager.start('news');
    manager.clientConnected();

    expect(await manager.start('news')).toBe(first);
    await expect(manager.start('other')).rejects.toSatisfy(
      (error) => error instanceof AppError && error.code === 'PROFILE_BUSY',
    );
  });

  it('stops the browser and removes its profile directory on end()', async () => {
    createManager({});
    const session = await manager.start('news');
    const { browserPid, userDataDir } = session;
    expect(existsSync(userDataDir)).toBe(true);

    await manager.end();

    expect(manager.current()).toBeUndefined();
    expect(isAlive(browserPid)).toBe(false);
    expect(existsSync(userDataDir)).toBe(false);
    expect((await manager.start('other')).profile).toBe('other');
  });

  it('ends the session automatically after its maximum lifetime', async () => {
    createManager({ maxLifetimeMs: GRACE_MS });
    const session = await manager.start('news');

    await waitUntil(() => manager.current() === undefined);

    expect(manager.current()).toBeUndefined();
    await waitUntil(() => !isAlive(session.browserPid));
    expect(isAlive(session.browserPid)).toBe(false);
  });

  it('keeps the session and the profile when the person closes the browser, so that it can still be saved', async () => {
    const session = await startAndWaitForPage('/set-cookie', BROWSER_SETTLE_MS);

    process.kill(session.browserPid, 'SIGINT');
    await waitUntil(() => session.browserExited());

    expect(manager.current()).toBe(session);
    const state = await session.storageState(['127.0.0.1']);
    expect(state.cookies.map((item) => item.name)).toContain('sid');
  });

  it('saves the imported session cookie through LoginService as an encrypted profile and ends the session', async () => {
    const key = randomBytes(32);
    const store = new ProfileStore(
      new LocalObjectStore(mkdtempSync(join(tmpdir(), 'profile-store-'))),
      key,
    );
    await startAndWaitForPage('/set-cookie', BROWSER_SETTLE_MS);
    const service = new LoginService({
      getConfig: async () => ({
        api_keys: [],
        profiles: { news: { allowed_domains: ['127.0.0.1'] } },
      }),
      sessions: manager,
      profileStore: store,
      logger: createLogger(() => undefined),
    });

    const result = await service.saveSession();

    const saved = JSON.parse(
      (await store.load('news'))?.toString() ?? '{}',
    ) as StorageStateLike;
    expect(result.cookies).toBeGreaterThan(0);
    expect(saved.cookies.map((item) => item.name)).toContain('sid');
    expect(manager.current()).toBeUndefined();
  });

  describe('disconnect grace', () => {
    it('discards a session that no client connected to after the grace period', async () => {
      createManager({ disconnectGraceMs: GRACE_MS });
      const session = await manager.start('news');

      await waitUntil(() => manager.current() === undefined);

      expect(manager.current()).toBeUndefined();
      await waitUntil(() => !isAlive(session.browserPid));
      expect(isAlive(session.browserPid)).toBe(false);
    });

    it('keeps the session while a client stays connected and when it reconnects in time', async () => {
      createManager({ disconnectGraceMs: GRACE_MS });
      const session = await manager.start('news');
      manager.clientConnected()();
      await sleep(GRACE_MS / 4);
      manager.clientConnected();

      await sleep(GRACE_MS * 2);

      expect(manager.current()).toBe(session);
    });

    it('does not discard a session while a save is in progress, then discards it afterwards', async () => {
      createManager({ disconnectGraceMs: GRACE_MS });
      const session = await manager.start('news');
      manager.clientConnected()();
      let finishSave = (): void => undefined;
      const saving = manager.hold(
        () => new Promise<void>((resolve) => (finishSave = resolve)),
      );

      await sleep(GRACE_MS * 2);
      expect(manager.current()).toBe(session);
      expect(isAlive(session.browserPid)).toBe(true);

      finishSave();
      await saving;
      await waitUntil(() => manager.current() === undefined);

      expect(manager.current()).toBeUndefined();
    });

    it('defers the maximum-lifetime expiry until a save in progress finishes', async () => {
      createManager({ maxLifetimeMs: GRACE_MS });
      const session = await manager.start('news');
      manager.clientConnected();
      let finishSave = (): void => undefined;
      const saving = manager.hold(
        () => new Promise<void>((resolve) => (finishSave = resolve)),
      );

      await sleep(GRACE_MS * 2);
      expect(manager.current()).toBe(session);

      finishSave();
      await saving;
      await waitUntil(() => manager.current() === undefined);

      expect(manager.current()).toBeUndefined();
    });

    it('replaces an abandoned session when another profile is requested', async () => {
      createManager({});
      const abandoned = await manager.start('news');
      manager.clientConnected()();

      const next = await manager.start('other');

      expect(next.profile).toBe('other');
      expect(isAlive(abandoned.browserPid)).toBe(false);
      expect(existsSync(abandoned.userDataDir)).toBe(false);
    });

    it('refuses another profile while a save is in progress even without a client', async () => {
      createManager({});
      await manager.start('news');
      manager.clientConnected()();
      let finishSave = (): void => undefined;
      const saving = manager.hold(
        () => new Promise<void>((resolve) => (finishSave = resolve)),
      );

      await expect(manager.start('other')).rejects.toSatisfy(
        (error) => error instanceof AppError && error.code === 'PROFILE_BUSY',
      );

      finishSave();
      await saving;
    });
  });
});

describe('Chromium managed policy (installed in the image)', () => {
  const POLICY_PATH =
    '/etc/opt/chrome_for_testing/policies/managed/browser-gate.json';

  it('is installed where Chrome for Testing reads it', () => {
    expect(existsSync(POLICY_PATH)).toBe(true);
  });

  it('blocks file:// pages in a browser started the same way as the login browser', async () => {
    const context = await chromium.launchPersistentContext(
      mkdtempSync(join(tmpdir(), 'policy-test-')),
      { headless: false, args: ['--no-sandbox'] },
    );
    try {
      const page = context.pages()[0] ?? (await context.newPage());

      await expect(page.goto('file:///etc/hostname')).rejects.toThrow(
        'ERR_BLOCKED_BY_ADMINISTRATOR',
      );
    } finally {
      await context.close();
    }
  });
});
