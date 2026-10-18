#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# استقرار اولیه دانیار با Docker — با پیش‌بررسی‌های ایمن
# ⚠ این اسکریپت فقط برای «استقرار» است؛ به‌روزرسانی نسخه جدید با
#   scripts/update.sh انجام می‌شود (دو مسیر جدا و مستقل).
#
# قواعد:
#   • تنها درگاه وب روی 127.0.0.1:3034 منتشر می‌شود؛ پورت‌های 80/443 و
#     پنل DirectAdmin و هر سرویس دیگر میزبان دست‌نخورده می‌مانند
#   • پورت‌های ضروری رسانه جداگانه‌اند: 7882/udp و 7881/tcp (+ TURN در پروفایل turn)
#   • اگر اشغال پورت 3034 متعلق به خود پروژه باشد مانع نیست (stack موجود =
#     راهنمایی به update.sh)؛ اشغال توسط سرویس دیگر هرگز متوقف نمی‌شود
#   • «موفقیت» فقط پس از مهاجرت موفق و healthy‌بودن همه سرویس‌های فعال اعلام می‌شود
# استفاده:  bash scripts/deploy.sh
# ─────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/_common.sh

PORT="${DANIAR_PORT:-3034}"

fail() { echo "✘ $1" >&2; exit 1; }

# ۱) پیش‌نیازها
command -v docker >/dev/null 2>&1 || fail "Docker نصب نیست — نصب: curl -fsSL https://get.docker.com | sh"
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 در دسترس نیست (Docker قدیمی است)"

# ۲) تفکیک استقرار از به‌روزرسانی — stack موجود یعنی مسیر اشتباه
if [ "${DANIAR_FORCE_DEPLOY:-0}" != "1" ]; then
  EXISTING="$(docker compose ps -q --all 2>/dev/null | tr '\n' ' ' || true)"
  if [ -n "${EXISTING// /}" ]; then
    echo "✘ یک stack دانیار از قبل تعریف/اجرا شده است (استقرار تکراری نیست)." >&2
    echo "  • به‌روزرسانی نسخه جدید:  bash scripts/update.sh" >&2
    echo "  • اجرای مجدد سرویس‌های موجود:  docker compose up -d" >&2
    echo "  • اگر واقعاً استقرار از صفر می‌خواهید: DANIAR_FORCE_DEPLOY=1 bash scripts/deploy.sh" >&2
    exit 1
  fi
fi

# ۳) فایل تنظیمات مالک
[ -f .env ] || fail "فایل .env وجود ندارد — «cp .env.example .env» و مقادیر امن را تنظیم کنید"

required_nonempty() {
  local VAR="$1" MINLEN="$2"
  local VAL
  VAL="$(daniar_env_value "$VAR")"
  [ -n "$VAL" ] || fail "${VAR} در .env تعیین نشده است"
  case "$VAL" in
    *please-change*|*change-this*|*daniar-dev*|Admin@1234)
      fail "${VAR} هنوز مقدار نمونه/پیش‌فرض است — مقدار امن بگذارید (openssl rand -base64 32)" ;;
  esac
  if [ "${#VAL}" -lt "$MINLEN" ]; then
    fail "${VAR} خیلی کوتاه است (${#VAL} کاراکتر؛ حداقل ${MINLEN})"
  fi
  echo "  ✔ ${VAR} تنظیم است (${#VAL} کاراکتر)"
}

echo "── بررسی کلیدهای امن ──"
required_nonempty SESSION_SECRET 32
required_nonempty SOCKET_INTERNAL_SECRET 24
required_nonempty SUPERADMIN_INITIAL_PASSWORD 12
grep -qE '^DATABASE_URL=' .env && fail "DATABASE_URL نباید در .env سرور باشد — docker-compose خودش file:/data/daniar.db را تنظیم می‌کند" || true

# ۳.۵) پروفایل سرویس رسانه (LiveKit SFU) — کلیدها وقتی الزامی‌اند که فعال باشد
PROFILES="${COMPOSE_PROFILES-$(daniar_env_value COMPOSE_PROFILES)}"
has_profile() { echo ",${PROFILES:-}," | grep -q ",$1,"; }
if [ -z "${PROFILES}" ] || has_profile media; then
  echo "── بررسی کلیدهای سرویس رسانه (LiveKit) ──"
  required_nonempty LIVEKIT_API_KEY 8
  # باینری LiveKit خودش رمز کوتاه‌تر از ۳۲ را رد می‌کند — همان‌جا الزام می‌کنیم
  required_nonempty LIVEKIT_API_SECRET 32
  # IP عمومی VPS: با use_external_ip=false کاندیدهای ICE از همین IP ساخته می‌شوند؛
  # بدون آن در شبکه‌های محدود STUN خارجی شکست می‌خورد و استریم بالا نمی‌آید
  NODEIP="$(daniar_env_value LIVEKIT_NODE_IP)"
  [ -n "$NODEIP" ] || fail "LIVEKIT_NODE_IP در .env تعیین نشده — IP عمومی VPS (کاندیدهای ICE رسانه)؛ مثال: LIVEKIT_NODE_IP=203.0.113.10"
  echo "$NODEIP" | grep -qE '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' || fail "LIVEKIT_NODE_IP باید IPv4 عمومی باشد (فعلی: $NODEIP)"
  echo "  ✔ LIVEKIT_NODE_IP=$NODEIP"
  echo "  ✔ پورت‌های رسانه روی میزبان: 7882/udp و 7881/tcp — در فایروال باز باشند (جدا از درگاه وب)"
fi
if has_profile turn; then
  echo "── بررسی TURN (شبکه‌های محدود) ──"
  required_nonempty LIVE_TURN_USERNAME 3
  required_nonempty LIVE_TURN_CREDENTIAL 8
  TEIP="$(daniar_env_value TURN_EXTERNAL_IP)"
  [ -n "$TEIP" ] || fail "TURN_EXTERNAL_IP در .env تعیین نشده — IP عمومی VPS برای تبلیغ رله TURN (بدون آن رله از بیرون کار نمی‌کند)"
  echo "$TEIP" | grep -qE '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' || fail "TURN_EXTERNAL_IP باید IPv4 عمومی باشد (فعلی: $TEIP)"
  echo "  ✔ TURN_EXTERNAL_IP=$TEIP"
  echo "  ✔ پورت‌های TURN: 3478/udp+tcp، 5349/tcp+udp (TLS اختیاری)، رله 49160-49200/udp"
fi

# ۴) آزاد بودن پورت 3034 — اشغال توسط «خود پروژه» مانع نیست؛ سرویس دیگر متوقف نمی‌شود
# ⚠ سازگار با set -e: نتیجه تابع هرگز مستقیم اجرا نمی‌شود (برگشت ۱ = پورت آزاد
#   نباید اسکریپت را متوقف کند)؛ همیشه «|| BUSY=$?» — الگوی امن.
echo "── بررسی پورت ${PORT} ──"
port_busy_foreign() {
  # 0 = شنونده خارجی هست، 1 = آزاد، 2 = ابزار بررسی موجود نیست
  if command -v ss >/dev/null 2>&1; then
    if ss -ltnH "sport = :${PORT}" 2>/dev/null | grep -q .; then return 0; else return 1; fi
  elif command -v netstat >/dev/null 2>&1; then
    if netstat -ltn 2>/dev/null | awk '{print $4}' | grep -q ":${PORT}$"; then return 0; else return 1; fi
  else
    return 2  # ابزار موجود نیست — Docker خودش بررسی می‌کند
  fi
}
BUSY=0
port_busy_foreign || BUSY=$?
if [ "$BUSY" = "2" ]; then
  echo "  ⚠ نه ss و نه netstat در دسترس است — بررسی پورت توسط خود Docker انجام می‌شود"
elif [ "$BUSY" = "0" ]; then
  # شنونده‌ای هست — آیا خودِ پروژه است؟ (کانتینر proxy پروژه که 3034 را منتشر کرده)
  OURS="$(docker ps --filter "label=com.docker.compose.project=daniar" --format '{{.Names}} {{.Ports}}' 2>/dev/null | grep ":${PORT}->" || true)"
  if [ -n "$OURS" ]; then
    echo "  ℹ پورت ${PORT} به‌دلیل stack موجودِ همین پروژه اشغال شده است — این مانع استقرار/آپدیت نیست."
    echo "    برای نسخه جدید: bash scripts/update.sh  (کانتینرها جایگزین می‌شوند، پورت آزاد نمی‌خواهد)"
  else
    echo "✘ پورت ${PORT} توسط سرویس دیگری اشغال است — آن سرویس متوقف نمی‌شود؛ ابتدا خودتان آن را منتقل/متوقف کنید:" >&2
    ss -ltnp "sport = :${PORT}" 2>/dev/null || ss -ltn "sport = :${PORT}" >&2 || true
    netstat -ltnp 2>/dev/null | grep ":${PORT}" || true
    exit 1
  fi
else
  echo "  ✔ پورت ${PORT} آزاد است (درگاه وب: فقط 127.0.0.1:${PORT})"
fi

# ۵) اجرا — مهاجرت، سرویس‌ها، درگاه (و رسانه/TURN بر اساس پروفایل‌های .env)
echo "── ساخت و اجرای کانتینرها ──"
docker compose up -d --build

# ۶) دروازه موفقیت: مهاجرت موفق + همه سرویس‌های فعال healthy
if daniar_gate_success 300; then
  echo "── وضعیت سرویس‌ها ──"
  docker compose ps
  echo
  echo "✔ دانیار آماده است — تنها درگاه وب: http://127.0.0.1:${PORT} (روی میزبان فقط loopback)"
  echo "  پورت‌های ضروری رسانه (جدا از درگاه وب): 7882/udp و 7881/tcp — در پروفایل turn: 3478، 5349، رله 49160-49200"
  echo "  در DirectAdmin پراکسی دامنه را به همین آدرس وصل کنید (deploy/directadmin-*.conf — مسیرهای /socket.io و /rtc و /twirp هم)"
  echo "  لاگ زنده: docker compose logs -f"
  echo "  به‌روزرسانی آینده: bash scripts/update.sh"
else
  daniar_fail_hint
  exit 1
fi
