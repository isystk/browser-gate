import { chromium } from 'playwright';

const START_URL = 'about:blank';

/** ヘッドフル Chromium を Xvfb 上に起動し、noVNC から操作できる状態にする。 */
export async function launchHeadfulBrowser(): Promise<void> {
  // コンテナ内ではユーザー名前空間が使えないため --no-sandbox が必要
  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();
  await page.goto(START_URL);
}
