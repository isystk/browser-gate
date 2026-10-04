import { serve } from '@hono/node-server';

import { createApp } from './app.js';
import { launchHeadfulBrowser } from './browser/launcher.js';
import { loadEnv } from './config/env.js';

const env = loadEnv();
const app = createApp(env.mode);

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`browser-gate (${env.mode}) listening on :${info.port}`);
});

if (env.mode === 'login') {
  await launchHeadfulBrowser();
}
