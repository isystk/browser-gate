/** 起動モード。api は取得用、login はログイン用サービスを表す。 */
export const APP_MODES = ['api', 'login'] as const;

export type AppMode = (typeof APP_MODES)[number];

export interface AppEnv {
  mode: AppMode;
  port: number;
  configPath: string;
  maxResponseBytes: number;
}

const DEFAULT_MODE: AppMode = 'api';
const DEFAULT_PORT = 8080;
const DEFAULT_CONFIG_PATH = 'config/local.json';
const DEFAULT_MAX_RESPONSE_BYTES = 24 * 1024 * 1024;
const MAX_RESPONSE_BYTES_LIMIT = 30 * 1024 * 1024;

/** 環境変数から起動設定を読み込み、不正な値はエラーにする。 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  return {
    mode: parseMode(source.MODE),
    port: parsePort(source.PORT),
    maxResponseBytes: parseMaxResponseBytes(source.MAX_RESPONSE_BYTES),
    configPath:
      source.CONFIG_PATH === undefined || source.CONFIG_PATH === ''
        ? DEFAULT_CONFIG_PATH
        : source.CONFIG_PATH,
  };
}

function parseMode(value: string | undefined): AppMode {
  if (value === undefined || value === '') return DEFAULT_MODE;
  const mode = APP_MODES.find((candidate) => candidate === value);
  if (mode === undefined) {
    throw new Error(`MODE must be one of: ${APP_MODES.join(', ')}`);
  }
  return mode;
}

function parsePort(value: string | undefined): number {
  if (value === undefined || value === '') return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  return port;
}

function parseMaxResponseBytes(value: string | undefined): number {
  if (value === undefined || value === '') return DEFAULT_MAX_RESPONSE_BYTES;
  const bytes = Number(value);
  if (
    !Number.isInteger(bytes) ||
    bytes < 1 ||
    bytes > MAX_RESPONSE_BYTES_LIMIT
  ) {
    throw new Error(
      `MAX_RESPONSE_BYTES must be an integer between 1 and ${MAX_RESPONSE_BYTES_LIMIT}`,
    );
  }
  return bytes;
}
