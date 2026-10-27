import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ApiClient, ApiResult } from '../../src/mcp/apiClient.js';
import {
  FETCH_PAGE_DESCRIPTION,
  FETCH_PAGE_TOOL_NAME,
} from '../../src/mcp/fetchTool.js';
import { createMcpServer } from '../../src/mcp/server.js';

const MAX_TEXT_CHARS = 20_000;
const PAGE_URL = 'https://example.com/article';
const FINAL_URL = 'https://example.com/article';
const PAGE_TEXT = 'Fixture Title\nFirst paragraph';
const TIMEOUT_CODE = 'TIMEOUT';
const TIMEOUT_MESSAGE = 'The browser-gate API request timed out';

const SUCCESS: ApiResult = {
  ok: true,
  body: {
    ok: true,
    url: PAGE_URL,
    final_url: FINAL_URL,
    status: 200,
    elapsed_ms: 12,
    text: PAGE_TEXT,
  },
};

const FAILURE: ApiResult = {
  ok: false,
  code: TIMEOUT_CODE,
  message: TIMEOUT_MESSAGE,
};

/** Fake API client that records requests and returns the configured result. */
class StubApiClient implements ApiClient {
  result: ApiResult = SUCCESS;
  readonly requests: Record<string, unknown>[] = [];

  async fetchPage(request: Record<string, unknown>): Promise<ApiResult> {
    this.requests.push(request);
    return this.result;
  }
}

describe('MCP server', () => {
  let api: StubApiClient;
  let client: Client;
  let server: McpServer;

  beforeEach(async () => {
    api = new StubApiClient();
    server = createMcpServer({ client: api, maxTextChars: MAX_TEXT_CHARS });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '1.0.0' });
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it('lists the fetch_page tool with its description', async () => {
    const { tools } = await client.listTools();

    const tool = tools.find((entry) => entry.name === FETCH_PAGE_TOOL_NAME);
    expect(tool).toMatchObject({
      name: FETCH_PAGE_TOOL_NAME,
      description: FETCH_PAGE_DESCRIPTION,
    });
  });

  it('returns the page text fetched through the API client', async () => {
    const result = await client.callTool({
      name: FETCH_PAGE_TOOL_NAME,
      arguments: { url: PAGE_URL, outputs: ['text'] },
    });

    expect(api.requests).toHaveLength(1);
    expect(api.requests[0]).toMatchObject({ url: PAGE_URL });
    expect(result).toMatchObject({
      content: expect.arrayContaining([
        { type: 'text', text: expect.stringContaining(PAGE_TEXT) },
      ]),
    });
  });

  it('returns an error result when the API call fails', async () => {
    api.result = FAILURE;

    const result = await client.callTool({
      name: FETCH_PAGE_TOOL_NAME,
      arguments: { url: PAGE_URL },
    });

    expect(result).toMatchObject({
      isError: true,
      content: expect.arrayContaining([
        { type: 'text', text: expect.stringContaining(TIMEOUT_CODE) },
      ]),
    });
  });

  it('rejects a profile with steps without calling the API', async () => {
    const result = await client.callTool({
      name: FETCH_PAGE_TOOL_NAME,
      arguments: {
        url: PAGE_URL,
        profile: 'member',
        steps: [{ wait_for: 'article' }],
      },
    });

    expect(result).toMatchObject({ isError: true });
    expect(api.requests).toEqual([]);
  });
});
