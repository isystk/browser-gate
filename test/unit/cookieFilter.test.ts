import { describe, expect, it } from 'vitest';

import {
  type StorageStateLike,
  filterStorageState,
} from '../../src/profile/cookieFilter.js';

function cookie(
  domain: string,
  name = 'c',
): StorageStateLike['cookies'][number] {
  return {
    name,
    value: 'v',
    domain,
    path: '/',
    expires: -1,
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
  };
}

function origin(value: string): StorageStateLike['origins'][number] {
  return { origin: value, localStorage: [{ name: 'k', value: 'v' }] };
}

function domainsOf(state: StorageStateLike): string[] {
  return state.cookies.map((item) => item.domain);
}

describe('filterStorageState', () => {
  const allowed = ['example.com'];

  it('keeps cookies of the allowed domain and its subdomains', () => {
    const state: StorageStateLike = {
      cookies: [
        cookie('example.com'),
        cookie('.example.com'),
        cookie('www.example.com'),
      ],
      origins: [],
    };

    const result = filterStorageState(state, allowed);

    expect(domainsOf(result.state)).toEqual([
      'example.com',
      '.example.com',
      'www.example.com',
    ]);
    expect(result.droppedCookies).toBe(0);
  });

  it.each([
    ['other.org'],
    ['.other.org'],
    ['evilexample.com'],
    ['example.com.evil.net'],
    ['accounts.google.com'],
  ])('drops cookies of the unrelated domain %s', (domain) => {
    const result = filterStorageState(
      { cookies: [cookie(domain)], origins: [] },
      allowed,
    );

    expect(result.state.cookies).toEqual([]);
    expect(result.droppedCookies).toBe(1);
  });

  it('keeps a parent-domain cookie that applies to an allowed subdomain', () => {
    const result = filterStorageState(
      { cookies: [cookie('.example.com')], origins: [] },
      ['app.example.com'],
    );

    expect(domainsOf(result.state)).toEqual(['.example.com']);
  });

  it('keeps only localStorage origins whose host is allowed', () => {
    const state: StorageStateLike = {
      cookies: [],
      origins: [
        origin('https://www.example.com'),
        origin('https://other.org'),
        origin('not a url'),
      ],
    };

    const result = filterStorageState(state, allowed);

    expect(result.state.origins.map((item) => item.origin)).toEqual([
      'https://www.example.com',
    ]);
    expect(result.droppedOrigins).toBe(2);
  });

  it('drops everything when no domain is allowed', () => {
    const result = filterStorageState(
      {
        cookies: [cookie('example.com')],
        origins: [origin('https://example.com')],
      },
      [],
    );

    expect(result.state).toEqual({ cookies: [], origins: [] });
  });

  it('does not mutate the input', () => {
    const state: StorageStateLike = {
      cookies: [cookie('other.org')],
      origins: [],
    };

    filterStorageState(state, allowed);

    expect(state.cookies).toHaveLength(1);
  });
});
