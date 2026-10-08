import type { Metadata } from "next";
import { Vazirmatn } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Providers } from "@/components/providers";
import { NavigationProgress } from "@/components/navigation-progress";

const vazirmatn = Vazirmatn({
  subsets: ["arabic", "latin"],
  variable: "--font-vazirmatn",
  display: "swap",
});

export const metadata: Metadata = {
  title: "دانیار | سامانه آموزشی مدارس",
  description: "پیام‌رسان اختصاصی معلم با مدیریت کلاس، تکالیف، نمونه سوالات و نمرات",
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <body
        className={`${vazirmatn.variable} font-sans antialiased bg-background text-foreground min-h-screen`}
      >
        <Providers>
          <NavigationProgress />
          {children}
        </Providers>
        <Toaster />
      </body>
    </html>
  );
}
