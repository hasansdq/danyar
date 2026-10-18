'use client'

/**
 * راهنمای نصب در صفحهٔ ورود (موبایل) — دکمهٔ «نصب برنامه» وقتی مرورگر
 * پشتیبانی کند (اندروید/کروم) و راهنمای کوتاه iOS.
 */

import { Download, Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePwaInstall } from '@/lib/install-prompt'

export function InstallLoginHint() {
  const { canInstall, install, standalone, isIos } = usePwaInstall()

  if (standalone) return null

  if (canInstall) {
    return (
      <div className="flex flex-col items-center gap-2">
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Smartphone className="h-3.5 w-3.5" />
          دانیار را روی گوشی نصب کنید
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => void install()}
        >
          <Download className="h-4 w-4" />
          نصب برنامه
        </Button>
      </div>
    )
  }

  if (isIos) {
    return (
      <p className="text-center text-xs text-muted-foreground">
        برای نصب روی آیفون: در سافاری دکمهٔ اشتراک‌گذاری ← «افزودن به صفحهٔ اصلی» را بزنید
      </p>
    )
  }

  return null
}
