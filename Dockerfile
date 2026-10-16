# ─── مرحله ۱: نصب و بیلد با Bun ───
FROM oven/bun:1 AS builder
WORKDIR /app

# متغیرهای عمومی کلاینت — هنگام build در باندل ثبت می‌شوند.
# در استقرار، کلاینت Socket.IO همان دامنه سایت را صدا می‌زند و پراکسی داخلی
# مسیر /socket.io را به سرویس سوکت می‌فرستد (پرچم‌های dev برای Docker لازم نیست).
ARG NEXT_PUBLIC_SOCKET_URL=/
ARG NEXT_PUBLIC_SOCKET_PATH=/socket.io
# آدرس SFU رسانه — خالی = همان‌مبدأ (مسیر /rtc)
ARG NEXT_PUBLIC_LIVEKIT_WS_URL=
ENV NEXT_PUBLIC_SOCKET_URL=${NEXT_PUBLIC_SOCKET_URL} \
    NEXT_PUBLIC_SOCKET_PATH=${NEXT_PUBLIC_SOCKET_PATH} \
    NEXT_PUBLIC_LIVEKIT_WS_URL=${NEXT_PUBLIC_LIVEKIT_WS_URL}

# نصب وابستگی‌ها (با کش لایه)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# کد پروژه
COPY . .

# تولید کلاینت Prisma (موتورها برای همین پلتفرم build دانلود می‌شوند)
RUN bunx prisma generate

# بیلد Next.js — بررسی TypeScript فعال است؛ خطا بیلد را واقعاً رد می‌کند
RUN bun run build

# کامپایل اسکریپت seed برای اجرا با Node در مرحله اجرا (bcryptjs داخل باندل می‌ماند)
RUN bun build prisma/seed.ts --target node \
    --external @prisma/client \
    --outfile prisma/seed.mjs

# کامپایل سرویس مستقل Socket.IO (خودکفا؛ فقط @prisma/client خارجی)
RUN bun build mini-services/socket-server/index.ts --target node \
    --external @prisma/client \
    --outfile socket-server.mjs

# ─── مرحله ۲: اجرا با Node glibc (سازگار با موتورهای Prisma و sharp) ───
FROM node:20-bookworm-slim AS runner

# sqlite3 برای وضعیت پایه مهاجرت و پشتیبان‌گیری؛ openssl برای Prisma
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl sqlite3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
ENV DATABASE_URL=file:/data/daniar.db \
    UPLOAD_DIR=/data/uploads
ENV SOCKET_PORT=3003 \
    SOCKET_PATH=/socket.io
ENV PRISMA_HIDE_UPDATE_MESSAGE=1

# خروجی standalone این Next.js (اسکریپت build، static و public را هم داخل آن کپی می‌کند)
COPY --from=builder /app/.next/standalone ./

# Prisma برای migrate deploy/resolve + اسکریپت seed
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
# کلاینت تولیدشده + موتورهای واقعی کوئری/اسکیما (برای server.js، seed.mjs و socket-server.mjs)
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/.bin/prisma ./node_modules/.bin/prisma

# سرویس Socket.IO مستقل
COPY --from=builder /app/socket-server.mjs ./socket-server.mjs

# اسکریپت راه‌اندازی
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# ─── کاربر غیر root — Next.js و Socket.IO با همین کاربر اجرا می‌شوند ───
RUN groupadd -g 10001 daniar \
    && useradd -m -u 10001 -g 10001 daniar \
    && chown -R daniar:daniar /app
USER daniar

# دیتابیس SQLite و پیوست‌ها روی ولوم پایدار (مالکیت توسط سرویس init-data تنظیم می‌شود)
VOLUME ["/data"]

EXPOSE 3000 3003
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["web"]
