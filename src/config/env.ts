/** 起動モード。api は取得用、login はログイン用サービスを表す。 */
export const APP_MODES = ['api', 'login'] as const;

export type AppMode = (typeof APP_MODES)[number];

export interface AppEnv {
  mode: AppMode;
  port: number;
}

const DEFAULT_MODE: AppMode = 'api';
const DEFAULT_PORT = 8080;

/** 環境変数から起動設定を読み込み、不正な値はエラーにする。 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  return {
    mode: parseMode(source.MODE),
    port: parsePort(source.PORT),
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
