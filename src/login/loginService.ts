import type { ConfigProvider } from '../config/appConfig.js';
import { AppError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import {
  type StorageStateLike,
  filterStorageState,
} from '../profile/cookieFilter.js';
import { assertLoginProfile } from '../security/loginProfile.js';

/** ログイン用ブラウザの1セッション。 */
export interface LoginBrowserSession {
  profile: string;
  storageState(): Promise<StorageStateLike>;
}

/** ログイン用ブラウザセッションの起動・取得・終了を担う。 */
export interface LoginSessionHost {
  start(profile: string): Promise<LoginBrowserSession>;
  current(): LoginBrowserSession | undefined;
  end(): Promise<void>;
}

/** 暗号化してプロファイルを保存する。 */
export interface ProfileSaver {
  save(profile: string, plaintext: Buffer): Promise<void>;
}

export interface LoginServiceDeps {
  getConfig: ConfigProvider;
  sessions: LoginSessionHost;
  profileStore: ProfileSaver;
  logger: Logger;
}

export interface SaveResult {
  profile: string;
  cookies: number;
  origins: number;
  droppedCookies: number;
  droppedOrigins: number;
}

/** ログインセッションの開始・保存・中止を扱い、登録済みプロファイルだけを許可する。 */
export class LoginService {
  constructor(private readonly deps: LoginServiceDeps) {}

  /** Starts (or reuses) the login browser for a registered profile, or throws PROFILE_NOT_FOUND. */
  async openSession(profile: string): Promise<void> {
    assertLoginProfile(profile, await this.deps.getConfig());
    await this.deps.sessions.start(profile);
    this.deps.logger.info('login_session_opened', { profile });
  }

  /**
   * Saves the active session's profile.
   * - Keeps only cookies and storage of the profile's allowed domains
   * - Encrypts and stores the result, then ends the session
   * - Leaves the session open if storing fails so that the user can retry
   */
  async saveSession(): Promise<SaveResult> {
    const session = this.deps.sessions.current();
    if (session === undefined) {
      throw new AppError('INVALID_REQUEST', 'No login session is active');
    }
    const allowedDomains = await this.allowedDomainsOf(session.profile);
    const filtered = filterStorageState(
      await session.storageState(),
      allowedDomains,
    );
    await this.deps.profileStore.save(
      session.profile,
      Buffer.from(JSON.stringify(filtered.state)),
    );
    await this.deps.sessions.end();
    const result: SaveResult = {
      profile: session.profile,
      cookies: filtered.state.cookies.length,
      origins: filtered.state.origins.length,
      droppedCookies: filtered.droppedCookies,
      droppedOrigins: filtered.droppedOrigins,
    };
    this.deps.logger.info('profile_saved', {
      profile: result.profile,
      cookie_count: result.cookies,
      origin_count: result.origins,
      dropped_cookie_count: result.droppedCookies,
      dropped_origin_count: result.droppedOrigins,
    });
    return result;
  }

  /** Ends the active session without saving. */
  async cancelSession(): Promise<void> {
    await this.deps.sessions.end();
    this.deps.logger.info('login_session_cancelled');
  }

  private async allowedDomainsOf(profile: string): Promise<string[]> {
    const config = await this.deps.getConfig();
    assertLoginProfile(profile, config);
    const domains = config.profiles[profile]?.allowed_domains ?? [];
    if (domains.length === 0) {
      throw new AppError(
        'INVALID_REQUEST',
        'The profile has no allowed domains, so nothing can be saved',
      );
    }
    return domains;
  }
}
