#!/usr/bin/env bash
# MODE=api: Xvfb + アプリ / MODE=login: Xvfb + x11vnc + websockify + アプリ
# websockify は 127.0.0.1 のみで待ち受け、外部へは OAuth 認証済みの利用者だけにアプリ（Hono）が中継する
set -euo pipefail

MODE="${MODE:-api}"
DISPLAY="${DISPLAY:-:99}"
SCREEN_GEOMETRY="${SCREEN_GEOMETRY:-1280x800x24}"
VNC_PORT=5900
NOVNC_PORT=6080
export DISPLAY

case "${MODE}" in
  api | login) ;;
  *)
    echo "MODE must be api or login: ${MODE}" >&2
    exit 1
    ;;
esac

rm -f "/tmp/.X${DISPLAY#:}-lock"
Xvfb "${DISPLAY}" -screen 0 "${SCREEN_GEOMETRY}" -nolisten tcp &

for _ in $(seq 1 50); do
  [ -S "/tmp/.X11-unix/X${DISPLAY#:}" ] && break
  sleep 0.1
done

if [ "${MODE}" = "login" ]; then
  x11vnc -display "${DISPLAY}" -localhost -rfbport "${VNC_PORT}" -forever -shared -nopw -quiet &
  websockify "127.0.0.1:${NOVNC_PORT}" "localhost:${VNC_PORT}" &
fi

exec "$@"
