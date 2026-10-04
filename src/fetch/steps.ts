import type { Page } from 'playwright';

import type { FetchStep } from './schema.js';

/** Runs the allow-listed page steps in order, each limited by the time remaining until the deadline. */
export async function runSteps(
  page: Page,
  steps: readonly FetchStep[],
  deadlineMs: number,
): Promise<void> {
  for (const step of steps) {
    await runStep(page, step, remainingMs(deadlineMs));
  }
}

/** Returns the milliseconds left until the deadline, never below 1 so Playwright does not treat it as "no timeout". */
export function remainingMs(
  deadlineMs: number,
  now: number = Date.now(),
): number {
  return Math.max(1, deadlineMs - now);
}

async function runStep(
  page: Page,
  step: FetchStep,
  timeout: number,
): Promise<void> {
  if ('wait_for' in step) {
    await page
      .locator(`css=${step.wait_for}`)
      .first()
      .waitFor({ state: 'visible', timeout });
    return;
  }
  if ('click' in step) {
    await page.locator(`css=${step.click}`).first().click({ timeout });
    return;
  }
  await scroll(page, step.scroll);
}

async function scroll(page: Page, target: 'top' | 'bottom'): Promise<void> {
  const toBottom = target === 'bottom';
  await page.evaluate(
    (bottom) =>
      window.scrollTo(0, bottom ? document.documentElement.scrollHeight : 0),
    toBottom,
  );
}
