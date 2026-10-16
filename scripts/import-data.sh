#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# انتقال اولیه امن داده‌های موجود (دیتابیس + آپلودهای محیط توسعه)
# به ولوم پایدار Docker — پیش از اولین «docker compose up» یا با سرویس‌های متوقف.
# استفاده:  bash scripts/import-data.sh <db/custom.db> [uploads]
#
# قواعد ایمنی:
#   • انتقال اولیه به «مقصد غیرخالی» (دیتابیس واقعی روی ولوم) متوقف می‌شود
#     و داده‌های موجود حفظ می‌شوند — مگر DANIAR_ALLOW_OVERWRITE=1 (آگاهانه)
#   • یکپارچگی دیتابیس منبع پیش از هر کاری اعتبارسنجی می‌شود
#   • اجرای shell با ایمیج پروژه: entrypoint صریحاً جایگزین می‌شود
#     (ENTRYPOINT ایمیج daniar:local خودِ docker-entrypoint.sh است؛ بدون
#     --entrypoint، پارامترهای sh به‌عنوان حالت نامعتبر رد می‌شدند)
#   • کانتینر کمکی با کاربر root اجرا می‌شود تا فارغ از مالکیت فعلی ولوم
#     بتواند بخواند/بنویسد؛ در پایان مالکیت به کاربر سرویس (10001) برمی‌گردد
#   • مقصد غیرخالی بدون مجوز بازنویسی نمی‌شود؛ ناخوانایی مقصد = خطای صریح
# ─────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."

SRC_DB="${1:?مسیر دیتابیس منبع را بدهید (مثلاً db/custom.db)}"
SRC_UP="${2:-uploads}"
[ -f "$SRC_DB" ] || { echo "✘ فایل دیتابیس منبع یافت نشد: $SRC_DB" >&2; exit 1; }
[ -d "$SRC_UP" ] || SRC_UP=""

echo "منبع: $SRC_DB ${SRC_UP:+(+ $SRC_UP)}"

# ایمیج کمکی: ترجیحاً خود ایمیج پروژه (sqlite3 داخلی دارد، بدون نیاز به شبکه)
HELPER_IMG="daniar:local"
if docker image inspect "$HELPER_IMG" >/dev/null 2>&1; then
  # ایمیج پروژه ENTRYPOINT و USER غیر root دارد — هر دو صریحاً کنترل می‌شوند
  HELPER_ARGS=(--entrypoint /bin/sh --user 0:0)
else
  HELPER_IMG="alpine:3.20"
  HELPER_ARGS=(--entrypoint /bin/sh --user 0:0)
  echo "ℹ ایمیج daniar:local هنوز ساخته نشده — کانتینر کمکی alpine:3.20 (نیاز به دانلود بسته sqlite3)"
fi

echo "── بررسی یکپارچگی دیتابیس منبع (کانتینر کمکی) ──"
docker run --rm "${HELPER_ARGS[@]}" -v "$PWD:/src:ro" "$HELPER_IMG" -c '
  command -v sqlite3 >/dev/null 2>&1 || apk add --no-cache sqlite3 >/dev/null 2>&1
  sqlite3 "/src/'"$SRC_DB"'" "PRAGMA integrity_check;"
' | grep -q "^ok$" || { echo "✘ دیتابیس منبع سالم نیست — انتقال انجام نشد" >&2; exit 1; }
echo "  ✔ دیتابیس منبع سالم است"

# ─── گارد مقصد غیرخالی: داده‌های موجود هرگز بی‌اجازه جایگزین نمی‌شوند ───
# نکته: ناخوانایی مقصد (مالکیت/مجوز) نباید به‌اشتباه «empty» گزارش شود —
# هر خطای خواندن = توقف با پیام صریح؛ کانتینر کمکی root است تا واقعاً بخواند.
DEST_HAS_DATA="$(docker run --rm "${HELPER_ARGS[@]}" -v daniar_data:/data "$HELPER_IMG" -c '
  command -v sqlite3 >/dev/null 2>&1 || apk add --no-cache sqlite3 >/dev/null 2>&1
  if [ ! -d /data ]; then
    echo "empty"
    exit 0
  fi
  if [ -f /data/daniar.db ] && [ -s /data/daniar.db ]; then
    if ! sqlite3 /data/daniar.db "SELECT count(*) FROM sqlite_master LIMIT 1;" >/dev/null 2>&1; then
      echo "unreadable"
      exit 0
    fi
    n=$(sqlite3 /data/daniar.db "SELECT count(*) FROM sqlite_master WHERE type='"'"'table'"'"' AND name NOT LIKE '"'"'sqlite_%'"'"';" 2>/dev/null || echo 0)
    u=0
    has=$(sqlite3 /data/daniar.db "SELECT count(*) FROM sqlite_master WHERE type='"'"'table'"'"' AND name='"'"'User'"'"';" 2>/dev/null || echo 0)
    [ "$has" -gt 0 ] 2>/dev/null && u=$(sqlite3 /data/daniar.db "SELECT count(*) FROM \"User\";" 2>/dev/null || echo 0)
    echo "tables=$n users=$u"
  else
    echo "empty"
  fi
')"
echo "وضعیت مقصد (ولوم daniar_data): $DEST_HAS_DATA"
case "$DEST_HAS_DATA" in
  unreadable)
    echo "✘ مقصد خوانده نشد — دیتابیس موجود روی ولوم ناسالم یا غیرقابل‌دسترس است؛ انتقال انجام نشد." >&2
    echo "  ابتدا وضعیت ولوم را بررسی کنید (docker volume inspect daniar_data) یا از restore.sh استفاده کنید." >&2
    exit 1 ;;
  empty) echo "  مقصد خالی است — انتقال بدون مانع ادامه می‌یابد." ;;
  *)
    DEST_USERS="$(echo "$DEST_HAS_DATA" | sed -n 's/.*users=\([0-9]*\).*/\1/p')"
    if [ "${DEST_USERS:-0}" -gt 0 ] && [ "${DANIAR_ALLOW_OVERWRITE:-0}" != "1" ]; then
      echo "✘ مقصد غیرخالی است (جدول User دارای $DEST_USERS کاربر) — انتقال اولیه متوقف شد تا داده‌های موجود حفظ شوند." >&2
      echo "  • برای جایگزینی آگاهانه: DANIAR_ALLOW_OVERWRITE=1 bash scripts/import-data.sh …" >&2
      echo "    (نسخه فعلی آن‌وقت در /data/daniar.db.prev حفظ می‌شود)" >&2
      echo "  • برای بازیابی استاندارد از پشتیبان: scripts/restore.sh" >&2
      exit 1
    fi
    echo "⚠ مقصد دیتابیس دارد ولی خالی از کاربر است — ادامه مجاز است (نسخه فعلی در .prev حفظ می‌شود)."
    ;;
esac

if [ "$DEST_HAS_DATA" != "empty" ]; then
  echo "⚠ اگر ولوم از قبل دیتای تولیدی دارد، دیتابیس فعلی در /data/daniar.db.prev نگه داشته می‌شود."
fi
read -r -p "ادامه؟ [y/N] " OK
[ "${OK:-n}" = "y" ] || exit 1

# سرویس‌های نویسنده متوقف باشند تا فایل کپی نیمه‌کاره نشود
docker compose ps -q web 2>/dev/null | grep -q . && {
  echo "── توقف web و socket ──"
  docker compose stop web socket
}

echo "── کپی امن به ولوم (کانتینر کمکی یک‌بارمصرف) ──"
docker run --rm \
  "${HELPER_ARGS[@]}" \
  -v "$PWD:/src:ro" \
  -v daniar_data:/data \
  "$HELPER_IMG" -c '
    set -e
    command -v sqlite3 >/dev/null 2>&1 || apk add --no-cache sqlite3 >/dev/null 2>&1
    if [ -f /data/daniar.db ] && [ -s /data/daniar.db ]; then
      cp /data/daniar.db /data/daniar.db.prev
      echo "• نسخه قبلی → /data/daniar.db.prev"
    fi
    cp "/src/'"$SRC_DB"'" /data/daniar.db
    rm -f /data/daniar.db-wal /data/daniar.db-shm 2>/dev/null || true
    if [ -n "'"$SRC_UP"'" ] && [ -d "/src/'"$SRC_UP"'" ]; then
      mkdir -p /data/uploads
      cp -r "/src/'"$SRC_UP"'"/. /data/uploads/
    fi
    # مالکیت/مجوز: کاربر سرویس (10001) باید روی ولوم بنویسد — کمکی root است
    # و مالکیت را کامل به 10001 برمی‌گرداند؛ مجوز نوشتن عمومی بسته می‌ماند.
    chown -R 10001:10001 /data
    chmod 700 /data
    touch /data/.perms-ok
    chown 10001:10001 /data/.perms-ok
    echo "• یکپارچگی مقصد: $(sqlite3 /data/daniar.db "PRAGMA integrity_check;")"
    echo "✔ انتقال کامل شد (مالکیت: 10001:10001)"
  '

echo
echo "مرحله بعد: bash scripts/deploy.sh"
echo "(استقرار، مهاجرت‌های pending را فقط با تأیید تطابق schema اعمال می‌کند و موفقیت را پس از سلامت همه سرویس‌ها اعلام می‌کند)"
