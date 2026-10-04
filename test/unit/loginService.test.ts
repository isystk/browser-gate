import { beforeEach, describe, expect, it } from 'vitest';

import type { AppConfig } from '../../src/config/appConfig.js';
import { AppError } from '../../src/lib/errors.js';
import { createLogger } from '../../src/lib/logger.js';
import {
  type LoginBrowserSession,
  type LoginSessionHost,
  LoginService,
} from '../../src/login/loginService.js';
import type { StorageStateLike } from '../../src/profile/cookieFilter.js';

const CONFIG: AppConfig = {
  api_keys: [],
  profiles: {
    news: { allowed_domains: ['example.com'] },
    empty: { allowed_domains: [] },
  },
};

function cookie(domain: string): StorageStateLike['cookies'][number] {
  return {
    name: 'c',
    value: 'v',
    domain,
    path: '/',
    expires: -1,
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
  };
}

describe('LoginService', () => {
  let saved: { profile: string; data: Buffer }[];
  let ended: number;
  let active: LoginBrowserSession | undefined;
  let service: LoginService;

  beforeEach(() => {
    saved = [];
    ended = 0;
    active = undefined;
    const sessions: LoginSessionHost = {
      start: async (profile) => {
        active = {
          profile,
          storageState: async () => ({
            cookies: [cookie('www.example.com'), cookie('accounts.google.com')],
            origins: [],
          }),
        };
        return active;
      },
      current: () => active,
      end: async () => {
        ended += 1;
        active = undefined;
      },
    };
    service = new LoginService({
      getConfig: async () => CONFIG,
      sessions,
      profileStore: {
        save: async (profile, data) => void saved.push({ profile, data }),
      },
      logger: createLogger(() => undefined),
    });
  });

  async function codeOf(run: () => Promise<unknown>): Promise<string> {
    try {
      await run();
      return 'NO_ERROR';
    } catch (error) {
      return error instanceof AppError ? error.code : 'NOT_APP_ERROR';
    }
  }

  it('does not start a session for an unregistered profile', async () => {
    expect(await codeOf(() => service.openSession('unknown'))).toBe(
      'PROFILE_NOT_FOUND',
    );
    expect(active).toBeUndefined();
  });

  it('saves only the cookies of the profile allowed domains and ends the session', async () => {
    await service.openSession('news');

    const result = await service.saveSession();

    const stored = JSON.parse(
      saved[0]?.data.toString() ?? '{}',
    ) as StorageStateLike;
    expect(saved[0]?.profile).toBe('news');
    expect(stored.cookies.map((item) => item.domain)).toEqual([
      'www.example.com',
    ]);
    expect(result).toMatchObject({
      profile: 'news',
      cookies: 1,
      droppedCookies: 1,
    });
    expect(ended).toBe(1);
  });

  it('refuses to save a profile that has no allowed domains', async () => {
    await service.openSession('empty');

    expect(await codeOf(() => service.saveSession())).toBe('INVALID_REQUEST');
    expect(saved).toEqual([]);
    expect(active).toBeDefined();
  });

  it('refuses to save when no session is active', async () => {
    expect(await codeOf(() => service.saveSession())).toBe('INVALID_REQUEST');
  });

  it('keeps the session open when storing fails so that the user can retry', async () => {
    await service.openSession('news');
    const failing = new LoginService({
      getConfig: async () => CONFIG,
      sessions: {
        start: async () => {
          throw new Error('unused');
        },
        current: () => active,
        end: async () => {
          ended += 1;
        },
      },
      profileStore: {
        save: async () => {
          throw new Error('storage down');
        },
      },
      logger: createLogger(() => undefined),
    });

    await expect(failing.saveSession()).rejects.toThrow('storage down');
    expect(ended).toBe(0);
  });

  it('cancels the active session', async () => {
    await service.openSession('news');

    await service.cancelSession();

    expect(ended).toBe(1);
  });
});
