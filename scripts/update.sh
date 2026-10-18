#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# به‌روزرسانی دانیار — بدون حذف داده، بدون توقف سرویس دیگر، بدون
# نیاز به آزادسازی پورت 3034 (اشغال پورت توسط همین پروژه مانع آپدیت نیست؛
# کانتینرها جایگزین می‌شوند).
# ⚠ این اسکریپت مسیر «آپدیت» است؛ استقرار اولیه با scripts/deploy.sh جدا شده.
#
# ولوم daniar_data دست‌نخورده می‌ماند؛ مهاجرت‌های جدید با
# «prisma migrate deploy» (غیرمخرب) در سرویس migrate اعمال می‌شوند.
# زنجیره ایمنی داده در هر آپدیت:
#   ۱) پشتیبان کامل (دیتابیس + آپلودها) روی میزبان
#   ۲) شمارش داده‌های حیاتی پیش از آپدیت
#   ۳) بیلد و جایگزینی سرویس‌ها (سپر داده داخلی خود entrypoint هم فعال است)
#   ۴) مقایسه شمارش‌ها پس از آپدیت — کاهش هر شمارنده = خطای صریح
#   ۵) اعلام موفقیت فقط پس از مهاجرت موفق و healthy‌بودن همه سرویس‌های فعال
# استفاده:  bash scripts/update.sh
# ─────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/_common.sh

COUNTS_SQL="SELECT (SELECT count(*) FROM School)||','||(SELECT count(*) FROM Classroom)||','||(SELECT count(*) FROM SubjectGroup)||','||(SELECT count(*) FROM User)||','||(SELECT count(*) FROM Message);"
METRICS=(مدارس کلاس‌ها گروه‌ها کاربران پیام‌ها)

echo "── ۱) پشتیبان خودکار پیش از به‌روزرسانی ──"
bash scripts/backup.sh ./backups || {
  echo "✘ پشتیبان‌گیری ناموفق بود؛ برای حفظ داده‌ها آپدیت متوقف شد." >&2
  exit 1
}

echo "── ۲) شمارش داده‌های حیاتی پیش از آپدیت ──"
BEFORE=""
if docker compose exec -T web sqlite3 /data/daniar.db "$COUNTS_SQL" >/dev/null 2>&1; then
  BEFORE="$(docker compose exec -T web sqlite3 /data/daniar.db "$COUNTS_SQL" 2>/dev/null || true)"
fi
if [ -n "$BEFORE" ]; then
  IFS=',' read -ra B <<< "$BEFORE"
  for i in "${!METRICS[@]}"; do
    echo "  ${METRICS[$i]}: ${B[$i]:-?}"
  done
else
  echo "  ⚠ سرویس web در دسترس نیست — شمارش پیش از آپدیت رد شد (استقرار اولیه؟ به scripts/deploy.sh)"
fi

echo "── ۳) بیلد نسخه جدید ──"
docker compose build

echo "── ۴) جایگزینی سرویس‌ها (مهاجرتِ ایمن خودکار در سرویس migrate) ──"
# پورت 3034 توسط پروکسی خود پروژه اشغال است — compose کانتینرها را
# جایگزین می‌کند و نیازی به آزادشدن پورت نیست؛ هیچ سرویس دیگری لمس نمی‌شود.
docker compose up -d

echo "── ۵) راستی‌آزمایی حفظ داده‌ها ──"
if [ -n "$BEFORE" ]; then
  AFTER=""
  for _ in $(seq 1 30); do
    AFTER="$(docker compose exec -T web sqlite3 /data/daniar.db "$COUNTS_SQL" 2>/dev/null || true)"
    [ -n "$AFTER" ] && break
    sleep 2
  done
  if [ -z "$AFTER" ]; then
    echo "  ✘ خواندن شمارش‌ها پس از آپدیت ناموفق بود — وضعیت را با «docker compose logs» بررسی کنید." >&2
    echo "  پشتیبان مرحله ۱ در ./backups موجود است (بازیابی: scripts/restore.sh)." >&2
    exit 1
  fi
  IFS=',' read -ra B <<< "$BEFORE"
  IFS=',' read -ra A <<< "$AFTER"
  DECREASED=()
  for i in "${!METRICS[@]}"; do
    BV="${B[$i]:-0}"; AV="${A[$i]:-0}"
    if [ "$AV" -lt "$BV" ] 2>/dev/null; then
      DECREASED+=("${METRICS[$i]}: $BV → $AV")
    fi
  done
  INTEGRITY="$(docker compose exec -T web sqlite3 /data/daniar.db 'PRAGMA integrity_check;' 2>/dev/null || true)"
  echo "  یکپارچگی دیتابیس: ${INTEGRITY:-نامشخص}"
  if [ "$INTEGRITY" != "ok" ]; then
    echo "  ✘ یکپارچگی دیتابیس تأیید نشد؛ آپدیت موفق اعلام نمی‌شود. پشتیبان مرحله ۱ را حفظ کنید." >&2
    exit 1
  fi
  if [ "${#DECREASED[@]}" -gt 0 ]; then
    echo "  ✘ هشدار جدی — این شمارنده‌ها کاهش یافته‌اند:" >&2
    for d in "${DECREASED[@]}"; do echo "     - $d" >&2; done
    echo "  هیچ مهاجرت استانداردی داده حذف نمی‌کند؛ این وضعیت غیرمنتظره است." >&2
    echo "  فوراً سرویس‌ها را بررسی کنید و در صورت نیاز از پشتیبان مرحله ۱ بازیابی کنید:" >&2
    echo "    bash scripts/restore.sh ./backups/daniar-db-<زمان>.db" >&2
    exit 1
  fi
  echo "  ✔ هیچ داده‌ای از دست نرفته است (قبل: $BEFORE / بعد: $AFTER)"
fi

echo "── ۶) دروازه نهایی: مهاجرت موفق + سلامت همه سرویس‌های فعال ──"
if daniar_gate_success 300; then
  echo "── وضعیت ──"
  docker compose ps
  echo "✔ به‌روزرسانی کامل شد — داده‌ها روی ولوم daniar_data حفظ شده‌اند."
  echo "  پشتیبان‌ها: ./backups (میزبان) و /data/backups (داخل ولوم — ۷ نسخه آخر پیش از هر مهاجرت)"
else
  daniar_fail_hint
  exit 1
fi
