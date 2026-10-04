SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c

DOCKER_CMD := docker compose
NPM_RUN := $(DOCKER_CMD) run --rm --no-deps --entrypoint npm api

.DEFAULT_GOAL := help

.PHONY: help
help: ## ヘルプを表示します。
	@echo "Available commands:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "} {printf "%-20s %s\n", $$1, $$2}'

.PHONY: init
init: ## .env と config/local.json を見本から作成し、イメージをビルドします。
	@if [ ! -f .env ]; then cp .env.example .env; echo ".env を作成しました"; fi
	@if [ ! -f config/local.json ]; then cp config/local.example.json config/local.json; echo "config/local.json を作成しました"; fi
	$(DOCKER_CMD) build

.PHONY: build
build: ## Dockerイメージをビルドします。
	$(DOCKER_CMD) build

.PHONY: up
up: ## api / login を起動します（noVNC は http://localhost:6080）。
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
