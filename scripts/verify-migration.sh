#!/bin/bash
# راستی‌آزمایی مهاجرت ایمن: (۱) دیتابیس تازه (۲) دیتابیس موجود — بدون هیچ تغییر مخرب داده
set -euo pipefail
cd /home/z/my-project

V=.verify-migration
rm -rf $V && mkdir -p $V

echo "── ۱) مسیر دیتابیس تازه ──"
DATABASE_URL="file:$PWD/$V/fresh.db" bunx prisma migrate deploy 2>&1 | tail -3
echo "جدول‌های ساخته‌شده: $(bun -e 'import {Database} from "bun:sqlite"; console.log(new Database(process.argv[1],{readonly:true}).query("SELECT count(*) c FROM sqlite_master WHERE type=\"table\" AND name NOT LIKE \"sqlite_%\"").get().c)' $V/fresh.db)"

echo "── ۲) مسیر دیتابیس موجود (baseline + deploy) ──"
cp db/custom.db $V/existing.db
bun -e '
import {Database} from "bun:sqlite"
const db = new Database(process.argv[1], {readonly: true})
const t = (n) => db.query(`SELECT count(*) c FROM "${n}"`).get().c
console.log("قبل  → users:", t("User"), "| messages:", t("Message"), "| schools:", t("School"), "| groups:", t("SubjectGroup"))
' $V/existing.db > $V/before.txt 2>&1
cat $V/before.txt

DATABASE_URL="file:$PWD/$V/existing.db" bunx prisma migrate resolve --applied 20251012000000_init 2>&1 | tail -2
DATABASE_URL="file:$PWD/$V/existing.db" bunx prisma migrate deploy 2>&1 | tail -3

bun -e '
import {Database} from "bun:sqlite"
const db = new Database(process.argv[1], {readonly: true})
const t = (n) => db.query(`SELECT count(*) c FROM "${n}"`).get().c
console.log("بعد  → users:", t("User"), "| messages:", t("Message"), "| schools:", t("School"), "| groups:", t("SubjectGroup"))
console.log("integrity:", db.query("PRAGMA integrity_check").get().integrity_check)
console.log("migrations ثبت‌شده:", db.query("SELECT count(*) c FROM _prisma_migrations").get().c)
' $V/existing.db > $V/after.txt 2>&1
cat $V/after.txt

echo "── مقایسه داده ──"
BEFORE=$(rg -o 'users: \d+ \| messages: \d+ \| schools: \d+ \| groups: \d+' $V/before.txt | head -1)
AFTER=$(rg -o 'users: \d+ \| messages: \d+ \| schools: \d+ \| groups: \d+' $V/after.txt | head -1)
if [ "$BEFORE" = "$AFTER" ]; then echo "✔ داده‌ها دقیقاً حفظ شدند: $BEFORE"; else echo "✘ تفاوت! قبل=$BEFORE بعد=$AFTER"; exit 1; fi
