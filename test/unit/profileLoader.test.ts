import { randomBytes } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import { AppError } from '../../src/lib/errors.js';
import { encryptProfile } from '../../src/profile/crypto.js';
import { ProfileLoader } from '../../src/profile/loader.js';
import type { ObjectStore } from '../../src/profile/store.js';
import { ProfileStore } from '../../src/profile/store.js';

const SECRET_VALUE = 'cookie-secret-value-123';
const ALLOWED = ['example.com'];

function cookie(domain: string, value = SECRET_VALUE) {
  return {
    name: 'sid',
    value,
    domain,
    path: '/',
    expires: -1,
    httpOnly: true,
    secure: true,
    sameSite: 'Lax' as const,
  };
}

class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, Buffer>();
  failWith: Error | undefined;

  async put(name: string, data: Buffer): Promise<void> {
    this.objects.set(name, data);
  }

  async get(name: string): Promise<Buffer | undefined> {
    if (this.failWith !== undefined) throw this.failWith;
    return this.objects.get(name);
  }
}

async function expectAppError(
  promise: Promise<unknown>,
  code: AppError['code'],
): Promise<AppError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  return error as AppError;
}

describe('ProfileLoader', () => {
  let key: Buffer;
  let objects: MemoryStore;
  let store: ProfileStore;
  let loader: ProfileLoader;

  beforeEach(() => {
    key = randomBytes(32);
    objects = new MemoryStore();
    store = new ProfileStore(objects, key);
    loader = new ProfileLoader(store);
  });

  it('returns the saved storage state', async () => {
    const state = {
      cookies: [cookie('example.com')],
      origins: [
        {
          origin: 'https://example.com',
          localStorage: [{ name: 'k', value: 'v' }],
        },
      ],
    };
    await store.save('news', Buffer.from(JSON.stringify(state)));

    expect(await loader.load('news', ALLOWED)).toEqual(state);
  });

  it('drops cookies and origins outside the currently allowed domains', async () => {
    await store.save(
      'news',
      Buffer.from(
        JSON.stringify({
          cookies: [cookie('example.com'), cookie('evil.test')],
          origins: [
            { origin: 'https://evil.test', localStorage: [] },
            { origin: 'https://example.com', localStorage: [] },
          ],
        }),
      ),
    );

    const state = await loader.load('news', ALLOWED);

    expect(state.cookies.map((c) => c.domain)).toEqual(['example.com']);
    expect(state.origins.map((o) => o.origin)).toEqual(['https://example.com']);
  });

  it('throws PROFILE_NOT_FOUND when nothing is saved', async () => {
    await expectAppError(loader.load('never', ALLOWED), 'PROFILE_NOT_FOUND');
  });

  it('throws INTERNAL_ERROR without secrets when the key does not match', async () => {
    await new ProfileStore(objects, randomBytes(32)).save(
      'news',
      Buffer.from(JSON.stringify({ cookies: [], origins: [] })),
    );

    const error = await expectAppError(
      loader.load('news', ALLOWED),
      'INTERNAL_ERROR',
    );
    expect(error.message).not.toContain(key.toString('base64'));
  });

  it('throws INTERNAL_ERROR when the data is corrupted', async () => {
    await store.save('news', Buffer.from('{"cookies":[],"origins":[]}'));
    const name = 'profiles/news.enc';
    const stored = Buffer.from(objects.objects.get(name) ?? []);
    stored.writeUInt8(
      stored.readUInt8(stored.length - 1) ^ 0xff,
      stored.length - 1,
    );
    objects.objects.set(name, stored);

    await expectAppError(loader.load('news', ALLOWED), 'INTERNAL_ERROR');
  });

  it('throws INTERNAL_ERROR when the data has an unknown format', async () => {
    objects.objects.set('profiles/news.enc', Buffer.from('not encrypted'));

    await expectAppError(loader.load('news', ALLOWED), 'INTERNAL_ERROR');
  });

  it.each([
    ['not JSON', 'not json'],
    ['a wrong shape', JSON.stringify({ cookies: 'x', origins: [] })],
    [
      'a cookie with an invalid sameSite',
      JSON.stringify({
        cookies: [{ ...cookie('example.com'), sameSite: 'Bogus' }],
        origins: [],
      }),
    ],
  ])(
    'throws INTERNAL_ERROR without echoing content for %s',
    async (_l, raw) => {
      objects.objects.set(
        'profiles/news.enc',
        encryptProfile(key, 'news', Buffer.from(raw)),
      );

      const error = await expectAppError(
        loader.load('news', ALLOWED),
        'INTERNAL_ERROR',
      );
      expect(error.message).not.toContain('Bogus');
    },
  );

  it('throws INTERNAL_ERROR without leaking details when the storage fails', async () => {
    objects.failWith = new Error(`denied for ${SECRET_VALUE}`);

    const error = await expectAppError(
      loader.load('news', ALLOWED),
      'INTERNAL_ERROR',
    );
    expect(error.message).not.toContain(SECRET_VALUE);
  });
});
