#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# dev-up.sh — خودترمیمی محیط توسعه دانیار (سندباکس)
#
# مشکل تکرارشونده: بازنشانی محیط بین جلسات → .env فقط DATABASE_URL دارد،
# LiveKit/socket با env ناقص بالا آمده‌اند یا اصلاً اجرا نیستند →
# کاربر «سرویس رسانه (LiveKit) پیکربندی نشده است / سرور رسانه در دسترس نیست» می‌بیند.
#
# کاری که می‌کند:
#   ۱) اگر .env کلیدهای الزامی را ندارد → بازگردانی از گیت (HEAD)
#   ۲) LiveKit (:7880) را اگر پایین/ناسالم است با کلیدهای .env بالا می‌آورد؛
#      اگر «مقدار» کلیدهای LiveKit با .env فرق کرده باشد (نه فقط وجودشان)
#      یا پیکربندی yaml به حالت محلی برگردد → ری‌استارت
#   ۳) socket (:3003) را اگر پایین است یا env آن بدون LIVEKIT است یا «مقدار»
#      متغیرهای حساسش با .env فرق دارد، ری‌استارت می‌کند
#   ۴) next (:3000) را اگر پایین است یا «مقدار» متغیرهای حساسش (از جمله
#      آدرس/کلیدهای LiveKit) با .env فرق دارد، ری‌استارت می‌کند — یعنی
#      تغییر آدرس/کلید LiveKit = ری‌استارت «هر دو» سرویس؛ در لاگ فقط «نام»
#      کلیدهای ناهم‌خوان چاپ می‌شود، نه مقدار محرمانه
#   ۵) شیم‌های آزمون AI (:3055) و پیامک (:3056)
#   ۶) هم‌خوانی SESSION_SECRET پروسه‌های در حال اجرا با .env فعلی + تازگی
#      mtime .env نسبت به بوت next
#   ۶-ج) پل TURN عمومی پیش‌نمایش (LIVEKIT_PUBLIC_TURN_HOST — فقط dev):
#      coturn محلی (:3478) + تونل TCP رله — مرورگر بیرونیِ پیش‌نمایش با
#      TURN/TCP از مسیر عمومی به رسانه می‌رسد؛ خودترمیم زنده نگهش می‌دارد
#
# الگوی بقا: پروسه‌ها با subshell دو‌مرحله‌ای «( setsid nohup ... & )» بالا
# می‌آیند — با پایان فراخوانی شل، کشته نمی‌شوند (امتحان‌شده در سندباکس).
# ─────────────────────────────────────────────────────────────────────────────
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RED=$'\033[0;31m'; GRN=$'\033[0;32m'; YLW=$'\033[1;33m'; RST=$'\033[0m'
say()  { echo -e "  $1"; }
die()  { echo -e "${RED}✘ $1${RST}"; exit 1; }
listening() { ss -tln 2>/dev/null | grep -q ":$1 "; }
# مقدار یک متغیر از environ پروسهٔ شنوندهٔ یک پورت (برای مقایسهٔ هم‌خوانی env)
proc_env_var() { # $1=port $2=var
  local pid
  pid=$(ss -tlnp 2>/dev/null | grep ":$1 " | grep -oP 'pid=\K[0-9]+' | head -1)
  [ -n "$pid" ] || return 1
  tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null | grep "^$2=" | head -1 | cut -d= -f2-
}
start_socket() {
  ( cd "$ROOT/mini-services/socket-server" && set -a; source "$ROOT/.env"; set +a
    setsid nohup bun index.ts >> "$ROOT/socket.log" 2>&1 < /dev/null & )
}
# توقف سوکت «فقط» با PID شنوندهٔ :3003 — الگوی pkill کلی (bun index.ts) قبلاً
# شیم پیامک (:3056) را هم می‌کشت (همان نام فرمان) و پس از ری‌استارت نگهبان،
# شیم مرده باقی می‌ماند؛ توقف هدفمند این تداخل را رفع می‌کند.
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
turn_running() { pgrep -f 'turnserver.*turnserver-preview\.conf' >/dev/null 2>&1; }

# ─── متغیرهایی که «تغییر مقدار»شان ری‌استارت next/socket را الزامی می‌کند ───
# توجه: بررسی «وجود» کلید کافی نیست — مقدار پروسهٔ در حال اجرا باید با .env
# یکی باشد؛ مثلاً عوض‌کردن آدرس/کلید LiveKit باید هر دو سرویس تازه شوند.
# مقایسه با مقدارِ parse شدهٔ .env انجام می‌شود (این اسکریپت source کرده)؛
# در لاگ فقط «نام» کلیدهای ناهم‌خوان می‌آید، مقدار محرمانه هرگز چاپ نمی‌شود.
# متغیرهای TURN هم جزو کلیدهای حساس‌اند: «حذف» از .env (مثلاً رفتن به
# LiveKit Cloud که TURN خودش را می‌فرستد) باید ری‌استارت کند تا مقدار کهنه در
# environ پروسه نماند و iceServers توکن را به‌اشتباه به TURN قدیمی بفرستد.
RESTART_ENV_VARS="SESSION_SECRET SOCKET_INTERNAL_SECRET DATABASE_URL LIVEKIT_API_KEY LIVEKIT_API_SECRET LIVEKIT_INTERNAL_URL NEXT_PUBLIC_LIVEKIT_WS_URL LIVEKIT_PUBLIC_TURN_HOST LIVEKIT_PUBLIC_TURN_PORT LIVE_TURN_URLS LIVE_TURN_USERNAME LIVE_TURN_CREDENTIAL"
stale_env_keys() { # $1=port → خروجی: نام کلیدهای ناهم‌خوان با کاما (خالی = سالم)
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

# ─── ۱) .env — کلیدهای الزامی ────────────────────────────────────────────────
need_env() {
  [ -f .env ] || return 1
  for v in DATABASE_URL SESSION_SECRET SOCKET_INTERNAL_SECRET LIVEKIT_API_KEY LIVEKIT_API_SECRET; do
    grep -qE "^${v}=" .env || return 1
  done
  return 0
}
if need_env; then
  say "${GRN}✔ .env کامل است (کلیدهای الزامی موجود)${RST}"
else
  # .env ممکن است در HEAD نباشد (سیاست امنیتی: بدون راز در ایندکس گیت) →
  # fallback: آخرین کامیتی که «بلابِ» .env را دارد (کامیتِ حذف از ایندکس را رد می‌کند)
  env_src=""
  if git show HEAD:.env >/dev/null 2>&1; then
    env_src="HEAD"
  else
    for c in $(git log --all --format='%H' -- .env 2>/dev/null); do
      if git show "$c:.env" >/dev/null 2>&1; then env_src="$c"; break; fi
    done
  fi
  if [ -n "$env_src" ]; then
    umask 077
    git show "$env_src:.env" > .env && chmod 600 .env
    need_env || die ".env از گیت برگشت ولی هنوز ناقص است — دستی پرش کنید"
    say "${YLW}⚠ .env ناقص بود → از آخرین نسخهٔ کامیت‌شدهٔ گیت بازگردانی شد (کلیدهای dev محلی)${RST}"
  else
    die ".env ناقص است و نسخه‌ای در گیت نیست — دستی بسازید"
  fi
fi
set -a; source .env; set +a
[ -n "${LIVEKIT_API_KEY}" ] && [ -n "${LIVEKIT_API_SECRET}" ] || die "LIVEKIT_API_KEY/SECRET در .env خالی است"

# ─── رسانهٔ بیرونی؟ سرور محلی و پل مربوط نیستند ─────────────────────────────
EXTERNAL_MEDIA=0
if grep -qE '^NEXT_PUBLIC_LIVEKIT_WS_URL=.+.' "$ROOT/.env" 2>/dev/null; then
  EXTERNAL_MEDIA=1
  say "رسانهٔ بیرونی فعال است (NEXT_PUBLIC_LIVEKIT_WS_URL) — LiveKit محلی/پل TURN مدیریت نمی‌شوند؛ STUN/TURN از خود سرویس بیرونی می‌آید"
else
# ─── ۲) LiveKit :7880 — سلامت + هم‌خوانی «مقدار» کلیدها ──────────────────────
LK_STALE_KEYS=""
if listening 7880; then
  LK_PID=$(ss -tlnp 2>/dev/null | grep ':7880 ' | grep -oP 'pid=\K[0-9]+' | head -1)
  for v in LIVEKIT_API_KEY LIVEKIT_API_SECRET LIVEKIT_INTERNAL_URL; do
    proc_val=""
    [ -n "$LK_PID" ] && proc_val=$(tr '\0' '\n' < "/proc/$LK_PID/environ" 2>/dev/null | grep "^${v}=" | head -1 | cut -d= -f2-)
    cur="${!v:-}"
    [ "$proc_val" != "$cur" ] && LK_STALE_KEYS="${LK_STALE_KEYS:+$LK_STALE_KEYS,}$v"
  done
fi
# پیکربندی قدیمی «node_ip پل ICE-TCP» → بازگردانی به حالت محلی (کاندیدهای محلی +
# مسیر عمومی رسانه از طریق TURN می‌گذرد، نه node_ip عمومی)
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
  say "${YLW}⚠ پیکربندی LiveKit به حالت محلی برگشت (node_ip حذف شد) → ری‌استارت${RST}"
fi
HTTP7880="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:7880/ || true)"
if [ -n "$LK_STALE_KEYS" ] || [ "$LK_YAML_RESTORED" = "1" ] || [ "$HTTP7880" != "200" ]; then
  [ -n "$LK_STALE_KEYS" ] && say "${YLW}⚠ LiveKit با مقادیر کهنهٔ این کلیدها اجراست → ری‌استارت: $LK_STALE_KEYS (مقادیر چاپ نمی‌شوند)${RST}"
  [ "$HTTP7880" != "200" ] && say "${YLW}⚠ LiveKit روی :7880 پاسخ سالم نمی‌دهد → ری‌استارت${RST}"
  pkill -f 'livekit-server --config' 2>/dev/null; sleep 1
  [ -x "$ROOT/.tools/livekit-server" ] || die "باینری .tools/livekit-server نیست"
  ( set -a; source .env; set +a
    LIVEKIT_KEYS="$LIVEKIT_API_KEY: $LIVEKIT_API_SECRET" setsid nohup \
      "$ROOT/.tools/livekit-server" --config "$ROOT/.tools/livekit-dev.yaml" \
      >> "$ROOT/livekit.log" 2>&1 < /dev/null & )
  for i in $(seq 1 20); do
    sleep 0.5
    [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:7880/ || true)" = "200" ] && break
  done
  listening 7880 && say "${GRN}✔ LiveKit با کلیدها/پیکربندی تازه بالا آمد (:7880)${RST}" || die "LiveKit بالا نیامد — livekit.log را ببینید"
else
  say "${GRN}✔ LiveKit روی :7880 سالم و هم‌خوان با .env اجراست${RST}"
fi

# ─── ۲-ب) پل TURN عمومی پیش‌نمایش (coturn محلی + تونل رله) ──────────────────
# این پل فقط برای رسانهٔ «مرورگر بیرونی» پیش‌نمایش است؛ اگر بالا نیامد،
# هستهٔ اپ (ورود/پیام‌رسانی/کلاس داخل سندباکس) نباید متوقف شود → warn نه die.
if grep -qE '^LIVEKIT_PUBLIC_TURN_HOST=.+.' "$ROOT/.env" 2>/dev/null; then
  TURN_HOST_V="$(grep -E '^LIVEKIT_PUBLIC_TURN_HOST=' "$ROOT/.env" | head -1 | cut -d= -f2- | tr -d '[:space:]')"
  TURN_PORT_V="$(grep -E '^LIVEKIT_PUBLIC_TURN_PORT=' "$ROOT/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '[:space:]')"
  [ -n "$TURN_PORT_V" ] || TURN_PORT_V=3478
  if turn_running; then
    say "${GRN}✔ coturn در حال اجراست (:3478 محلی)${RST}"
  else
    # باینری بیرون پروژه است و بازنشانی سندباکس پاکش می‌کند → نصب best-effort
    if [ -x "$ROOT/.tools/turnserver" ] && ! "$ROOT/.tools/turnserver" --version >/dev/null 2>&1; then
      bash "$ROOT/scripts/install-coturn.sh" >/dev/null 2>&1 \
        && say "${GRN}✔ coturn بازنصب شد (پاک‌شده با بازنشانی سندباکس)${RST}" \
        || say "${YLW}⚠ نصب coturn ناموفق — ادامه بدون پل TURN${RST}"
    fi
    if [ -x "$ROOT/.tools/turnserver" ] && [ -f "$ROOT/.tools/turnserver-preview.conf" ]; then
      ( setsid nohup "$ROOT/.tools/turnserver" -c "$ROOT/.tools/turnserver-preview.conf" \
          >> "$ROOT/turn.log" 2>&1 < /dev/null & )
      for i in $(seq 1 10); do sleep 0.5; turn_running && break; done
      turn_running && say "${GRN}✔ coturn بالا آمد (:3478 محلی)${RST}" \
        || say "${YLW}⚠ coturn بالا نیامد (turn.log) — ادامه بدون پل TURN${RST}"
    else
      say "${YLW}⚠ باینری/کانفیگ coturn نیست (.tools/turnserver) — ادامه بدون پل TURN${RST}"
    fi
  fi
  LIVEKIT_PUBLIC_TURN_HOST="$TURN_HOST_V" LIVEKIT_PUBLIC_TURN_PORT="$TURN_PORT_V" \
    bash "$ROOT/scripts/tunnel-relay.sh" ensure
  if LIVEKIT_PUBLIC_TURN_HOST="$TURN_HOST_V" LIVEKIT_PUBLIC_TURN_PORT="$TURN_PORT_V" \
       bash "$ROOT/scripts/tunnel-relay.sh" status 2>/dev/null | grep -q 'public_listener=OK'; then
    say "${GRN}✔ پل TURN عمومی فعال (${TURN_HOST_V}:${TURN_PORT_V} → coturn محلی)${RST}"
  else
    say "${YLW}⚠ پل TURN عمومی هنوز گوش نمی‌دهد — tunnel.log / tunnel-relay.sh status${RST}"
  fi
fi
fi

# ─── ۳) socket :3003 — پایین، env بدون LIVEKIT، یا مقادیر کهنه → ری‌استارت ──
sock_env_ok() {
  local pid
  pid=$(ss -tlnp 2>/dev/null | grep ':3003 ' | grep -oP 'pid=\K[0-9]+' | head -1)
  [ -n "$pid" ] || return 1
  tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null | grep -q '^LIVEKIT_API_KEY='
}
SOCK_STALE="$(stale_env_keys 3003 || true)"
if listening 3003 && sock_env_ok && [ -z "$SOCK_STALE" ]; then
  say "${GRN}✔ socket روی :3003 با env هم‌خوان اجراست${RST}"
else
  [ -n "$SOCK_STALE" ] && say "${YLW}⚠ socket با مقادیر کهنهٔ این کلیدها اجراست → ری‌استارت: $SOCK_STALE (مقادیر چاپ نمی‌شوند)${RST}"
  stop_socket
  start_socket
  for i in $(seq 1 20); do
    sleep 0.5
    listening 3003 && sock_env_ok && break
  done
  listening 3003 && say "${GRN}✔ socket ری‌استارت شد (:3003، env هم‌خوان)${RST}" || die "socket بالا نیامد — socket.log را ببینید"
fi

# ─── ۴) next :3000 — پایین یا مقادیر کهنه (LiveKit/رمزها) → ری‌استارت ──────
NEXT_STALE="$(stale_env_keys 3000 || true)"
if listening 3000 && [ -z "$NEXT_STALE" ]; then
  say "${GRN}✔ next dev روی :3000 با env هم‌خوان اجراست${RST}"
else
  [ -n "$NEXT_STALE" ] && say "${YLW}⚠ next با مقادیر کهنهٔ این کلیدها اجراست → ری‌استارت: $NEXT_STALE (مقادیر چاپ نمی‌شوند)${RST}"
  pkill -f 'next dev' 2>/dev/null; pkill -f 'next-server' 2>/dev/null; sleep 2
  start_next
  for i in $(seq 1 60); do
    sleep 1
    listening 3000 && break
  done
  listening 3000 && say "${GRN}✔ next dev بالا آمد (:3000)${RST}" || die "next بالا نیامد — dev.log را ببینید"
fi

# ─── ۵) شیم‌های آزمون :3055 (دستیار AI) و :3056 (پیامک) ─────────────────────
if listening 3055; then
  say "${GRN}✔ شیم دستیار AI روی :3055 اجراست${RST}"
else
  ( cd "$ROOT/mini-services/ai-test-server" && setsid nohup bun index.mjs >> "$ROOT/ai-test.log" 2>&1 < /dev/null & )
  sleep 2
  listening 3055 && say "${GRN}✔ شیم دستیار AI بالا آمد (:3055)${RST}" || say "${YLW}⚠ شیم AI بالا نیامد (فقط برای آزمون دستیار لازم است)${RST}"
fi
if listening 3056; then
  say "${GRN}✔ شیم پیامک روی :3056 اجراست${RST}"
else
  ( cd "$ROOT/mini-services/sms-test-server" && setsid nohup bun index.ts >> "$ROOT/sms-test.log" 2>&1 < /dev/null & )
  sleep 2
  listening 3056 && say "${GRN}✔ شیم پیامک بالا آمد (:3056)${RST}" || say "${YLW}⚠ شیم پیامک بالا نیامد (فقط برای آزمون OTP لازم است)${RST}"
fi

# ─── ۶) هم‌خوانی SESSION_SECRET پروسه‌های next/socket با .env فعلی ──────────
# اگر یکی از دو سرویس با رمز نشستِ کهنه (قبل از بازنشانی/تغییر .env) بالا
# مانده باشد، امضای کوکی JWT در سوکت تأیید نمی‌شود → کلاینت فقط
# «درحال اتصال → قطع اتصال» می‌بیند در حالی که صفحات سالم‌اند.
ENV_SEC=$(grep -E '^SESSION_SECRET=' .env | head -1 | cut -d= -f2-)
NEXT_SEC=$(proc_env_var 3000 SESSION_SECRET || true)
SOCK_SEC=$(proc_env_var 3003 SESSION_SECRET || true)
if [ -n "$SOCK_SEC" ] && [ "$SOCK_SEC" != "$ENV_SEC" ]; then
  say "${YLW}⚠ socket با SESSION_SECRET کهنه اجراست → ری‌استارت${RST}"
  stop_socket
  start_socket
  for i in $(seq 1 20); do
    sleep 0.5
    listening 3003 && break
  done
  listening 3003 && say "${GRN}✔ socket با رمز تازه بالا آمد (:3003)${RST}" || die "socket بعد از ری‌استارت رمز بالا نیامد"
else
  say "${GRN}✔ رمز نشست socket با .env هم‌خوان است${RST}"
fi
if [ -n "$NEXT_SEC" ] && [ "$NEXT_SEC" != "$ENV_SEC" ]; then
  say "${YLW}⚠ next با SESSION_SECRET کهنه اجراست → ری‌استارت (نشست‌های کاربران باید دوباره وارد شوند)${RST}"
  pkill -f 'next dev' 2>/dev/null; pkill -f 'next-server' 2>/dev/null; sleep 2
  start_next
  for i in $(seq 1 60); do
    sleep 1
    listening 3000 && break
  done
  listening 3000 && say "${GRN}✔ next با رمز تازه بالا آمد (:3000)${RST}" || die "next بعد از ری‌استارت رمز بالا نیامد"
else
  say "${GRN}✔ رمز نشست next با .env هم‌خوان است${RST}"
fi

# ─── ۶-ب) تازگی .env نسبت به پروسهٔ next ───
# next کافیگ .env را فقط هنگام بالا آمدن می‌خواند. اگر .env بعد از next بازنشانی
# شده باشد (الگوی تکرارشوندهٔ سندباکس)، next رمزهای کهنه در حافظه دارد و
# SOCKET_INTERNAL_SECRET مخصوصاً: broadcast پیام‌ها بی‌صدا 403 می‌خورد —
# پیام در DB ذخیره می‌شود ولی بلادرنگ هرگز نمی‌رسد. تشخیص: mtime فایل .env
# در برابر زمان شروع پروسهٔ شنوندهٔ :3000 → ناهم‌خوان = ری‌استارت next.
if listening 3000; then
  NEXT_PID=$(ss -tlnp 2>/dev/null | grep ':3000 ' | grep -oP 'pid=\K[0-9]+' | head -1)
  ELAPSED=$(ps -o etimes= -p "$NEXT_PID" 2>/dev/null | tr -d ' ')
  NEXT_START=0
  [ -n "$ELAPSED" ] && [ "$ELAPSED" != "0" ] && NEXT_START=$(( $(date +%s) - ELAPSED ))
  ENV_MTIME=$(stat -c %Y "$ROOT/.env" 2>/dev/null || echo 0)
  if [ "$NEXT_START" != "0" ] && [ "$ENV_MTIME" -gt "$NEXT_START" ]; then
    say "${YLW}⚠ .env بعد از بالا آمدن next عوض شده → ری‌استارت next (رله کهنه 403 می‌خورد)${RST}"
    pkill -f 'next dev' 2>/dev/null; pkill -f 'next-server' 2>/dev/null; sleep 2
    start_next
    for i in $(seq 1 60); do
      sleep 1
      listening 3000 && break
    done
    listening 3000 && say "${GRN}✔ next با .env تازه بالا آمد (:3000)${RST}" || die "next بعد از ری‌استارت .env تازه بالا نیامد"
  else
    say "${GRN}✔ .env از پروسهٔ next تازه‌تر نیست (رله رمز سالم)${RST}"
  fi
fi

# ─── ۷) سنسور مسیر پیش‌نمایش سوکت (عین مسیر مرورگر) ───
if command -v node >/dev/null 2>&1; then
  if node "$ROOT/scripts/preview-socket-handshake-probe.mjs" >/dev/null 2>&1; then
    say "${GRN}✔ مسیر پیش‌نمایش سوکت (لاگین→handshake→CONNECT) سالم است${RST}"
  else
    say "${YLW}⚠ مسیر پیش‌نمایش سوکت ناسالم است — اجرا کنید: node scripts/preview-socket-handshake-probe.mjs${RST}"
  fi
fi

# ─── ۸) نگهبان دوره‌ای خودترمیم (اگر اجرا نیست) ─────────────────────────────
if pgrep -f 'scripts/dev-watchdog\.sh' >/dev/null 2>&1; then
  say "${GRN}✔ نگهبان دوره‌ای خودترمیم در حال اجراست${RST}"
else
  ( setsid nohup bash "$ROOT/scripts/dev-watchdog.sh" >> "$ROOT/watchdog.log" 2>&1 < /dev/null & )
  sleep 1
  pgrep -f 'scripts/dev-watchdog\.sh' >/dev/null 2>&1 \
    && say "${GRN}✔ نگهبان دوره‌ای خودترمیم بالا آمد (هر ۳۰ ثانیه)${RST}" \
    || say "${YLW}⚠ نگهبان بالا نیامد — watchdog.log را ببینید${RST}"
fi

say ""
if [ "$EXTERNAL_MEDIA" = "1" ]; then
  say "${GRN}همه سرویس‌ها سالم‌اند: next :3000 / socket :3003 / رسانهٔ بیرونی (NEXT_PUBLIC_LIVEKIT_WS_URL) / شیم‌ها :3055 :3056${RST}"
else
  say "${GRN}همه سرویس‌ها سالم‌اند: next :3000 / socket :3003 / LiveKit :7880 / coturn :3478 (+تونل عمومی در صورت فعال‌بودن) / شیم‌ها :3055 :3056${RST}"
fi
