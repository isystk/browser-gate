import { describe, expect, it, vi } from 'vitest';

import { type ApiClient, createApiClient } from '../../src/mcp/apiClient.js';

const BASE_URL = 'http://api.test';
// 機密情報検知（gitleaks）の誤検知を避けるため、エントロピーの低いダミー値にする
const API_KEY = `bg_test_${'x'.repeat(24)}`;
const MARGIN_MS = 5_000;
const REQUEST = { url: 'https://example.com/', outputs: ['text'] };
const SUCCESS_BODY = {
  ok: true,
  url: 'https://example.com/',
  final_url: 'https://example.com/',
  status: 200,
  elapsed_ms: 12,
  text: 'hello',
};

function createClient(fetchImpl: typeof fetch): ApiClient {
  return createApiClient({
    baseUrl: BASE_URL,
    apiKey: API_KEY,
    marginMs: MARGIN_MS,
    fetchImpl,
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function namedError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

describe('createApiClient', () => {
  it('returns the parsed success body', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse(SUCCESS_BODY),
    );

    const result = await createClient(fetchImpl).fetchPage(REQUEST);

    expect(result).toEqual({ ok: true, body: SUCCESS_BODY });
  });

  it('posts the request as JSON to /fetch', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse(SUCCESS_BODY),
    );

    await createClient(fetchImpl).fetchPage(REQUEST);

    const call = fetchImpl.mock.calls[0];
    expect(call?.[0]).toBe(`${BASE_URL}/fetch`);
    expect(call?.[1]?.method).toBe('POST');
    expect(new Headers(call?.[1]?.headers).get('content-type')).toBe(
      'application/json',
    );
    expect(call?.[1]?.body).toBe(JSON.stringify(REQUEST));
  });

  it('sends the API key as a bearer token', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse(SUCCESS_BODY),
    );

    await createClient(fetchImpl).fetchPage(REQUEST);

    expect(
      new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get('authorization'),
    ).toBe(`Bearer ${API_KEY}`);
  });

  it('attaches an abort signal to every request', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse(SUCCESS_BODY),
    );

    await createClient(fetchImpl).fetchPage({ ...REQUEST, timeout_ms: 1_000 });

    expect(fetchImpl.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('passes an API error response through', async () => {
    const errorBody = {
      ok: false,
      error: {
        code: 'FORBIDDEN_PROFILE',
        message: 'The profile is not allowed',
      },
    };
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse(errorBody, 403),
    );

    const result = await createClient(fetchImpl).fetchPage(REQUEST);

    expect(result).toEqual({
      ok: false,
      code: errorBody.error.code,
      message: errorBody.error.message,
    });
  });

  it('returns INTERNAL_ERROR for a non-JSON response', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response('not json', { status: 502 }),
    );

    const result = await createClient(fetchImpl).fetchPage(REQUEST);

    expect(result).toMatchObject({ ok: false, code: 'INTERNAL_ERROR' });
  });

  it.each([
    { url: undefined },
    { final_url: 42 },
    { status: '200' },
    { elapsed_ms: null },
  ])(
    'returns INTERNAL_ERROR for an invalid success body %j',
    async (override) => {
      const fetchImpl = vi.fn<typeof fetch>(async () =>
        jsonResponse({ ...SUCCESS_BODY, ...override }),
      );

      const result = await createClient(fetchImpl).fetchPage(REQUEST);

      expect(result).toMatchObject({ ok: false, code: 'INTERNAL_ERROR' });
    },
  );

  it('returns INTERNAL_ERROR for an invalid error body', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ ok: false, error: { code: 'X' } }),
    );

    const result = await createClient(fetchImpl).fetchPage(REQUEST);

    expect(result).toMatchObject({ ok: false, code: 'INTERNAL_ERROR' });
  });

  it('maps a connection failure to NAVIGATION_FAILED with a startup hint', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError('fetch failed');
    });

    const result = await createClient(fetchImpl).fetchPage(REQUEST);

    expect(result).toEqual({
      ok: false,
      code: 'NAVIGATION_FAILED',
      message: expect.stringContaining('make up'),
    });
  });

  it.each(['TimeoutError', 'AbortError'])(
    'maps a %s rejection to TIMEOUT',
    async (name) => {
      const fetchImpl = vi.fn<typeof fetch>(async () => {
        throw namedError(name);
      });

      const result = await createClient(fetchImpl).fetchPage(REQUEST);

      expect(result).toEqual({
        ok: false,
        code: 'TIMEOUT',
        message: expect.any(String),
      });
    },
  );

  it.each([
    new TypeError('fetch failed'),
    namedError('TimeoutError'),
    namedError('AbortError'),
  ])('keeps the API key out of the error message for %s', async (error) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw error;
    });

    const result = await createClient(fetchImpl).fetchPage(REQUEST);

    expect(JSON.stringify(result)).not.toContain(API_KEY);
  });
});
