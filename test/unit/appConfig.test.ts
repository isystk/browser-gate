import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createFileConfigProvider,
  parseAppConfig,
} from '../../src/config/appConfig.js';

const RELOAD_AFTER_MS = 10_000;

describe('createFileConfigProvider', () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bg-config-'));
    path = join(dir, 'config.json');
    await writeFile(path, JSON.stringify({ api_keys: [], profiles: {} }));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('keeps the cached config until the reload interval elapses', async () => {
    let nowMs = 0;
    const provider = await createFileConfigProvider(path, vi.fn(), () => nowMs);
    await writeFile(
      path,
      JSON.stringify({ profiles: { news: { allowed_domains: ['a.com'] } } }),
    );

    nowMs = RELOAD_AFTER_MS - 1;
    expect(Object.keys((await provider()).profiles)).toEqual([]);

    nowMs = RELOAD_AFTER_MS;
    expect(Object.keys((await provider()).profiles)).toEqual(['news']);
  });

  it('keeps the last valid config and reports an error when the reload fails', async () => {
    let nowMs = 0;
    const onError = vi.fn();
    const provider = await createFileConfigProvider(path, onError, () => nowMs);
    await writeFile(path, '{ not json');

    nowMs = RELOAD_AFTER_MS;
    expect((await provider()).api_keys).toEqual([]);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe('parseAppConfig', () => {
  it('accepts login_url_patterns for a profile', () => {
    const config = parseAppConfig({
      profiles: {
        news: {
          allowed_domains: ['example.com'],
          login_url_patterns: ['/login', 'accounts.example.com'],
        },
      },
    });

    expect(config.profiles.news?.login_url_patterns).toEqual([
      '/login',
      'accounts.example.com',
    ]);
  });

  it('treats login_url_patterns as optional', () => {
    const config = parseAppConfig({
      profiles: { news: { allowed_domains: ['example.com'] } },
    });

    expect(config.profiles.news?.login_url_patterns).toBeUndefined();
  });

  it.each([
    ['an empty string', ['/login', '']],
    ['a non-string element', ['/login', 1]],
    ['a non-array value', '/login'],
  ])('rejects %s in login_url_patterns', (_label, loginUrlPatterns) => {
    expect(() =>
      parseAppConfig({
        profiles: {
          news: {
            allowed_domains: ['example.com'],
            login_url_patterns: loginUrlPatterns,
          },
        },
      }),
    ).toThrow(/login_url_patterns/);
  });
});
