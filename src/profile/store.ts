import { randomBytes } from 'node:crypto';
import { chmod, mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { Storage } from '@google-cloud/storage';

import { parseProfileName } from '../security/loginProfile.js';
import { encryptProfile } from './crypto.js';

/** 名前を指定してバイト列を保存するストレージ。 */
export interface ObjectStore {
  put(name: string, data: Buffer): Promise<void>;
}

const OBJECT_NAME_PATTERN =
  /^(?:[a-z0-9][a-z0-9_-]*\/)*[a-z0-9][a-z0-9_-]*\.enc$/;
const OWNER_ONLY_DIR_MODE = 0o700;
const OWNER_ONLY_FILE_MODE = 0o600;
const TEMP_SUFFIX_BYTES = 6;
const OBJECT_CONTENT_TYPE = 'application/octet-stream';

/** Returns the object name for a profile and throws if the profile name is malformed. */
export function profileObjectName(profile: string): string {
  return `profiles/${parseProfileName(profile)}.enc`;
}

/** プロファイルを暗号化してオブジェクトストアへ保存するサービス。 */
export class ProfileStore {
  constructor(
    private readonly objects: ObjectStore,
    private readonly key: Buffer,
  ) {}

  /** Encrypts the serialized profile with AES-256-GCM and writes it, replacing the previous one. */
  async save(profile: string, plaintext: Buffer): Promise<void> {
    const name = profileObjectName(profile);
    await this.objects.put(name, encryptProfile(this.key, profile, plaintext));
  }
}

/** ローカル開発用に、ディレクトリ配下へファイルとして保存するストア（権限 600、原子的に置換）。 */
export class LocalObjectStore implements ObjectStore {
  constructor(private readonly dir: string) {}

  async put(name: string, data: Buffer): Promise<void> {
    const file = this.resolve(name);
    await mkdir(path.dirname(file), {
      recursive: true,
      mode: OWNER_ONLY_DIR_MODE,
    });
    const temp = `${file}.${randomBytes(TEMP_SUFFIX_BYTES).toString('hex')}.tmp`;
    await writeFile(temp, data, { mode: OWNER_ONLY_FILE_MODE });
    await chmod(temp, OWNER_ONLY_FILE_MODE);
    await rename(temp, file);
  }

  private resolve(name: string): string {
    assertObjectName(name);
    const root = path.resolve(this.dir);
    const file = path.resolve(root, name);
    if (!file.startsWith(`${root}${path.sep}`)) {
      throw new Error('The object name escapes the store directory');
    }
    return file;
  }
}

/** Cloud Storage のバケットへ保存するストア。認証は実行環境の ADC（Cloud Run のサービスアカウント）を使う。 */
export class GcsObjectStore implements ObjectStore {
  constructor(
    private readonly bucket: string,
    private readonly storage: Storage = new Storage(),
  ) {}

  async put(name: string, data: Buffer): Promise<void> {
    assertObjectName(name);
    await this.storage.bucket(this.bucket).file(name).save(data, {
      resumable: false,
      contentType: OBJECT_CONTENT_TYPE,
    });
  }
}

function assertObjectName(name: string): void {
  if (!OBJECT_NAME_PATTERN.test(name)) {
    throw new Error('The object name is invalid');
  }
}
