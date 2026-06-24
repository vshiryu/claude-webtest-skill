#!/usr/bin/env bash
# webtest — lifecycle (Chrome + error monitor) + CLI wrapper around drive.mjs.
#   webtest.sh start|stop|restart|status
#   webtest.sh <command> [args...]      (auto-starts Chrome + monitor if needed)
set -uo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME="${HOME}/.cache/claude-browser"
PROFILE="${RUNTIME}/profile"
LOG="${RUNTIME}/chrome.log"
MONLOG="${RUNTIME}/monitor.log"
PIDFILE="${RUNTIME}/chrome.pid"
MONPID="${RUNTIME}/monitor.pid"
PORT="${BROWSER_PORT:-9222}"
export BROWSER_PORT="$PORT"
export STATE_DIR="$RUNTIME"
export SHOTS_DIR="${SHOTS_DIR:-${RUNTIME}/shots}"
mkdir -p "$RUNTIME" "$SHOTS_DIR"

find_chrome() {
  for c in google-chrome-stable google-chrome chromium chromium-browser chrome; do
    if command -v "$c" >/dev/null 2>&1; then echo "$c"; return 0; fi
  done
  return 1
}
is_up()  { curl -s "http://127.0.0.1:${PORT}/json/version" >/dev/null 2>&1; }
mon_up() { [ -f "$MONPID" ] && kill -0 "$(cat "$MONPID")" 2>/dev/null; }

ensure_chrome() {
  is_up && return 0
  local chrome; chrome="$(find_chrome)" || { echo "No Chrome/Chromium in PATH"; return 1; }
  local headless="${BROWSER_HEADLESS--headless=new}"   # set BROWSER_HEADLESS= for headful
  nohup "$chrome" $headless --disable-gpu --no-sandbox \
    --remote-debugging-port="$PORT" --window-size=1366,900 \
    --user-data-dir="$PROFILE" about:blank >"$LOG" 2>&1 &
  echo "$!" >"$PIDFILE"
  for _ in $(seq 1 25); do is_up && break; sleep 0.3; done
  is_up || { echo "Chrome failed to start:"; tail -n 12 "$LOG"; return 1; }
}
ensure_monitor() {
  mon_up && return 0
  nohup node "${SKILL_DIR}/monitor.mjs" >"$MONLOG" 2>&1 &
  echo "$!" >"$MONPID"
  sleep 0.6
}

start() { ensure_chrome && ensure_monitor && echo "webtest up — Chrome :${PORT} + monitor | shots: ${SHOTS_DIR}"; }
stop() {
  [ -f "$MONPID" ] && kill "$(cat "$MONPID")" 2>/dev/null || true; rm -f "$MONPID"
  [ -f "$PIDFILE" ] && kill "$(cat "$PIDFILE")" 2>/dev/null || true; rm -f "$PIDFILE"
  pkill -f "remote-debugging-port=${PORT}" 2>/dev/null || true
  echo "stopped"
}

cmd="${1:-}"; shift || true
case "$cmd" in
  start)   start ;;
  stop)    stop ;;
  restart) stop; sleep 1; start ;;
  status)
    is_up && echo "Chrome: UP :${PORT}" || echo "Chrome: DOWN"
    mon_up && echo "Monitor: UP (pid $(cat "$MONPID"))" || echo "Monitor: DOWN"
    ;;
  "" ) node "${SKILL_DIR}/drive.mjs" help ;;
  *)
    ensure_chrome >/dev/null && ensure_monitor >/dev/null || exit 1
    node "${SKILL_DIR}/drive.mjs" "$cmd" "$@" ;;
esac
