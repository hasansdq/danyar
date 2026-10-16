#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# پشتیبان‌گیری دانیار — دیتابیس (بکاپ آنلاین سازگار SQLite) + آپلودها
# استفاده:  bash scripts/backup.sh [مسیر خروجی — پیش‌فرض ./backups]
# ─────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."

STAMP="$(date +%F-%H%M%S)"
DIR="${1:-./backups}"
mkdir -p "$DIR"

# web باید واقعاً در حال اجرا باشد (exec روی کانتینر متوقف مجاز نیست)
WEB_RUNNING="$(docker compose ps -q web 2>/dev/null | head -1)"
[ -n "$WEB_RUNNING" ] || { echo "✘ سرویس‌ها اجرا نیستند — docker compose up -d" >&2; exit 1; }
WSTATE="$(docker inspect --format '{{.State.Status}}' "$WEB_RUNNING" 2>/dev/null || echo unknown)"
[ "$WSTATE" = "running" ] || { echo "✘ سرویس web در حال اجرا نیست (وضعیت: $WSTATE) — docker compose up -d" >&2; exit 1; }

echo "── پشتیبان دیتابیس (آنلاین، بدون توقف سرویس) ──"
CHECK=$(docker compose exec -T web sh -c "sqlite3 /data/daniar.db '.backup /tmp/daniar-backup.db' && sqlite3 /tmp/daniar-backup.db 'PRAGMA integrity_check;'")
echo "$CHECK" | grep -q '^ok$' || { echo "✘ بکاپ از بررسی یکپارچگی رد شد: $CHECK" >&2; exit 1; }
docker compose cp web:/tmp/daniar-backup.db "$DIR/daniar-db-$STAMP.db" >/dev/null
docker compose exec -T web rm -f /tmp/daniar-backup.db
echo "  ✔ $DIR/daniar-db-$STAMP.db ($(du -h "$DIR/daniar-db-$STAMP.db" | cut -f1))"

echo "── پشتیبان آپلودها ──"
docker compose exec -T web sh -c "tar czf /tmp/daniar-uploads.tar.gz -C /data uploads"
docker compose cp web:/tmp/daniar-uploads.tar.gz "$DIR/daniar-uploads-$STAMP.tar.gz" >/dev/null
docker compose exec -T web rm -f /tmp/daniar-uploads.tar.gz
echo "  ✔ $DIR/daniar-uploads-$STAMP.tar.gz ($(du -h "$DIR/daniar-uploads-$STAMP.tar.gz" | cut -f1))"

echo "✔ پشتیبان کامل شد — $STAMP"
echo "  بازیابی: bash scripts/restore.sh $DIR/daniar-db-$STAMP.db $DIR/daniar-uploads-$STAMP.tar.gz"
