import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it, vi } from 'vitest';

import type {
  ApiClient,
  ApiResult,
  ApiSuccess,
} from '../../src/mcp/apiClient.js';
import {
  FETCH_PAGE_DESCRIPTION,
  FETCH_PAGE_TOOL_NAME,
  createFetchPageHandler,
  fetchPageInputShape,
} from '../../src/mcp/fetchTool.js';

const PAGE_URL = 'https://example.com/';
const FINAL_URL = 'https://example.com/final';
const PROFILE = 'work';
const MAX_TEXT_CHARS = 10;
const PNG_BASE64 = 'iVBORw0KGgo=';
const FIELD_NAMES = [
  'url',
  'profile',
  'outputs',
  'extract',
  'steps',
  'timeout_ms',
  'full_page',
];
const SUCCESS_BODY: ApiSuccess = {
  ok: true,
  url: PAGE_URL,
  final_url: FINAL_URL,
  status: 200,
  elapsed_ms: 42,
};

function createFixture(result: ApiResult = { ok: true, body: SUCCESS_BODY }) {
  const fetchPage = vi.fn<ApiClient['fetchPage']>(async () => result);
  const client: ApiClient = { fetchPage };
  const handler = createFetchPageHandler({
    client,
    maxTextChars: MAX_TEXT_CHARS,
  });
  return { handler, fetchPage };
}

function successResult(body: ApiSuccess): ApiResult {
  return { ok: true, body };
}

function textContent(result: CallToolResult, index = 0): string {
  const content = result.content[index];
  if (content === undefined || content.type !== 'text') {
    throw new Error(`content[${index}] is not text`);
  }
  return content.text;
}

function parseMeta(result: CallToolResult): Record<string, unknown> {
  return JSON.parse(textContent(result)) as Record<string, unknown>;
}

function descriptionOf(schema: unknown): string | undefined {
  const candidate = schema as {
    description?: string;
    _def?: { description?: string };
    _zod?: { def?: { description?: string } };
  };
  return (
    candidate.description ??
    candidate._def?.description ??
    candidate._zod?.def?.description
  );
}

describe('fetch_page tool definition', () => {
  it('is named fetch_page', () => {
    expect(FETCH_PAGE_TOOL_NAME).toBe('fetch_page');
  });

  it('warns that fetched content is untrusted', () => {
    expect(FETCH_PAGE_DESCRIPTION.toLowerCase()).toContain('untrusted');
  });

  it('warns that session expiry is not detected and final_url must be checked', () => {
    const description = FETCH_PAGE_DESCRIPTION.toLowerCase();
    expect(description).toContain('expir');
    expect(description).toContain('final_url');
    expect(description).toContain('login');
  });

  it('states that a profile must be allowed for the API key', () => {
    expect(FETCH_PAGE_DESCRIPTION.toLowerCase()).toContain(
      'allowed for the api key',
    );
  });

  it('states that profile use is read-only and steps are unavailable', () => {
    const description = FETCH_PAGE_DESCRIPTION.toLowerCase();
    expect(description).toContain('read-only');
    expect(description).toContain('steps');
  });
});

describe('fetchPageInputShape', () => {
  it('contains every fetch request field and excludes proxy', () => {
    expect(Object.keys(fetchPageInputShape).sort()).toEqual(
      [...FIELD_NAMES].sort(),
    );
    expect(Object.keys(fetchPageInputShape)).not.toContain('proxy');
  });

  it('describes every field', () => {
    for (const field of Object.values(fetchPageInputShape)) {
      expect(descriptionOf(field)).toEqual(expect.any(String));
    }
  });
});

describe('createFetchPageHandler', () => {
  it('rejects steps with profile without calling the API', async () => {
    const { handler, fetchPage } = createFixture();

    const result = await handler({
      url: PAGE_URL,
      profile: PROFILE,
      steps: [{ scroll: 'bottom' }],
    });

    expect(result.isError).toBe(true);
    expect(textContent(result)).toContain('INVALID_REQUEST');
    expect(textContent(result)).toContain('steps');
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('rejects empty outputs without extract without calling the API', async () => {
    const { handler, fetchPage } = createFixture();

    const result = await handler({ url: PAGE_URL, outputs: [] });

    expect(result.isError).toBe(true);
    expect(textContent(result)).toContain('INVALID_REQUEST');
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('rejects malformed arguments without calling the API', async () => {
    const { handler, fetchPage } = createFixture();

    const result = await handler({ url: PAGE_URL, outputs: 'text' });

    expect(result.isError).toBe(true);
    expect(textContent(result)).toContain('INVALID_REQUEST');
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('defaults outputs to text when neither outputs nor extract is given', async () => {
    const { handler, fetchPage } = createFixture();

    await handler({ url: PAGE_URL });

    expect(fetchPage).toHaveBeenCalledWith({
      url: PAGE_URL,
      outputs: ['text'],
    });
  });

  it('does not add outputs when only extract is given', async () => {
    const { handler, fetchPage } = createFixture();
    const extract = { title: 'h1' };

    await handler({ url: PAGE_URL, extract });

    expect(fetchPage).toHaveBeenCalledWith({ url: PAGE_URL, extract });
  });

  it('drops proxy and unknown fields from the API request', async () => {
    const { handler, fetchPage } = createFixture();

    await handler({
      url: PAGE_URL,
      outputs: ['text'],
      proxy: { server: 'http://proxy.example.test:8080' },
      script: 'alert(1)',
    });

    expect(fetchPage).toHaveBeenCalledWith({
      url: PAGE_URL,
      outputs: ['text'],
    });
    expect(fetchPage.mock.calls[0]?.[0]).not.toHaveProperty('proxy');
  });

  it('returns metadata as the first text content', async () => {
    const { handler } = createFixture();

    const result = await handler({ url: PAGE_URL });

    expect(result.isError).toBeUndefined();
    expect(parseMeta(result)).toEqual({
      final_url: FINAL_URL,
      status: SUCCESS_BODY.status,
      elapsed_ms: SUCCESS_BODY.elapsed_ms,
    });
  });

  it('includes extract in the metadata when present', async () => {
    const extract = { title: ['Example'] };
    const { handler } = createFixture(
      successResult({ ...SUCCESS_BODY, extract }),
    );

    const result = await handler({ url: PAGE_URL, extract: { title: 'h1' } });

    expect(parseMeta(result).extract).toEqual(extract);
  });

  it('returns text as a second text content', async () => {
    const { handler } = createFixture(
      successResult({ ...SUCCESS_BODY, text: 'hello' }),
    );

    const result = await handler({ url: PAGE_URL, outputs: ['text'] });

    expect(result.content[1]).toEqual({ type: 'text', text: 'hello' });
    expect(parseMeta(result)).not.toHaveProperty('truncated');
  });

  it('truncates text at maxTextChars and marks the metadata', async () => {
    const text = '0123456789ABCDEF';
    const { handler } = createFixture(successResult({ ...SUCCESS_BODY, text }));

    const result = await handler({ url: PAGE_URL, outputs: ['text'] });

    expect(result.content[1]).toEqual({
      type: 'text',
      text: text.slice(0, MAX_TEXT_CHARS),
    });
    expect(parseMeta(result).truncated).toBe(true);
  });

  it('truncates html at maxTextChars and marks the metadata', async () => {
    const html = '<p>0123456789ABCDEF</p>';
    const { handler } = createFixture(successResult({ ...SUCCESS_BODY, html }));

    const result = await handler({ url: PAGE_URL, outputs: ['html'] });

    expect(result.content[1]).toEqual({
      type: 'text',
      text: html.slice(0, MAX_TEXT_CHARS),
    });
    expect(parseMeta(result).truncated).toBe(true);
  });

  it('returns a screenshot as image content', async () => {
    const { handler } = createFixture(
      successResult({ ...SUCCESS_BODY, screenshot: PNG_BASE64 }),
    );

    const result = await handler({ url: PAGE_URL, outputs: ['screenshot'] });

    expect(result.content).toContainEqual({
      type: 'image',
      data: PNG_BASE64,
      mimeType: 'image/png',
    });
  });

  it('returns API errors as tool errors with code and message', async () => {
    const { handler } = createFixture({
      ok: false,
      code: 'TIMEOUT',
      message: 'The request timed out',
    });

    const result = await handler({ url: PAGE_URL });

    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'TIMEOUT: The request timed out' }],
    });
  });
});
