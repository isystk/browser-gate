# browser-gate

## 1. browser-gate とは

Bot 対策（自動アクセスを弾く仕組み）が入った Web サイトでも、本物のブラウザ（Chromium）で開いて、本文・HTML・スクリーンショットを取得して返す API です。Google Cloud の Cloud Run 上で動きます。

現在の到達点は次のとおりです。

| 機能 | 状態 |
|---|---|
| 匿名取得（ログインなしで URL を開き、本文・HTML・スクリーンショット・指定部分の抜き出しを返す） | 本番稼働中 |
| ログイン済みプロファイルでの取得（`profile` 指定） | 未実装（Phase 3・4 で対応予定。指定すると `INVALID_REQUEST` を返す） |

用語の補足:

- Cloud Run: Google Cloud のサーバー実行サービス。リクエストが来たときだけ動かせる。
- noVNC: ブラウザの画面を Web 経由で見て操作する仕組み。ログイン作業用（Phase 3 以降で本番利用予定）。
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

- ID は名前なら何でも構いません（英数字・`-`・`_` のみ。例: `musashi`）。
- キー本体は画面に表示されません。`~/.config/browser-gate/prod-keys/<ID>.key`（本人のみ読める権限、リポジトリの外）に保存されます。
- 発行は初回のみです。PC を再起動するたびに実行する必要はありません。同じ ID で再発行はできません（先に失効が必要）。
- 本番への反映に最大 10 秒かかります。
- キーの値をチャットや Git に貼らないでください。

### 2. 取得する

```
make prod-fetch URL=https://example.com/ [OUT=text|html|screenshot] [ID=<名前>] [FILE=out.png] [API_URL=...]
```

- `OUT` を省略すると `text`（本文）です。
- `FILE` を指定すると、画面に出さずファイルへ保存します。`OUT=screenshot` のときの保存先は省略すると `screenshot.png` です。
- `ID` は保存済みキーが1つだけなら省略できます。
- 接続先（api の URL）は `API_URL=` 指定、`terraform output`、`gcloud run services describe` の順で自動的に解決されます。

### 3. キーの一覧・失効

```
make prod-keys-list                   # 保存済みキーの ID と作成日時（キー本体は出ません）
make prod-keys-revoke ID=<名前>       # 本番で失効し、保存済みキーも削除
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
| `profile` | 任意 | ログイン済みプロファイル名。Phase 4 まで未対応（指定すると `INVALID_REQUEST`） |
| `timeout_ms` | 任意 | タイムアウト（1000〜60000、既定 30000） |
| `full_page` | 任意 | `true` でスクリーンショットをページ全体にする |

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
| `FORBIDDEN_PROFILE` | 403 | そのキーに許可されていないプロファイルを指定した（Phase 4 向け） |
| `FORBIDDEN_DOMAIN` | 403 | そのプロファイルで許可されていないドメインを指定した（Phase 4 向け） |
| `BLOCKED_URL` | 400 | 取得してはいけない宛先（社内向けアドレス、http/https 以外、80/443 以外のポート等）。SSRF 対策で拒否 |
| `INVALID_REQUEST` | 400 | リクエストの形式不正（項目名の誤り、`outputs` の値不正、`profile` 指定等）。本文が大きすぎる場合は 413、存在しないパスは 404 で、いずれも本コード |
| `PROFILE_NOT_FOUND` | 404 | 指定プロファイルが存在しない（Phase 4 向け） |
| `SESSION_EXPIRED` | 409 | ログインの有効期限切れ（Phase 4 向け） |
| `PROFILE_BUSY` | 409 | 同じプロファイルが使用中（Phase 4 向け） |
| `RESPONSE_TOO_LARGE` | 413 | 取得結果が大きすぎる（既定 24MB 上限） |
| `NAVIGATION_FAILED` | 502 | ページを開けなかった（接続失敗、上流プロキシの異常等） |
| `TIMEOUT` | 504 | 時間内にページの読み込みや操作が終わらなかった |
| `INTERNAL_ERROR` | 500 | サーバー内部の予期せぬエラー |

コードと HTTP ステータスの対応はソース（`src/lib/errors.ts`）で確認した内容です。`profile` 関連の4コードは Phase 4 の実装までは通常発生しません。未確認: 本番での各エラーの実機再現は `UNAUTHORIZED` 等の一部のみです。

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
- noVNC: http://localhost:6080（ローカル PC からのみ接続可）
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
- `browser-gate-login` は Phase 3（OAuth）まで未認証の呼び出しを許可しません（`login_public_access=false`）。

## 6. セキュリティの考え方

- APIキーは平文で保持しません。設定 JSON にはハッシュ（元の値に戻せない変換結果）だけを保存し、キー本体は発行時に一度だけ得られます。
- SSRF 対策（SSRF: 取得 API を悪用して社内ネットワークなど外部から見えない宛先へアクセスさせる攻撃）: Chromium の全通信を、内部 IP の遮断・ポート 80/443 限定のローカル中継プロキシ経由にします。接続直前に DNS 解決した全 IP を検査するため、DNS リバインディング・リダイレクト・サブリソース経由の迂回も防ぎます。
- `--no-sandbox`（Chromium の安全隔離機能をオフにする起動オプション）を受容しています。理由: コンテナ内ではユーザー名前空間が使えず、有効にすると起動できないため。条件: コンテナと Cloud Run 側の隔離に依存すること、APIキー認証を通った呼び出し元のみが取得を依頼できること。この判断は実装時に社長確認済みです。
- キーが流出した（またはその疑いがある）場合は、すぐ `make prod-keys-revoke ID=<名前>` で失効し、必要なら別の ID で再発行します。

## 7. 困ったとき

| 症状 | 原因と対処 |
|---|---|
| 401（`UNAUTHORIZED`） | キーの誤り、失効済み、または発行直後の反映待ち（最大 10 秒）。少し待って再実行。`make prod-keys-list` で ID を確認 |
| 400（`INVALID_REQUEST`） | 項目名の誤り。特に `outputs` は複数形で、値は配列（例: `"outputs":["text"]`）。未知の項目や `profile` 指定も該当 |
| 初回だけ遅い | Cloud Run のコールドスタート（停止中のインスタンスの起動待ち）。再実行すると速くなる。`prod-fetch` は最大 90 秒待つ |
| `jq: command not found` | `prod-fetch` には `jq` が必要。インストールしてください |
| `ID を指定してください` | 保存済みキーが複数ある場合は `ID=<名前>` が必要 |
| `api_url を取得できません` | `gcloud` のログイン状態を確認するか、`API_URL=https://...` を指定 |
| `/healthz` が 404 | Cloud Run の外部 URL では使えません（Google 側の予約パス） |
| `既に存在します` | その ID のキーは発行済み。使い続けるか、`prod-keys-revoke` で失効してから再発行 |

## 8. よく使うコマンド一覧

`make help` が正の一覧です。主なものは次のとおりです。

| コマンド | 内容 |
|---|---|
| `make init` / `build` | 初期設定とイメージのビルド |
| `make up` / `down` / `restart` / `ps` / `logs` / `shell` | ローカルの起動・停止・確認 |
| `make lint` / `typecheck` / `test` / `test-unit` / `format` | 検証・整形（Docker 内） |
| `make keys-add` / `keys-list` / `keys-revoke` | ローカルのキー管理 |
| `make prod-keys-add` / `prod-keys-list` / `prod-keys-revoke` | 本番のキー管理 |
| `make prod-fetch URL=...` | 本番で取得を試す |
| `make infra-init` / `infra-fmt` / `infra-validate` / `infra-plan` / `infra-apply` | Terraform |
| `make config-push` | `config/local.json` を本番の設定として登録 |
| `make deploy` | GitHub Actions のデプロイを手動起動 |

`prod-config-pull` / `prod-config-push` もあります（本番設定 JSON の取得・反映。通常は `prod-keys-*` が内部で呼びます）。
