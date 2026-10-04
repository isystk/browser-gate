import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { AppError } from '../../src/lib/errors.js';
import { createLogger } from '../../src/lib/logger.js';
import {
  type ChromiumLoginSession,
  LoginSessionManager,
} from '../../src/login/loginSessionManager.js';
import {
  DEFAULT_EGRESS_POLICY,
  type EgressPolicy,
} from '../../src/security/urlGuard.js';
import { type FixtureServer, startFixtureServer } from '../fixtures/servers.js';

const SHORT_LIFETIME_MS = 500;
const WAIT_STEP_MS = 50;
const WAIT_LIMIT_MS = 5000;

async function waitUntil(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + WAIT_LIMIT_MS;
  while (!condition() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, WAIT_STEP_MS));
  }
}

describe('LoginSessionManager (real Chromium)', () => {
  let web: FixtureServer;
  let internal: FixtureServer;
  let policy: EgressPolicy;
  let manager: LoginSessionManager;

  function createManager(maxLifetimeMs = 60_000): LoginSessionManager {
    return new LoginSessionManager({
      policy,
      maxLifetimeMs,
      logger: createLogger(() => undefined),
    });
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

  async function openPage(session: ChromiumLoginSession, url: string) {
    const page =
      session.context.pages()[0] ?? (await session.context.newPage());
    await page.goto(url);
    return page;
  }

  it('captures the cookies set by a page opened in the login browser', async () => {
    manager = createManager();
    const session = await manager.start('news');

    await openPage(session, `${web.origin}/set-cookie`);
    const state = await session.storageState();

    expect(state.cookies.map((item) => item.name)).toContain('sid');
  });

  it('reuses the session for the same profile and refuses a different profile', async () => {
    manager = createManager();
    const first = await manager.start('news');

    expect(await manager.start('news')).toBe(first);
    await expect(manager.start('other')).rejects.toSatisfy(
      (error) => error instanceof AppError && error.code === 'PROFILE_BUSY',
    );
  });

  it('blocks navigation from the login browser to a forbidden address', async () => {
    manager = createManager();
    const session = await manager.start('news');
    const page =
      session.context.pages()[0] ?? (await session.context.newPage());

    await expect(page.goto(`${internal.origin}/article`)).rejects.toThrow();

    expect(internal.hits).toEqual([]);
  });

  it('closes the browser and allows a new session after end()', async () => {
    manager = createManager();
    const session = await manager.start('news');

    await manager.end();

    expect(manager.current()).toBeUndefined();
    expect(session.context.browser()?.isConnected()).toBe(false);
    expect((await manager.start('other')).profile).toBe('other');
  });

  it('ends the session automatically after its maximum lifetime', async () => {
    manager = createManager(SHORT_LIFETIME_MS);
    await manager.start('news');

    await waitUntil(() => manager.current() === undefined);

    expect(manager.current()).toBeUndefined();
  });

  it('forgets the session when the browser disconnects', async () => {
    manager = createManager();
    const session = await manager.start('news');

    await session.context.browser()?.close();
    await waitUntil(() => manager.current() === undefined);

    expect(manager.current()).toBeUndefined();
  });
});
