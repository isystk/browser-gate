import {
  type Browser,
  type BrowserContext,
  type Page,
  errors as playwrightErrors,
} from 'playwright';

import { launchGuardedBrowser } from '../browser/launcher.js';
import { AppError } from '../lib/errors.js';
import {
  type BlockedEvent,
  type HostResolver,
  type UpstreamProxy,
  startEgressProxy,
} from '../security/egressProxy.js';
import type { StorageStateLike } from '../profile/cookieFilter.js';
import { installRequestFilter } from '../security/requestFilter.js';
import type { EgressPolicy } from '../security/urlGuard.js';
import { type PageOutputs, collectOutputs } from './outputs.js';
import type { FetchStep, OutputKind } from './schema.js';
import { runSteps } from './steps.js';

export interface PageFetchDeps {
  policy: EgressPolicy;
  resolve?: HostResolver;
  maxResponseBytes: number;
}

export interface PageFetchInput {
  url: string;
  steps: readonly FetchStep[];
  outputs: readonly OutputKind[];
  extract: Record<string, string> | undefined;
  fullPage: boolean;
  timeoutMs: number;
  upstream: UpstreamProxy | undefined;
  /** ログイン済みプロファイルで取得する場合の保存状態と、画面遷移を許可するドメイン。 */
  session?: {
    storageState: StorageStateLike;
    allowedDomains: readonly string[];
  };
}

export interface PageFetchResult extends PageOutputs {
  finalUrl: string;
  status: number;
}

const VIEWPORT = { width: 1280, height: 800 };

/** Opens the URL in a fresh headful Chromium behind the egress proxy, runs the steps, and returns the requested outputs. */
export async function fetchPage(
  deps: PageFetchDeps,
  input: PageFetchInput,
): Promise<PageFetchResult> {
  const deadlineMs = Date.now() + input.timeoutMs;
  const violations: BlockedEvent[] = [];
  const outOfDomain: BlockedEvent[] = [];
  const proxy = await startEgressProxy({
    policy: deps.policy,
    upstream: input.upstream,
    resolve: deps.resolve,
  });
  let browser: Browser | undefined;
  try {
    browser = await launchGuardedBrowser(proxy.port);
    const context = await newGuardedContext(
      browser,
      deps.policy,
      (event) => violations.push(event),
      input.session,
      (event) => outOfDomain.push(event),
    );
    const page = await context.newPage();
    const blocked = (): readonly BlockedEvent[] => [
      ...violations,
      ...proxy.blocked,
    ];
    const assertInDomain = (): void => assertNoOutOfDomain(outOfDomain);
    const status = await navigate(page, input, blocked, assertInDomain);
    await executeSteps(page, input, deadlineMs).finally(assertInDomain);
    assertInDomain();
    const outputs = await collectOutputs(page, {
      outputs: input.outputs,
      extract: input.extract,
      fullPage: input.fullPage,
      deadlineMs,
      maxBytes: deps.maxResponseBytes,
    }).catch((error: unknown) => rethrowPageError(error, page));
    assertInDomain();
    return { finalUrl: page.url(), status, ...outputs };
  } finally {
    await browser?.close();
    await proxy.close();
  }
}

async function newGuardedContext(
  browser: Browser,
  policy: EgressPolicy,
  onBlocked: (event: BlockedEvent) => void,
  session: PageFetchInput['session'],
  onOutOfDomain: (event: BlockedEvent) => void,
): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    locale: 'ja-JP',
    serviceWorkers: 'block',
    acceptDownloads: false,
    storageState: session?.storageState,
  });
  await installRequestFilter(context, policy, onBlocked, {
    navigationDomains: session?.allowedDomains,
    onOutOfDomain,
  });
  return context;
}

/** Throws FORBIDDEN_DOMAIN if a top-level navigation left the profile's allowed domains (the request was aborted before any connection). */
function assertNoOutOfDomain(events: readonly BlockedEvent[]): void {
  if (events.length > 0) {
    throw new AppError(
      'FORBIDDEN_DOMAIN',
      'The page navigated to a domain the profile is not allowed to access',
    );
  }
}

async function navigate(
  page: Page,
  input: PageFetchInput,
  blocked: () => readonly BlockedEvent[],
  assertInDomain: () => void,
): Promise<number> {
  try {
    const response = await page.goto(input.url, {
      timeout: input.timeoutMs,
      waitUntil: 'load',
    });
    return response?.status() ?? 0;
  } catch (error) {
    assertInDomain();
    if (blocked().length > 0)
      throw new AppError(
        'BLOCKED_URL',
        'The URL or a redirect target is not allowed',
      );
    if (error instanceof playwrightErrors.TimeoutError)
      throw new AppError('TIMEOUT', 'The page did not load in time');
    throw new AppError('NAVIGATION_FAILED', 'The page could not be opened');
  }
}

async function executeSteps(
  page: Page,
  input: PageFetchInput,
  deadlineMs: number,
): Promise<void> {
  await runSteps(page, input.steps, deadlineMs).catch((error: unknown) =>
    rethrowPageError(error, page),
  );
}

function rethrowPageError(error: unknown, page: Page): never {
  if (error instanceof AppError) throw error;
  if (error instanceof playwrightErrors.TimeoutError)
    throw new AppError('TIMEOUT', 'A step or output timed out');
  if (page.isClosed())
    throw new AppError('INTERNAL_ERROR', 'The browser closed unexpectedly');
  throw new AppError(
    'INVALID_REQUEST',
    'A step or selector could not be executed',
  );
}
