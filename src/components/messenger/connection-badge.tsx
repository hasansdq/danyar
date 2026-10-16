'use client'

import { useEffect, useState } from 'react'
import { Loader2, RotateCcw, WifiOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSocketStatus } from './socket-client'
import { repairAndReload } from '@/lib/sw-repair'

/**
 * نشان وضعیت اتصال بلادرنگ — دقیقاً مطابق وضعیت واقعی سوکت:
 *  متصل / درحال اتصال… / قطع اتصال (+ دکمه ترمیم)
 * تلاش مجدد خودکار انجام می‌شود؛ دکمه «تلاش مجدد» برای فرار از حالت‌های
 * گیرکرده مرورگر (SW/کش کهنه) است: پاک‌سازی کش و نوسازی کامل صفحه.
 * با hideWhenConnected فقط در قطع/درحال اتصال نمایش داده می‌شود.
 */
export function ConnectionBadge({
  className,
  hideWhenConnected = false,
}: {
  className?: string
  hideWhenConnected?: boolean
}) {
  const status = useSocketStatus((s) => s.status)
  const everConnected = useSocketStatus((s) => s.everConnected)
  const lastError = useSocketStatus((s) => s.lastError)

  // اگر اتصال خیلی طولانی برقرار نشد (حتی در حالت «درحال اتصال»)، دکمه ترمیم ظاهر می‌شود
  // الگوی سازگار با قاعده react-hooks/set-state-in-effect: تغییر state فقط داخل
  // کال‌بک تایمر یا cleanup — هرگز به‌صورت همگام در بدنه افکت.
  const [stuck, setStuck] = useState(false)
  useEffect(() => {
    if (status === 'connected' || everConnected) return
    const timer = setInterval(() => setStuck(true), 20000)
    return () => {
      clearInterval(timer)
      setStuck(false)
    }
  }, [status, everConnected])

  if (hideWhenConnected && status === 'connected') return null

  if (status === 'connected') {
    return (
      <span
        className={cn('flex items-center gap-1 text-emerald-600 dark:text-emerald-400 shrink-0', className)}
        role="status"
        aria-label="اتصال برقرار است"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" aria-hidden />
        متصل
      </span>
    )
  }

  if (status === 'connecting') {
    return (
      <span
        className={cn('flex items-center gap-1 text-amber-600 dark:text-amber-400 shrink-0', className)}
        role="status"
        aria-label="در حال اتصال"
        title={lastError ?? 'در حال اتصال به سرویس بلادرنگ…'}
      >
        <Loader2 className="h-3 w-3 animate-spin shrink-0" aria-hidden />
        درحال اتصال…
        {stuck && <RepairButton className="ms-1" />}
      </span>
    )
  }

  return (
    <span
      className={cn('flex items-center gap-1 text-destructive shrink-0', className)}
      role="status"
      aria-label="اتصال قطع است"
      title={lastError ?? 'اتصال بلادرنگ برقرار نشده — تلاش خودکار ادامه دارد'}
    >
      <WifiOff className="h-3.5 w-3.5 shrink-0" aria-hidden />
      قطع اتصال
      <RepairButton className="ms-1" />
    </span>
  )
}

/** دکمه ترمیم: پاک‌سازی سرویس‌ورکر/کش‌های کهنه + نوسازی کامل صفحه */
function RepairButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => void repairAndReload()}
      title="پاک‌سازی کش و نوسازی صفحه"
      className={cn(
        'inline-flex items-center gap-0.5 rounded border px-1 py-px text-[10px] font-bold',
        'bg-background/60 hover:bg-accent transition-colors shrink-0',
        className,
      )}
    >
      <RotateCcw className="h-2.5 w-2.5" aria-hidden />
      تلاش مجدد
    </button>
  )
}
