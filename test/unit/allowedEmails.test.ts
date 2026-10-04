import { describe, expect, it } from 'vitest';

import {
  isEmailAllowed,
  parseAllowedEmails,
} from '../../src/auth/allowedEmails.js';

describe('parseAllowedEmails', () => {
  it('splits by comma, trims and lowercases', () => {
    expect(parseAllowedEmails(' A@Example.com , b@example.com ')).toEqual([
      'a@example.com',
      'b@example.com',
    ]);
  });

  it.each([[undefined], [''], ['  '], [' , ']])(
    'throws when no address is configured (%j)',
    (raw) => {
      expect(() => parseAllowedEmails(raw)).toThrow();
    },
  );

  it('throws on an entry that is not an email address', () => {
    expect(() => parseAllowedEmails('a@example.com,not-an-email')).toThrow();
  });
});

describe('isEmailAllowed', () => {
  const allowed = ['owner@example.com'];

  it.each([
    ['owner@example.com', true],
    ['OWNER@example.com', true],
    ['other@example.com', false],
    ['owner@example.com.evil.net', false],
    ['xowner@example.com', false],
    ['', false],
  ])('%j is %s', (email, expected) => {
    expect(isEmailAllowed(email, allowed)).toBe(expected);
  });

  it('denies everyone when the allow list is empty', () => {
    expect(isEmailAllowed('owner@example.com', [])).toBe(false);
  });
});
