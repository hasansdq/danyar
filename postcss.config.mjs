import path from "node:path";

const config = {
  plugins: [
    [
      "@tailwindcss/postcss",
      {
        // ریشهٔ اسکن منابع Tailwind — به‌جای cwd کل پروژه، فقط درخت src اسکن می‌شود.
        // دلیل: پوشهٔ upload روی FUSE (ossfs) سوار است؛ اگر daemon آن هنگ کند، اسکن
        // خودکار **/* وارد upload می‌شود و کامپایل CSS برای همیشه قفل می‌شود
        // (کلاس‌های UI فقط در src هستند، پس خروجی CSS تغییری نمی‌کند).
        base: path.join(process.cwd(), "src"),
      },
    ],
  ],
};

export default config;
