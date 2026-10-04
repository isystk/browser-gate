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
