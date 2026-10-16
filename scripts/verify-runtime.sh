#!/usr/bin/env bash
# شبیه‌سازی دقیق اجرای کانتینرها در سندباکس (بدون Docker):
# همان آرتیفکت‌ها، همان متغیرها، همان ترتیب راه‌اندازی، درگاه یکسان :3034
set -euo pipefail
cd /home/z/my-project

V=.verify-runtime
mkdir -p "$V/data" "$V/logs"

# ─── متغیرهای امن مالک (مانند .env سرور) ───
export NODE_ENV=production
export SESSION_SECRET="$(openssl rand -base64 32)"
export SOCKET_INTERNAL_SECRET="$(openssl rand -base64 24)"
export DATABASE_URL="file:$PWD/$V/data/daniar.db"
export UPLOAD_DIR="$PWD/$V/data/uploads"
export SOCKET_INTERNAL_URL="http://127.0.0.1:3003"
export SOCKET_PORT=3003
export SOCKET_PATH=/socket.io
export PORT=3000
export HOSTNAME=0.0.0.0
export PRISMA_HIDE_UPDATE_MESSAGE=1
echo "$SESSION_SECRET" > "$V/session.secret"

# ─── ۱) مهاجرت: baseline دیتابیس موجود + deploy (غیرمخرب) ───
echo "[1] migrate resolve + deploy…"
bunx prisma migrate resolve --applied 20251012000000_init --schema prisma/schema.prisma >/dev/null 2>&1 || true
bunx prisma migrate deploy 2>&1 | tail -1

# ─── ۲) seed — حساب موجود باید دست‌نخورده بماند (بدون رمز هم نباید خطا بدهد) ───
echo "[2] seed (حساب مدیر کل موجود → no-op):"
node prisma/seed.mjs

# ─── ۳) مسیر دیتابیس تازه: seed فقط با رمز مالک ───
echo "[3] مسیر دیتابیس تازه (فقط با SUPERADMIN_INITIAL_PASSWORD):"
rm -f "$V/data/fresh.db"
if (
  export DATABASE_URL="file:$PWD/$V/data/fresh.db"
  bunx prisma migrate deploy >/dev/null 2>&1
  node prisma/seed.mjs 2>"$V/logs/seed-no-pass.err"
); then
  echo "✘ انتظار می‌رفت بدون رمز متوقف شود"; exit 1
else
  echo "  ✔ بدون رمز مالک → متوقف شد با پیام واضح: $(head -1 "$V/logs/seed-no-pass.err")"
fi
DATABASE_URL="file:$PWD/$V/data/fresh.db" SUPERADMIN_INITIAL_PASSWORD="Owner#Test-2026!" node prisma/seed.mjs
echo "  ✔ با رمز مالک → مدیر کل ساخته شد"

# ─── ۴) اجرای سرویس‌ها (دقیقاً مانند کانتینرها: node، غیر interactive) ───
echo "[4] اجرای web (:3000) و socket (:3003)…"
nohup node socket-server.mjs >"$V/logs/socket.log" 2>&1 &
echo $! > "$V/socket.pid"
nohup node .next/standalone/server.js >"$V/logs/web.log" 2>&1 &
echo $! > "$V/web.pid"

# ─── ۵) درگاه یکسان :3034 (مانیتور nginx داخلی: /socket.io → 3003، بقیه → 3000) ───
cat > "$V/Caddyfile" <<'EOF'
:3034 {
        handle /socket.io/* {
                reverse_proxy 127.0.0.1:3003
        }
        handle {
                reverse_proxy 127.0.0.1:3000
        }
}
EOF
nohup caddy run --config "$V/Caddyfile" --adapter caddyfile >"$V/logs/proxy.log" 2>&1 &
echo $! > "$V/proxy.pid"

sleep 4
echo "[5] healthcheckها:"
echo -n "  web  /api/health (از طریق :3034): "; curl -s http://127.0.0.1:3034/api/health
echo
echo -n "  socket /healthz (مستقیم): "; curl -s http://127.0.0.1:3003/healthz
echo
echo -n "  آپلود از طریق درگاه (صفحه ورود): "; curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3034/login
echo "$V" > "$V/.done"
echo "✔ آماده — لاگ‌ها در $V/logs/"
