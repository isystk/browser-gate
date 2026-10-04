import { Hono } from 'hono';

import type { AppMode } from './config/env.js';

/** モード別の Hono アプリケーションを生成する。 */
export function createApp(mode: AppMode): Hono {
  const app = new Hono();
  app.get('/healthz', (c) => c.json({ status: 'ok', mode }));
  return app;
}
