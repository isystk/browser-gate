import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { ApiClient } from './apiClient.js';
import {
  FETCH_PAGE_DESCRIPTION,
  FETCH_PAGE_TOOL_NAME,
  createFetchPageHandler,
  fetchPageInputShape,
} from './fetchTool.js';

const SERVER_INFO = { name: 'browser-gate', version: '0.1.0' };

/** Creates the MCP server with the fetch_page tool registered. */
export function createMcpServer(deps: {
  client: ApiClient;
  maxTextChars: number;
}): McpServer {
  const server = new McpServer(SERVER_INFO);
  server.registerTool(
    FETCH_PAGE_TOOL_NAME,
    {
      description: FETCH_PAGE_DESCRIPTION,
      inputSchema: fetchPageInputShape,
    },
    createFetchPageHandler({
      client: deps.client,
      maxTextChars: deps.maxTextChars,
    }),
  );
  return server;
}
