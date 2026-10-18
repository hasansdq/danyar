import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // web-push فقط سمت سرور اجرا می‌شود و نباید در باندل کلاینت رد شود
  serverExternalPackages: ["web-push"],
  /* config options here */
  /* بررسی خطاهای TypeScript فعال است — خطاها در مرحله build واقعاً رد می‌شوند */
  reactStrictMode: false,
  // نشانگر dev گوشه صفحه را نمی‌خواهیم (با دکمه‌های پایین تداخل دارد)
  devIndicators: false,
  // ─── پیام‌رسان بلادرنگ: پراکسی داخلی /socket.io به سرویس مستقل :3003 ───
  // دسترسی مستقیم به :3000 (بدون گیت‌وی :81) هم باید سوکت واقعی داشته باشد تا
  // نشان «متصل» صفحه اول صادق بماند. در گیت‌وی/داکر، /socket.io قبل از Next
  // به سرویس سوکت می‌رود و این پراکسی هرگز اجرا نمی‌شود (پشتیبان اضافی است).
  // ارتقای websocket از مسیر rewrites پشتیبانی نمی‌شود — socket.io خودکار
  // روی polling می‌ماند (ترتیب transports در socket-client.ts).
  async rewrites() {
    const socketTarget = process.env.SOCKET_PROXY_TARGET ?? "http://localhost:3003";
    return [
      // سه الگو لازم است: engine.io همیشه /socket.io/ (با اسلش) صدا می‌زند و
      // Next مسیر بدون-اسلش را ۳۰۸ می‌کند؛ هر دو شکل + زیرمسیرها پوشش داده شوند
      { source: "/socket.io", destination: `${socketTarget}/socket.io/` },
      { source: "/socket.io/", destination: `${socketTarget}/socket.io/` },
      { source: "/socket.io/:path*", destination: `${socketTarget}/socket.io/:path*` },
    ];
  },
  // امنیت کش: پاسخ API و صفحات خصوصی هرگز در کش عمومی ذخیره نمی‌شوند
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, max-age=0" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      {
        source: "/:path*",
        headers: [
          // X-Frame-Options: DENY حذف شد — زنده‌پیش‌نمایش پروژه در iframe پنل را مسدود می‌کرد
          // (کوکی نشست SameSite=Lax است؛ embed مخرب کوکی نمی‌گیرد و فقط صفحه ورود را می‌بیند)
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
