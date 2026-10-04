import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import { AppError } from '../../src/lib/errors.js';
import { createLogger } from '../../src/lib/logger.js';
import { LoginSessionManager } from '../../src/login/loginSessionManager.js';
import { DEFAULT_EGRESS_POLICY } from '../../src/security/urlGuard.js';

const GRACE_MS = 400;
const LONG_LIFETIME_MS = 60_000;
const WAIT_STEP_MS = 25;
const WAIT_LIMIT_MS = 8000;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + WAIT_LIMIT_MS;
  while (!condition() && Date.now() < deadline) await sleep(WAIT_STEP_MS);
}

function chromiumTempDirs(): string[] {
  return readdirSync(tmpdir()).filter((name) =>
    name.startsWith('playwright_chromiumdev_profile-'),
  );
}

describe('LoginSessionManager disconnect grace (real Chromium)', () => {
  let manager: LoginSessionManager;

  function createManager(maxLifetimeMs = LONG_LIFETIME_MS) {
    manager = new LoginSessionManager({
      policy: DEFAULT_EGRESS_POLICY,
      maxLifetimeMs,
      disconnectGraceMs: GRACE_MS,
      logger: createLogger(() => undefined),
    });
    return manager;
  }

  afterEach(async () => {
    await manager?.end();
  });

  it('discards a session that no client ever connected to after the grace period', async () => {
    createManager();
    const session = await manager.start('news');

    await waitUntil(() => manager.current() === undefined);
    await waitUntil(() => session.context.browser()?.isConnected() === false);

    expect(manager.current()).toBeUndefined();
    expect(session.context.browser()?.isConnected()).toBe(false);
  });

  it('frees the profile so that a new login can start after the grace period', async () => {
    createManager();
    const release = (await manager.start('news')) && manager.clientConnected();
    release();

    await waitUntil(() => manager.current() === undefined);

    expect((await manager.start('other')).profile).toBe('other');
  });

  it('keeps the session while a client stays connected beyond the grace period', async () => {
    createManager();
    const session = await manager.start('news');
    manager.clientConnected();

    await sleep(GRACE_MS * 2);

    expect(manager.current()).toBe(session);
  });

  it('keeps the session when a client reconnects within the grace period', async () => {
    createManager();
    const session = await manager.start('news');
    manager.clientConnected()();
    await sleep(GRACE_MS / 4);

    manager.clientConnected();
    await sleep(GRACE_MS * 2);

    expect(manager.current()).toBe(session);
    expect(session.context.browser()?.isConnected()).toBe(true);
  });

  it('keeps the session until the last of several clients disconnects', async () => {
    createManager();
    const session = await manager.start('news');
    const releaseFirst = manager.clientConnected();
    manager.clientConnected();

    releaseFirst();
    await sleep(GRACE_MS * 2);

    expect(manager.current()).toBe(session);
  });

  it('ignores a repeated release of the same client', async () => {
    createManager();
    const session = await manager.start('news');
    const release = manager.clientConnected();
    manager.clientConnected();

    release();
    release();
    await sleep(GRACE_MS * 2);

    expect(manager.current()).toBe(session);
  });

  it('does not discard a session while a save is in progress, then discards it afterwards', async () => {
    createManager();
    const session = await manager.start('news');
    manager.clientConnected()();

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

  it('defers the maximum-lifetime expiry until a save in progress finishes', async () => {
    createManager(GRACE_MS);
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

  it('re-arms the grace period after a failed save when no client is connected', async () => {
    createManager();
    await manager.start('news');
    manager.clientConnected()();

    await expect(
      manager.hold(async () => {
        throw new Error('storage down');
      }),
    ).rejects.toThrow('storage down');
    await waitUntil(() => manager.current() === undefined);

    expect(manager.current()).toBeUndefined();
  });

  it('replaces an abandoned session when another profile is requested', async () => {
    createManager();
    const abandoned = await manager.start('news');
    manager.clientConnected()();

    const next = await manager.start('other');

    expect(next.profile).toBe('other');
    // 置き換えでは、旧ブラウザの終了を待ってから新しいセッションが返る
    expect(abandoned.context.browser()?.isConnected()).toBe(false);
  });

  it('refuses another profile while a client is connected', async () => {
    createManager();
    await manager.start('news');
    manager.clientConnected();

    await expect(manager.start('other')).rejects.toSatisfy(
      (error) => error instanceof AppError && error.code === 'PROFILE_BUSY',
    );
  });

  it('refuses another profile while a save is in progress even without a client', async () => {
    createManager();
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

  it('removes the Chromium temporary profile when an abandoned session is discarded', async () => {
    createManager();
    const before = chromiumTempDirs();
    await manager.start('news');
    expect(chromiumTempDirs().length).toBeGreaterThan(before.length);

    await waitUntil(() => manager.current() === undefined);
    await waitUntil(() => chromiumTempDirs().length <= before.length);

    expect(chromiumTempDirs().length).toBeLessThanOrEqual(before.length);
  });
});
