# browser-gate

Cloud Run 上のヘッドフル Chromium + noVNC による汎用ブラウザ取得API。要件・実装計画は isystk-biz-ops の `projects/browser-gate/cto/成果物/` を参照する。

## ルール

実装時のルールは `.claude/rules/*.md` に従う（本ファイルには重複記載しない）。

## 主要コマンド

`make help` で一覧を表示する。開発は Docker 前提で、`make init` → `make up` で起動する。
