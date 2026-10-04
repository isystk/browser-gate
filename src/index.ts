import type http from 'node:http';

import { serve } from '@hono/node-server';

import { createApp } from './app.js';
import {
  type ConfigProvider,
  createFileConfigProvider,
} from './config/appConfig.js';
import { loadEnv } from './config/env.js';
import { loadLoginEnv } from './config/loginEnv.js';
import { FetchService } from './fetch/service.js';
import { createLogger } from './lib/logger.js';
import { createLoginRuntime } from './login/runtime.js';
import { DEFAULT_EGRESS_POLICY } from './security/urlGuard.js';

const env = loadEnv();
const logger = createLogger();
const getConfig = await createConfigProvider();
const loginRuntime =
  env.mode === 'login'
    ? createLoginRuntime({
        env: loadLoginEnv(),
        port: env.port,
        getConfig,
        logger,
      })
    : undefined;
const app = createApp(env.mode, {
  fetchService: env.mode === 'api' ? createFetchService() : undefined,
  loginRoutes: loginRuntime?.routes,
  fakeGoogleRoutes: loginRuntime?.fakeGoogleRoutes,
  logger,
});

const server = serve({ fetch: app.fetch, port: env.port }, (info) => {
  logger.info('listening', { mode: env.mode, port: info.port });
});
loginRuntime?.attachWebSocket(server as http.Server);

function createConfigProvider(): Promise<ConfigProvider> {
  return createFileConfigProvider(env.configPath, (error) =>
    logger.error('config_reload_failed', {
      error_name: error instanceof Error ? error.name : 'unknown',
    }),
  );
}

function createFetchService(): FetchService {
  return new FetchService({
    getConfig,
    policy: DEFAULT_EGRESS_POLICY,
    maxResponseBytes: env.maxResponseBytes,
    logger,
  });
}
