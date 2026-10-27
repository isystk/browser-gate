import { describe, expect, it } from 'vitest';

import { isLoginUrl } from '../../src/fetch/sessionExpiry.js';

const LOGIN_PATH = '/login';
const LOGIN_HOST = 'accounts.example.com';
const MIXED_CASE_HOST = 'Accounts.Example.com';
const LOGIN_URL_WITH_QUERY = 'https://example.com/login?next=%2Fhome#form';

describe('isLoginUrl', () => {
  describe('path patterns', () => {
    it.each([
      'https://example.com/login',
      'https://example.com/login/',
      'https://example.com/login/step2',
    ])('matches %s at or below the login path', (finalUrl) => {
      expect(isLoginUrl(finalUrl, [LOGIN_PATH])).toBe(true);
    });

    it.each([
      'https://example.com/loginfoo',
      'https://example.com/login2',
      'https://example.com/signin',
      'https://example.com/',
    ])('does not match %s', (finalUrl) => {
      expect(isLoginUrl(finalUrl, [LOGIN_PATH])).toBe(false);
    });

    it('matches on the pathname of a URL with a query and fragment', () => {
      expect(isLoginUrl(LOGIN_URL_WITH_QUERY, [LOGIN_PATH])).toBe(true);
    });

    it('matches the path regardless of the host', () => {
      expect(isLoginUrl('https://other.test/login', [LOGIN_PATH])).toBe(true);
    });
  });

  describe('host patterns', () => {
    it.each([
      'https://accounts.example.com/signin',
      'https://accounts.example.com/',
      'https://eu.accounts.example.com/signin',
    ])('matches %s on the login host or its subdomain', (finalUrl) => {
      expect(isLoginUrl(finalUrl, [LOGIN_HOST])).toBe(true);
    });

    it.each([
      'https://example.com/signin',
      'https://other.test/signin',
      'https://accounts.example.com.evil.net/signin',
    ])('does not match %s', (finalUrl) => {
      expect(isLoginUrl(finalUrl, [LOGIN_HOST])).toBe(false);
    });

    it('compares the host case-insensitively', () => {
      expect(
        isLoginUrl('https://accounts.example.com/signin', [MIXED_CASE_HOST]),
      ).toBe(true);
    });
  });

  it('matches when any pattern matches', () => {
    expect(
      isLoginUrl('https://example.com/signin', [LOGIN_PATH, '/signin']),
    ).toBe(true);
  });

  it.each(['not a url', '', '/login'])(
    'returns false for the unparseable URL %j',
    (finalUrl) => {
      expect(isLoginUrl(finalUrl, [LOGIN_PATH])).toBe(false);
    },
  );

  it('returns false for an empty pattern list', () => {
    expect(isLoginUrl('https://example.com/login', [])).toBe(false);
  });
});
