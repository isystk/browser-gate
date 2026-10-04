import type { Page } from 'playwright';

import { AppError } from '../lib/errors.js';
import { remainingMs } from './steps.js';
import type { OutputKind } from './schema.js';

export interface PageOutputs {
  html?: string;
  text?: string;
  screenshot?: string;
  extract?: Record<string, string[]>;
}

export interface OutputRequest {
  outputs: readonly OutputKind[];
  extract: Record<string, string> | undefined;
  fullPage: boolean;
  deadlineMs: number;
  maxBytes: number;
}

/** Collects the requested outputs and throws RESPONSE_TOO_LARGE as soon as their total size exceeds the limit. */
export async function collectOutputs(
  page: Page,
  request: OutputRequest,
): Promise<PageOutputs> {
  const result: PageOutputs = {};
  let used = 0;
  const account = (value: string): void => {
    used += Buffer.byteLength(value);
    if (used > request.maxBytes)
      throw new AppError(
        'RESPONSE_TOO_LARGE',
        'The result exceeds the response size limit',
      );
  };

  if (request.outputs.includes('html')) {
    result.html = await page.content();
    account(result.html);
  }
  if (request.outputs.includes('text')) {
    result.text = await page
      .locator('body')
      .innerText({ timeout: remainingMs(request.deadlineMs) });
    account(result.text);
  }
  if (request.extract !== undefined) {
    result.extract = await extractAll(page, request.extract);
    account(JSON.stringify(result.extract));
  }
  if (request.outputs.includes('screenshot')) {
    const png = await page.screenshot({
      type: 'png',
      fullPage: request.fullPage,
      timeout: remainingMs(request.deadlineMs),
    });
    result.screenshot = png.toString('base64');
    account(result.screenshot);
  }
  return result;
}

async function extractAll(
  page: Page,
  selectors: Record<string, string>,
): Promise<Record<string, string[]>> {
  const entries = await Promise.all(
    Object.entries(selectors).map(
      async ([name, selector]) =>
        [name, await page.locator(`css=${selector}`).allInnerTexts()] as const,
    ),
  );
  return Object.fromEntries(entries);
}
