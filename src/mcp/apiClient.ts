import { DEFAULT_TIMEOUT_MS } from '../fetch/schema.js';

/** browser-gate API の成功応答。 */
export interface ApiSuccess {
  ok: true;
  url: string;
  final_url: string;
  status: number;
  elapsed_ms: number;
  html?: string;
  text?: string;
  screenshot?: string;
  extract?: Record<string, string[]>;
}

/** browser-gate API の呼び出し結果。 */
export type ApiResult =
  { ok: true; body: ApiSuccess } | { ok: false; code: string; message: string };

/** browser-gate API への HTTP クライアント。 */
export interface ApiClient {
  fetchPage(request: Record<string, unknown>): Promise<ApiResult>;
}

/** API クライアントの生成オプション。 */
export interface ApiClientOptions {
  baseUrl: string;
  apiKey: string;
  marginMs: number;
  defaultTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const INTERNAL_ERROR = 'INTERNAL_ERROR';
const NAVIGATION_FAILED = 'NAVIGATION_FAILED';
const TIMEOUT = 'TIMEOUT';
const CONNECTION_FAILED_MESSAGE =
  'Cannot connect to the browser-gate API. Check that it is running (for example, run "make up").';
const TIMEOUT_MESSAGE = 'The browser-gate API request timed out';
const NON_JSON_MESSAGE = 'The browser-gate API returned a non-JSON response';
const INVALID_RESPONSE_MESSAGE =
  'The browser-gate API returned an invalid response';
const INVALID_ERROR_MESSAGE =
  'The browser-gate API returned an invalid error response';

/** Creates a client that posts to /fetch with a mandatory timeout and never logs request secrets. */
export function createApiClient(options: ApiClientOptions): ApiClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    async fetchPage(request: Record<string, unknown>): Promise<ApiResult> {
      const timeoutMs = resolveTimeoutMs(request, defaultTimeoutMs);
      let response: Response;
      try {
        response = await fetchImpl(`${options.baseUrl}/fetch`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${options.apiKey}`,
          },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(timeoutMs + options.marginMs),
        });
      } catch (error) {
        return toTransportFailure(error);
      }
      return parseResponse(response);
    },
  };
}

function resolveTimeoutMs(
  request: Record<string, unknown>,
  defaultTimeoutMs: number,
): number {
  const timeoutMs = request.timeout_ms;
  return typeof timeoutMs === 'number' ? timeoutMs : defaultTimeoutMs;
}

function toTransportFailure(error: unknown): ApiResult {
  if (isTimeoutError(error)) return fail(TIMEOUT, TIMEOUT_MESSAGE);
  return fail(NAVIGATION_FAILED, CONNECTION_FAILED_MESSAGE);
}

/** Returns true if the error is an AbortSignal timeout or abort. */
function isTimeoutError(error: unknown): boolean {
  if (!isRecord(error)) return false;
  return error.name === 'TimeoutError' || error.name === 'AbortError';
}

async function parseResponse(response: Response): Promise<ApiResult> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    return fail(INTERNAL_ERROR, NON_JSON_MESSAGE);
  }
  if (!isRecord(value)) return fail(INTERNAL_ERROR, INVALID_RESPONSE_MESSAGE);
  if (value.ok === false) return parseError(value);
  if (value.ok === true) return parseSuccess(value);
  return fail(INTERNAL_ERROR, INVALID_RESPONSE_MESSAGE);
}

function parseError(value: Record<string, unknown>): ApiResult {
  const error = value.error;
  if (
    isRecord(error) &&
    typeof error.code === 'string' &&
    typeof error.message === 'string'
  )
    return fail(error.code, error.message);
  return fail(INTERNAL_ERROR, INVALID_ERROR_MESSAGE);
}

function parseSuccess(value: Record<string, unknown>): ApiResult {
  if (
    typeof value.url !== 'string' ||
    typeof value.final_url !== 'string' ||
    typeof value.status !== 'number' ||
    typeof value.elapsed_ms !== 'number'
  )
    return fail(INTERNAL_ERROR, INVALID_RESPONSE_MESSAGE);
  return {
    ok: true,
    body: {
      ok: true,
      url: value.url,
      final_url: value.final_url,
      status: value.status,
      elapsed_ms: value.elapsed_ms,
      ...pickOutputs(value),
    },
  };
}

function pickOutputs(
  value: Record<string, unknown>,
): Pick<ApiSuccess, 'html' | 'text' | 'screenshot' | 'extract'> {
  const outputs: Pick<ApiSuccess, 'html' | 'text' | 'screenshot' | 'extract'> =
    {};
  if (typeof value.html === 'string') outputs.html = value.html;
  if (typeof value.text === 'string') outputs.text = value.text;
  if (typeof value.screenshot === 'string')
    outputs.screenshot = value.screenshot;
  if (isStringArrayRecord(value.extract)) outputs.extract = value.extract;
  return outputs;
}

function isStringArrayRecord(
  value: unknown,
): value is Record<string, string[]> {
  if (!isRecord(value)) return false;
  return Object.values(value).every(
    (entry) =>
      Array.isArray(entry) &&
      entry.every((item: unknown) => typeof item === 'string'),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fail(code: string, message: string): ApiResult {
  return { ok: false, code, message };
}
