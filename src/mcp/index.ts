import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { type Logger, createLogger } from '../lib/logger.js';
import { createApiClient } from './apiClient.js';
import { type McpConfig, loadMcpConfig } from './config.js';
import { createMcpServer } from './server.js';

const logger = createLogger((line) => process.stderr.write(`${line}\n`));

/** Starts the stdio MCP server with the configured API client. */
async function main(): Promise<void> {
  const config = loadConfigOrExit(logger);
  const server = createMcpServer({
    client: createApiClient({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      marginMs: config.clientTimeoutMarginMs,
    }),
    maxTextChars: config.maxTextChars,
  });
  await server.connect(new StdioServerTransport());
}

/** Loads the MCP settings and exits with a logged error when they are invalid. */
function loadConfigOrExit(log: Logger): McpConfig {
  try {
    return loadMcpConfig();
  } catch (error) {
    log.error('mcp_start_failed', { message: describeError(error) });
    process.exit(1);
  }
}

/** Returns the message of an unknown error for logging. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

main().catch((error: unknown) => {
  logger.error('mcp_unexpected_error', { message: describeError(error) });
  process.exit(1);
});
