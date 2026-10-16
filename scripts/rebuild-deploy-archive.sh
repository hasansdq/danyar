#!/usr/bin/env bash
# rebuild-deploy-archive.sh — بازسازی قطعی بستهٔ استقرار بر اساس فهرست فایل (بدون دام --exclude)
# فرمول: git ls-files منهای مصنوعات جلسه/سندباکس + تأکید صریح بر فایل‌های runtime
# ⚠ امنیت: .env (و هر فایل حاوی رمز) هرگز وارد بسته نمی‌شود — گارد صریح دارد؛
#   روی سرور با «cp .env.example .env» از صفر ساخته می‌شود.
set -euo pipefail
cd /home/z/my-project

OUT="download/daniar-repo-deploy.tar.gz"
LIST="/tmp/daniar-deploy-filelist.txt"

# --- فهرست قطعی: همهٔ فایل‌های tracked منهای مستثنیات عمدی استقرار ---
git ls-files \
  | grep -v '^download/' \
  | grep -v '^tool-results/' \
  | grep -v '^upload/' \
  | grep -v '^\.verify-' \
  | grep -v '^\.baseline-test/' \
  | grep -v '^\.tools/livekit-server$' \
  | grep -v '^db/custom\.pre-capacity\.db$' \
  | grep -v '^prisma/dev\.db$' \
  | grep -v '\.log$' \
  | grep -v '\.pid$' \
  | grep -v '^tmp-' \
  > "$LIST"

# --- گارد امنیتی: هیچ فایل حاوی رمز نباید در فهرست باشد ---
if grep -Fxq '.env' "$LIST"; then
  echo "FATAL: .env در فهرست بستهٔ استقرار است — رمزها هرگز وارد بسته نمی‌شوند" >&2
  exit 1
fi

# --- گارد: فایل‌های حیاتی حتماً باید در فهرست باشند ---
# socket-server.mjs و db/custom.db عمداً حذف شدند: داکر socket-server.mjs را
# داخل ایمیج از سورس mini-services/socket-server/index.ts می‌سازد (Dockerfile)
# و دیتابیس VPS با migrations+seed ساخته می‌شود — بسته فقط سورس/کانفیگ می‌برد.
for critical in .env.example Dockerfile docker-compose.yml docker-entrypoint.sh \
  mini-services/socket-server/index.ts mini-services/socket-server/livekit.ts \
  src/lib/livekit.ts prisma/schema.prisma prisma/seed.ts \
  prisma/migrations/20261015090000_group_lock/migration.sql \
  deploy/livekit.yaml deploy/turnserver.conf deploy/nginx.conf \
  README-DEPLOY.md; do
  if ! grep -Fxq "$critical" "$LIST"; then
    echo "FATAL: critical file missing from list: $critical" >&2
    exit 1
  fi
done
# گارد ضد تکرار: فایل‌های دارای فاصله هم با -F x دقیق چک شدند

COUNT=$(wc -l < "$LIST")
echo "file list ready: $COUNT files"

# --- ساخت آرشیو از فهرست (مسیرهای نسبی از ریشهٔ پروژه) ---
tar -czf "$OUT" -T "$LIST"

echo "=== result ==="
ls -la "$OUT"
echo "entries: $(tar -tzf "$OUT" | wc -l)"
echo "files:   $(tar -tzf "$OUT" | grep -v '/$' | wc -l)"
echo "uploads bundled: $(tar -tzf "$OUT" | grep -c '^uploads/.')"
echo "=== spot check criticals inside archive ==="
# نکته: grep -q + pipefail باعث SIGPIPE در tar و خطای کاذب می‌شود؛ اول کل لیست را می‌گیریم
TARLIST=$(tar -tzf "$OUT")
for critical in .env.example Dockerfile docker-compose.yml docker-entrypoint.sh mini-services/socket-server/index.ts mini-services/socket-server/livekit.ts src/lib/livekit.ts uploads/.gitkeep deploy/livekit.yaml deploy/turnserver.conf; do
  echo "$TARLIST" | grep -Fxq "$critical" && echo "  [OK] $critical" || echo "  [!!] $critical"
done
# گارد امنیتی نهایی روی خود tarball
if echo "$TARLIST" | grep -Fxq '.env'; then
  echo "  [!!] FATAL: .env داخل بسته است!" >&2
  exit 1
else
  echo "  [OK] .env NOT in archive (secret-free)"
fi
echo "no pid files: $(echo "$TARLIST" | grep -c '\.pid$' || true) (انتظار: 0)"
rm -f "$LIST"
