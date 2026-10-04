import { randomBytes } from 'node:crypto';
import type http from 'node:http';

import type { Hono } from 'hono';

import { AuthFlow } from '../auth/authFlow.js';
import {
  GOOGLE_ENDPOINTS,
  OAuthClient,
  type OAuthClientConfig,
} from '../auth/oauth.js';
import { CookieSigner } from '../auth/sessionCookie.js';
import type { ConfigProvider } from '../config/appConfig.js';
import { type LoginEnv, NOVNC_PORT } from '../config/loginEnv.js';
import type { Logger } from '../lib/logger.js';
import {
  GcsObjectStore,
  LocalObjectStore,
  ProfileStore,
} from '../profile/store.js';
import { DEFAULT_EGRESS_POLICY } from '../security/urlGuard.js';
import { createFakeGoogle } from './fakeGoogle.js';
import { LoginService } from './loginService.js';
import { LoginSessionManager } from './loginSessionManager.js';
import { SESSION_COOKIE_NAME, createLoginRoutes } from './routes.js';
import { attachVncProxy, authorizeByCookie } from './vncProxy.js';

export interface LoginRuntimeDeps {
  env: LoginEnv;
  port: number;
  getConfig: ConfigProvider;
  logger: Logger;
}

export interface LoginRuntime {
  routes: Hono;
  fakeGoogleRoutes: Hono | undefined;
  /** HTTP サーバーへ noVNC の WebSocket 中継を取り付ける。 */
  attachWebSocket(server: http.Server): void;
}

const VNC_WEBSOCKET_PATH = '/ws';
const SIGNING_SECRET_BYTES = 32;
const LOGIN_SESSION_MAX_LIFETIME_MS = 55 * 60 * 1000;
const FAKE_CLIENT_ID = 'fake-client';
const FAKE_CLIENT_SECRET = 'fake-secret';

/** ログイン用サービスの部品（OAuth・ブラウザセッション・暗号化保存・noVNC 中継）を組み立てる。 */
export function createLoginRuntime(deps: LoginRuntimeDeps): LoginRuntime {
  const { env, logger } = deps;
  const fakeGoogle =
    env.oauth.kind === 'fake'
      ? createFakeGoogle({
          clientId: FAKE_CLIENT_ID,
          clientSecret: FAKE_CLIENT_SECRET,
        })
      : undefined;
  const authFlow = new AuthFlow({
    oauth: new OAuthClient(oauthConfig(deps)),
    // 再起動で全セッションが無効になる（ログイン用は max-instances=1 の運用）
    signer: new CookieSigner(randomBytes(SIGNING_SECRET_BYTES)),
    allowedEmails: env.allowedEmails,
  });
  const sessions = new LoginSessionManager({
    policy: DEFAULT_EGRESS_POLICY,
    maxLifetimeMs: LOGIN_SESSION_MAX_LIFETIME_MS,
    disconnectGraceMs: env.disconnectGraceMs,
    logger,
  });
  const loginService = new LoginService({
    getConfig: deps.getConfig,
    sessions,
    profileStore: new ProfileStore(createObjectStore(env), env.encryptionKey),
    logger,
  });
  return {
    routes: createLoginRoutes({
      authFlow,
      loginService,
      publicBaseUrl: env.publicBaseUrl,
      uiDir: env.uiDir,
      novncDir: env.novncDir,
      logger,
    }),
    fakeGoogleRoutes: fakeGoogle?.app,
    attachWebSocket: (server) =>
      attachVncProxy(server, {
        path: VNC_WEBSOCKET_PATH,
        upstreamPort: NOVNC_PORT,
        allowedOrigin: env.publicBaseUrl,
        isAuthorized: authorizeByCookie(
          SESSION_COOKIE_NAME,
          (value) => authFlow.authenticate(value) !== undefined,
        ),
        hasActiveSession: () => sessions.current() !== undefined,
        onClientConnected: () => sessions.clientConnected(),
        logger,
      }),
  };
}

function oauthConfig(deps: LoginRuntimeDeps): OAuthClientConfig {
  const { env, port } = deps;
  const redirectUri = `${env.publicBaseUrl}/oauth/callback`;
  if (env.oauth.kind === 'fake') {
    return {
      clientId: FAKE_CLIENT_ID,
      clientSecret: FAKE_CLIENT_SECRET,
      redirectUri,
      endpoints: {
        authorizationUrl: `${env.publicBaseUrl}/__fake_google/authorize`,
        tokenUrl: `http://127.0.0.1:${port}/__fake_google/token`,
      },
    };
  }
  return {
    clientId: env.oauth.clientId,
    clientSecret: env.oauth.clientSecret,
    redirectUri,
    endpoints: GOOGLE_ENDPOINTS,
  };
}

function createObjectStore(env: LoginEnv): GcsObjectStore | LocalObjectStore {
  return env.store.kind === 'gcs'
    ? new GcsObjectStore(env.store.bucket)
    : new LocalObjectStore(env.store.dir);
}
