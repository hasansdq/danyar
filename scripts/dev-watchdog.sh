#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# dev-watchdog.sh — نگهبان دوره‌ای خودترمیم سندباکس دانیار
#
# چرا؟ بازنشانی .env و مرگ پروسه‌ها بین فراخوانی‌ها/جلسات، علت ریشه‌ای
# «سرویس رسانه (LiveKit) پیکربندی نشده است» و «قطع اتصال» سوکت است. dev-up.sh
# ترمیم دستی است؛ این نگهبان همان ترمیم را هر ۳۰ ثانیه خودکار انجام می‌دهد.
# توسط src/instrumentation.ts (بوت next) یا dev-up.sh بالا آورده می‌شود —
# هر دو idempotent هستند (الگوی pgrep؛ بدون pidfile).
#
# هر چرخه:
#   ۱) .env کلیدهای الزامی ندارد → git checkout -- .env
#   ۲) LiveKit :7880 — پایین/ناسالم یا «مقدار» کلیدهایش با .env فرق کرده
#      → ری‌استارت؛ پیکربندی قدیمی node_ip → بازگردانی به حالت محلی
#   ۲-ب) پل TURN پیش‌نمایش — coturn و تونل رله را ensure می‌کند
#   ۳) سوکت :3003 — پایین، env بدون LIVEKIT، یا «مقدار» متغیرهای حساس کهنه
#      → ری‌استارت با .env تازه
#   ۴) next :3000 — پایین یا «مقدار» متغیرهای حساس کهنه (LiveKit/رمزها)
#      → ری‌استارت. یعنی تغییر آدرس/کلید LiveKit در .env حداکثر تا یک چرخه
#      بعد، ری‌استارت «هر دو» سرویس را الزامی می‌کند. در لاگ فقط نام کلیدها
#      می‌آید، نه مقدار محرمانه.
#
# نکته‌ها:
#  - همهٔ استارت‌ها با الگوی دو‌مرحله‌ای «( setsid nohup ... & )» — با پایان
#    پدر زنده می‌مانند
#  - لاگ: watchdog.log (ریشهٔ پروژه)
# ─────────────────────────────────────────────────────────────────────────────
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
LOG="$ROOT/watchdog.log"

ts() { date '+%Y-%m-%d %H:%M:%S'; }
listening() { ss -tln 2>/dev/null | grep -q ":$1 "; }
log() { echo "[$(ts)] $*" >> "$LOG"; }

start_livekit() {
  [ -x "$ROOT/.tools/livekit-server" ] && [ -f "$ROOT/.tools/livekit-dev.yaml" ] || return 1
  ( set -a; source "$ROOT/.env"; set +a
    LIVEKIT_KEYS="$LIVEKIT_API_KEY: $LIVEKIT_API_SECRET" setsid nohup \
      "$ROOT/.tools/livekit-server" --config "$ROOT/.tools/livekit-dev.yaml" \
      >> "$ROOT/livekit.log" 2>&1 < /dev/null & )
}
start_socket() {
  ( cd "$ROOT/mini-services/socket-server" && set -a; source "$ROOT/.env"; set +a
    setsid nohup bun index.ts >> "$ROOT/socket.log" 2>&1 < /dev/null & )
}
# توقف سوکت فقط با PID شنوندهٔ :3003 — pkill الگوی کلی (bun index.ts)
# شیم پیامک (:3056) را هم می‌کشت؛ توقف هدفمند تداخل را رفع می‌کند.
stop_socket() {
  local pid
  pid=$(ss -tlnp 2>/dev/null | grep ':3003 ' | grep -oP 'pid=\K[0-9]+' | head -1)
  [ -n "$pid" ] && kill "$pid" 2>/dev/null
  sleep 1
  if listening 3003 && [ -n "$pid" ]; then kill -9 "$pid" 2>/dev/null; sleep 1; fi
}
start_next() {
  ( cd "$ROOT" && setsid nohup npx next dev -p 3000 >> "$ROOT/dev.log" 2>&1 < /dev/null & )
}
start_turn() {
  [ -x "$ROOT/.tools/turnserver" ] && [ -f "$ROOT/.tools/turnserver-preview.conf" ] || return 1
  # باینری بیرون پروژه است و بازنشانی سندباکس پاکش می‌کند → نصب best-effort
  if ! "$ROOT/.tools/turnserver" --version >/dev/null 2>&1; then
    bash "$ROOT/scripts/install-coturn.sh" >/dev/null 2>&1 \
      && log 'coturn پاک‌شده با بازنشانی سندباکس بود → بازنصب شد' \
      || return 1
  fi
  ( setsid nohup "$ROOT/.tools/turnserver" -c "$ROOT/.tools/turnserver-preview.conf" \
      >> "$ROOT/turn.log" 2>&1 < /dev/null & )
}
turn_running() { pgrep -f 'turnserver.*turnserver-preview\.conf' >/dev/null 2>&1; }
sock_env_ok() {
  local pid
  pid=$(ss -tlnp 2>/dev/null | grep ':3003 ' | grep -oP 'pid=\K[0-9]+' | head -1)
  [ -n "$pid" ] || return 1
  tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null | grep -q '^LIVEKIT_API_KEY='
}

# کلیدهای حساس مثل dev-up — متغیرهای TURN هم شامل‌اند تا «حذف» از .env
# (رفتن به LiveKit Cloud) ری‌استارت بدهد و مقدار کهنه در environ نماند.
RESTART_ENV_VARS="SESSION_SECRET SOCKET_INTERNAL_SECRET DATABASE_URL LIVEKIT_API_KEY LIVEKIT_API_SECRET LIVEKIT_INTERNAL_URL NEXT_PUBLIC_LIVEKIT_WS_URL LIVEKIT_PUBLIC_TURN_HOST LIVEKIT_PUBLIC_TURN_PORT LIVE_TURN_URLS LIVE_TURN_USERNAME LIVE_TURN_CREDENTIAL"
stale_env_keys() { # $1=port → نام کلیدهای ناهم‌خوان با کاما (مقادیر هرگز لاگ نمی‌شوند)
  local pid v proc_val cur out=""
  pid=$(ss -tlnp 2>/dev/null | grep ":$1 " | grep -oP 'pid=\K[0-9]+' | head -1)
  [ -n "$pid" ] || return 1
  for v in $RESTART_ENV_VARS; do
    proc_val=$(tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null | grep "^${v}=" | head -1 | cut -d= -f2-)
    cur="${!v:-}"
    [ "$proc_val" != "$cur" ] && out="${out:+$out,}$v"
  done
  echo "$out"
}

log 'نگهبان شروع به کار کرد'
while true; do
  # ۱) .env الزامی
  need_env=0
  [ -f .env ] || need_env=1
  if [ "$need_env" = 0 ]; then
    for v in DATABASE_URL SESSION_SECRET SOCKET_INTERNAL_SECRET LIVEKIT_API_KEY LIVEKIT_API_SECRET; do
      grep -qE "^${v}=" .env || { need_env=1; break; }
    done
  fi
  if [ "$need_env" = 1 ]; then
    env_src=""
    if git show HEAD:.env >/dev/null 2>&1; then
      env_src="HEAD"
    else
      # .env در HEAD نیست (بدون راز در ایندکس) → آخرین کامیتِ دارای بلاب .env
      for c in $(git log --all --format='%H' -- .env 2>/dev/null); do
        if git show "$c:.env" >/dev/null 2>&1; then env_src="$c"; break; fi
      done
    fi
    if [ -n "$env_src" ]; then
      umask 077
      if git show "$env_src:.env" > .env 2>/dev/null; then
        chmod 600 .env
        log '.env ناقص بود → از آخرین نسخهٔ کامیت‌شدهٔ تاریخچهٔ گیت بازگردانی شد (کلیدهای dev محلی)'
      fi
    fi
  fi

  # مقدارهای تازهٔ .env برای مقایسه (source در هر چرخه — .env ممکن است عوض شده باشد)
  set -a; source "$ROOT/.env" 2>/dev/null; set +a

  # ۲) LiveKit :7880 + پل TURN — در حالت رسانهٔ بیرونی هیچ‌کدام
  # (پیام حالت فقط روی «تغییر حالت» لاگ می‌شود تا لاگ هر ۳۰ ثانیه اسپم نشود)
  MEDIA_MODE_STATE="$ROOT/.tools/.watchdog-media-mode"
  if grep -qE '^NEXT_PUBLIC_LIVEKIT_WS_URL=.+.' "$ROOT/.env" 2>/dev/null; then
    [ "$(cat "$MEDIA_MODE_STATE" 2>/dev/null)" = "external" ] || log 'رسانهٔ بیرونی فعال است (NEXT_PUBLIC_LIVEKIT_WS_URL) — مدیریت LiveKit محلی/پل رد شد؛ تنظیمات Cloud دست نمی‌خورد'
    echo external > "$MEDIA_MODE_STATE" 2>/dev/null
  else
    [ "$(cat "$MEDIA_MODE_STATE" 2>/dev/null)" = "local" ] || log 'حالت رسانهٔ محلی — مدیریت LiveKit محلی/پل TURN فعال است'
    echo local > "$MEDIA_MODE_STATE" 2>/dev/null
    LK_STALE=""
    if listening 7880; then
      LK_PID=$(ss -tlnp 2>/dev/null | grep ':7880 ' | grep -oP 'pid=\K[0-9]+' | head -1)
      for v in LIVEKIT_API_KEY LIVEKIT_API_SECRET LIVEKIT_INTERNAL_URL; do
        proc_val=""
        [ -n "$LK_PID" ] && proc_val=$(tr '\0' '\n' < "/proc/$LK_PID/environ" 2>/dev/null | grep "^${v}=" | head -1 | cut -d= -f2-)
        cur="${!v:-}"
        [ "$proc_val" != "$cur" ] && LK_STALE="${LK_STALE:+$LK_STALE,}$v"
      done
    fi
    # پیکربندی قدیمی node_ip → بازگردانی به حالت محلی
    LK_YAML_RESTORED=0
    if grep -q '^  node_ip:' "$ROOT/.tools/livekit-dev.yaml" 2>/dev/null; then
      cat > "$ROOT/.tools/livekit-dev.yaml" <<'YEOF'
# ─── LiveKit SFU — پیکربندی توسعه بومی (sandbox) ───
# معادل deploy/livekit.yaml ولی برای اجرای مستقیم روی میزبان dev
# کلید API از متغیر محیطی LIVEKIT_KEYS خوانده می‌شود (بدون کلید پیش‌فرض)

port: 7880
bind_addresses:
  - 0.0.0.0

rtc:
  udp_port: 7882
  tcp_port: 7881
  # بدون IP خارجی — در dev مرورگر و سرور هم‌میزبان‌اند؛ کاندیدهای محلی کافی است
  use_external_ip: false
  congestion_control:
    allow_pause: true

turn:
  enabled: false

room:
  empty_timeout: 600
  max_participants: 64

logging:
  level: info
  json: false
YEOF
      LK_YAML_RESTORED=1
      log 'پیکربندی LiveKit به حالت محلی برگشت (node_ip حذف شد) → ری‌استارت'
    fi
    HTTP7880="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:7880/ || true)"
    if [ -n "$LK_STALE" ] || [ "$LK_YAML_RESTORED" = "1" ] || ! listening 7880 || [ "$HTTP7880" != "200" ]; then
      [ -n "$LK_STALE" ] && log "LiveKit با مقادیر کهنه ($LK_STALE) → ری‌استارت"
      pkill -f 'livekit-server --config' 2>/dev/null; sleep 1
      if start_livekit; then
        for i in $(seq 1 16); do
          sleep 0.5
          [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:7880/ || true)" = "200" ] && break
        done
        listening 7880 && log 'LiveKit ری‌استارت شد (:7880)' || log 'خطا: LiveKit بالا نیامد — livekit.log'
      else
        log 'خطا: باینری/پیکربندی LiveKit نیست'
      fi
    fi

    # ۲-ب) پل TURN پیش‌نمایش
    if grep -qE '^LIVEKIT_PUBLIC_TURN_HOST=.+.' "$ROOT/.env" 2>/dev/null; then
      TURN_HOST_V="$(grep -E '^LIVEKIT_PUBLIC_TURN_HOST=' "$ROOT/.env" | head -1 | cut -d= -f2- | tr -d '[:space:]')"
      TURN_PORT_V="$(grep -E '^LIVEKIT_PUBLIC_TURN_PORT=' "$ROOT/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '[:space:]')"
      [ -n "$TURN_PORT_V" ] || TURN_PORT_V=3478
      if ! turn_running; then
        if start_turn; then
          sleep 2
          turn_running && log 'coturn پایین بود → بالا آمد (:3478 محلی)' || log 'خطا: coturn بالا نیامد — turn.log'
        else
          log 'خطا: باینری/کانفیگ coturn نیست'
        fi
      fi
      LIVEKIT_PUBLIC_TURN_HOST="$TURN_HOST_V" LIVEKIT_PUBLIC_TURN_PORT="$TURN_PORT_V" \
        bash "$ROOT/scripts/tunnel-relay.sh" ensure
    fi
  fi

  # ۳) سوکت :3003 — پایین، env بدون LIVEKIT، یا مقادیر کهنه
  SOCK_STALE="$(stale_env_keys 3003 || true)"
  if ! listening 3003 || ! sock_env_ok || [ -n "$SOCK_STALE" ]; then
    [ -n "$SOCK_STALE" ] && log "سوکت با مقادیر کهنه ($SOCK_STALE) → ری‌استارت"
    stop_socket
    start_socket
    for i in $(seq 1 16); do
      sleep 0.5
      listening 3003 && sock_env_ok && break
    done
    listening 3003 && sock_env_ok && log 'سوکت ری‌استارت شد (:3003، env هم‌خوان)' || log 'خطا: سوکت بالا نیامد — socket.log'
  fi

  # ۴) next :3000 — پایین یا مقادیر کهنه → ری‌استارت
  NEXT_STALE="$(stale_env_keys 3000 || true)"
  if ! listening 3000 || [ -n "$NEXT_STALE" ]; then
    [ -n "$NEXT_STALE" ] && log "next با مقادیر کهنه ($NEXT_STALE) → ری‌استارت"
    pkill -f 'next dev' 2>/dev/null; pkill -f 'next-server' 2>/dev/null; sleep 2
    start_next
    for i in $(seq 1 40); do
      sleep 1
      listening 3000 && break
    done
    listening 3000 && log 'next ری‌استارت شد (:3000)' || log 'خطا: next بالا نیامد — dev.log'
  fi

  sleep 30
done
