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

  /** Starts the login browser, returns the existing one for the same profile, or throws PROFILE_BUSY for another profile. */
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
    this.active = undefined;
    clearTimeout(entry.timer);
    await entry.browser
      .close()
      .catch((error: unknown) => this.logCloseError(error));
    await entry.proxy.close();
  }

  private async startExclusive(profile: string): Promise<ChromiumLoginSession> {
    if (this.active !== undefined)
      return this.reuseOrReject(this.active, profile);
    const proxy = await startEgressProxy({
      policy: this.deps.policy,
      resolve: this.deps.resolve,
    });
    let browser: Browser | undefined;
    try {
      browser = await launchGuardedBrowser(proxy.port, LOGIN_BROWSER_OPTIONS);
      const session = await this.openContext(browser, profile);
      this.register({ session, browser, proxy, timer: this.startTimer() });
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
      void this.end();
    }, this.deps.maxLifetimeMs);
    timer.unref();
    return timer;
  }

  /** Cleans up after a browser that closed on its own (crash or manual close). */
  private async release(entry: ActiveSession): Promise<void> {
    if (this.active !== entry) return;
    this.active = undefined;
    clearTimeout(entry.timer);
    await entry.proxy.close();
  }

  private logCloseError(error: unknown): void {
    this.deps.logger.warn('login_browser_close_failed', {
      error_name: error instanceof Error ? error.name : 'unknown',
    });
  }
}
