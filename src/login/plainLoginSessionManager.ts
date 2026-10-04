import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  type PlainLoginBrowser,
  spawnPlainLoginBrowser,
} from '../browser/plainLoginBrowser.js';
import { importStorageState } from '../browser/profileImport.js';
import { AppError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import type { StorageStateLike } from '../profile/cookieFilter.js';
import {
  type EgressProxy,
  type HostResolver,
  startEgressProxy,
} from '../security/egressProxy.js';
import type { EgressPolicy } from '../security/urlGuard.js';
import type { LoginBrowserSession, LoginSessionHost } from './loginService.js';

export interface PlainLoginSessionManagerDeps {
  policy: EgressPolicy;
  resolve?: HostResolver;
  /** セッションの最大継続時間。超えたら自動で閉じる。 */
  maxLifetimeMs: number;
  /** 接続中の画面が無くなってから、セッションを自動破棄するまでの猶予。猶予内の再接続では同じセッションに戻れる。 */
  disconnectGraceMs: number;
  logger: Logger;
  /** ブラウザが最初に開くページ。既定は about:blank。 */
  startUrl?: string;
}

const PROFILE_DIR_PREFIX = 'browser-gate-login-';
const DEFAULT_START_URL = 'about:blank';

/** Removes the profile directories that a previous process left behind (call once at startup, when no session can be active). */
export async function removeStaleLoginProfiles(
  root: string = tmpdir(),
): Promise<void> {
  const names = await readdir(root).catch(() => [] as string[]);
  await Promise.all(
    names
      .filter((name) => name.startsWith(PROFILE_DIR_PREFIX))
      .map((name) => rm(join(root, name), { recursive: true, force: true })),
  );
}

/**
 * ログイン用ブラウザの1セッション。Playwright なしの素の Chromium とその user-data-dir を保持し、
 * storageState() で、ブラウザを正常終了させたうえで同じ user-data-dir を Playwright で開いて Cookie 等を取り出す。
 */
export class PlainLoginSession implements LoginBrowserSession {
  private imported: Promise<StorageStateLike> | undefined;

  constructor(
    readonly profile: string,
    readonly userDataDir: string,
    private readonly browser: PlainLoginBrowser,
    private readonly proxyPort: number,
  ) {}

  get browserPid(): number {
    return this.browser.pid;
  }

  browserExited(): boolean {
    return this.browser.hasExited();
  }

  /** 取り込み結果を覚えておき、保存に失敗した後の再試行ではブラウザを開き直さずに同じ内容を返す。 */
  storageState(allowedDomains: readonly string[]): Promise<StorageStateLike> {
    this.imported ??= this.import(allowedDomains).catch((error: unknown) => {
      this.imported = undefined;
      throw error;
    });
    return this.imported;
  }

  /** Stops the browser and deletes its profile directory. */
  async dispose(): Promise<void> {
    await this.browser.stop();
    await rm(this.userDataDir, { recursive: true, force: true });
  }

  private async import(
    allowedDomains: readonly string[],
  ): Promise<StorageStateLike> {
    await this.browser.stop();
    return importStorageState({
      userDataDir: this.userDataDir,
      proxyPort: this.proxyPort,
      allowedDomains,
    });
  }
}

interface ActiveSession {
  session: PlainLoginSession;
  proxy: EgressProxy;
  timer: NodeJS.Timeout;
  /** 接続中の noVNC 画面（WebSocket）の数。 */
  clients: number;
  /** 保存など、途中で破棄してはいけない処理の実行数。 */
  holds: number;
  /** 保存中に最大継続時間を迎えた。処理が終わり次第閉じる。 */
  expireAfterHold: boolean;
  graceTimer?: NodeJS.Timeout;
}

/**
 * noVNC で人が操作するログイン用 Chromium を、Playwright/CDP なしの素のプロセスとして1つだけ起動・保持し、全通信を送信先検査プロキシ経由にする。
 * 人がブラウザを閉じてもセッションとプロファイルは残り、「保存して終了」で取り込める。
 */
export class PlainLoginSessionManager implements LoginSessionHost {
  private active: ActiveSession | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: PlainLoginSessionManagerDeps) {}

  /** Starts the login browser, returns the existing one for the same profile, or throws PROFILE_BUSY for another profile (an abandoned session with no connected screen and no save in progress is replaced instead). */
  start(profile: string): Promise<PlainLoginSession> {
    const run = this.queue.then(() => this.startExclusive(profile));
    // 失敗は run を通じて呼び出し側へ伝わる。キューは次の start を継続させるためだけに結果を捨てる
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  current(): PlainLoginSession | undefined {
    return this.active?.session;
  }

  /** Stops the browser, deletes its profile and closes the egress proxy. Does nothing when no session is active. */
  async end(): Promise<void> {
    const entry = this.active;
    if (entry === undefined) return;
    await this.close(entry);
  }

  /**
   * Registers a connected noVNC screen and returns the function to call when it disconnects.
   * The session is discarded after the grace period once no screen is connected.
   */
  clientConnected(): () => void {
    const entry = this.active;
    if (entry === undefined) return () => undefined;
    entry.clients += 1;
    clearTimeout(entry.graceTimer);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      entry.clients -= 1;
      this.armGrace(entry);
    };
  }

  /** Runs a task (such as saving) during which the session must not be discarded automatically. */
  async hold<T>(task: () => Promise<T>): Promise<T> {
    const entry = this.active;
    if (entry === undefined) return task();
    entry.holds += 1;
    clearTimeout(entry.graceTimer);
    try {
      return await task();
    } finally {
      entry.holds -= 1;
      await this.afterHold(entry);
    }
  }

  private async afterHold(entry: ActiveSession): Promise<void> {
    if (this.active !== entry || entry.holds > 0) return;
    if (entry.expireAfterHold) {
      await this.close(entry);
      return;
    }
    this.armGrace(entry);
  }

  private async close(entry: ActiveSession): Promise<void> {
    if (this.active !== entry) return;
    this.active = undefined;
    clearTimeout(entry.timer);
    clearTimeout(entry.graceTimer);
    await entry.session
      .dispose()
      .catch((error: unknown) => this.logCloseError(error));
    await entry.proxy.close();
  }

  private async startExclusive(profile: string): Promise<PlainLoginSession> {
    if (this.active !== undefined) {
      const existing = this.active;
      if (!this.isAbandoned(existing) || existing.session.profile === profile) {
        return this.reuseOrReject(existing, profile);
      }
      this.deps.logger.warn('login_session_replaced');
      await this.close(existing);
    }
    const proxy = await startEgressProxy({
      policy: this.deps.policy,
      resolve: this.deps.resolve,
    });
    let userDataDir: string | undefined;
    try {
      userDataDir = await mkdtemp(join(tmpdir(), PROFILE_DIR_PREFIX));
      const browser = spawnPlainLoginBrowser({
        userDataDir,
        proxyPort: proxy.port,
        startUrl: this.deps.startUrl ?? DEFAULT_START_URL,
      });
      const session = new PlainLoginSession(
        profile,
        userDataDir,
        browser,
        proxy.port,
      );
      const entry: ActiveSession = {
        session,
        proxy,
        timer: this.startTimer(),
        clients: 0,
        holds: 0,
        expireAfterHold: false,
      };
      this.active = entry;
      void browser.exited.then(() => this.logBrowserExit(entry));
      this.armGrace(entry);
      return session;
    } catch (error) {
      if (userDataDir !== undefined) {
        await rm(userDataDir, { recursive: true, force: true });
      }
      await proxy.close();
      throw error;
    }
  }

  private reuseOrReject(
    entry: ActiveSession,
    profile: string,
  ): PlainLoginSession {
    if (entry.session.profile !== profile) {
      throw new AppError(
        'PROFILE_BUSY',
        'Another login session is in progress. Finish or cancel it first',
      );
    }
    // 同じプロファイルで画面が開き直された。接続が来るまでの猶予を数え直す
    this.armGrace(entry);
    return entry.session;
  }

  private startTimer(): NodeJS.Timeout {
    const timer = setTimeout(() => {
      this.deps.logger.warn('login_session_expired');
      const entry = this.active;
      if (entry === undefined) return;
      if (entry.holds > 0) entry.expireAfterHold = true;
      else void this.close(entry);
    }, this.deps.maxLifetimeMs);
    timer.unref();
    return timer;
  }

  /** Starts the countdown to discard a session that no screen is connected to. A save in progress postpones it until the save ends. */
  private armGrace(entry: ActiveSession): void {
    clearTimeout(entry.graceTimer);
    if (entry.clients > 0 || entry.holds > 0) return;
    entry.graceTimer = setTimeout(() => {
      this.deps.logger.warn('login_session_abandoned');
      void this.close(entry);
    }, this.deps.disconnectGraceMs);
    entry.graceTimer.unref();
  }

  private isAbandoned(entry: ActiveSession): boolean {
    return entry.clients === 0 && entry.holds === 0;
  }

  /** ブラウザが自分で終了した（人が窓を閉じた・クラッシュ）。プロファイルは残し、保存で取り込めるようにする。 */
  private logBrowserExit(entry: ActiveSession): void {
    if (this.active !== entry) return;
    this.deps.logger.info('login_browser_exited');
  }

  private logCloseError(error: unknown): void {
    this.deps.logger.warn('login_browser_close_failed', {
      error_name: error instanceof Error ? error.name : 'unknown',
    });
  }
}
