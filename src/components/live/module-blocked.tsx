'use client'

import { VideoOff, Headset } from 'lucide-react'
import {
  ONLINE_CLASS_DISABLED_MSG,
  ONLINE_CLASS_DISABLED_HINT,
} from '@/lib/features'

/**
 * صفحه/کارت «ماژول استریم این مدرسه خاموش است» — همان متن رسمی پشتیبانی
 * که در همه لایه‌ها (فهرست، اتاق جلسه، توکن، سوکت) یکسان نمایش داده می‌شود.
 */
export function ModuleBlocked({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={cnWrap(compact)}
      role="alert"
      aria-live="assertive"
    >
      <span className="h-14 w-14 rounded-2xl bg-red-500/10 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0">
        <VideoOff className="h-7 w-7" />
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <h2 className="font-bold text-base leading-7 text-red-700 dark:text-red-300">
          {ONLINE_CLASS_DISABLED_MSG}
        </h2>
        <p className="text-sm text-muted-foreground leading-6 flex items-center gap-1.5">
          <Headset className="h-4 w-4 shrink-0 text-muted-foreground/70" />
          {ONLINE_CLASS_DISABLED_HINT}
        </p>
      </div>
    </div>
  )
}

function cnWrap(compact: boolean): string {
  const base =
    'rounded-2xl border border-red-200 dark:border-red-900/60 bg-red-50/60 dark:bg-red-950/30 p-5 flex items-center gap-4'
  return compact ? base : `${base} mt-5`
}
