import { chromium } from 'playwright';

import type { StorageStateLike } from '../profile/cookieFilter.js';
import { BASE_ARGS, guardArgs } from './launcher.js';

export interface ImportOptions {
  userDataDir: string;
  proxyPort: number;
  allowedDomains: readonly string[];
}

const HOST_PATTERN = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i;
const EMPTY_PAGE = '<!doctype html><html><head></head><body></body></html>';

/** Turns the allowed domains into the https origins whose localStorage is read. Entries that are not plain host names are skipped. */
export function originsToVisit(domains: readonly string[]): string[] {
  return domains
    .filter((domain) => HOST_PATTERN.test(domain))
    .map((domain) => `https://${domain.toLowerCase()}`);
}

/**
 * Opens the user data dir of a closed login browser with Playwright and reads its cookies and localStorage.
 * The browser is offline and every request is answered locally, so nothing is sent to any site.
 * The session cookies survive only with the RestoreOnStartup managed policy and a headful browser.
 */
export async function importStorageState(
  options: ImportOptions,
): Promise<StorageStateLike> {
  const context = await chromium.launchPersistentContext(options.userDataDir, {
    headless: false,
    offline: true,
    serviceWorkers: 'block',
    acceptDownloads: false,
    args: [...BASE_ARGS, ...guardArgs(options.proxyPort)],
  });
  try {
    await context.route('**/*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: EMPTY_PAGE,
      }),
    );
    // localStorage は、開いたことのあるオリジンしか storageState に含まれない。許可ドメインを空ページで開いて読み出す
    for (const origin of originsToVisit(options.allowedDomains)) {
      const page = await context.newPage();
      await page.goto(`${origin}/`).catch(() => undefined);
      await page.close();
    }
    // IndexedDB も取り込む（Playwright は既定では含めない）。ログイン状態を IndexedDB に持つサイトがある
    return await context.storageState({ indexedDB: true });
  } finally {
    await context.close();
  }
}
