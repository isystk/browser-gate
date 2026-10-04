import { randomBytes } from 'node:crypto';

import { AppError } from '../lib/errors.js';
import { isEmailAllowed } from './allowedEmails.js';
import { type OAuthClient, createPkcePair } from './oauth.js';
import type { CookieSigner } from './sessionCookie.js';

export const FLOW_COOKIE_TTL_MS = 10 * 60 * 1000;
export const SESSION_COOKIE_TTL_MS = 55 * 60 * 1000;

const FLOW_KIND = 'oauth_flow';
const SESSION_KIND = 'login_session';
const STATE_BYTES = 16;

export interface AuthFlowDeps {
  oauth: OAuthClient;
  signer: CookieSigner;
  allowedEmails: readonly string[];
}

export interface BeginResult {
  authorizationUrl: string;
  flowCookie: string;
}

export interface CompleteInput {
  code: string;
  state: string;
  flowCookie: string | undefined;
}

export interface CompleteResult {
  profile: string;
  sessionCookie: string;
}

/** OAuth ログインの開始・完了と、許可メールアドレスの判定・セッション Cookie の発行を行うサービス。 */
export class AuthFlow {
  constructor(private readonly deps: AuthFlowDeps) {}

  /** Starts a sign-in: returns the Google URL and a signed cookie that carries state, nonce, PKCE verifier and the profile. */
  begin(profile: string): BeginResult {
    const state = randomBytes(STATE_BYTES).toString('base64url');
    const nonce = randomBytes(STATE_BYTES).toString('base64url');
    const pkce = createPkcePair();
    return {
      authorizationUrl: this.deps.oauth.buildAuthorizationUrl({
        state,
        nonce,
        codeChallenge: pkce.challenge,
      }),
      flowCookie: this.deps.signer.sign(
        FLOW_KIND,
        { state, nonce, verifier: pkce.verifier, profile },
        FLOW_COOKIE_TTL_MS,
      ),
    };
  }

  /** Completes a sign-in and returns a session cookie, or throws UNAUTHORIZED / FORBIDDEN_USER. */
  async complete(input: CompleteInput): Promise<CompleteResult> {
    const flow = this.deps.signer.verify(FLOW_KIND, input.flowCookie);
    const { state, nonce, verifier, profile } = flow ?? {};
    if (
      state === undefined ||
      nonce === undefined ||
      verifier === undefined ||
      profile === undefined ||
      state !== input.state
    ) {
      throw new AppError('UNAUTHORIZED', 'The sign-in request is invalid');
    }
    const identity = await this.deps.oauth.exchangeCode({
      code: input.code,
      codeVerifier: verifier,
      nonce,
    });
    if (!isEmailAllowed(identity.email, this.deps.allowedEmails)) {
      throw new AppError(
        'FORBIDDEN_USER',
        'This Google account is not allowed to use the login screen',
      );
    }
    return {
      profile,
      sessionCookie: this.deps.signer.sign(
        SESSION_KIND,
        { email: identity.email },
        SESSION_COOKIE_TTL_MS,
      ),
    };
  }

  /** Returns the signed-in user if the cookie is a valid session and the email is still on the allow list. */
  authenticate(
    sessionCookie: string | undefined,
  ): { email: string } | undefined {
    const email = this.deps.signer.verify(SESSION_KIND, sessionCookie)?.email;
    if (email === undefined) return undefined;
    return isEmailAllowed(email, this.deps.allowedEmails)
      ? { email }
      : undefined;
  }
}
