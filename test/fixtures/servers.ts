import http from 'node:http';
import net, { type AddressInfo, type Socket } from 'node:net';

const LOOPBACK = '127.0.0.1';
const BIG_BODY_BYTES = 3 * 1024 * 1024;

/** /whoami がログイン済みと判定する Cookie。 */
export const SESSION_COOKIE = 'sid';
export const SESSION_VALUE = 'fixture-session-token';

export interface FixtureServer {
  host: string;
  port: number;
  origin: string;
  /** 受信したリクエストのパス（メソッド付き）。到達しないことの確認に使う。 */
  hits: string[];
  /** 受信したリクエストの Cookie ヘッダー（hits と同じ順）。Cookie を送っていないことの確認に使う。 */
  cookieHeaders: (string | undefined)[];
  close(): Promise<void>;
}

export interface FixtureProxyRequest {
  kind: 'forward' | 'connect';
  target: string;
  proxyAuthorization: string | undefined;
}

export interface FixtureProxy extends FixtureServer {
  requests: FixtureProxyRequest[];
}

const ARTICLE_HTML = `<!doctype html><html><head><title>Fixture Article</title></head><body>
<h1>Fixture Title</h1>
<article><p>First paragraph</p><p>Second paragraph</p></article>
<button class="more" onclick="document.body.insertAdjacentHTML('beforeend','<p id=extra>Extra content</p>')">More</button>
</body></html>`;

const SCROLL_HTML = `<!doctype html><html><body style="margin:0">
<div style="height:5000px">tall</div><div id="bottom-marker">bottom</div>
<script>addEventListener('scroll',()=>{ if (scrollY > 1000) document.title = 'scrolled'; });</script>
</body></html>`;

/** 結合テスト用のローカルWebサーバーを起動する。 */
export async function startFixtureServer(): Promise<FixtureServer> {
  const hits: string[] = [];
  const cookieHeaders: (string | undefined)[] = [];
  const server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    cookieHeaders.push(req.headers.cookie);
    route(req, res);
  });
  return listen(server, hits, cookieHeaders);
}

/** 受け取った接続をそのまま返す TCP エコーサーバーを起動する。 */
export async function startEchoServer(): Promise<FixtureServer> {
  const hits: string[] = [];
  const server = net.createServer((socket) => {
    hits.push('connection');
    socket.on('error', () => socket.destroy());
    socket.pipe(socket);
  });
  return listen(server, hits);
}

/** 上流プロキシ役のサーバーを起動し、受信したリクエストと Proxy-Authorization を記録する。 */
export async function startFixtureProxy(): Promise<FixtureProxy> {
  const requests: FixtureProxyRequest[] = [];
  const hits: string[] = [];
  const server = http.createServer((req, res) => {
    requests.push({
      kind: 'forward',
      target: req.url ?? '',
      proxyAuthorization: req.headers['proxy-authorization'],
    });
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><html><body><h1>via-proxy</h1></body></html>');
  });
  server.on('connect', (req, socket: Socket) => {
    requests.push({
      kind: 'connect',
      target: req.url ?? '',
      proxyAuthorization: req.headers['proxy-authorization'],
    });
    socket.on('error', () => socket.destroy());
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    socket.pipe(socket);
  });
  return { ...(await listen(server, hits)), requests };
}

function route(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = new URL(req.url ?? '/', `http://${LOOPBACK}`);
  switch (url.pathname) {
    case '/article':
      return html(res, ARTICLE_HTML);
    case '/scroll':
      return html(res, SCROLL_HTML);
    case '/set-cookie':
      res.setHeader('set-cookie', 'sid=fixture-session; Path=/');
      return html(res, '<!doctype html><html><body>cookie set</body></html>');
    case '/whoami':
      return html(res, whoamiPage(req.headers.cookie ?? ''));
    case '/leave':
      return html(
        res,
        `<!doctype html><html><body><a class="leave" href="${url.searchParams.get('to') ?? '/'}">leave</a></body></html>`,
      );
    case '/redirect':
      res.writeHead(302, { location: url.searchParams.get('to') ?? '/' });
      return void res.end();
    case '/with-subresources':
      return html(res, subresourcePage(url.searchParams.getAll('src')));
    case '/with-file-iframe':
      return html(
        res,
        '<!doctype html><html><body><h1>frame</h1><iframe src="file:///etc/passwd"></iframe></body></html>',
      );
    case '/status/403':
      res.writeHead(403, { 'content-type': 'text/html' });
      return void res.end('<html><body>blocked by site</body></html>');
    case '/big':
      return html(
        res,
        `<html><body>${'x'.repeat(BIG_BODY_BYTES)}</body></html>`,
      );
    case '/slow':
      return;
    default:
      res.writeHead(404).end('not found');
  }
}

function html(res: http.ServerResponse, body: string): void {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(body);
}

/** Cookie の有無でログイン済み・未ログインの表示が変わるページ（プロファイル利用取得の検証用）。 */
function whoamiPage(cookieHeader: string): string {
  const signedIn = cookieHeader
    .split(';')
    .some((pair) => pair.trim() === `${SESSION_COOKIE}=${SESSION_VALUE}`);
  return signedIn
    ? '<!doctype html><html><body><h1>Signed in as alice</h1></body></html>'
    : '<!doctype html><html><body><h1>Please sign in</h1></body></html>';
}

function subresourcePage(sources: string[]): string {
  const tags = sources.flatMap((src) => [
    `<img src="${src}">`,
    `<script src="${src}"></script>`,
  ]);
  const fetches = sources
    .map((src) => `fetch(${JSON.stringify(src)}).catch(()=>{});`)
    .join('');
  return `<!doctype html><html><body><h1>with subresources</h1>${tags.join('')}<script>${fetches}</script></body></html>`;
}

async function listen(
  server: net.Server,
  hits: string[],
  cookieHeaders: (string | undefined)[] = [],
): Promise<FixtureServer> {
  await new Promise<void>((resolve) => server.listen(0, LOOPBACK, resolve));
  const { port } = server.address() as AddressInfo;
  const sockets = new Set<Socket>();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  return {
    host: LOOPBACK,
    port,
    origin: `http://${LOOPBACK}:${port}`,
    hits,
    cookieHeaders,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        sockets.forEach((socket) => socket.destroy());
      }),
  };
}
