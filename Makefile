SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c

DOCKER_CMD := docker compose
NPM_RUN := $(DOCKER_CMD) run --rm --no-deps --entrypoint npm api
KEYS_RUN := $(DOCKER_CMD) run --rm --no-deps --user $$(id -u):$$(id -g) -e HOME=/tmp keys

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

.PHONY: format
format: build ## Prettier で src / test を整形します。
	$(DOCKER_CMD) run --rm --no-deps --user $$(id -u):$$(id -g) -e HOME=/tmp -v $(CURDIR)/src:/app/src -v $(CURDIR)/test:/app/test --entrypoint npx api prettier --write src test
