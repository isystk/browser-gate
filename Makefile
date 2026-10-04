SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c

DOCKER_CMD := docker compose
NPM_RUN := $(DOCKER_CMD) run --rm --no-deps --entrypoint npm api
TF_RUN := $(DOCKER_CMD) run --rm --user $$(id -u):$$(id -g) terraform
GCP_PROJECT ?= isystk
GCP_REGION ?= asia-northeast1
CONFIG_SECRET := browser-gate-config
ENCRYPTION_KEY_SECRET := browser-gate-profile-encryption-key
OAUTH_CLIENT_SECRET := browser-gate-oauth-client
KEYS_RUN := $(DOCKER_CMD) run --rm --no-deps --user $$(id -u):$$(id -g) -e HOME=/tmp keys
# 本番用: config/prod.json を対象にする。出力を変数へ取り込むため -T（TTY なし）にする。
PROD_KEYS_RUN := $(DOCKER_CMD) run --rm -T --no-deps --user $$(id -u):$$(id -g) -e HOME=/tmp -e CONFIG_PATH=/app/config/prod.json keys
# 本番キーの保存先（リポジトリ外・Git に入らない。1キー1ファイル <ID>.key、権限 600 / ディレクトリ 700）
PROD_KEY_DIR ?= $(HOME)/.config/browser-gate/prod-keys
RUN_SERVICE := browser-gate-api
# ID の検証（パス操作や意図しない文字を拒否）
CHECK_ID = case "$$ID" in ''|*[!A-Za-z0-9_-]*) echo "ID を指定してください（英数字・-・_ のみ。例: ID=musashi）"; exit 1;; esac
# PROFILE / PROFILES の検証（空は許可。複数はスペースまたはカンマ区切り）
CHECK_PROFILES = case "$$profiles" in *[!A-Za-z0-9_,\ -]*) echo "プロファイル名は英数字・-・_ のみです（複数はスペースまたはカンマ区切り）"; exit 1;; esac

.DEFAULT_GOAL := help

.PHONY: help
help: ## ヘルプを表示します。
	@echo "Available commands:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "} {printf "%-20s %s\n", $$1, $$2}'

.PHONY: env-login
env-login: ## .env にログイン用のローカル設定（暗号鍵・許可メール・フェイクOAuth）を不足分だけ追記します。
	@touch .env; chmod 600 .env
	@grep -q '^PROFILE_ENCRYPTION_KEY=.' .env || { echo "PROFILE_ENCRYPTION_KEY=$$(openssl rand -base64 32)" >> .env; echo ".env にローカル用の暗号鍵を追記しました"; }
	@for name in ALLOWED_EMAILS OAUTH_FAKE; do grep -q "^$$name=" .env || { grep "^$$name=" .env.example >> .env; echo ".env に $$name を追記しました"; }; done

.PHONY: init
init: ## .env と config/local.json を見本から作成し、イメージをビルドします。
	@if [ ! -f .env ]; then cp .env.example .env; echo ".env を作成しました"; fi
	@$(MAKE) --no-print-directory env-login
	@if [ ! -f config/local.json ]; then cp config/local.example.json config/local.json; echo "config/local.json を作成しました"; fi
	$(DOCKER_CMD) build

.PHONY: build
build: ## Dockerイメージをビルドします。
	$(DOCKER_CMD) build

.PHONY: up
up: env-login ## api / login を起動します（ログイン画面は http://localhost:8081/login?profile=<名前>）。
	$(DOCKER_CMD) up -d --build

.PHONY: down
down: ## api / login を停止します。
	$(DOCKER_CMD) down

.PHONY: restart
restart: down up ## 停止して再起動します。

.PHONY: logs
logs: ## コンテナのログを表示します。
	$(DOCKER_CMD) logs -f

.PHONY: ps
ps: ## コンテナの状態を表示します。
	$(DOCKER_CMD) ps

.PHONY: shell
shell: ## api コンテナ内のシェルに入ります。
	$(DOCKER_CMD) exec api bash

.PHONY: lint
lint: build ## ESLint と Prettier のチェックを実行します。
	$(NPM_RUN) run lint

.PHONY: typecheck
typecheck: build ## TypeScript の型チェックを実行します。
	$(NPM_RUN) run typecheck

.PHONY: test
test: build ## 単体テストと結合テストを実行します（Xvfb 上の Chromium を使用）。
	$(DOCKER_CMD) run --rm --no-deps api npm test

.PHONY: test-unit
test-unit: build ## 単体テストのみ実行します。
	$(DOCKER_CMD) run --rm --no-deps --entrypoint npm api run test:unit

.PHONY: keys-add
keys-add: ## APIキーを発行します（例: make keys-add ID=musashi。キーは一度だけ表示）。
	@test -n "$(ID)" || { echo "ID を指定してください（例: make keys-add ID=musashi）"; exit 1; }
	$(KEYS_RUN) add --id "$(ID)"

.PHONY: keys-grant
keys-grant: ## 既存のAPIキーにプロファイル権限を追加します（例: make keys-grant ID=musashi PROFILE=github-test）。
	@test -n "$(ID)" -a -n "$(PROFILE)" || { echo "ID と PROFILE を指定してください（例: make keys-grant ID=musashi PROFILE=github-test）"; exit 1; }
	$(KEYS_RUN) grant --id "$(ID)" --profile "$(PROFILE)"

.PHONY: keys-list
keys-list: ## APIキーの一覧を表示します。
	$(KEYS_RUN) list

.PHONY: keys-revoke
keys-revoke: ## APIキーを失効します（例: make keys-revoke ID=musashi）。
	@test -n "$(ID)" || { echo "ID を指定してください（例: make keys-revoke ID=musashi）"; exit 1; }
	$(KEYS_RUN) revoke --id "$(ID)"

.PHONY: prod-config-pull
prod-config-pull: ## 本番の最新設定JSONを config/prod.json に取得します（読み取りのみ。権限600）。
	@umask 077; gcloud secrets versions access latest --secret $(CONFIG_SECRET) --project $(GCP_PROJECT) > config/prod.json
	@chmod 600 config/prod.json
	@echo "config/prod.json を最新化しました"

.PHONY: prod-config-push
prod-config-push: ## config/prod.json を本番の設定JSONとして新バージョン登録します（本番反映）。
	@test -f config/prod.json || { echo "config/prod.json がありません"; exit 1; }
	gcloud secrets versions add $(CONFIG_SECRET) --project $(GCP_PROJECT) --data-file=config/prod.json

.PHONY: prod-login-key-init
prod-login-key-init: ## 本番のプロファイル暗号鍵を生成して Secret Manager に登録します（未登録の場合のみ。値は表示しません）。
	@if gcloud secrets versions list $(ENCRYPTION_KEY_SECRET) --project $(GCP_PROJECT) --limit 1 --format='value(name)' | grep -q .; then echo "$(ENCRYPTION_KEY_SECRET) は登録済みです（鍵を変えると保存済みプロファイルが復号できなくなるため上書きしません）"; exit 1; fi
	@openssl rand -base64 32 | tr -d '\n' | gcloud secrets versions add $(ENCRYPTION_KEY_SECRET) --project $(GCP_PROJECT) --data-file=-

.PHONY: prod-oauth-client-set
prod-oauth-client-set: ## OAuth クライアント情報（JSON ファイル）を Secret Manager に登録します（例: make prod-oauth-client-set FILE=~/client_secret.json）。
	@test -f "$(FILE)" || { echo "FILE を指定してください（Google コンソールからダウンロードした JSON、または {\"client_id\":...,\"client_secret\":...}）"; exit 1; }
	gcloud secrets versions add $(OAUTH_CLIENT_SECRET) --project $(GCP_PROJECT) --data-file="$(FILE)"

.PHONY: prod-keys-add
prod-keys-add: ## 本番APIキーを発行して反映します（例: make prod-keys-add ID=musashi [PROFILES="github-test"]。キーは画面に出さず ~/.config/browser-gate/prod-keys に保存）。
	@$(CHECK_ID); \
	profiles="$${PROFILES:-}"; $(CHECK_PROFILES); \
	args=(); for p in $$(printf '%s' "$$profiles" | tr ',' ' '); do args+=(--profile "$$p"); done; \
	f="$(PROD_KEY_DIR)/$$ID.key"; \
	test ! -e "$$f" || { echo "$$f は既に存在します（失効してから再発行してください）"; exit 1; }; \
	umask 077; mkdir -p "$(PROD_KEY_DIR)"; chmod 700 "$(PROD_KEY_DIR)"; \
	$(MAKE) --no-print-directory prod-config-pull; \
	out="$$($(PROD_KEYS_RUN) add --id "$$ID" "$${args[@]}" | tr -d '\r')"; \
	key="$$(printf '%s\n' "$$out" | grep -E '^bg_[A-Za-z0-9_-]+$$' | head -n 1 || true)"; \
	test -n "$$key" || { echo "キーの発行結果を取得できませんでした（config/prod.json を確認してください。本番へは未反映）"; exit 1; }; \
	printf '%s\n' "$$key" > "$$f"; chmod 600 "$$f"; unset key out; \
	echo "キーを $$f に保存しました。本番へ反映します..."; \
	$(MAKE) --no-print-directory prod-config-push || { echo "反映に失敗しました。make prod-config-push で再実行してください（キーは保存済み）"; exit 1; }; \
	echo "完了: ID=$$ID（反映まで最大10秒）"

.PHONY: prod-keys-grant
prod-keys-grant: ## 既存の本番APIキーにプロファイル権限を追加して反映します（例: make prod-keys-grant ID=musashi PROFILE=github-test）。
	@$(CHECK_ID); \
	profiles="$${PROFILE:-}"; test -n "$$profiles" || { echo "PROFILE を指定してください（例: PROFILE=github-test）"; exit 1; }; $(CHECK_PROFILES); \
	args=(); for p in $$(printf '%s' "$$profiles" | tr ',' ' '); do args+=(--profile "$$p"); done; \
	$(MAKE) --no-print-directory prod-config-pull; \
	$(PROD_KEYS_RUN) grant --id "$$ID" "$${args[@]}"; \
	$(MAKE) --no-print-directory prod-config-push; \
	echo "完了: ID=$$ID に $$profiles を許可しました（反映まで最大10秒）"

.PHONY: prod-keys-list
prod-keys-list: ## 保存済みの本番キーのIDを一覧表示します（キー本体は表示しません）。
	@if ls "$(PROD_KEY_DIR)"/*.key >/dev/null 2>&1; then \
		for f in "$(PROD_KEY_DIR)"/*.key; do printf '%-20s %s\n' "$$(basename "$$f" .key)" "$$(date -r "$$f" '+%Y-%m-%d %H:%M')"; done; \
	else echo "保存済みキーはありません（$(PROD_KEY_DIR)）"; fi

.PHONY: prod-keys-revoke
prod-keys-revoke: ## 本番APIキーを失効して反映し、保存済みキーも削除します（例: make prod-keys-revoke ID=musashi）。
	@$(CHECK_ID); \
	$(MAKE) --no-print-directory prod-config-pull; \
	$(PROD_KEYS_RUN) revoke --id "$$ID"; \
	$(MAKE) --no-print-directory prod-config-push; \
	rm -f "$(PROD_KEY_DIR)/$$ID.key"; \
	echo "完了: ID=$$ID を失効しました（反映まで最大10秒）"

.PHONY: prod-fetch
prod-fetch: ## 本番 /fetch を実行します（例: make prod-fetch URL=https://example.com/ [OUT=text|html|screenshot] [ID=musashi] [PROFILE=github-test] [FILE=out.png] [API_URL=...]）。
	@test -n "$${URL:-}" || { echo "URL を指定してください（例: make prod-fetch URL=https://example.com/）"; exit 1; }; \
	out="$${OUT:-text}"; \
	case "$$out" in text|html|screenshot) ;; *) echo "OUT は text / html / screenshot のいずれかです"; exit 1;; esac; \
	if [ -z "$${ID:-}" ]; then \
		set -- "$(PROD_KEY_DIR)"/*.key; \
		if [ $$# -eq 1 ] && [ -f "$$1" ]; then ID="$$(basename "$$1" .key)"; \
		else echo "ID を指定してください（make prod-keys-list で確認。保存キーが1つだけの場合のみ省略可）"; exit 1; fi; \
	fi; \
	$(CHECK_ID); \
	f="$(PROD_KEY_DIR)/$$ID.key"; \
	test -f "$$f" || { echo "$$f がありません（make prod-keys-add ID=$$ID）"; exit 1; }; \
	base="$${API_URL:-$$($(TF_RUN) output -raw api_url 2>/dev/null | tr -d '\r' || true)}"; \
	[ -n "$$base" ] || base="$$(gcloud run services describe $(RUN_SERVICE) --region $(GCP_REGION) --project $(GCP_PROJECT) --format 'value(status.url)')"; \
	[ -n "$$base" ] || { echo "api_url を取得できません（API_URL=https://... を指定してください）"; exit 1; }; \
	profile="$${PROFILE:-}"; \
	case "$$profile" in *[!A-Za-z0-9_-]*) echo "PROFILE は英数字・-・_ のみです（例: PROFILE=github-test）"; exit 1;; esac; \
	body="$$(jq -cn --arg url "$$URL" --arg o "$$out" --arg p "$$profile" '{url:$$url, outputs:[$$o]} + (if $$p != "" then {profile:$$p} else {} end)')"; \
	res="$$(printf 'Authorization: Bearer %s\n' "$$(cat "$$f")" | curl -sS -m 90 -X POST "$$base/fetch" -H @- -H 'Content-Type: application/json' -d "$$body")"; \
	if [ "$$out" = screenshot ]; then \
		dest="$${FILE:-screenshot.png}"; \
		printf '%s' "$$res" | jq -er '.screenshot' | base64 -d > "$$dest" || { echo "取得に失敗しました:"; printf '%s\n' "$$res" | jq . 2>/dev/null || printf '%s\n' "$$res"; rm -f "$$dest"; exit 1; }; \
		echo "保存しました: $$dest"; \
	else \
		val="$$(printf '%s' "$$res" | jq -er ".$$out" 2>/dev/null)" || { echo "取得に失敗しました:"; printf '%s\n' "$$res" | jq . 2>/dev/null || printf '%s\n' "$$res"; exit 1; }; \
		if [ -n "$${FILE:-}" ]; then printf '%s\n' "$$val" > "$$FILE"; echo "保存しました: $$FILE"; else printf '%s\n' "$$val"; fi; \
	fi

.PHONY: format
format: build ## Prettier で src / test を整形します。
	$(DOCKER_CMD) run --rm --no-deps --user $$(id -u):$$(id -g) -e HOME=/tmp -v $(CURDIR)/src:/app/src -v $(CURDIR)/test:/app/test --entrypoint npx api prettier --write src test

.PHONY: infra-init
infra-init: ## Terraform を初期化します（state 用 GCS バケットに接続）。
	$(TF_RUN) init

.PHONY: infra-fmt
infra-fmt: ## Terraform ファイルを整形します。
	$(TF_RUN) fmt

.PHONY: infra-validate
infra-validate: infra-init ## Terraform の構文を検証します。
	$(TF_RUN) validate

.PHONY: infra-plan
infra-plan: infra-init ## Terraform の変更内容を確認します。
	$(TF_RUN) plan

.PHONY: infra-apply
infra-apply: infra-init ## Terraform の変更を反映します（確認プロンプトあり。実リソースを変更）。
	$(DOCKER_CMD) run --rm -it --user $$(id -u):$$(id -g) terraform apply

.PHONY: config-push
config-push: ## config/local.json を Secret Manager の設定JSONとして新バージョン登録します（本番反映）。
	@test -f config/local.json || { echo "config/local.json がありません"; exit 1; }
	gcloud secrets versions add $(CONFIG_SECRET) --project $(GCP_PROJECT) --data-file=config/local.json

.PHONY: deploy
deploy: ## GitHub Actions のデプロイを手動起動し、完了まで表示します。
	gh workflow run deploy.yml --ref main
	@sleep 5
	gh run watch "$$(gh run list --workflow=deploy.yml --limit 1 --json databaseId --jq '.[0].databaseId')" --exit-status
