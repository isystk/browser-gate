import { spawn } from 'node:child_process';

import { chromium } from 'playwright';

import { BASE_ARGS, guardArgs } from './launcher.js';

export interface PlainLoginArgsOptions {
  userDataDir: string;
  proxyPort: number;
  startUrl: string;
}

// noVNC の画面（Xvfb の SCREEN_GEOMETRY 既定値）に合わせる
const WINDOW_ARGS = ['--window-position=0,0', '--window-size=1280,800'];
const PLAIN_ARGS = [
  ...BASE_ARGS,
  '--no-first-run',
  '--no-default-browser-check',
  // 取り込みに使う Playwright の Chromium は --disable-field-trial-config 付きで動く。揃えないと、素の Chromium が新しい保存方式
  // （localStorage / IndexedDB の SQLite 版）で書いたデータを Playwright 側が読めず、Cookie 以外が取り込めない（実機調査で確認）
  '--disable-field-trial-config',
  ...WINDOW_ARGS,
];
// 子プロセスへ渡す環境変数。暗号鍵・OAuth 設定・認証情報などの秘密は含めない（/proc/<pid>/environ から読まれないため）。
const CHILD_ENV_KEYS = ['DISPLAY', 'HOME', 'PATH', 'LANG', 'LC_ALL', 'TZ'];
const STOP_TIMEOUT_MS = 10_000;

/**
 * Builds the arguments of the login Chromium that runs as a normal process, without Playwright or CDP.
 * It carries no automation flag (--remote-debugging-*, --enable-automation, AutomationControlled).
 */
export function buildPlainLoginArgs(options: PlainLoginArgsOptions): string[] {
  return [
    ...PLAIN_ARGS,
    `--user-data-dir=${options.userDataDir}`,
    ...guardArgs(options.proxyPort),
    options.startUrl,
  ];
}

/** Picks only the environment variables the browser needs to run, so that no secret reaches the child process. */
export function minimalChildEnv(
  source: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of CHILD_ENV_KEYS) {
    const value = source[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

/** A Chromium process started without any automation connection. */
export interface PlainLoginBrowser {
  readonly pid: number;
  hasExited(): boolean;
  /** Resolves when the process has exited, however it ended. */
  readonly exited: Promise<void>;
  /** Asks the browser to quit normally (SIGINT, which makes Chromium flush its profile; SIGTERM exits at once and loses recent data) and kills it after a timeout. */
  stop(): Promise<void>;
}

/** Starts the login Chromium as a normal process (its own process group, so that stop() leaves no orphan). */
export function spawnPlainLoginBrowser(
  options: PlainLoginArgsOptions,
): PlainLoginBrowser {
  const child = spawn(chromium.executablePath(), buildPlainLoginArgs(options), {
    env: minimalChildEnv(),
    stdio: 'ignore',
    detached: true,
  });
  const pid = child.pid;
  let exitedFlag = false;
  const exited = new Promise<void>((resolve) => {
    const done = () => {
      exitedFlag = true;
      resolve();
    };
    child.once('exit', done);
    child.once('error', done);
  });
  if (pid === undefined) throw new Error('Failed to start the login browser');
  return {
    pid,
    hasExited: () => exitedFlag,
    exited,
    stop: async () => {
      if (!exitedFlag) {
        signalGroup(pid, 'SIGINT');
        const timer = new Promise<'timeout'>((resolve) => {
          setTimeout(() => resolve('timeout'), STOP_TIMEOUT_MS).unref();
        });
        if ((await Promise.race([exited, timer])) === 'timeout') {
          signalGroup(pid, 'SIGKILL');
          await exited;
        }
      }
      // 本体の終了後に残った子プロセス（GPU・レンダラー等）を片付ける
      signalGroup(pid, 'SIGKILL');
    },
  };
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // すでにプロセスグループが無い
  }
}
