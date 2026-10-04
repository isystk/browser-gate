import { describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/config/env.js';

describe('loadEnv', () => {
  it('uses defaults when nothing is set', () => {
    expect(loadEnv({})).toEqual({
      mode: 'api',
      port: 8080,
      configPath: 'config/local.json',
      maxResponseBytes: 24 * 1024 * 1024,
    });
  });

  it('reads overrides', () => {
    expect(
      loadEnv({
        MODE: 'login',
        PORT: '9000',
        CONFIG_PATH: '/x.json',
        MAX_RESPONSE_BYTES: '1000',
      }),
    ).toEqual({
      mode: 'login',
      port: 9000,
      configPath: '/x.json',
      maxResponseBytes: 1000,
    });
  });

  it.each([
    { MODE: 'other' },
    { PORT: '0' },
    { PORT: 'abc' },
    { MAX_RESPONSE_BYTES: '0' },
    { MAX_RESPONSE_BYTES: '99999999999' },
    { MAX_RESPONSE_BYTES: '1.5' },
  ])('rejects invalid value %j', (source) => {
    expect(() => loadEnv(source)).toThrow();
  });
});
