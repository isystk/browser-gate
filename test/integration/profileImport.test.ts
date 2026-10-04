import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { chromium } from 'playwright';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BASE_ARGS } from '../../src/browser/launcher.js';
import { importStorageState } from '../../src/browser/profileImport.js';

const ORIGIN = 'https://app.example.com';
const EMPTY_PAGE = '<!doctype html><html><body></body></html>';

describe('importStorageState (real Chromium)', () => {
  let userDataDir: string;

  beforeEach(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'browser-gate-import-test-'));
    // ログイン済みのブラウザが残したプロファイルの代わりに、localStorage と IndexedDB を書いたプロファイルを用意する
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [...BASE_ARGS],
    });
    await context.route('**/*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: EMPTY_PAGE,
      }),
    );
    const page = await context.newPage();
    await page.goto(`${ORIGIN}/`);
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          localStorage.setItem('ls-key', 'ls-value');
          const request = indexedDB.open('app-db', 1);
          request.onupgradeneeded = () =>
            request.result.createObjectStore('store');
          request.onerror = () => reject(new Error('indexedDB failed'));
          request.onsuccess = () => {
            const tx = request.result.transaction('store', 'readwrite');
            tx.objectStore('store').put('idb-value', 'idb-key');
            tx.oncomplete = () => {
              request.result.close();
              resolve();
            };
          };
        }),
    );
    await context.close();
  });

  afterEach(async () => {
    await rm(userDataDir, { recursive: true, force: true });
  });

  it('reads the localStorage and the IndexedDB of an allowed domain', async () => {
    const state = await importStorageState({
      userDataDir,
      proxyPort: 1,
      allowedDomains: ['app.example.com'],
    });

    const origin = state.origins.find((item) => item.origin === ORIGIN);
    expect(origin?.localStorage.map((item) => item.name)).toEqual(['ls-key']);
    expect(origin?.indexedDB?.map((item) => item.name)).toEqual(['app-db']);
  });
});
