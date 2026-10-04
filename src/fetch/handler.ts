import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import { AppError } from '../lib/errors.js';
import type { FetchService } from './service.js';

const MAX_REQUEST_BODY_BYTES = 64 * 1024;
const PAYLOAD_TOO_LARGE_STATUS = 413;

/** POST /fetch を FetchService へ中継する Hono ルート。 */
export function createFetchRoutes(service: FetchService): Hono {
  const routes = new Hono();
  routes.post(
    '/fetch',
    bodyLimit({
      maxSize: MAX_REQUEST_BODY_BYTES,
      onError: (c) =>
        c.json(
          errorBody('INVALID_REQUEST', 'The request body is too large'),
          PAYLOAD_TOO_LARGE_STATUS,
        ),
    }),
    async (c) =>
      c.json(
        await service.execute(
          c.req.header('authorization'),
          await c.req.text(),
        ),
      ),
  );
  return routes;
}

/** Builds the error response body defined by the API specification. */
export function errorBody(
  code: AppError['code'],
  message: string,
): { ok: false; error: { code: string; message: string } } {
  return { ok: false, error: { code, message } };
}
