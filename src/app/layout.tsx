import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { Providers } from "@/components/providers";
import { SplashGate } from "@/components/splash-gate";
import {
  getPlatformSettings,
  getBrandingPayload,
  injectedCss,
  BRANDING_DEFAULTS,
} from "@/lib/branding";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7fbfa" },
    { media: "(prefers-color-scheme: dark)", color: "#101c22" },
  ],
};

// هویت برنامه از تنظیمات مدیر کل — در زمان بیلد به پیش‌فرض امن برمی‌گردد
export async function generateMetadata(): Promise<Metadata> {
  const payload = await getBrandingPayload();
  return {
    title: `${payload.appName} | پیام‌رسان آموزشی مدارس`,
    description:
      "محیط یکپارچه مدیریت مدرسه، پیام‌رسان آموزشی، تکالیف و کلاس آنلاین",
    icons: {
      icon: payload.logoUrl ?? "/logo.svg",
      shortcut: "/icons/icon-192.png",
      apple: "/icons/apple-touch-icon.png",
    },
    manifest: "/manifest.webmanifest",
    applicationName: payload.appName,
    appleWebApp: {
      capable: true,
      title: payload.appName,
      statusBarStyle: "default",
    },
    formatDetection: { telephone: false },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // کوکی خوانده می‌شود → رندر داینامیک؛ برندینگ همیشه تازه است
  await cookies();
  const [branding, settings] = await Promise.all([
    getBrandingPayload(),
    getPlatformSettings().catch(() => null),
  ]);
  const safeSettings = settings ?? BRANDING_DEFAULTS;

  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <head>
        {/* فونت فعال برنامه + پس‌زمینه چت موبایل — از تنظیمات مدیر کل */}
        <style
          dangerouslySetInnerHTML={{ __html: injectedCss(safeSettings) }}
        />
      </head>
      <body className="antialiased bg-background text-foreground min-h-screen">
        <SplashGate branding={branding} />
        <Providers>{children}</Providers>
        <Toaster />
        {/* توستر sonner برای اعلان‌های بلادرنگ کلاس آنلاین */}
        <SonnerToaster position="top-center" richColors />
      </body>
    </html>
  );
}
