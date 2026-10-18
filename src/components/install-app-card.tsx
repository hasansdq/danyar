'use client'

/**
 * کارت «نصب برنامه روی موبایل» (درخواست کاربر: امکان نصب دانیار از مرورگر موبایل):
 * - اندروید/کروم: دکمهٔ «نصب برنامه» → دیالوگ نصب خودِ مرورگر
 * - iOS سافاری: راهنمای گام‌به‌گام «اشتراک ← افزودن به صفحهٔ اصلی»
 * - نصب‌شده (standalone): پیام تأیید
 */

import { useState } from 'react'
import { Download, Share, PlusSquare, Smartphone, BadgeCheck } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { usePwaInstall } from '@/lib/install-prompt'

export function InstallAppCard() {
  const { canInstall, install, standalone, isIos } = usePwaInstall()
  const [busy, setBusy] = useState(false)

  async function onInstall() {
    setBusy(true)
    try {
      const outcome = await install()
      if (outcome === 'accepted') {
        // برنامه نصب شد — کارت با رفرش حالت standalone را نشان می‌دهد
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card id="install">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Smartphone className="h-4.5 w-4.5 text-primary" />
          نصب دانیار روی موبایل
        </CardTitle>
        <CardDescription>
          دانیار را مثل یک اپ واقعی روی گوشی نصب کنید — آیکون صفحهٔ اصلی، تمام‌صفحه و بدون
          نوار مرورگر
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {standalone ? (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3">
            <BadgeCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <p className="text-sm">
              دانیار همین حالا به‌صورت <b>برنامهٔ نصب‌شده</b> اجرا می‌شود — نیازی به نصب مجدد
              نیست.
            </p>
          </div>
        ) : canInstall ? (
          <div className="space-y-3">
            <p className="text-muted-foreground">
              مرورگر شما نصب مستقیم را پشتیبانی می‌کند — با یک کلیک دیالوگ نصب باز می‌شود.
            </p>
            <Button onClick={onInstall} disabled={busy} className="gap-2 w-full sm:w-auto">
              <Download className="h-4.5 w-4.5" />
              {busy ? 'در حال باز کردن دیالوگ نصب…' : 'نصب برنامه'}
            </Button>
          </div>
        ) : isIos ? (
          <div className="space-y-2.5">
            <p className="text-muted-foreground">
              در آیفون/آیپد، دانیار را با «افزودن به صفحهٔ اصلی» نصب کنید:
            </p>
            <ol className="space-y-2">
              <li className="flex items-center gap-2.5 rounded-lg border p-2.5">
                <span className="h-7 w-7 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0">
                  ۱
                </span>
                <span className="flex items-center gap-1.5">
                  دکمهٔ
                  <Share className="h-4 w-4 text-primary" />
                  <b>اشتراک‌گذاری</b>
                  را در نوار پایین سافاری بزنید
                </span>
              </li>
              <li className="flex items-center gap-2.5 rounded-lg border p-2.5">
                <span className="h-7 w-7 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0">
                  ۲
                </span>
                <span className="flex items-center gap-1.5">
                  گزینهٔ
                  <PlusSquare className="h-4 w-4 text-primary" />
                  <b>افزودن به صفحهٔ اصلی</b>
                  را انتخاب کنید
                </span>
              </li>
              <li className="flex items-center gap-2.5 rounded-lg border p-2.5">
                <span className="h-7 w-7 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0">
                  ۳
                </span>
                <span>
                  روی <b>افزودن</b> بزنید — آیکون دانیار روی صفحهٔ اصلی ساخته می‌شود
                </span>
              </li>
            </ol>
          </div>
        ) : (
          <p className="text-muted-foreground">
            اگر مرورگر شما نصب مستقیم را پشتیبانی نکند، از منوی مرورگر گزینهٔ «نصب
            برنامه/افزودن به صفحهٔ اصلی» را انتخاب کنید.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
