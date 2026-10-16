#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# گزارش سلامت داده‌های دانیار — هر زمان قابل اجراست
#   • یکپارچگی دیتابیس  • شمارش داده‌های حیاتی (مدارس/کلاس‌ها/…)
#   • فهرست پشتیبان‌های خودکار داخل ولوم (/data/backups)
# استفاده:  bash scripts/verify-data.sh
# ─────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."

echo "── یکپارچگی دیتابیس ──"
INTEGRITY="$(docker compose exec -T web sqlite3 /data/daniar.db 'PRAGMA integrity_check;' 2>/dev/null || true)"
[ "$INTEGRITY" = "ok" ] && echo "  ✔ ok" || { echo "  ✘ ${INTEGRITY:-دسترس به دیتابیس ممکن نیست (سرویس web روشن است؟)}" >&2; exit 1; }

echo "── شمارش داده‌های حیاتی ──"
COUNTS_SQL="SELECT (SELECT count(*) FROM School)||','||(SELECT count(*) FROM Classroom)||','||(SELECT count(*) FROM SubjectGroup)||','||(SELECT count(*) FROM User)||','||(SELECT count(*) FROM Message);"
COUNTS="$(docker compose exec -T web sqlite3 /data/daniar.db "$COUNTS_SQL" 2>/dev/null || true)"
if [ -n "$COUNTS" ]; then
  IFS=',' read -ra C <<< "$COUNTS"
  M=(مدارس کلاس‌ها گروه‌ها کاربران پیام‌ها)
  for i in "${!M[@]}"; do echo "  ${M[$i]}: ${C[$i]:-?}"; done
else
  echo "  ⚠ خواندن شمارش‌ها ناموفق بود"
fi

echo "── پشتیبان‌های خودکار داخل ولوم (/data/backups) ──"
docker compose exec -T web sh -c 'ls -1ht /data/backups/pre-migrate-*.db 2>/dev/null || echo "  (هنوز پشتیبانی ثبت نشده — پس از اولین آپدیت ساخته می‌شود)"'
echo "✔ گزارش کامل شد"
