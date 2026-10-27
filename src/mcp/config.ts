/** Settings for the stdio MCP server, loaded from environment variables. */
export interface McpConfig {
  apiKey: string;
  baseUrl: string;
  clientTimeoutMarginMs: number;
  maxTextChars: number;
}

/** Extra time added to the API timeout so the client waits for the server's own timeout. */
export const CLIENT_TIMEOUT_MARGIN_MS = 5000;

/** Maximum number of characters returned for text or html content. */
export const MAX_TEXT_CHARS = 50000;

const API_KEY_ENV = 'BROWSER_GATE_API_KEY';
const BASE_URL_ENV = 'BROWSER_GATE_URL';
const DEFAULT_BASE_URL = 'http://localhost:8080';
const ALLOWED_PROTOCOLS = ['http:', 'https:'];
const TRAILING_SLASHES = /\/+$/;

/** Loads and validates the MCP settings and throws on a missing key or an unsafe URL. Error messages never contain the key value. */
export function loadMcpConfig(
  env: Record<string, string | undefined> = process.env,
): McpConfig {
  return {
    apiKey: parseApiKey(env[API_KEY_ENV]),
    baseUrl: parseBaseUrl(env[BASE_URL_ENV]),
    clientTimeoutMarginMs: CLIENT_TIMEOUT_MARGIN_MS,
    maxTextChars: MAX_TEXT_CHARS,
  };
}

function parseApiKey(raw: string | undefined): string {
  if (raw === undefined || raw === '') {
    throw new Error(`${API_KEY_ENV} is required`);
  }
  return raw;
}

function parseBaseUrl(raw: string | undefined): string {
  const value = raw === undefined || raw === '' ? DEFAULT_BASE_URL : raw;
  const url = parseUrl(value);
  if (!ALLOWED_PROTOCOLS.includes(url.protocol)) {
    throw new Error(`${BASE_URL_ENV} must be an http or https URL`);
  }
  return url.href.replace(TRAILING_SLASHES, '');
}

function parseUrl(raw: string): URL {
  try {
    return new URL(raw);
  } catch {
    throw new Error(`${BASE_URL_ENV} must be an absolute http or https URL`);
  }
}
