import { type Browser, chromium } from 'playwright';

const START_URL = 'about:blank';
const LOOPBACK_HOST = '127.0.0.1';

// コンテナ内ではユーザー名前空間が使えないため --no-sandbox が必要。
// Cloud Run の /dev/shm は小さいため --disable-dev-shm-usage で /tmp を使わせる。
const BASE_ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--lang=ja-JP'];

/** ヘッドフル Chromium を Xvfb 上に起動し、noVNC から操作できる状態にする。 */
export async function launchHeadfulBrowser(): Promise<void> {
  const browser = await chromium.launch({
    headless: false,
    args: BASE_ARGS,
  });
  const page = await browser.newPage();
  await page.goto(START_URL);
}

/** Launches a headful Chromium whose every connection is forced through the local egress proxy. */
export async function launchFetchBrowser(proxyPort: number): Promise<Browser> {
  return chromium.launch({
    headless: false,
    args: [
      ...BASE_ARGS,
      `--proxy-server=http://${LOOPBACK_HOST}:${proxyPort}`,
      // 既定ではループバックとリンクローカルがプロキシを迂回するため、迂回対象を空にする
      '--proxy-bypass-list=<-loopback>',
      // プロキシ経由の通信では Chromium 自身に名前解決させず、迂回した直接接続も失敗させる
      `--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE ${LOOPBACK_HOST}`,
      // UDP を使う QUIC / WebRTC はプロキシを迂回できるため無効にする
      '--disable-quic',
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    ],
  });
}
