/** 機密情報を伏せた JSON Lines 形式のログ出力。 */
export interface Logger {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

type LogLevel = 'info' | 'warn' | 'error';
type LogWriter = (line: string) => void;

const REDACTED = '[REDACTED]';
const SENSITIVE_KEYS = new Set([
  'authorization',
  'cookie',
  'cookies',
  'set-cookie',
  'password',
  'username',
  'proxy',
  'api_key',
  'apikey',
  'key',
  'token',
  'secret',
  'hash',
  'html',
  'text',
  'body',
  'screenshot',
  'extract',
]);
const API_KEY_PATTERN = /\bbg_[A-Za-z0-9_-]{20,}/g;
const BEARER_PATTERN = /\bBearer\s+\S+/gi;
const URL_CREDENTIALS_PATTERN = /(\w+:\/\/)[^/\s@]+@/g;
const MAX_DEPTH = 5;

/** Creates a logger that writes redacted JSON lines through the given writer (stdout by default). */
export function createLogger(write: LogWriter = writeToStdout): Logger {
  const emit = (
    level: LogLevel,
    event: string,
    fields: Record<string, unknown> = {},
  ): void => {
    const entry = {
      time: new Date().toISOString(),
      level,
      event,
      ...(redact(fields, 0) as Record<string, unknown>),
    };
    write(JSON.stringify(entry));
  };
  return {
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
  };
}

/** Reduces a URL to origin and path so that credentials, query strings, and fragments are never logged. */
export function sanitizeUrlForLog(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return '[invalid-url]';
  }
}

function writeToStdout(line: string): void {
  process.stdout.write(`${line}\n`);
}

function redact(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return scrubString(value);
  if (depth >= MAX_DEPTH) return REDACTED;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value !== null && typeof value === 'object')
    return redactObject(value, depth);
  return value;
}

function redactObject(value: object, depth: number): Record<string, unknown> {
  const entries = Object.entries(value).map(
    ([key, item]) => [key, redactEntry(key, item, depth)] as const,
  );
  return Object.fromEntries(entries);
}

function redactEntry(key: string, item: unknown, depth: number): unknown {
  if (SENSITIVE_KEYS.has(key.toLowerCase())) return REDACTED;
  return redact(item, depth + 1);
}

function scrubString(value: string): string {
  return value
    .replace(BEARER_PATTERN, `Bearer ${REDACTED}`)
    .replace(API_KEY_PATTERN, REDACTED)
    .replace(URL_CREDENTIALS_PATTERN, `$1${REDACTED}@`);
}
