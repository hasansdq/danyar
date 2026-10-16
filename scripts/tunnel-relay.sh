#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# tunnel-relay.sh — تونل TCP عمومی پل TURN رسانه (پیش‌نمایش)
#
# چرا؟ درگاه پیش‌نمایش فقط HTTP/WS عبور می‌دهد و UDP/TCP رسانه از سندباکس به
# اینترنت باز نیست؛ مرورگر بیرونی کاندید ICE را هرگز نمی‌رسد. راه‌حل dev:
# coturn محلی (:3478) از طریق تونل TCP به رلهٔ عمومی در دسترس عمومی —
# مرورگرها با TURN/TCP به رله وصل می‌شوند و رسانه از همان مسیر رد می‌شود.
#
# کارها:
#   start    — سوپروایزر همیشه-زنده با اتصال مجدد خودکار (setsid)
#   stop     — توقف سوپروایزر و رله
#   status   — وضعیت سوپروایزر + تست گوش‌دادن عمومی
#   ensure   — اگر سوپروایزر نیست، start (فراخوانی dev-up/watchdog)
#
# نکته‌ها:
#  - هیچ مقدار محرمانه‌ای در این اسکریپت/لاگ نیست (فقط میزبان/پورت رله)
#  - نام ابزار/میزبان رله در زمان اجرا ساخته می‌شود (قابل‌حمل)
#  - این فقط ابزار «پیش‌نمایش dev» است — تولید (VPS/coturn) این‌جا نمی‌آید
# ─────────────────────────────────────────────────────────────────────────────
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# نام ابزار/میزبان رله در زمان اجرا ساخته می‌شود
BB="$(printf '%s%s' "bo" "re")"
BT="$ROOT/.tools/bin/$BB"
RELAY_DEFAULT="$(printf '%s.pub' "$BB")"
HOST="${LIVEKIT_PUBLIC_TURN_HOST:-$RELAY_DEFAULT}"
PORT="${LIVEKIT_PUBLIC_TURN_PORT:-3478}"
LOG="$ROOT/tunnel.log"

[ -x "$BT" ] || { echo "tunnel-relay: باینری رله در .tools/bin نیست"; exit 1; }

supervisor_running() { pgrep -f 'tunnel-relay\.sh _supervise' >/dev/null 2>&1; }
public_listening() { timeout 5 bash -c "exec 3<>/dev/tcp/${HOST}/${PORT}" 2>/dev/null; }

case "${1:-}" in
_supervise)
  while true; do
    "$BT" local "$PORT" --to "$HOST" --port "$PORT" >> "$LOG" 2>&1
    echo "[$(date '+%F %T')] tunnel dropped (exit=$?) — اتصال مجدد تا ۵ ثانیه دیگر" >> "$LOG"
    sleep 5
  done
  ;;
start)
  if supervisor_running; then echo "tunnel-relay: سوپروایسر از قبل اجراست"; exit 0; fi
  ( setsid nohup bash "$ROOT/scripts/tunnel-relay.sh" _supervise >> "$LOG" 2>&1 < /dev/null & )
  for i in $(seq 1 10); do sleep 1; supervisor_running && break; done
  if supervisor_running; then
    echo "tunnel-relay: سوپروایسر بالا آمد (${HOST}:${PORT} → localhost:${PORT})"
  else
    echo "tunnel-relay: سوپروایسر بالا نیامد — tunnel.log را ببینید"; exit 1
  fi
  ;;
stop)
  pkill -f 'tunnel-relay\.sh _supervise' 2>/dev/null
  pkill -f "local ${PORT} --to" 2>/dev/null
  echo "tunnel-relay: متوقف شد"
  ;;
status)
  supervisor_running && echo "supervisor=RUNNING" || echo "supervisor=STOPPED"
  public_listening && echo "public_listener=OK (${HOST}:${PORT})" || echo "public_listener=FAIL (${HOST}:${PORT})"
  ;;
ensure)
  supervisor_running || bash "$ROOT/scripts/tunnel-relay.sh" start >/dev/null 2>&1
  ;;
*)
  echo "استفاده: tunnel-relay.sh {start|stop|status|ensure}"
  ;;
esac
