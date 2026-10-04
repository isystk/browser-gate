import { describe, expect, it } from 'vitest';

import { parseCookieHeader } from '../../src/lib/cookies.js';

describe('parseCookieHeader', () => {
  it('parses name-value pairs', () => {
    expect(parseCookieHeader('a=1; b=two')).toEqual({ a: '1', b: 'two' });
  });

  it('keeps "=" inside values and decodes percent encoding', () => {
    expect(parseCookieHeader('t=x.y=z; u=%E3%81%82')).toEqual({
      t: 'x.y=z',
      u: 'あ',
    });
  });

  it('uses the first occurrence of a duplicated name', () => {
    expect(parseCookieHeader('a=1; a=2')).toEqual({ a: '1' });
  });

  it.each([[undefined], [''], [';;'], ['novalue'], ['=x']])(
    'returns an empty object for %j',
    (header) => {
      expect(parseCookieHeader(header)).toEqual({});
    },
  );

  it('does not let a cookie named __proto__ pollute the result', () => {
    const result = parseCookieHeader('__proto__=x');

    expect(Object.getPrototypeOf(result)).toBeNull();
  });
});
