# browser-gate

## 1. browser-gate とは

Bot 対策（自動アクセスを弾く仕組み）が入った Web サイトでも、本物のブラウザ（Chromium）で開いて、本文・HTML・スクリーンショットを取得して返す API です。ローカルの Docker 上で動かします。

なお、Google Cloud（Cloud Run）での公開運用は 2026-10-27 に終了し、クラウド上のリソースはすべて削除済みです（ローカル専用）。

現在の到達点は次のとおりです。

| 機能 | 状態 |
|---|---|
| 匿名取得（ログインなしで URL を開き、本文・HTML・スクリーンショット・指定部分の抜き出しを返す） | 実装済み |
| ログイン画面（noVNC で人が手動ログインし、Cookie 等を暗号化して保存） | 実装済み（ローカルで動作確認済み） |
| ログイン済みプロファイルでの取得（`profile` 指定。保存済みの Cookie 等を復号して適用） | 実装済み（ローカルで動作確認済み）。取得後の Cookie 書き戻し・同時利用のロック・ログイン切れ検知と通知は未実装 |

AI エージェントからは MCP サーバー（`fetch_page` ツール）として使えます。詳しくは「5. MCP サーバーとして使う」を参照してください。

用語の補足:

- noVNC: ブラウザの画面を Web 経由で見て操作する仕組み。ログイン作業用。外部へは直接公開せず、OAuth で認証された利用者にだけアプリが中継します。

## 2. クイックスタート

### 事前準備

次のコマンドが使える状態にしてください。

- `docker`（Docker Compose を含む）
- `curl`、`make`

### 1. 起動する

```
make init     # .env と config/local.json を見本から作成し、イメージをビルド
make up       # api / login を起動
```

### 2. APIキーを発行する（呼び出し元ごとに1回）

```
make keys-add ID=<呼び出し元の名前>
```

- ID は名前なら何でも構いません（英数字・`-`・`_` のみ。例: `my-app`）。
- キー本体（平文）は発行時に一度だけ表示されます。`.env` など Git 管理外に保存してください。チャットや Git には貼らないでください。
- ログイン済みプロファイルを使うキーには、`make keys-grant ID=<名前> PROFILE=<プロファイル名>` で許可を付けます（プロファイルは `config/local.json` の `profiles` に登録済みであること）。
- 一覧・失効: `make keys-list` / `make keys-revoke ID=<名前>`。

### 3. 取得する

```
curl -X POST "http://localhost:8080/fetch" \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/","outputs":["text"]}'
```

## 3. API リファレンス

### エンドポイント

`POST /fetch`（ヘッダー `Authorization: Bearer <APIキー>`、本文は JSON）

`GET /healthz` で生死確認ができます（api: http://localhost:8080/healthz、login: http://localhost:8081/healthz）。

### リクエスト項目

| 項目 | 必須 | 説明 |
|---|---|---|
| `url` | 必須 | 取得する URL（http / https、ポートは 80 / 443 のみ、2048 文字以内） |
| `outputs` | 任意 | 返す内容の配列。`html` / `text` / `screenshot`。項目名は複数形の `outputs`。省略時は `html`（`extract` のみ指定した場合は extract だけ返す） |
| `extract` | 任意 | 抜き出したい部分。`{"名前": "CSSセレクタ"}` の形（最大 20 件）。値は常に文字列の配列で返る |
| `steps` | 任意 | 取得前の操作（最大 20 個）。`{"wait_for":"CSS"}`（出現待ち）、`{"click":"CSS"}`（クリック）、`{"scroll":"top"}` または `{"scroll":"bottom"}` のみ |
| `proxy` | 任意 | 上流プロキシ。`{"server":"http://host:port","username":..,"password":..}`（`http://host:port` 形式のみ対応） |
| `profile` | 任意 | ログイン済みプロファイル名。キーに許可され、設定 JSON の `profiles` に登録済みで、`/login` で保存済みのものだけ使えます。`url` はそのプロファイルの許可ドメイン内であること。取得中に許可ドメイン外へ画面遷移（リダイレクトを含む）すると `FORBIDDEN_DOMAIN` になり、内容は返りません |
| `timeout_ms` | 任意 | タイムアウト（1000〜60000、既定 30000） |
| `full_page` | 任意 | `true` でスクリーンショットをページ全体にする |

環境変数 `EGRESS_PREFER_IPV4=true` で、宛先の IPv4 アドレスを IPv6 より先に試す（既定は従来どおり。IPv6 だと Cloudflare のチャレンジを通れない場合の切り分け用）。

SPA サイト（Feedly など）は描画が遅いため、`steps` の `wait_for` で主要な要素を待ち、`timeout_ms` も長めにする（待たないと読み込み失敗の画面が返ることがある）。

CSS セレクタ（要素の指定方法。例: `h1`、`.price`）以外の指定（`xpath=` や `>>` 連結など）は拒否されます。未知の項目名を送るとエラーになります。リクエスト本文は 64KB までです。

### レスポンス例（成功）

```json
{
  "ok": true,
  "url": "https://example.com/",
  "final_url": "https://example.com/",
  "status": 200,
  "text": "Example Domain ...",
  "extract": { "title": ["Example Domain"] },
  "elapsed_ms": 1840
}
```

`html` / `text` / `screenshot`（PNG を base64 文字列で）は、`outputs` で指定したものだけが入ります。`final_url` はリダイレクト後の URL、`status` は取得先ページの HTTP ステータスです。

### エラー

失敗時は `{"ok": false, "error": {"code": "...", "message": "..."}}` を返します。

| code | HTTP | 意味・主な原因 |
|---|---|---|
| `UNAUTHORIZED` | 401 | APIキーがない・誤り・失効済み。発行直後なら反映待ち（最大10秒） |
| `FORBIDDEN_PROFILE` | 403 | そのキーに許可されていない、または設定 JSON に登録されていないプロファイルを指定した |
| `FORBIDDEN_DOMAIN` | 403 | そのプロファイルで許可されていないドメインを指定した、または取得中に許可ドメイン外へ遷移した |
| `BLOCKED_URL` | 400 | 取得してはいけない宛先（社内向けアドレス、http/https 以外、80/443 以外のポート等）。SSRF 対策で拒否 |
| `INVALID_REQUEST` | 400 | リクエストの形式不正（項目名の誤り、`outputs` の値不正等）。本文が大きすぎる場合は 413、存在しないパスは 404 で、いずれも本コード |
| `PROFILE_NOT_FOUND` | 404 | 設定に登録済みだが、ログインの保存データがまだ無い（`/login` でログインして保存する） |
| `SESSION_EXPIRED` | 409 | ログインの有効期限切れ（未実装。現状は、ログイン切れでもログイン画面の内容が正常結果として返ります） |
| `PROFILE_BUSY` | 409 | 同じプロファイルが使用中（取得側では未実装。ログイン画面が別プロファイルで使用中のときに発生） |
| `RESPONSE_TOO_LARGE` | 413 | 取得結果が大きすぎる（既定 24MB 上限） |
| `NAVIGATION_FAILED` | 502 | ページを開けなかった（接続失敗、上流プロキシの異常等） |
| `TIMEOUT` | 504 | 時間内にページの読み込みや操作が終わらなかった |
| `INTERNAL_ERROR` | 500 | サーバー内部の予期せぬエラー。プロファイル関連では、保存データの復号失敗・破損、保存先の読み取り失敗、プロファイル機能が未設定のサーバー（メッセージに原因の種類のみ。鍵や中身は出ません） |

コードと HTTP ステータスの対応はソース（`src/lib/errors.ts`）で確認した内容です。

## 4. ローカルで動かす

```
make init     # .env と config/local.json を見本から作成し、イメージをビルド
make up       # api / login を起動
make ps       # 状態確認
make down     # 停止
```

- api: http://localhost:8080/healthz
- login: http://localhost:8081/healthz
- ログイン画面: http://localhost:8081/login?profile=<名前>（`localhost` で開くこと。`127.0.0.1` では開けません）。`config/local.json` の `profiles` に登録済みの名前だけ開けます。`make up` は `.env` に暗号鍵・許可メール・フェイクOAuth（`OAUTH_FAKE=1`。Google の代わりにメールアドレスを入力するローカル専用画面）を不足分だけ追記します。実際の Google OAuth を試すときは `OAUTH_FAKE` を空にして `OAUTH_CLIENT_JSON` を設定します。
- 保存したプロファイルはローカルでは Docker ボリューム `login-profiles`（`/data/profiles`）に暗号化されて保存されます。取得用（api）も同じボリュームを読み取り専用で参照します。`profile` 指定の取得を試すには、`make keys-grant ID=<名前> PROFILE=<プロファイル名>` でキーに許可を付けてください。
- ログイン用ブラウザの方式は環境変数 `LOGIN_BROWSER_MODE` で切り替えます。既定（空）は従来の Playwright 方式。`plain` にすると、ログイン中は Playwright/CDP なしの素の Chromium を起動し（Cloudflare Turnstile 対策）、「保存して終了」でブラウザを閉じてから同じプロファイルを Playwright で開いて Cookie 等を取り込みます。`plain` では Chromium の管理ポリシー（`docker/chromium-policy.json`。セッション Cookie の保持、`file://` とダウンロードの禁止）がイメージに入り、人がブラウザを閉じてもセッションは残って「保存して終了」で保存できます。
- 設定は `config/local.json`（Git 管理外）。変更は再起動なしで反映されます。
- ローカルのキー操作: `make keys-add ID=<名前>`、`make keys-list`、`make keys-revoke ID=<名前>`。
- `make test`（単体・結合）、`make lint`、`make typecheck`。すべて Docker 内で実行します。
- ログイン画面の使い方: `/login?profile=<名前>` を開き、Google（またはフェイクOAuth）でログイン後、noVNC 上のブラウザで対象サイトにログインし、「保存して終了」を押します。
  - 保存されるのは、そのプロファイルの `allowed_domains`（許可ドメイン）に属する Cookie と localStorage だけです（それ以外は破棄）。`allowed_domains` が空のプロファイルは保存できません。
  - 暗号鍵（`.env` の `PROFILE_ENCRYPTION_KEY`）を変更・紛失すると保存済みプロファイルは復号できなくなります（再ログインで作り直し）。
  - 取得で更新された Cookie は保存されないため、サイト側のログイン期限が来たら `/login` から再ログインしてください。

## 5. MCP サーバーとして使う

AI エージェント（Claude Code、Claude Desktop など）から、`fetch_page` ツールとして browser-gate を呼べます。ローカル専用の stdio 接続で、中身は既存の `POST /fetch` を呼ぶだけです（認証・権限・SSRF 対策は API 側がそのまま担います）。

用語の補足:

- MCP（Model Context Protocol）: AI エージェントが外部のツールを呼ぶための共通の取り決め。
- stdio: 標準入出力でやり取りする接続方式。ネットワークには公開されません。

### 準備

1. `make up` で api を起動する（MCP は api に接続します）。
2. MCP 専用の API キーを発行する: `make keys-add ID=mcp`（キーは一度だけ表示されます）。
3. ログイン済みプロファイルを使う場合は `make keys-grant ID=mcp PROFILE=<プロファイル名>` で許可を付ける。**閲覧が中心のプロファイルだけ**を許可してください（決済や投稿ができるサイトのプロファイルは許可しない）。

### クライアントの設定例

キーは MCP クライアントの設定の `env` から渡します（下の値はダミーです）。Claude Desktop はシェルの環境変数を引き継がないため、`env` に書く必要があります。

```json
{
  "mcpServers": {
    "browser-gate": {
      "command": "docker",
      "args": [
        "compose", "--project-directory", "/path/to/browser-gate",
        "--profile", "mcp", "run", "--rm", "-T", "--no-deps", "mcp"
      ],
      "env": { "BROWSER_GATE_API_KEY": "bg_dummy_key_replace_me" }
    }
  }
}
```

Claude Code の場合は、同じ内容を `claude mcp add` か `.mcp.json` に設定します。

ホストの Node.js で直接動かすこともできます（`npm run build` 済みであること）。`BROWSER_GATE_URL` の既定は `http://localhost:8080` です。

```
BROWSER_GATE_API_KEY=<キー> node dist/mcp/index.js
```

### `fetch_page` の入力と出力

- 入力: `url`、`profile`、`outputs`、`extract`、`steps`、`timeout_ms`、`full_page`（意味は「3. API リファレンス」と同じ）。`proxy` は公開しません。
- `outputs` も `extract` も省略すると `text` だけを返します（`html` は大きいため）。`extract` だけを指定した場合は抜き出した値だけを返します。
- 出力: メタ情報（`final_url`、`status`、`elapsed_ms`、`extract`）を JSON で返し、続けて本文（`text` / `html`）、スクリーンショット（画像）を返します。本文は 50,000 文字を超えると切り詰め、メタ情報に `truncated: true` を付けます。
- エラーは `isError` で、`コード: メッセージ`（例: `FORBIDDEN_DOMAIN: ...`）の形で返ります。

### 制限と注意（第1弾）

- **`profile` 指定時は読み取り専用**です。`profile` と `steps`（クリックなどの操作）は同時に指定できません（`INVALID_REQUEST`）。取得ページ内の指示によって、ログイン済みの権限で削除・購入・投稿などをエージェントに誘導されることを防ぐためです。`steps` は匿名取得でだけ使えます。
- 取得した内容は信頼できないデータです。エージェントがページ内の指示に従わないようにしてください。
- ログイン切れは検知されません。期限が切れてもログイン画面が成功として返るため、`final_url` がログイン画面の URL でないか確認してください（「1. browser-gate とは」の未実装事項を参照）。
- `allowed_domains` は必要なドメインだけに絞ってください。同じプロファイルの同時利用ロックはありません。
- ローカル利用が前提です（リモート公開はしません）。

## 6. セキュリティの考え方

- APIキーは平文で保持しません。設定 JSON にはハッシュ（元の値に戻せない変換結果）だけを保存し、キー本体は発行時に一度だけ得られます。
- SSRF 対策（SSRF: 取得 API を悪用して社内ネットワークなど外部から見えない宛先へアクセスさせる攻撃）: Chromium の全通信を、内部 IP の遮断・ポート 80/443 限定のローカル中継プロキシ経由にします。接続直前に DNS 解決した全 IP を検査するため、DNS リバインディング・リダイレクト・サブリソース経由の迂回も防ぎます。
- `--no-sandbox`（Chromium の安全隔離機能をオフにする起動オプション）を受容しています。理由: コンテナ内ではユーザー名前空間が使えず、有効にすると起動できないため。条件: コンテナ側の隔離に依存すること、APIキー認証を通った呼び出し元のみが取得を依頼できること。
- ポートは `127.0.0.1` のみに公開します（外部ネットワークへは出しません）。
- キーが流出した（またはその疑いがある）場合は、すぐ `make keys-revoke ID=<名前>` で失効し、必要なら別の ID で再発行します。

## 7. 困ったとき

| 症状 | 原因と対処 |
|---|---|
| 401（`UNAUTHORIZED`） | キーの誤り、失効済み、または発行直後の反映待ち（最大 10 秒）。少し待って再実行。`make keys-list` で ID を確認 |
| ログイン画面が 400（「公開URLで開いてください」） | `localhost` 以外のホスト名（`127.0.0.1` など）で開いている |
| 400（`INVALID_REQUEST`） | 項目名の誤り。特に `outputs` は複数形で、値は配列（例: `"outputs":["text"]`）。未知の項目や `profile` 指定も該当 |
| ログイン画面が 409（`PROFILE_BUSY`、「Another login session is in progress」） | 前のログインセッションが残っている。「保存して終了」「中止」を押さずにタブを閉じても、画面の接続が切れてから約 3 分（`LOGIN_DISCONNECT_GRACE_SECONDS`、既定 180 秒）で自動破棄されるため、待ってから `/login` を開き直す（3 分以内のリロード・再接続は同じ画面に戻れる。接続中の別タブがある場合はそちらで保存か中止）。保存の処理中は破棄されない。それでも直らないときは `make restart` で再起動する |
| `既に存在します` | その ID のキーは発行済み。使い続けるか、`make keys-revoke` で失効してから再発行 |

## 8. よく使うコマンド一覧

`make help` が正の一覧です。主なものは次のとおりです。

| コマンド | 内容 |
|---|---|
| `make init` / `build` | 初期設定とイメージのビルド |
| `make up` / `down` / `restart` / `ps` / `logs` / `shell` | ローカルの起動・停止・確認 |
| `make lint` / `typecheck` / `test` / `test-unit` / `format` | 検証・整形（Docker 内） |
| `make keys-add` / `keys-grant` / `keys-list` / `keys-revoke` | キー管理 |
