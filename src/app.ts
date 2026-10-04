import { Hono } from 'hono';

import type { AppMode } from './config/env.js';
import { createFetchRoutes, errorBody } from './fetch/handler.js';
import type { FetchService } from './fetch/service.js';
import { AppError } from './lib/errors.js';
import type { Logger } from './lib/logger.js';

export interface AppDeps {
  fetchService?: FetchService;
  logger: Logger;
}

const NOT_FOUND_STATUS = 404;

/** モード別の Hono アプリケーションを生成する。 */
export function createApp(mode: AppMode, deps: AppDeps): Hono {
  const app = new Hono();
  app.get('/healthz', (c) => c.json({ status: 'ok', mode }));
  if (mode === 'api' && deps.fetchService !== undefined) {
    app.route('/', createFetchRoutes(deps.fetchService));
  }
  app.notFound((c) =>
    c.json(errorBody('INVALID_REQUEST', 'Not found'), NOT_FOUND_STATUS),
  );
  app.onError((error, c) => {
    if (error instanceof AppError)
      return c.json(errorBody(error.code, error.message), error.status);
    deps.logger.error('unhandled_error', { error_name: error.name });
    return c.json(
      errorBody('INTERNAL_ERROR', 'An unexpected error occurred'),
      500,
    );
  });
  return app;
}
