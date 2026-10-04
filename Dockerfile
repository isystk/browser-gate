# Playwright のバージョンは package.json の playwright と揃える
FROM mcr.microsoft.com/playwright:v1.63.0-noble

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    xvfb \
    x11vnc \
    novnc \
    websockify \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json eslint.config.js vitest.config.ts .prettierrc.json .prettierignore ./
COPY src ./src
COPY docker/novnc ./docker/novnc
COPY docker/chromium-policy.json ./docker/chromium-policy.json
COPY test ./test
RUN npm run build

# Chrome for Testing が読む管理ポリシー（パスは Chrome for Testing 固有）。
# RestoreOnStartup: セッション Cookie をプロファイルに残し、閉じた後の取り込みで読めるようにする（ログイン用の素の Chromium）。
# URLBlocklist / DownloadRestrictions: 素の Chromium では Playwright のリクエストフィルタが使えないため、file:// とダウンロードを禁止する。
RUN mkdir -p /etc/opt/chrome_for_testing/policies/managed \
  && cp /app/docker/chromium-policy.json /etc/opt/chrome_for_testing/policies/managed/browser-gate.json \
  && chmod 644 /etc/opt/chrome_for_testing/policies/managed/browser-gate.json

COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh \
  && mkdir -p /tmp/.X11-unix \
  && chmod 1777 /tmp/.X11-unix \
  && mkdir -p /data/profiles \
  && chown -R pwuser:pwuser /app /data

USER pwuser

ENV MODE=api \
    PORT=8080 \
    DISPLAY=:99

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "dist/index.js"]
