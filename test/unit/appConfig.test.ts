import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFileConfigProvider } from '../../src/config/appConfig.js';

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
