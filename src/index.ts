import { serve } from '@hono/node-server';

import { createApp } from './app.js';
import { launchHeadfulBrowser } from './browser/launcher.js';
import { createFileConfigProvider } from './config/appConfig.js';
import { loadEnv } from './config/env.js';
import { FetchService } from './fetch/service.js';
import { createLogger } from './lib/logger.js';
import { DEFAULT_EGRESS_POLICY } from './security/urlGuard.js';

const env = loadEnv();
const logger = createLogger();
const fetchService =
  env.mode === 'api' ? await createFetchService() : undefined;
const app = createApp(env.mode, { fetchService, logger });

serve({ fetch: app.fetch, port: env.port }, (info) => {
  logger.info('listening', { mode: env.mode, port: info.port });
});

if (env.mode === 'login') {
  await launchHeadfulBrowser();
}

async function createFetchService(): Promise<FetchService> {
  const getConfig = await createFileConfigProvider(env.configPath, (error) =>
    logger.error('config_reload_failed', {
      error_name: error instanceof Error ? error.name : 'unknown',
    }),
  );
  return new FetchService({
    getConfig,
    policy: DEFAULT_EGRESS_POLICY,
    maxResponseBytes: env.maxResponseBytes,
    logger,
  });
}
