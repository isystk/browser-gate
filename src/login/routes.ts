import { Hono } from 'hono';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

import {
  type AuthFlow,
  FLOW_COOKIE_TTL_MS,
  SESSION_COOKIE_TTL_MS,
} from '../auth/authFlow.js';
import { AppError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import { parseProfileName } from '../security/loginProfile.js';
import type { LoginService } from './loginService.js';
import { readStaticFile } from './staticFiles.js';

export const SESSION_COOKIE_NAME = 'bg_session';

const FLOW_COOKIE_NAME = 'bg_oauth';
const FLOW_COOKIE_PATH = '/oauth';
const NOVNC_PREFIX = '/novnc';
const ASSET_PREFIX = '/login/assets';
const ASSET_FILES = ['/login.js', '/login.css'];
const PAGE_TEMPLATE = '/login.html';
const REQUESTED_WITH = 'browser-gate';
const MS_PER_SECOND = 1000;
const NOT_FOUND_STATUS = 404;
const PAGE_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');
const FRAME_CSP = "frame-ancestors 'self'";

export interface LoginRoutesDeps {
  authFlow: AuthFlow;
  loginService: LoginService;
  publicBaseUrl: string;
  uiDir: string;
  novncDir: string;
  logger: Logger;
}

/** ログイン画面（OAuth・noVNC 画面・保存/中止）を提供する Hono ルート。未認証ではログイン画面も noVNC も使えない。 */
export function createLoginRoutes(deps: LoginRoutesDeps): Hono {
  const routes = new Hono();
  const base = new URL(deps.publicBaseUrl);
  const isSecure = base.protocol === 'https:';
  const requireUser = createUserGuard(deps.authFlow);
  const requireAjax = createAjaxGuard(base.origin);

  routes.use('*', async (c, next) => {
    if (new URL(c.req.url).host !== base.host) {
      throw new AppError(
        'INVALID_REQUEST',
        'Open the login screen through its public URL',
      );
    }
    await next();
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
  });

  routes.get('/login', async (c) => {
    const profile = parseProfileName(c.req.query('profile'));
    if (
      deps.authFlow.authenticate(getCookie(c, SESSION_COOKIE_NAME)) ===
      undefined
    ) {
      const { authorizationUrl, flowCookie } = deps.authFlow.begin(profile);
      setCookie(c, FLOW_COOKIE_NAME, flowCookie, {
        ...cookieOptions(isSecure, FLOW_COOKIE_TTL_MS),
        path: FLOW_COOKIE_PATH,
      });
      return c.redirect(authorizationUrl, 302);
    }
    await deps.loginService.openSession(profile);
    c.header('Content-Security-Policy', PAGE_CSP);
    return c.html(await renderPage(deps.uiDir, profile));
  });

  routes.get('/oauth/callback', async (c) => {
    const { code, state, error } = c.req.query();
    if (error !== undefined || !code || !state) {
      deps.logger.warn('oauth_callback_rejected');
      throw new AppError(
        'UNAUTHORIZED',
        'Sign-in with Google was not completed',
      );
    }
    const result = await deps.authFlow
      .complete({ code, state, flowCookie: getCookie(c, FLOW_COOKIE_NAME) })
      .catch((failure: unknown) => {
        deps.logger.warn('login_denied', {
          code: failure instanceof AppError ? failure.code : 'INTERNAL_ERROR',
        });
        throw failure;
      });
    deleteCookie(c, FLOW_COOKIE_NAME, { path: FLOW_COOKIE_PATH });
    setCookie(
      c,
      SESSION_COOKIE_NAME,
      result.sessionCookie,
      cookieOptions(isSecure, SESSION_COOKIE_TTL_MS),
    );
    return c.redirect(
      `/login?profile=${encodeURIComponent(result.profile)}`,
      302,
    );
  });

  routes.use(`${NOVNC_PREFIX}/*`, requireUser);
  routes.get(`${NOVNC_PREFIX}/*`, async (c) => {
    c.header('Content-Security-Policy', FRAME_CSP);
    c.header('X-Frame-Options', 'SAMEORIGIN');
    return serveStatic(c, deps.novncDir, c.req.path.slice(NOVNC_PREFIX.length));
  });

  routes.use(`${ASSET_PREFIX}/*`, requireUser);
  routes.get(`${ASSET_PREFIX}/*`, async (c) => {
    const file = c.req.path.slice(ASSET_PREFIX.length);
    if (!ASSET_FILES.includes(file)) return notFound(c);
    return serveStatic(c, deps.uiDir, file);
  });

  routes.post('/login/save', requireUser, requireAjax, async (c) => {
    const result = await deps.loginService.saveSession();
    return c.json({
      ok: true,
      profile: result.profile,
      cookies: result.cookies,
      dropped_cookies: result.droppedCookies,
      dropped_origins: result.droppedOrigins,
    });
  });

  routes.post('/login/cancel', requireUser, requireAjax, async (c) => {
    await deps.loginService.cancelSession();
    return c.json({ ok: true });
  });

  return routes;
}

function createUserGuard(authFlow: AuthFlow) {
  return async (c: Context, next: () => Promise<void>): Promise<void> => {
    if (
      authFlow.authenticate(getCookie(c, SESSION_COOKIE_NAME)) === undefined
    ) {
      throw new AppError('UNAUTHORIZED', 'Sign in is required');
    }
    await next();
  };
}

/** Rejects state-changing requests that do not come from this site's own page (Origin check plus a custom header). */
function createAjaxGuard(origin: string) {
  return async (c: Context, next: () => Promise<void>): Promise<void> => {
    const isSameSite =
      c.req.header('origin') === origin &&
      c.req.header('x-requested-with') === REQUESTED_WITH;
    if (!isSameSite) {
      throw new AppError(
        'FORBIDDEN_USER',
        'Cross-site requests are not allowed',
      );
    }
    await next();
  };
}

function cookieOptions(isSecure: boolean, ttlMs: number) {
  return {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'Lax' as const,
    path: '/',
    maxAge: ttlMs / MS_PER_SECOND,
  };
}

async function serveStatic(
  c: Context,
  root: string,
  urlPath: string,
): Promise<Response> {
  const file = await readStaticFile(root, urlPath);
  if (file === undefined) return notFound(c);
  c.header('Content-Type', file.contentType);
  return c.body(new Uint8Array(file.body));
}

function notFound(c: Context): Response {
  return c.json(
    { ok: false, error: { code: 'INVALID_REQUEST', message: 'Not found' } },
    NOT_FOUND_STATUS,
  );
}

async function renderPage(uiDir: string, profile: string): Promise<string> {
  const template = await readStaticFile(uiDir, PAGE_TEMPLATE);
  if (template === undefined)
    throw new Error('The login page template is missing');
  return template.body
    .toString('utf8')
    .replaceAll('{{PROFILE}}', escapeHtml(profile));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
