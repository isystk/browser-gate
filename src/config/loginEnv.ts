import { parseAllowedEmails } from '../auth/allowedEmails.js';
import { parseEncryptionKey } from '../profile/crypto.js';

/** OAuth の接続先。fake はローカル開発専用の Google 代替。 */
export type OAuthSettings =
  { kind: 'google'; clientId: string; clientSecret: string } | { kind: 'fake' };

/** プロファイルの保存先。local はローカル開発専用。 */
export type StoreSettings =
  { kind: 'gcs'; bucket: string } | { kind: 'local'; dir: string };

/** ログイン用ブラウザの方式。plain は Playwright/CDP なしの素の Chromium（閉じた後に取り込む）、playwright は従来方式。 */
export type LoginBrowserMode = 'playwright' | 'plain';

export interface LoginEnv {
  publicBaseUrl: string;
  allowedEmails: string[];
  encryptionKey: Buffer;
  oauth: OAuthSettings;
  store: StoreSettings;
  uiDir: string;
  novncDir: string;
  /** noVNC の接続が全て切れてから、ログインセッションを自動破棄するまでの猶予。 */
  disconnectGraceMs: number;
  browserMode: LoginBrowserMode;
}

export const NOVNC_PORT = 6080;

const DEFAULT_UI_DIR = 'docker/novnc';
const DEFAULT_NOVNC_DIR = '/usr/share/novnc';
const MS_PER_SECOND = 1000;
const DEFAULT_DISCONNECT_GRACE_SECONDS = 180;
const MIN_DISCONNECT_GRACE_SECONDS = 10;
const MAX_DISCONNECT_GRACE_SECONDS = 3600;
const LOCAL_HOSTNAMES = ['localhost', '127.0.0.1'];

/** Loads the login service settings from environment variables and throws on missing or unsafe values. Error messages never contain secret values. */
export function loadLoginEnv(
  source: NodeJS.ProcessEnv = process.env,
): LoginEnv {
  const onCloudRun = nonEmpty(source.K_SERVICE) !== undefined;
  return {
    publicBaseUrl: parsePublicBaseUrl(source.PUBLIC_BASE_URL),
    allowedEmails: parseAllowedEmails(source.ALLOWED_EMAILS),
    encryptionKey: parseEncryptionKey(source.PROFILE_ENCRYPTION_KEY ?? ''),
    oauth: parseOAuth(source, onCloudRun),
    store: parseStore(source, onCloudRun),
    uiDir: nonEmpty(source.LOGIN_UI_DIR) ?? DEFAULT_UI_DIR,
    novncDir: nonEmpty(source.NOVNC_DIR) ?? DEFAULT_NOVNC_DIR,
    disconnectGraceMs: parseDisconnectGraceMs(
      source.LOGIN_DISCONNECT_GRACE_SECONDS,
    ),
    browserMode: parseBrowserMode(source.LOGIN_BROWSER_MODE),
  };
}

function parseBrowserMode(raw: string | undefined): LoginBrowserMode {
  const value = nonEmpty(raw);
  if (value === undefined || value === 'playwright') return 'playwright';
  if (value === 'plain') return 'plain';
  throw new Error('LOGIN_BROWSER_MODE must be playwright or plain');
}

function parseDisconnectGraceMs(raw: string | undefined): number {
  const value = nonEmpty(raw);
  if (value === undefined) {
    return DEFAULT_DISCONNECT_GRACE_SECONDS * MS_PER_SECOND;
  }
  const seconds = /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (
    !(seconds >= MIN_DISCONNECT_GRACE_SECONDS) ||
    seconds > MAX_DISCONNECT_GRACE_SECONDS
  ) {
    throw new Error(
      `LOGIN_DISCONNECT_GRACE_SECONDS must be an integer from ${MIN_DISCONNECT_GRACE_SECONDS} to ${MAX_DISCONNECT_GRACE_SECONDS}`,
    );
  }
  return seconds * MS_PER_SECOND;
}

function parsePublicBaseUrl(raw: string | undefined): string {
  const url = parseUrl(raw);
  const isLocal = LOCAL_HOSTNAMES.includes(url.hostname);
  const isSchemeAllowed =
    url.protocol === 'https:' || (url.protocol === 'http:' && isLocal);
  if (!isSchemeAllowed || url.pathname !== '/' || url.search !== '') {
    throw new Error(
      'PUBLIC_BASE_URL must be an https origin (http is allowed only for localhost)',
    );
  }
  return url.origin;
}

function parseUrl(raw: string | undefined): URL {
  try {
    return new URL(raw ?? '');
  } catch {
    throw new Error('PUBLIC_BASE_URL must be an absolute URL');
  }
}

function parseOAuth(
  source: NodeJS.ProcessEnv,
  onCloudRun: boolean,
): OAuthSettings {
  if (source.OAUTH_FAKE === '1') {
    if (onCloudRun) throw new Error('OAUTH_FAKE must not be used on Cloud Run');
    return { kind: 'fake' };
  }
  return { kind: 'google', ...parseOAuthClient(source.OAUTH_CLIENT_JSON) };
}

function parseOAuthClient(raw: string | undefined): {
  clientId: string;
  clientSecret: string;
} {
  const invalid = new Error(
    'OAUTH_CLIENT_JSON must be a JSON object with client_id and client_secret',
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw ?? '');
  } catch {
    throw invalid;
  }
  const client = unwrapWebClient(parsed);
  if (
    typeof client.client_id !== 'string' ||
    client.client_id === '' ||
    typeof client.client_secret !== 'string' ||
    client.client_secret === ''
  ) {
    throw invalid;
  }
  return { clientId: client.client_id, clientSecret: client.client_secret };
}

/** Accepts both {client_id, client_secret} and the file downloaded from the Google console ({"web": {...}}). */
function unwrapWebClient(parsed: unknown): Record<string, unknown> {
  const record = isRecord(parsed) ? parsed : {};
  return isRecord(record.web) ? record.web : record;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseStore(
  source: NodeJS.ProcessEnv,
  onCloudRun: boolean,
): StoreSettings {
  const dir = nonEmpty(source.PROFILE_STORE_DIR);
  if (dir !== undefined) {
    if (onCloudRun) {
      throw new Error('PROFILE_STORE_DIR must not be used on Cloud Run');
    }
    return { kind: 'local', dir };
  }
  const bucket = nonEmpty(source.GCS_BUCKET);
  if (bucket === undefined) {
    throw new Error(
      'GCS_BUCKET (or PROFILE_STORE_DIR for local use) is required',
    );
  }
  return { kind: 'gcs', bucket };
}

export function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value;
}
