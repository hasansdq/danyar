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
