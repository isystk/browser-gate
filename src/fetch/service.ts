import { type ApiKeyRecord, verifyApiKey } from '../auth/apiKey.js';
import type { ConfigProvider } from '../config/appConfig.js';
import { AppError } from '../lib/errors.js';
import { type Logger, sanitizeUrlForLog } from '../lib/logger.js';
import type { HostResolver, UpstreamProxy } from '../security/egressProxy.js';
import type { ProfileStateProvider } from '../profile/loader.js';
import { assertFetchPermission } from '../security/permission.js';
import {
  type EgressPolicy,
  assertProxyAllowed,
  normalizeHost,
  parseTargetUrl,
} from '../security/urlGuard.js';
import {
  type PageFetchInput,
  type PageFetchResult,
  fetchPage,
} from './pageFetcher.js';
import {
  type FetchRequest,
  DEFAULT_TIMEOUT_MS,
  parseFetchRequest,
  resolveOutputs,
} from './schema.js';
import { isLoginUrl } from './sessionExpiry.js';

export type PageFetcher = (input: PageFetchInput) => Promise<PageFetchResult>;

export interface FetchServiceDeps {
  getConfig: ConfigProvider;
  policy: EgressPolicy;
  maxResponseBytes: number;
  logger: Logger;
  resolve?: HostResolver;
  /** テストで差し替える。未指定なら実際の Chromium で取得する。 */
  pageFetcher?: PageFetcher;
  /** プロファイルの読み込み。未設定なら profile 指定の取得は INTERNAL_ERROR になる。 */
  profiles?: ProfileStateProvider;
}

export interface FetchResponseBody extends Omit<PageFetchResult, 'finalUrl'> {
  ok: true;
  url: string;
  final_url: string;
  elapsed_ms: number;
}

const DEFAULT_PROXY_PORT = 80;

/** 認証・入力検証・権限確認・禁止URL判定を行い、ページ取得を実行するサービス。 */
export class FetchService {
  private readonly pageFetcher: PageFetcher;

  constructor(private readonly deps: FetchServiceDeps) {
    this.pageFetcher =
      deps.pageFetcher ??
      ((input) =>
        fetchPage(
          {
            policy: deps.policy,
            resolve: deps.resolve,
            maxResponseBytes: deps.maxResponseBytes,
          },
          input,
        ));
  }

  /** Authenticates the caller, validates the request body, and returns the fetch result. */
  async execute(
    authorization: string | undefined,
    rawBody: string,
  ): Promise<FetchResponseBody> {
    const startedAt = Date.now();
    const key = await this.authenticate(authorization);
    try {
      const body = await this.fetchAuthorized(key, rawBody, startedAt);
      this.deps.logger.info('fetch', {
        key_id: key.id,
        url: sanitizeUrlForLog(body.url),
        status: body.status,
        elapsed_ms: body.elapsed_ms,
      });
      return body;
    } catch (error) {
      this.logFailure(key, error, startedAt);
      throw error;
    }
  }

  private async authenticate(
    authorization: string | undefined,
  ): Promise<ApiKeyRecord> {
    const config = await this.deps.getConfig();
    const key = verifyApiKey(authorization, config.api_keys);
    if (key === undefined) {
      this.deps.logger.warn('auth_failed');
      throw new AppError('UNAUTHORIZED', 'The API key is missing or invalid');
    }
    return key;
  }

  private async fetchAuthorized(
    key: ApiKeyRecord,
    rawBody: string,
    startedAt: number,
  ): Promise<FetchResponseBody> {
    const request = parseFetchRequest(parseJson(rawBody));
    const url = parseTargetUrl(request.url, this.deps.policy);
    const config = await this.deps.getConfig();
    assertFetchPermission({
      key,
      config,
      profile: request.profile,
      host: url.hostname,
    });
    const upstream = parseUpstreamProxy(request.proxy, this.deps.policy);
    const session = await this.loadSession(
      request.profile,
      config.profiles[request.profile ?? '']?.allowed_domains,
    );
    const result = await this.pageFetcher({
      ...toPageInput(request, url.href, upstream),
      session,
    });
    assertSessionNotExpired(
      result.finalUrl,
      request.profile === undefined
        ? undefined
        : config.profiles[request.profile]?.login_url_patterns,
    );
    const { finalUrl, ...outputs } = result;
    return {
      ok: true,
      url: request.url,
      final_url: finalUrl,
      ...outputs,
      elapsed_ms: Date.now() - startedAt,
    };
  }

  /** Loads the saved login for an authorized profile request. Returns undefined for anonymous fetches. */
  private async loadSession(
    profile: string | undefined,
    allowedDomains: readonly string[] | undefined,
  ): Promise<PageFetchInput['session']> {
    if (profile === undefined || allowedDomains === undefined) return undefined;
    if (this.deps.profiles === undefined) {
      throw new AppError(
        'INTERNAL_ERROR',
        'Profile fetching is not configured on this server',
      );
    }
    const storageState = await this.deps.profiles.load(profile, allowedDomains);
    return { storageState, allowedDomains };
  }

  private logFailure(
    key: ApiKeyRecord,
    error: unknown,
    startedAt: number,
  ): void {
    const fields = { key_id: key.id, elapsed_ms: Date.now() - startedAt };
    if (error instanceof AppError) {
      this.deps.logger.warn('fetch_failed', { ...fields, code: error.code });
      return;
    }
    this.deps.logger.error('fetch_failed', {
      ...fields,
      code: 'INTERNAL_ERROR',
      error_name: error instanceof Error ? error.name : 'unknown',
    });
  }
}

/** Throws SESSION_EXPIRED if the final URL is a login page for the profile. */
function assertSessionNotExpired(
  finalUrl: string,
  patterns: readonly string[] | undefined,
): void {
  if (patterns === undefined) return;
  if (!isLoginUrl(finalUrl, patterns)) return;
  throw new AppError(
    'SESSION_EXPIRED',
    'The saved login has expired. Log in again from the login page',
  );
}

function parseJson(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody);
  } catch {
    throw new AppError(
      'INVALID_REQUEST',
      'The request body must be valid JSON',
    );
  }
}

function toPageInput(
  request: FetchRequest,
  url: string,
  upstream: UpstreamProxy | undefined,
): PageFetchInput {
  return {
    url,
    steps: request.steps ?? [],
    outputs: resolveOutputs(request),
    extract: request.extract,
    fullPage: request.full_page ?? false,
    timeoutMs: request.timeout_ms ?? DEFAULT_TIMEOUT_MS,
    upstream,
  };
}

function parseUpstreamProxy(
  proxy: FetchRequest['proxy'],
  policy: EgressPolicy,
): UpstreamProxy | undefined {
  if (proxy === undefined) return undefined;
  const url = parseProxyUrl(proxy.server);
  const port = url.port === '' ? DEFAULT_PROXY_PORT : Number(url.port);
  const host = normalizeHost(url.hostname);
  assertProxyAllowed(host, port, policy);
  return {
    host,
    port,
    authorization: toBasicAuthorization(proxy.username, proxy.password),
  };
}

function parseProxyUrl(server: string): URL {
  try {
    const url = new URL(server);
    const isPlainProxyUrl =
      url.protocol === 'http:' &&
      url.username === '' &&
      url.password === '' &&
      url.pathname === '/' &&
      url.search === '';
    if (isPlainProxyUrl) return url;
  } catch {
    throw new AppError(
      'INVALID_REQUEST',
      'proxy.server must be an http://host:port URL',
    );
  }
  throw new AppError(
    'INVALID_REQUEST',
    'proxy.server must be an http://host:port URL without credentials',
  );
}

function toBasicAuthorization(
  username: string | undefined,
  password: string | undefined,
): string | undefined {
  if (username === undefined) return undefined;
  return `Basic ${Buffer.from(`${username}:${password ?? ''}`).toString('base64')}`;
}
