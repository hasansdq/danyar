#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# بازیابی دانیار از پشتیبان — تراکنشی (همه‌یا‌هیچ)
# استفاده:  bash scripts/restore.sh <daniar-db-….db> [daniar-uploads-….tar.gz]
#
# تضمین‌های این نسخه:
#   ① هیچ تغییری پیش از تأیید کامل بکاپ (یکپارچگی دیتابیس + آرشیو آپلودها)
#      شروع نمی‌شود — خطای اعتبارسنجی = انصراف کامل، سرویس‌ها هرگز لمس نمی‌شوند
#   ② پیش از هر جایگزینی، «محل بازگشت» ساخته می‌شود: تصویر کامل دیتابیس فعلی
#      (db+wal+shm با checkpoint) + انتقال rename-اتمیک آپلودهای فعلی
#   ③ در هر خطای میانی (جایگزینی، مهاجرت، سلامت سرویس‌ها) نسخه قبلی دیتابیس
#      و آپلودها به‌صورت کامل و راستی‌آزمایی‌شده برمی‌گردد
#   ④ اگر بازیابی شکست خورد سرویس‌ها متوقف می‌مانند — هیچ cleanup هرگز سرویس‌ها
#      را با داده ناقص روشن نمی‌کند؛ خطای واضح با وضعیت داده و دستور راه‌اندازی
#      دستی نمایش داده می‌شود
#   ⑤ موفقیت فقط پس از مهاجرت موفق (کد خروج ۰) و healthy‌بودن همه سرویس‌های
#      فعال اعلام می‌شود
#   ⑥ قفل هم‌زمانی: دو بازیابی موازی ممکن نیست
#
# متغیرهای محیطی:
#   DANIAR_RESTORE_YES=1        رد شدن از تأیید تعاملی (اتوماسیون)
#   DANIAR_RESTORE_FORCE=1      حذف قفل مانده از اجرای قبلی
#   DANIAR_DATA_ROOT / DANIAR_HELPER_TMP   (فقط برای تست — پیش‌فرض /data و /tmp)
# ─────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/_common.sh

DATA_ROOT="${DANIAR_DATA_ROOT:-/data}"
HELPER_TMP="${DANIAR_HELPER_TMP:-/tmp}"
DB="${1:?مسیر فایل بکاپ دیتابیس را بدهید}"
UP="${2:-}"
UP_PROVIDED=0
[ -n "$UP" ] && UP_PROVIDED=1

fail() { echo "✘ $1" >&2; exit 1; }
[ -f "$DB" ] || fail "فایل دیتابیس یافت نشد: $DB"
if [ "$UP_PROVIDED" = "1" ] && [ ! -f "$UP" ]; then fail "فایل آپلودها یافت نشد: $UP"; fi

HELPER="daniar-restore-helper"
HELPER_IMG="daniar:local"
LOCKDIR="${TMPDIR:-/tmp}/daniar-restore.lock"

SUCCESS=0
SERVICES_STOPPED=0
HELPER_UP=0

# ─── قفل هم‌زمانی ───
if [ "${DANIAR_RESTORE_FORCE:-0}" = "1" ]; then rm -rf "$LOCKDIR" 2>/dev/null || true; fi
mkdir "$LOCKDIR" 2>/dev/null || fail "بازیابی دیگری در حال اجراست ($LOCKDIR) — اگر مطمئنید اجرای دیگری نیست: DANIAR_RESTORE_FORCE=1"

cleanup() {
  local rc=$?
  trap - EXIT
  if [ "$HELPER_UP" = "1" ]; then docker rm -f "$HELPER" >/dev/null 2>&1 || true; fi
  rm -rf "$LOCKDIR" 2>/dev/null || true
  if [ "$SUCCESS" != "1" ] && [ "$SERVICES_STOPPED" = "1" ]; then
    echo "" >&2
    echo "════════════════════════════════════════════════" >&2
    echo "  ✘ بازیابی ناموفق بود — وضعیت نهایی:" >&2
    if [ "${ROLLBACK_DONE:-0}" = "1" ]; then
      echo "  • دیتابیس و آپلودهای قبلی به‌صورت کامل بازگردانده شدند." >&2
    else
      echo "  • به داده‌های فعلی دست نزده شده است (نسخه قبلی جای خود است)." >&2
    fi
    echo "  • سرویس‌ها عمداً متوقف مانده‌اند — با داده‌های مشکوک روشن نمی‌شوند." >&2
    echo "  • پس از رفع مشکل، راه‌اندازی دستی:  docker compose up -d" >&2
    echo "════════════════════════════════════════════════" >&2
  fi
  exit "$rc"
}
trap cleanup EXIT

echo "⚠ بازیابی، دیتابیس فعلی (و در صورت دادن آرشیو، آپلودها) را جایگزین می‌کند."
echo "  نسخه فعلی پیش از هر تغییری در محل بازگشت داخل ولوم ذخیره می‌شود."
if [ "${DANIAR_RESTORE_YES:-0}" != "1" ]; then
  read -r -p "ادامه؟ [y/N] " OK
  [ "${OK:-n}" = "y" ] || exit 1
fi

docker image inspect "$HELPER_IMG" >/dev/null 2>&1 || \
  fail "ایمیج $HELPER_IMG یافت نشد — ابتدا «docker compose build» یا deploy.sh را اجرا کنید"

# ─── ۱) کانتینر کمکی (در حال اجرا) + انتقال بکاپ‌ها ───
echo "── ۱) آماده‌سازی کانتینر کمکی و انتقال بکاپ‌ها ──"
docker rm -f "$HELPER" >/dev/null 2>&1 || true
docker run -d --name "$HELPER" \
  --entrypoint sleep \
  --user 0:0 \
  -v daniar_data:/data \
  "$HELPER_IMG" infinity >/dev/null
HELPER_UP=1

docker cp "$DB" "$HELPER:$HELPER_TMP/restore.db" >/dev/null
if [ "$UP_PROVIDED" = "1" ]; then
  docker cp "$UP" "$HELPER:$HELPER_TMP/restore-uploads.tar.gz" >/dev/null
fi

# ─── ۲) اعتبارسنجی کامل بکاپ (سرویس‌ها هنوز روشن‌اند — خطا = انصراف بی‌آسیب) ───
echo "── ۲) اعتبارسنجی بکاپ دیتابیس ──"
CHK="$(docker exec "$HELPER" sh -c "sqlite3 $HELPER_TMP/restore.db 'PRAGMA integrity_check;'")" || CHK=""
[ "$CHK" = "ok" ] || fail "بکاپ سالم نیست: ${CHK:-غیرقابل‌خواندن} — انصراف بدون هیچ تغییری (سرویس‌ها دست‌نخورده روشن ماندند)"
CORE="$(docker exec "$HELPER" sh -c "sqlite3 $HELPER_TMP/restore.db \"SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('User','School','Message','Classroom');\"")" || CORE=""
[ "${CORE:-0}" -ge 4 ] 2>/dev/null || fail "بکاپ جدول‌های حیاتی را ندارد (یافته‌شده: ${CORE:-0} از ۴) — انصراف"
DBSZ="$(docker exec "$HELPER" sh -c "wc -c < $HELPER_TMP/restore.db")" || DBSZ="?"
echo "  ✔ یکپارچگی ok + ۴ جدول حیاتی موجود ($DBSZ بایت)"

if [ "$UP_PROVIDED" = "1" ]; then
  echo "── ۳) اعتبارسنجی آرشیو آپلودها (مسیرها، لینک‌ها، نوع فایل‌ها) ──"
  if ! docker exec "$HELPER" sh -c "
    set -e
    T=$HELPER_TMP
    tar tzf \$T/restore-uploads.tar.gz >/dev/null 2>&1 || { echo \"✘ آرشیو قابل بازکردن نیست\" >&2; exit 1; }
    tar tvzf \$T/restore-uploads.tar.gz > \$T/archive-listing.txt
    NENT=\$(wc -l < \$T/archive-listing.txt)
    [ \"\$NENT\" -gt 0 ] 2>/dev/null || { echo \"✘ آرشیو خالی است\" >&2; exit 1; }
    # نوع: فقط فایل معمولی (-) و پوشه (d) — لینک/دستگاه/لوله/سوکت ممنوع
    BADTYPE=\$(grep -E '^[bclhps]' \$T/archive-listing.txt | head -5 || true)
    if [ -n \"\$BADTYPE\" ]; then
      echo \"✘ آرشیو شامل ورودی لینک/دستگاه/لوله است — انصراف:\" >&2
      echo \"\$BADTYPE\" | sed 's/^/     /' >&2
      exit 1
    fi
    # مسیر مطلق یا تراورسال (../)
    BADPATH=\$(grep -E '(^|[[:space:]])/' \$T/archive-listing.txt | head -5 || true)
    BADPATH2=\$(grep -E '(^|[[:space:]])[.][.]/|/[.][.]([[:space:]]|\$)' \$T/archive-listing.txt | head -5 || true)
    if [ -n \"\$BADPATH\" ] || [ -n \"\$BADPATH2\" ]; then
      echo \"✘ آرشیو شامل مسیر مطلق یا تراورسال (../) است — انصراف:\" >&2
      { echo \"\$BADPATH\"; echo \"\$BADPATH2\"; } | sed 's/^/     /' >&2
      exit 1
    fi
    # همه ورودی‌ها باید زیر uploads/ باشند
    OFFROOT=\$(sed -e 's/ -> .*//' \$T/archive-listing.txt | awk '{print \$NF}' | grep -v '^uploads/' | grep -v '^\$' | head -5 || true)
    if [ -n \"\$OFFROOT\" ]; then
      echo \"✘ آرشیو شامل ورودی خارج از پوشه uploads/ است — انصراف:\" >&2
      echo \"\$OFFROOT\" | sed 's/^/     /' >&2
      exit 1
    fi
    echo \"  ✔ آرشیو سالم است (\$NENT مدخل)\"
  "; then
    fail "اعتبارسنجی آرشیو ناموفق بود — انصراف بدون هیچ تغییری (سرویس‌ها دست‌نخورده روشن ماندند)"
  fi
fi

# ─── ۴) توقف سرویس‌ها (از این‌جا به بعد هر شکست = توقف کامل + بازگردانی) ───
echo "── ۴) توقف سرویس‌های پروژه (proxy، web، socket و پروفایل‌های فعال) ──"
docker compose stop >/dev/null 2>&1 || true
SERVICES_STOPPED=1

ROLLBACK_DONE=0
rollback_previous() {
  if docker exec \
       -e "DANIAR_DATA_ROOT=$DATA_ROOT" \
       "$HELPER" sh -c '
    set -e
    D="$DANIAR_DATA_ROOT"
    RB="$D/.restore-rollback"
    rm -rf "$D/.restore-staging"
    rm -f "$D/.daniar.db.new"
    if [ -f "$RB/db.done" ]; then
      rm -f "$D/daniar.db" "$D/daniar.db-wal" "$D/daniar.db-shm"
      mv "$RB/daniar.db" "$D/daniar.db"
      if [ -f "$RB/daniar.db-wal" ]; then mv "$RB/daniar.db-wal" "$D/daniar.db-wal"; fi
      if [ -f "$RB/daniar.db-shm" ]; then mv "$RB/daniar.db-shm" "$D/daniar.db-shm"; fi
      C="$(sqlite3 "$D/daniar.db" "PRAGMA integrity_check;")"
      if [ "$C" != "ok" ]; then echo "ROLLBACK-DB-BAD: $C" >&2; exit 1; fi
      echo "ROLLBACK-DB-OK"
    fi
    if [ -f "$RB/uploads.done" ]; then
      rm -rf "$D/uploads"
      if [ -d "$RB/uploads" ]; then mv "$RB/uploads" "$D/uploads"; fi
      echo "ROLLBACK-UPLOADS-OK"
    fi
    rm -rf "$RB"
    echo "ROLLBACK-COMPLETE"
  '; then
    ROLLBACK_DONE=1
    echo "  ✔ داده‌های قبلی کامل بازگردانده و راستی‌آزمایی شد"
    return 0
  else
    echo "  ✘✘ بازگردانی خودکار هم شکست خورد — وضعیت ولوم دستی بررسی شود:" >&2
    echo "     $DATA_ROOT/.restore-rollback  /  $DATA_ROOT/daniar.db  /  $DATA_ROOT/uploads" >&2
    return 1
  fi
}

# ─── ۵) تصویر وضعیت فعلی + جایگزینی همه‌یا‌هیچ ───
echo "── ۵) محل بازگشت و جایگزینی امن ──"
REPLACE_OK=0
if docker exec \
     -e "DANIAR_DATA_ROOT=$DATA_ROOT" \
     -e "DANIAR_HELPER_TMP=$HELPER_TMP" \
     -e "UP_PROVIDED=$UP_PROVIDED" \
     "$HELPER" sh -c '
  set -e
  D="$DANIAR_DATA_ROOT"
  T="$DANIAR_HELPER_TMP"
  RB="$D/.restore-rollback"
  ST="$D/.restore-staging"
  rm -rf "$RB" "$ST"
  mkdir -p "$RB"

  # تصویر کامل دیتابیس فعلی (db + wal +shm) — حتی اگر ناسالم باشد، «وضعیت قبلی» است
  if [ -f "$D/daniar.db" ]; then
    cp "$D/daniar.db" "$RB/daniar.db"
    if [ -f "$D/daniar.db-wal" ]; then cp "$D/daniar.db-wal" "$RB/daniar.db-wal"; fi
    if [ -f "$D/daniar.db-shm" ]; then cp "$D/daniar.db-shm" "$RB/daniar.db-shm"; fi
    sqlite3 "$RB/daniar.db" "PRAGMA wal_checkpoint(TRUNCATE);" >/dev/null 2>&1 || true
    C="$(sqlite3 "$RB/daniar.db" "PRAGMA integrity_check;")"
    if [ "$C" != "ok" ]; then
      echo "  ⚠ وضعیت فعلی دیتابیس ناسالم است ($C) — ادامه با حفظ همین نسخه در محل بازگشت" >&2
    fi
    touch "$RB/db.done"
    echo "  • نسخه فعلی دیتابیس در محل بازگشت ذخیره شد"
  fi

  if [ "$UP_PROVIDED" = "1" ]; then
    # انتقال rename-اتمیک آپلودهای فعلی به محل بازگشت
    if [ -d "$D/uploads" ]; then
      mv "$D/uploads" "$RB/uploads"
    fi
    touch "$RB/uploads.done"
    echo "  • آپلودهای فعلی به محل بازگشت منتقل شد"
  fi

  echo "  • جایگزینی دیتابیس (کپی → راستی‌آزمایی → rename اتمیک)…"
  cp "$T/restore.db" "$D/.daniar.db.new"
  C="$(sqlite3 "$D/.daniar.db.new" "PRAGMA integrity_check;")"
  if [ "$C" != "ok" ]; then
    echo "✘ کپی دیتابیس جدید سالم نیست: $C" >&2
    exit 1
  fi
  rm -f "$D/daniar.db-wal" "$D/daniar.db-shm"
  mv "$D/.daniar.db.new" "$D/daniar.db"
  echo "DB-REPLACED"

  if [ "$UP_PROVIDED" = "1" ]; then
    echo "  • استخراج آرشیو در محل موقت داخل ولوم و جایگزینی…"
    mkdir -p "$ST"
    tar xzf "$T/restore-uploads.tar.gz" -C "$ST"
    if [ ! -d "$ST/uploads" ]; then
      echo "✘ پس از استخراج، پوشه uploads در آرشیو نبود" >&2
      exit 1
    fi
    NFILES="$(find "$ST/uploads" -type f | wc -l)"
    mv "$ST/uploads" "$D/uploads"
    rm -rf "$ST"
    echo "UPLOADS-REPLACED ($NFILES فایل)"
  fi

  chown -R 10001:10001 "$D/daniar.db" 2>/dev/null || true
  if [ "$UP_PROVIDED" = "1" ]; then chown -R 10001:10001 "$D/uploads" 2>/dev/null || true; fi
  rm -f "$T/restore.db" "$T/restore-uploads.tar.gz"
  echo "REPLACE-COMPLETE"
'; then
  REPLACE_OK=1
  echo "  ✔ جایگزینی کامل و سالم انجام شد"
else
  echo "  ✘ جایگزینی ناموفق بود — بازگرداندن نسخه قبلی…" >&2
  rollback_previous || true
  fail "جایگزینی شکست خورد؛ نسخه قبلی دیتابیس و آپلودها کامل بازگشت (سرویس‌ها متوقف ماندند)"
fi

# ─── ۶) اجرای مجدد سرویس‌ها + دروازه مهاجرت/سلامت ───
echo "── ۶) اجرای مجدد سرویس‌ها (مهاجرت ایمن خودکار) ──"
docker compose up -d

GATE_TIMEOUT="${DANIAR_GATE_TIMEOUT:-300}"
if daniar_gate_success "$GATE_TIMEOUT"; then
  # نهایی‌سازی: نسخه «قبلی» دیتابیس به‌عنوان پشتیبان امنیتی prev + پاک‌سازی محل بازگشت
  docker exec -e "DANIAR_DATA_ROOT=$DATA_ROOT" "$HELPER" sh -c '
    set -e
    D="$DANIAR_DATA_ROOT"
    RB="$D/.restore-rollback"
    if [ -f "$RB/daniar.db" ]; then
      cp "$RB/daniar.db" "$D/daniar.db.prev"
      chown 10001:10001 "$D/daniar.db.prev" 2>/dev/null || true
    fi
    rm -rf "$RB" "$D/.restore-staging"
    rm -f "$D/.daniar.db.new"
  ' || true
  docker rm -f "$HELPER" >/dev/null 2>&1 || true
  HELPER_UP=0
  SUCCESS=1
  trap - EXIT
  rm -rf "$LOCKDIR" 2>/dev/null || true
  echo "── وضعیت سرویس‌ها ──"
  docker compose ps || true
  echo "✔ بازیابی کامل شد — مهاجرت موفق و همه سرویس‌های فعال healthy هستند."
  echo "  نسخه پیشین دیتابیس به‌عنوان پشتیبان امنیتی در $DATA_ROOT/daniar.db.prev حفظ شد."
  exit 0
else
  echo "  ✘ مهاجرت/سلامت سرویس‌ها پس از بازیابی تأیید نشد — توقف کامل و بازگردانی نسخه قبلی…" >&2
  docker compose stop >/dev/null 2>&1 || true
  rollback_previous || true
  daniar_fail_hint
  fail "بازیابی پس از مهاجرت/سلامت شکست خورد — داده‌های قبلی کامل برگشت و سرویس‌ها متوقف ماندند"
fi
