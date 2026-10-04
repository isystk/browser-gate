import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Storage } from '@google-cloud/storage';

import { decryptProfile } from '../../src/profile/crypto.js';
import {
  GcsObjectStore,
  LocalObjectStore,
  ProfileStore,
  profileObjectName,
} from '../../src/profile/store.js';

describe('profileObjectName', () => {
  it('maps a valid profile name to an object name', () => {
    expect(profileObjectName('google-main')).toBe('profiles/google-main.enc');
  });

  it.each([['../x'], ['a/b'], [''], ['A'], ['a b'], ['x'.repeat(65)]])(
    'rejects the invalid profile name %j',
    (name) => {
      expect(() => profileObjectName(name)).toThrow();
    },
  );
});

describe('LocalObjectStore', () => {
  let dir: string;
  let store: LocalObjectStore;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'bg-store-'));
    store = new LocalObjectStore(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes the object with owner-only permissions and overwrites it', async () => {
    await store.put('profiles/a.enc', Buffer.from('one'));
    await store.put('profiles/a.enc', Buffer.from('two'));

    const file = path.join(dir, 'profiles', 'a.enc');
    expect((await readFile(file)).toString()).toBe('two');
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it('leaves no temporary files behind', async () => {
    await store.put('profiles/a.enc', Buffer.from('one'));

    expect(await readdir(path.join(dir, 'profiles'))).toEqual(['a.enc']);
  });

  it('reads back what was written', async () => {
    await store.put('profiles/a.enc', Buffer.from('one'));

    expect((await store.get('profiles/a.enc'))?.toString()).toBe('one');
  });

  it('returns undefined for a missing object', async () => {
    expect(await store.get('profiles/missing.enc')).toBeUndefined();
  });

  it.each([['../escape.enc'], ['/abs.enc'], ['profiles/a\0.enc']])(
    'rejects reading the object name %j that escapes the directory',
    async (name) => {
      await expect(store.get(name)).rejects.toThrow();
    },
  );

  it.each([
    ['../escape.enc'],
    ['profiles/../../escape.enc'],
    ['/abs.enc'],
    ['profiles/a\0.enc'],
    [''],
  ])('rejects the object name %j that escapes the directory', async (name) => {
    await expect(store.put(name, Buffer.from('x'))).rejects.toThrow();
  });
});

describe('ProfileStore', () => {
  let dir: string;
  let key: Buffer;
  let store: ProfileStore;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'bg-store-'));
    key = randomBytes(32);
    store = new ProfileStore(new LocalObjectStore(dir), key);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('stores the state encrypted so that it can be decrypted only with the key', async () => {
    const plaintext = Buffer.from('{"cookies":[{"value":"very-secret"}]}');

    await store.save('google-main', plaintext);

    const stored = await readFile(
      path.join(dir, 'profiles', 'google-main.enc'),
    );
    expect(stored.includes(Buffer.from('very-secret'))).toBe(false);
    expect(decryptProfile(key, 'google-main', stored).equals(plaintext)).toBe(
      true,
    );
    expect(() =>
      decryptProfile(randomBytes(32), 'google-main', stored),
    ).toThrow();
  });

  it('rejects an invalid profile name without writing anything', async () => {
    await expect(store.save('../evil', Buffer.from('x'))).rejects.toThrow();

    expect(await readdir(dir)).toEqual([]);
  });
});

describe('ProfileStore.load', () => {
  let dir: string;
  let key: Buffer;
  let store: ProfileStore;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'bg-store-'));
    key = randomBytes(32);
    store = new ProfileStore(new LocalObjectStore(dir), key);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('decrypts what save stored', async () => {
    await store.save('google-main', Buffer.from('payload'));

    expect((await store.load('google-main'))?.toString()).toBe('payload');
  });

  it('returns undefined when the profile was never saved', async () => {
    expect(await store.load('never-saved')).toBeUndefined();
  });

  it('refuses data that was saved for another profile (AAD mismatch)', async () => {
    await store.save('a', Buffer.from('payload'));
    await rename(
      path.join(dir, 'profiles', 'a.enc'),
      path.join(dir, 'profiles', 'b.enc'),
    );

    await expect(store.load('b')).rejects.toThrow();
  });

  it('rejects an invalid profile name', async () => {
    await expect(store.load('../evil')).rejects.toThrow();
  });
});

describe('GcsObjectStore.get', () => {
  function fakeStorage(download: () => Promise<[Buffer]>): {
    storage: Storage;
    requested: string[];
  } {
    const requested: string[] = [];
    const storage = {
      bucket: () => ({
        file: (name: string) => {
          requested.push(name);
          return { download };
        },
      }),
    } as unknown as Storage;
    return { storage, requested };
  }

  it('downloads the named object', async () => {
    const { storage, requested } = fakeStorage(async () => [
      Buffer.from('data'),
    ]);

    const data = await new GcsObjectStore('bucket', storage).get(
      'profiles/a.enc',
    );

    expect(data?.toString()).toBe('data');
    expect(requested).toEqual(['profiles/a.enc']);
  });

  it('returns undefined when the object does not exist (404)', async () => {
    const { storage } = fakeStorage(async () =>
      Promise.reject(Object.assign(new Error('No such object'), { code: 404 })),
    );

    expect(
      await new GcsObjectStore('bucket', storage).get('profiles/a.enc'),
    ).toBeUndefined();
  });

  it('propagates other failures such as permission errors', async () => {
    const { storage } = fakeStorage(async () =>
      Promise.reject(Object.assign(new Error('Forbidden'), { code: 403 })),
    );

    await expect(
      new GcsObjectStore('bucket', storage).get('profiles/a.enc'),
    ).rejects.toThrow('Forbidden');
  });

  it('rejects an invalid object name without calling the API', async () => {
    const { storage, requested } = fakeStorage(async () => [Buffer.from('x')]);

    await expect(
      new GcsObjectStore('bucket', storage).get('../x'),
    ).rejects.toThrow();
    expect(requested).toEqual([]);
  });
});
