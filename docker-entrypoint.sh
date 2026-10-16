#!/bin/sh
# راه‌انداز دانیار — سه حالت مجزا (هر کدام یک پراسس، بدون پس‌زمینه):
#   migrate → اعمال مهاجرت‌های ایمن + اطمینان از حساب مدیر کل (سپس خروج)
#   web     → سرور Next.js (کاربر غیر root)
#   socket  → سرویس Socket.IO (کاربر غیر root)
#
# قواعد ایمنی داده:
#   • پیش از هر تغییر دیتابیس، پشتیبان آنلاین گرفته می‌شود (سپر داده)
#   • وضعیت پایه (baseline) فقط پس از تأیید تطابق واقعی schema دیتابیس موجود
#     با یکی از وضعیت‌های زنجیره مهاجرت‌ها ثبت می‌شود (diff پیشوندی)
#   • ثبت وضعیت پایه هرگز داده‌ای تغییر نمی‌دهد؛ دیتابیس غیرمطابق = توقف کامل
set -e

MODE="${1:-web}"
DB_PATH="${DATABASE_URL#file:}"
DATA_DIR="$(dirname "$DB_PATH")"

case "$MODE" in
  migrate)
    mkdir -p "$DATA_DIR/uploads" "$DATA_DIR/backups"

    PRISMA="node node_modules/prisma/build/index.js"
    MIGDIR="prisma/migrations"

    # ─── سپر داده: پیش از هرگونه تغییر دیتابیس (حتی baseline) یک پشتیبان آنلاین امن ───
    # هر به‌روزرسانی/راه‌اندازیِ مهاجرت‌دار، اول یک تصویر لحظه‌ای سالم داخل خود ولوم می‌سازد؛
    # حتی اگر مالک بدون scripts/update.sh آپدیت کند، داده‌ها قابل بازیابی می‌مانند.
    if [ -s "$DB_PATH" ] && [ "${DANIAR_SKIP_PRE_MIGRATE_BACKUP:-0}" != "1" ]; then
      STAMP="$(date +%Y%m%d-%H%M%S)"
      SNAP="$DATA_DIR/backups/pre-migrate-$STAMP.db"
      echo "[daniar] سپر داده — پشتیبان خودکار پیش از مهاجرت → $SNAP …"
      if sqlite3 "$DB_PATH" ".backup '$SNAP'" \
         && [ "$(sqlite3 "$SNAP" 'PRAGMA integrity_check;')" = "ok" ]; then
        echo "[daniar] ✔ پشتیبان پیش از مهاجرت سالم ثبت شد (۷ نسخه آخر نگه داشته می‌شوند)"
        ls -1t "$DATA_DIR"/backups/pre-migrate-*.db 2>/dev/null | tail -n +8 | xargs -r rm -f
      else
        rm -f "$SNAP" 2>/dev/null || true
        echo "[daniar] ✘ ساخت پشتیبان پیش از مهاجرت ناموفق بود — برای محافظت از داده‌ها مهاجرت متوقف شد." >&2
        echo "[daniar]   فضای دیسک ولوم را بررسی کنید؛ در صورت اطمینان، فقط یک‌بار و آگاهانه با" >&2
        echo "[daniar]   DANIAR_SKIP_PRE_MIGRATE_BACKUP=1 می‌توانید این سپر را رد کنید (توصیه نمی‌شود)." >&2
        exit 1
      fi
    fi

    if [ -f "$DB_PATH" ]; then
      # دیتابیس موجود که با db push ساخته شده و جدول مهاجرت ندارد → وضعیت پایه
      TABLES=$(sqlite3 "$DB_PATH" "SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';")
      HAS_MIG=$(sqlite3 "$DB_PATH" "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='_prisma_migrations';")
      if [ "$TABLES" -gt 0 ] && [ "$HAS_MIG" = "0" ]; then
        if [ "${DANIAR_BASELINE_FORCE:-0}" = "1" ]; then
          echo "[daniar] ⚠ DANIAR_BASELINE_FORCE=1 — ثبت همه مهاجرت‌ها به‌عنوان اعمال‌شده بدون تأیید ساختار (مسئولیت با اجراکننده)…"
          for m in $(ls -1d "$MIGDIR"/*/ | sort); do
            $PRISMA migrate resolve --applied "$(basename "$m")"
          done
        else
          echo "[daniar] دیتابیس موجود بدون جدول مهاجرت — تطابق واقعی schema با زنجیره مهاجرت‌ها بررسی می‌شود…"
          TMPD="$DATA_DIR/.baseline-check"
          rm -rf "$TMPD"; mkdir -p "$TMPD"
          MIGS="$(ls -1d "$MIGDIR"/*/ | sort)"
          MATCHED=""; MATCHN=0
          i=0
          for m in $MIGS; do
            i=$((i+1))
            SHADOW="$TMPD/shadow-$i.db"
            # ساخت وضعیت پایه پیشوندی: اعمال مهاجرت‌های ۱..i روی دیتابیس خالیِ موقت
            j=0
            for m2 in $MIGS; do
              j=$((j+1))
              sqlite3 "$SHADOW" < "$m2/migration.sql"
              [ "$j" -ge "$i" ] && break
            done
            if $PRISMA migrate diff --from-url "file:$SHADOW" --to-url "file:$DB_PATH" --exit-code >/dev/null 2>&1; then
              MATCHED="$m"; MATCHN="$i"
              break
            fi
          done
          if [ -z "$MATCHED" ]; then
            echo "[daniar] ✘ ساختار دیتابیس موجود با هیچ وضعیت پایه‌ای از مهاجرت‌ها مطابقت ندارد." >&2
            echo "[daniar]   برای حفظ داده‌ها، مهاجرت متوقف شد — هیچ تغییری اعمال نشده است." >&2
            echo "[daniar]   گزینه‌ها:" >&2
            echo "[daniar]    • بازیابی از پشتیبان هم‌نسخه: scripts/restore.sh" >&2
            echo "[daniar]    • اگر مطمئنید دیتابیس متعلق به همین پروژه است: DANIAR_BASELINE_FORCE=1" >&2
            echo "[daniar]      (ثبت همه مهاجرت‌ها بدون تأیید ساختار — توصیه نمی‌شود)" >&2
            rm -rf "$TMPD"
            exit 1
          fi
          echo "[daniar] ✔ تطابق کامل با وضعیت پایه «$(basename "$MATCHED")» — ثبت مهاجرت‌های ۱..$MATCHN (بدون هیچ تغییر روی داده)…"
          k=0
          for m in $MIGS; do
            k=$((k+1))
            [ "$k" -gt "$MATCHN" ] && break
            $PRISMA migrate resolve --applied "$(basename "$m")"
          done
          rm -rf "$TMPD"
        fi
      fi
    fi
    echo "[daniar] اعمال مهاجرت‌های Prisma (deploy — هرگز داده حذف/تغییر نمی‌کند)…"
    $PRISMA migrate deploy

    echo "[daniar] اطمینان از حساب مدیر کل (رمز فقط از تنظیمات مالک؛ حساب‌های موجود تغییر نمی‌کنند)…"
    node prisma/seed.mjs
    echo "[daniar] مهاجرت‌ها کامل شد."
    ;;

  web)
    echo "[daniar] اجرای Next.js روی :3000 (کاربر غیر root)…"
    exec node server.js
    ;;

  socket)
    echo "[daniar] اجرای سرویس Socket.IO روی :3003 (کاربر غیر root)…"
    exec node socket-server.mjs
    ;;

  *)
    echo "[daniar] حالت نامعتبر: '$MODE' — از migrate | web | socket استفاده کنید" >&2
    exit 1
    ;;
esac
