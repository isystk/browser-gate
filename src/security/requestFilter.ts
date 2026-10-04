import type { BrowserContext } from 'playwright';

import { AppError } from '../lib/errors.js';
import type { BlockedEvent } from './egressProxy.js';
import { type EgressPolicy, parseTargetUrl } from './urlGuard.js';

const INLINE_SCHEMES = ['data:', 'blob:', 'about:'];
const WEBSOCKET_SCHEME_PATTERN = /^ws(s?):/i;

/** Returns the reason a browser request must be blocked, or undefined if it may proceed. */
export function findRequestViolation(
  rawUrl: string,
  policy: EgressPolicy,
): string | undefined {
  if (INLINE_SCHEMES.some((scheme) => rawUrl.toLowerCase().startsWith(scheme)))
    return undefined;
  try {
    parseTargetUrl(rawUrl.replace(WEBSOCKET_SCHEME_PATTERN, 'http$1:'), policy);
    return undefined;
  } catch (error) {
    if (error instanceof AppError) return error.message;
    throw error;
  }
}

/** Aborts every browser request (navigation, redirect, sub-resource) that violates the policy and reports it. */
export async function installRequestFilter(
  context: BrowserContext,
  policy: EgressPolicy,
  onBlocked: (event: BlockedEvent) => void,
): Promise<void> {
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    const reason = findRequestViolation(url, policy);
    if (reason === undefined) {
      await route.continue();
      return;
    }
    onBlocked({ target: new URL(url, 'http://invalid.local').host, reason });
    await route.abort('blockedbyclient');
  });
}
