import type { BrowserContext, Request } from 'playwright';

import { AppError } from '../lib/errors.js';
import type { BlockedEvent } from './egressProxy.js';
import { isDomainAllowed } from './permission.js';
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

export interface RequestFilterOptions {
  /**
   * When set (profile fetching), top-level navigations to hosts outside these domains are aborted and reported through onOutOfDomain.
   * Redirect hops cannot be aborted (Chromium follows them internally), so they are only reported after the request was made.
   * Sub-resources and sub-frames are not restricted by this check, so pages can load CDNs.
   */
  navigationDomains?: readonly string[];
  onOutOfDomain?: (event: BlockedEvent) => void;
}

/** Aborts every browser request (navigation, redirect, sub-resource) that violates the policy and reports it. */
export async function installRequestFilter(
  context: BrowserContext,
  policy: EgressPolicy,
  onBlocked: (event: BlockedEvent) => void,
  options: RequestFilterOptions = {},
): Promise<void> {
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = request.url();
    const reason = findRequestViolation(url, policy);
    if (reason !== undefined) {
      onBlocked({ target: new URL(url, 'http://invalid.local').host, reason });
      await route.abort('blockedbyclient');
      return;
    }
    const { navigationDomains } = options;
    if (
      navigationDomains !== undefined &&
      isOutOfDomainNavigation(request, navigationDomains)
    ) {
      options.onOutOfDomain?.(outOfDomainEvent(url));
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  // Chromium は route.continue() 後のリダイレクトをブラウザ内で追従し、route には再度届かない。
  // 遷移ホップは request イベントで検知し、後から FORBIDDEN_DOMAIN にする（本文は返さない）。
  if (options.navigationDomains !== undefined) {
    const domains = options.navigationDomains;
    context.on('request', (request) => {
      if (isOutOfDomainNavigation(request, domains)) {
        options.onOutOfDomain?.(outOfDomainEvent(request.url()));
      }
    });
  }
}

function outOfDomainEvent(url: string): BlockedEvent {
  return {
    target: new URL(url).host,
    reason: 'The navigation target is outside the profile allowed domains',
  };
}

function isOutOfDomainNavigation(
  request: Request,
  domains: readonly string[],
): boolean {
  return (
    isTopLevelNavigation(request) && !isUrlInDomains(request.url(), domains)
  );
}

function isTopLevelNavigation(request: Request): boolean {
  return (
    request.isNavigationRequest() && request.frame().parentFrame() === null
  );
}

function isUrlInDomains(url: string, domains: readonly string[]): boolean {
  // data: / about: / blob: は外部への通信を伴わない（findRequestViolation が許可済み）
  if (INLINE_SCHEMES.some((scheme) => url.toLowerCase().startsWith(scheme)))
    return true;
  return isDomainAllowed(new URL(url).hostname, domains);
}
