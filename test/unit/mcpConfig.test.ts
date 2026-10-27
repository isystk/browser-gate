import { describe, expect, it } from 'vitest';

import {
  CLIENT_TIMEOUT_MARGIN_MS,
  MAX_TEXT_CHARS,
  loadMcpConfig,
} from '../../src/mcp/config.js';

const BASE_ENV = { BROWSER_GATE_API_KEY: 'test-api-key' };

describe('loadMcpConfig', () => {
  it('throws when the API key is not set', () => {
    expect(() => loadMcpConfig({})).toThrow('BROWSER_GATE_API_KEY');
  });

  it('throws when the API key is empty', () => {
    expect(() => loadMcpConfig({ BROWSER_GATE_API_KEY: '' })).toThrow(
      'BROWSER_GATE_API_KEY',
    );
  });

  it('does not include the API key in the error message', () => {
    expect(() =>
      loadMcpConfig({
        BROWSER_GATE_API_KEY: 'secret-looking-value',
        BROWSER_GATE_URL: 'file:///etc/passwd',
      }),
    ).toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining('secret-looking-value'),
      }),
    );
  });

  it('uses the default URL and constants when only the key is set', () => {
    expect(loadMcpConfig(BASE_ENV)).toEqual({
      apiKey: 'test-api-key',
      baseUrl: 'http://localhost:8080',
      clientTimeoutMarginMs: CLIENT_TIMEOUT_MARGIN_MS,
      maxTextChars: MAX_TEXT_CHARS,
    });
  });

  it('rejects a non-http scheme', () => {
    expect(() =>
      loadMcpConfig({ ...BASE_ENV, BROWSER_GATE_URL: 'file:///etc/passwd' }),
    ).toThrow('BROWSER_GATE_URL');
  });

  it('rejects a URL that cannot be parsed', () => {
    expect(() =>
      loadMcpConfig({ ...BASE_ENV, BROWSER_GATE_URL: 'not a url' }),
    ).toThrow('BROWSER_GATE_URL');
  });

  it('removes the trailing slash from the base URL', () => {
    expect(
      loadMcpConfig({
        ...BASE_ENV,
        BROWSER_GATE_URL: 'https://gateway.example.test/',
      }).baseUrl,
    ).toBe('https://gateway.example.test');
  });
});
