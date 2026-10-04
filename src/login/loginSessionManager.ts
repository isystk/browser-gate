import type { Browser, BrowserContext } from 'playwright';

import { launchGuardedBrowser } from '../browser/launcher.js';
import { AppError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import type { StorageStateLike } from '../profile/cookieFilter.js';
import {
  type EgressProxy,
  type HostResolver,
  startEgressProxy,
} from '../security/egressProxy.js';
import { installRequestFilter } from '../security/requestFilter.js';
import type { EgressPolicy } from '../security/urlGuard.js';
import type { LoginBrowserSession, LoginSessionHost } from './loginService.js';

export interface LoginSessionManagerDeps {
  policy: EgressPolicy;
  resolve?: HostResolver;
  /** セッションの最大継続時間。超えたら自動で閉じる。 */
  maxLifetimeMs: number;
  /** 接続中の画面が無くなってから、セッションを自動破棄するまでの猶予。猶予内の再接続では同じセッションに戻れる。 */
  disconnectGraceMs: number;
  logger: Logger;
}

/** Playwright の BrowserContext を保持するログイン用ブラウザセッション。 */
export class ChromiumLoginSession implements LoginBrowserSession {
  constructor(
    readonly profile: string,
    readonly context: BrowserContext,
  ) {}

  storageState(): Promise<StorageStateLike> {
    return this.context.storageState();
  }
}

interface ActiveSession {
  session: ChromiumLoginSession;
  browser: Browser;
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

// noVNC の画面（Xvfb の SCREEN_GEOMETRY 既定値）に合わせる
const WINDOW_ARGS = ['--window-position=0,0', '--window-size=1280,800'];
// 人が操作するログインで、自動操作の表示（情報バー等）が出てログインが拒否されるのを避ける
const LOGIN_BROWSER_OPTIONS = {
  args: [...WINDOW_ARGS, '--disable-blink-features=AutomationControlled'],
  ignoreDefaultArgs: ['--enable-automation'],
};

/** noVNC で人が操作するログイン用 Chromium を1つだけ起動・保持し、全通信を送信先検査プロキシ経由にする。 */
export class LoginSessionManager implements LoginSessionHost {
  private active: ActiveSession | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: LoginSessionManagerDeps) {}

  /** Starts the login browser, returns the existing one for the same profile, or throws PROFILE_BUSY for another profile (an abandoned session with no connected screen and no save in progress is replaced instead). */
  start(profile: string): Promise<ChromiumLoginSession> {
    const run = this.queue.then(() => this.startExclusive(profile));
    // 失敗は run を通じて呼び出し側へ伝わる。キューは次の start を継続させるためだけに結果を捨てる
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  current(): ChromiumLoginSession | undefined {
    return this.active?.session;
  }

  /** Closes the browser and the egress proxy. Does nothing when no session is active. */
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
    await entry.browser
      .close()
      .catch((error: unknown) => this.logCloseError(error));
    await entry.proxy.close();
  }

  private async startExclusive(profile: string): Promise<ChromiumLoginSession> {
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
    let browser: Browser | undefined;
    try {
      browser = await launchGuardedBrowser(proxy.port, LOGIN_BROWSER_OPTIONS);
      const session = await this.openContext(browser, profile);
      const entry: ActiveSession = {
        session,
        browser,
        proxy,
        timer: this.startTimer(),
        clients: 0,
        holds: 0,
        expireAfterHold: false,
      };
      this.register(entry);
      this.armGrace(entry);
      return session;
    } catch (error) {
      await browser
        ?.close()
        .catch((closeError: unknown) => this.logCloseError(closeError));
      await proxy.close();
      throw error;
    }
  }

  private reuseOrReject(
    entry: ActiveSession,
    profile: string,
  ): ChromiumLoginSession {
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

  private async openContext(
    browser: Browser,
    profile: string,
  ): Promise<ChromiumLoginSession> {
    const context = await browser.newContext({
      viewport: null,
      locale: 'ja-JP',
      serviceWorkers: 'block',
      acceptDownloads: false,
    });
    await installRequestFilter(context, this.deps.policy, (event) =>
      this.deps.logger.warn('login_request_blocked', { target: event.target }),
    );
    await context.newPage();
    return new ChromiumLoginSession(profile, context);
  }

  private register(entry: ActiveSession): void {
    this.active = entry;
    entry.browser.on('disconnected', () => void this.release(entry));
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

  /** Cleans up after a browser that closed on its own (crash or manual close). */
  private async release(entry: ActiveSession): Promise<void> {
    if (this.active !== entry) return;
    this.active = undefined;
    clearTimeout(entry.timer);
    clearTimeout(entry.graceTimer);
    await entry.proxy.close();
  }

  private logCloseError(error: unknown): void {
    this.deps.logger.warn('login_browser_close_failed', {
      error_name: error instanceof Error ? error.name : 'unknown',
    });
  }
}
