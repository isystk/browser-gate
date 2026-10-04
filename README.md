# browser-gate

Cloud Run 上のヘッドフル Chromium + noVNC による汎用ブラウザ取得API。

## ローカル起動

```
make init
make up
make ps
```

- api: http://localhost:8080/healthz
- login: http://localhost:8081/healthz
- noVNC: http://localhost:6080（ローカルPCからのみ接続可）

`make help` で全コマンドを表示する。

## 取得API（POST /fetch）

```
make keys-add ID=<呼び出し元名>   # APIキーを発行（平文は一度だけ表示。.env など Git 管理外に保存）
make keys-list / make keys-revoke ID=<呼び出し元名>
```

```
curl -X POST http://localhost:8080/fetch \
  -H "Authorization: Bearer $LOCAL_API_KEY" -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/","outputs":["text"],"extract":{"title":"h1"},"steps":[{"wait_for":"p"}]}'
```

- `outputs`: html / text / screenshot（省略時は html。`extract` のみ指定時は extract だけ返す）。`extract` の値は常に文字列の配列。
- `steps`: `wait_for` / `click`（CSS セレクタ）、`scroll`（`top` / `bottom`）のみ。
- 全通信は内部IP遮断・ポート80/443限定のローカル中継プロキシを経由する（DNSリバインディング・リダイレクト・サブリソース対策）。
- 設定は `config/local.json`（Git 管理外）。変更は再起動なしで反映される。
- `make test`（単体・結合）/ `make lint` / `make typecheck` はすべて Docker 内で実行する。
