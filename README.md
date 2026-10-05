# browser-gate

## 1. browser-gate とは

Bot 対策（自動アクセスを弾く仕組み）が入った Web サイトでも、本物のブラウザ（Chromium）で開いて、本文・HTML・スクリーンショットを取得して返す API です。Google Cloud の Cloud Run 上で動きます。

現在の到達点は次のとおりです。

| 機能 | 状態 |
|---|---|
| 匿名取得（ログインなしで URL を開き、本文・HTML・スクリーンショット・指定部分の抜き出しを返す） | 本番稼働中 |
| ログイン画面（noVNC で人が手動ログインし、Cookie 等を暗号化して保存） | 実装済み（ローカルで動作確認済み。本番は Secret 登録・OAuth クライアント作成・apply 待ち） |
| ログイン済みプロファイルでの取得（`profile` 指定。保存済みの Cookie 等を復号して適用） | 実装済み（ローカルで動作確認済み。本番は apply・デプロイ・キーへの権限付与待ち）。取得後の Cookie 書き戻し・同時利用のロック・ログイン切れ検知と通知は未実装 |

用語の補足:

- Cloud Run: Google Cloud のサーバー実行サービス。リクエストが来たときだけ動かせる。
- noVNC: ブラウザの画面を Web 経由で見て操作する仕組み。ログイン作業用。外部へは直接公開せず、Google OAuth で認証された利用者にだけアプリが中継します。
- Phase: 実装の段階。詳細は biz-ops 側の実装計画を参照。

## 2. クイックスタート（本番を試す）

### 事前準備

次のコマンドが使える状態にしてください。

- `gcloud`（Google Cloud の CLI。`gcloud auth login` 済みで、プロジェクト `isystk` にアクセスできること）
- `docker`（Docker Compose を含む）
- `jq`（JSON を扱うコマンド。`make prod-fetch` が使います）
- `curl`、`make`

### 1. APIキーを発行する（呼び出し元ごとに1回）

```
make prod-keys-add ID=<呼び出し元の名前>
```

- ID は名前なら何でも構いません（英数字・`-`・`_` のみ。例: `my-app`）。
- キー本体は画面に表示されません。`~/.config/browser-gate/prod-keys/<ID>.key`（本人のみ読める権限、リポジトリの外）に保存されます。
- 発行は初回のみです。PC を再起動するたびに実行する必要はありません。同じ ID で再発行はできません（先に失効が必要）。
- 本番への反映に最大 10 秒かかります。
- キーの値をチャットや Git に貼らないでください。
- ログイン済みプロファイルを使うキーは、発行時に `PROFILES="github-test"`（複数はスペース区切り）を付けます。発行済みのキーに後から許可を足すときは `make prod-keys-grant ID=<名前> PROFILE=<プロファイル名>`（本番の設定 JSON に反映。プロファイルは設定 JSON の `profiles` に登録済みであること）。

### 2. 取得する

```
make prod-fetch URL=https://example.com/ [OUT=text|html|screenshot] [ID=<名前>] [PROFILE=<プロファイル名>] [FILE=out.png] [API_URL=...]
```

- `OUT` を省略すると `text`（本文）です。
- `FILE` を指定すると、画面に出さずファイルへ保存します。`OUT=screenshot` のときの保存先は省略すると `screenshot.png` です。
- `ID` は保存済みキーが1つだけなら省略できます。
- `PROFILE` を指定すると、ログイン済みプロファイルで取得します（例: `make prod-fetch URL=https://github.com/settings/profile PROFILE=github-test`。未ログインなら GitHub のログイン画面、ログイン済みなら設定ページの内容が返ります）。キーに許可されたプロファイルだけ使えます。
- 接続先（api の URL）は `API_URL=` 指定、`terraform output`、`gcloud run services describe` の順で自動的に解決されます。

### 3. キーの一覧・失効

```
make prod-keys-list                   # 保存済みキーの ID と作成日時（キー本体は出ません）
make prod-keys-revoke ID=<名前>       # 本番で失効し、保存済みキーも削除
make prod-keys-grant ID=<名前> PROFILE=<プロファイル名>   # 既存キーにプロファイルの利用を許可
```

## 3. API リファレンス

### エンドポイント

`POST /fetch`（ヘッダー `Authorization: Bearer <APIキー>`、本文は JSON）

注意: Cloud Run の外部 URL では `/healthz` は Google 側の予約パスのため使えません（ローカル実行では使えます）。本番の生死確認には `/fetch` を呼んでください。

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

環境変数 `EGRESS_PREFER_IPV4=true`（Terraform は `egress_prefer_ipv4`）で、宛先の IPv4 アドレスを IPv6 より先に試す（既定は従来どおり。IPv6 だと Cloudflare のチャレンジを通れない場合の切り分け用）。

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
| `INTERNAL_ERROR` | 500 | サーバー内部の予期せぬエラー。プロファイル関連では、保存データの復号失敗・破損、保存先（GCS）の読み取り失敗、プロファイル機能が未設定のサーバー（メッセージに原因の種類のみ。鍵や中身は出ません） |

コードと HTTP ステータスの対応はソース（`src/lib/errors.ts`）で確認した内容です。未確認: 本番での各エラーの実機再現は `UNAUTHORIZED` 等の一部のみです（`profile` 関連はローカルのみ確認）。

### curl の例

```
curl -X POST "<api の URL>/fetch" \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/","outputs":["text"],"extract":{"title":"h1"},"steps":[{"wait_for":"p"}]}'
```

`<api の URL>` は `terraform output -raw api_url`、または `gcloud run services describe browser-gate-api --region asia-northeast1 --project isystk --format 'value(status.url)'` で確認できます。`$API_KEY` には保存済みキーの中身を環境変数として渡し、チャットや Git へは貼らないでください。

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
- 保存したプロファイルはローカルでは Docker ボリューム `login-profiles`（`/data/profiles`）に暗号化されて保存されます。取得用（api）も同じボリュームを読み取り専用で参照します。ローカルで `profile` 指定の取得を試すには、`make keys-grant ID=<名前> PROFILE=<プロファイル名>` でキーに許可を付けてください。
- ログイン用ブラウザの方式は環境変数 `LOGIN_BROWSER_MODE` で切り替えます。既定（空）は従来の Playwright 方式。`plain` にすると、ログイン中は Playwright/CDP なしの素の Chromium を起動し（Cloudflare Turnstile 対策）、「保存して終了」でブラウザを閉じてから同じプロファイルを Playwright で開いて Cookie 等を取り込みます。本番は Terraform の変数 `login_browser_mode`。`plain` では Chromium の管理ポリシー（`docker/chromium-policy.json`。セッション Cookie の保持、`file://` とダウンロードの禁止）がイメージに入り、人がブラウザを閉じてもセッションは残って「保存して終了」で保存できます。
- 設定は `config/local.json`（Git 管理外）。変更は再起動なしで反映されます。
- ローカルのキー操作: `make keys-add ID=<名前>`（平文は一度だけ表示。`.env` など Git 管理外に保存）、`make keys-list`、`make keys-revoke ID=<名前>`。
- `make test`（単体・結合）、`make lint`、`make typecheck`。すべて Docker 内で実行します。

## 5. デプロイ・インフラ（Terraform + GitHub Actions）

- Google Cloud プロジェクト `isystk`、リージョン `asia-northeast1`。Terraform（`infra/`）の状態ファイルは `gs://isystk-tfstate`（prefix `browser-gate`）に置きます。
- Terraform は Docker 内で実行します（ホストへの導入不要）。ホストの認証情報（`gcloud auth application-default login`）を読み取り専用でマウントします。
- `make infra-init` / `infra-validate` / `infra-plan`（変更内容の確認）/ `infra-apply`（実リソースの変更。確認プロンプトあり）。
- 予算アラートを作る場合は `infra/terraform.tfvars.example` を `infra/terraform.tfvars` にコピーし、課金アカウント ID を設定します（Git 管理外）。月額の予算額は既定 500 円です。
- 秘密情報の値は Terraform に書きません。Secret Manager は器だけ作り、設定 JSON は `make config-push`（`config/local.json` を新バージョンとして登録）で更新します。本番のキー操作は `make prod-keys-add` / `prod-keys-revoke` が反映まで行います。
- デプロイは `main` への push、または `make deploy`（`gh` が必要。完了まで表示）。デプロイ用の認証は main ブランチからの Workload Identity Federation（鍵ファイルを使わない認証）のみです。

### 課金方式

- `browser-gate-api`: リクエストベース課金（`cpu_idle = true`。リクエスト処理中だけ CPU 課金）。同時処理 1、最大 3 インスタンス。
- `browser-gate-login`: インスタンスベース課金（起動している間ずっと課金。リクエスト外でも動く必要があるため）。最大 1 インスタンス。

### 初回構築の手順（イメージが無いと Cloud Run を作れないため、この順で行う）

1. まず Artifact Registry だけ作る: `docker compose run --rm -it --user $(id -u):$(id -g) terraform apply -target=google_artifact_registry_repository.browser_gate`
2. 初回イメージを push する（`terraform output image_repository` の値を `<repo>` とする）:
   `gcloud auth configure-docker asia-northeast1-docker.pkg.dev && docker build -t <repo>:latest . && docker push <repo>:latest`
3. `make infra-apply` で残りを作成する。
4. GitHub リポジトリの Variables（Settings > Secrets and variables > Actions > Variables）に次を登録する（秘密情報ではない）:
   `GCP_WORKLOAD_IDENTITY_PROVIDER`（`terraform output github_workload_identity_provider`）、`GCP_DEPLOYER_SA`（`terraform output github_deployer_service_account`）、`GCP_IMAGE_REPOSITORY`（`terraform output image_repository`）。
5. 以降のデプロイは `main` への push または `make deploy`。

### 公開設定

- `browser-gate-api` は Cloud Run の IAM 認証なし（アプリ側の APIキー認証）。キーなし・誤ったキーは `UNAUTHORIZED`。
- `browser-gate-login` は Cloud Run の IAM 認証なし（`login_public_access=true`）で、アプリ側で Google OAuth と許可メールアドレス（`login_allowed_emails`。既定 `ise0615@gmail.com`）により守ります。noVNC の WebSocket（`/ws`）も OAuth 済みの利用者だけが接続でき、websockify はコンテナ内部（127.0.0.1）のみで待ち受けます。
- 公開URLは固定です（`terraform output login_page_url`）。別のURL（Cloud Run の自動URL）では開けません。

### ログイン画面を本番で使う手順（初回のみ。順番どおり）

1. OAuth クライアントを作る（Google Cloud コンソール > API とサービス > 認証情報 > OAuth クライアント ID > ウェブアプリ。同意画面は外部・テスト中でテストユーザーに許可メールを追加）。承認済みのリダイレクト URI に `terraform output -raw oauth_redirect_uri` の値と `http://localhost:8081/oauth/callback` を登録する。
2. `make prod-login-key-init`（暗号鍵を生成して Secret Manager へ。値は表示されない。登録済みなら何もしない）。
3. `make prod-oauth-client-set FILE=<ダウンロードした JSON>`。
4. `make infra-plan` で内容を確認し、`make infra-apply`（上の2・3が済んでいないと login の新リビジョンを作れない）。
5. 新しいイメージを `main` へ push または `make deploy` で反映する。
6. `https://<login の公開URL>/login?profile=<名前>` を開く（プロファイル名は設定 JSON の `profiles` に登録済みであること。`make config-push` / `prod-config-push` で反映）。Google でログイン後、noVNC 上のブラウザで対象サイトにログインし、「保存して終了」を押す。
- 保存されるのは、そのプロファイルの `allowed_domains`（許可ドメイン）に属する Cookie と localStorage だけです（それ以外は破棄）。`allowed_domains` が空のプロファイルは保存できません。
- 暗号鍵を変更・紛失すると保存済みプロファイルは復号できなくなります（再ログインで作り直し）。
- 取得用（api）は、暗号鍵の読み取りとプロファイル用バケットの読み取り専用権限だけを持ちます（書き込み・削除は不可）。取得で更新された Cookie は保存されないため、サイト側のログイン期限が来たら `/login` から再ログインしてください。

## 6. セキュリティの考え方

- APIキーは平文で保持しません。設定 JSON にはハッシュ（元の値に戻せない変換結果）だけを保存し、キー本体は発行時に一度だけ得られます。
- SSRF 対策（SSRF: 取得 API を悪用して社内ネットワークなど外部から見えない宛先へアクセスさせる攻撃）: Chromium の全通信を、内部 IP の遮断・ポート 80/443 限定のローカル中継プロキシ経由にします。接続直前に DNS 解決した全 IP を検査するため、DNS リバインディング・リダイレクト・サブリソース経由の迂回も防ぎます。
- `--no-sandbox`（Chromium の安全隔離機能をオフにする起動オプション）を受容しています。理由: コンテナ内ではユーザー名前空間が使えず、有効にすると起動できないため。条件: コンテナと Cloud Run 側の隔離に依存すること、APIキー認証を通った呼び出し元のみが取得を依頼できること。この判断は実装時に社長確認済みです。
- キーが流出した（またはその疑いがある）場合は、すぐ `make prod-keys-revoke ID=<名前>` で失効し、必要なら別の ID で再発行します。

## 7. 困ったとき

| 症状 | 原因と対処 |
|---|---|
| 401（`UNAUTHORIZED`） | キーの誤り、失効済み、または発行直後の反映待ち（最大 10 秒）。少し待って再実行。`make prod-keys-list` で ID を確認 |
| ログイン画面が 400（「公開URLで開いてください」） | `localhost`（ローカル）または固定の公開URL以外のホスト名で開いている |
| 400（`INVALID_REQUEST`） | 項目名の誤り。特に `outputs` は複数形で、値は配列（例: `"outputs":["text"]`）。未知の項目や `profile` 指定も該当 |
| 初回だけ遅い | Cloud Run のコールドスタート（停止中のインスタンスの起動待ち）。再実行すると速くなる。`prod-fetch` は最大 90 秒待つ |
| `jq: command not found` | `prod-fetch` には `jq` が必要。インストールしてください |
| `ID を指定してください` | 保存済みキーが複数ある場合は `ID=<名前>` が必要 |
| `api_url を取得できません` | `gcloud` のログイン状態を確認するか、`API_URL=https://...` を指定 |
| ログイン画面が 409（`PROFILE_BUSY`、「Another login session is in progress」） | 前のログインセッションが残っている。「保存して終了」「中止」を押さずにタブを閉じても、画面の接続が切れてから約 3 分（`LOGIN_DISCONNECT_GRACE_SECONDS`、既定 180 秒）で自動破棄されるため、待ってから `/login` を開き直す（3 分以内のリロード・再接続は同じ画面に戻れる。接続中の別タブがある場合はそちらで保存か中止）。保存の処理中は破棄されない。それでも直らないときは Cloud Run の新リビジョンを作って再起動する |
| `/healthz` が 404 | Cloud Run の外部 URL では使えません（Google 側の予約パス） |
| `既に存在します` | その ID のキーは発行済み。使い続けるか、`prod-keys-revoke` で失効してから再発行 |

## 8. よく使うコマンド一覧

`make help` が正の一覧です。主なものは次のとおりです。

| コマンド | 内容 |
|---|---|
| `make init` / `build` | 初期設定とイメージのビルド |
| `make up` / `down` / `restart` / `ps` / `logs` / `shell` | ローカルの起動・停止・確認 |
| `make lint` / `typecheck` / `test` / `test-unit` / `format` | 検証・整形（Docker 内） |
| `make keys-add` / `keys-grant` / `keys-list` / `keys-revoke` | ローカルのキー管理 |
| `make prod-keys-add` / `prod-keys-grant` / `prod-keys-list` / `prod-keys-revoke` | 本番のキー管理 |
| `make prod-fetch URL=... [PROFILE=...]` | 本番で取得を試す |
| `make infra-init` / `infra-fmt` / `infra-validate` / `infra-plan` / `infra-apply` | Terraform |
| `make config-push` | `config/local.json` を本番の設定として登録 |
| `make deploy` | GitHub Actions のデプロイを手動起動 |

`prod-config-pull` / `prod-config-push` もあります（本番設定 JSON の取得・反映。通常は `prod-keys-*` が内部で呼びます）。
