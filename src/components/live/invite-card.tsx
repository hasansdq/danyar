'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { MonitorPlay, LogIn, Ban, Loader2 } from 'lucide-react'
import { getSocket } from '@/components/messenger/socket-client'

/**
 * کارت دعوت کلاس آنلاین در گفتگوی گروهی:
 * - جلسه فعال → دکمه «ورود به کلاس»
 * - جلسه پایان‌یافته → دکمه غیرفعال «جلسه پایان یافته» (به‌صورت بلادرنگ)
 * - خطای شبکه/ناامید شدن از دریافت وضعیت → «در حال بررسی…» با تلاش مجدد؛
 *   هرگز خطای موقت را «پایان جلسه» جلوه نمی‌دهیم (قبلاً کارت فعال پایان‌یافته دیده می‌شد)
 */
export function LiveInviteCard({
  liveSessionId,
  body,
  senderName,
  time,
}: {
  liveSessionId: string
  body: string
  senderName: string
  time: string
}) {
  const [status, setStatus] = useState<'loading' | 'ACTIVE' | 'ENDED' | 'UNKNOWN'>('loading')
  const aliveRef = useRef(true)

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/live-sessions/${liveSessionId}`, { cache: 'no-store' })
      const d = r.ok ? await r.json().catch(() => null) : null
      if (!aliveRef.current) return
      if (d) setStatus(d.status === 'ACTIVE' ? 'ACTIVE' : 'ENDED')
      else setStatus((s) => (s === 'loading' ? 'UNKNOWN' : s))
    } catch {
      if (aliveRef.current) setStatus((s) => (s === 'loading' ? 'UNKNOWN' : s))
    }
  }, [liveSessionId])

  useEffect(() => {
    aliveRef.current = true
    void load()
    // تلاش مجدد برای حالت نامشخص (خطای شبکه) — حداکثر ۳ بار با فاصله ۳ ثانیه
    let tries = 0
    const timer = setInterval(() => {
      if (!aliveRef.current) return
      setStatus((s) => {
        if (s !== 'UNKNOWN' || tries >= 3) return s
        tries++
        void load()
        return 'loading'
      })
    }, 3000)

    // تغییر وضعیت جلسه (پایان یافتن) به‌صورت بلادرنگ + بازبینی پس از اتصال مجدد
    const socket = getSocket()
    const onStatus = (data: { sessionId?: string; status?: string }) => {
      if (data?.sessionId === liveSessionId) {
        setStatus(data.status === 'ACTIVE' ? 'ACTIVE' : 'ENDED')
      }
    }
    const onConnect = () => void load()
    socket.on('live:session-status', onStatus)
    socket.on('connect', onConnect)
    return () => {
      aliveRef.current = false
      clearInterval(timer)
      socket.off('live:session-status', onStatus)
      socket.off('connect', onConnect)
    }
  }, [liveSessionId, load])

  return (
    <div className="mx-auto w-full max-w-xl my-2">
      <div className="rounded-xl border-2 border-emerald-500/40 bg-emerald-500/5 p-3.5">
        <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-xs font-bold mb-1.5">
          <MonitorPlay className="h-4 w-4" />
          کلاس آنلاین
          {status === 'ACTIVE' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 text-[10px]">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              فعال
            </span>
          )}
        </div>
        <p className="text-sm whitespace-pre-wrap break-words">{body}</p>
        {status === 'ACTIVE' ? (
          <Link
            href={`/live/${liveSessionId}`}
            className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white transition-opacity hover:opacity-90"
          >
            <LogIn className="h-3.5 w-3.5" />
            ورود به کلاس
          </Link>
        ) : status === 'ENDED' ? (
          <span
            className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-muted px-3 py-1.5 text-xs font-bold text-muted-foreground cursor-not-allowed"
            aria-disabled="true"
          >
            <Ban className="h-3.5 w-3.5" />
            جلسه پایان یافته
          </span>
        ) : (
          <span
            className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-muted px-3 py-1.5 text-xs font-bold text-muted-foreground"
            aria-label="در حال بررسی وضعیت جلسه"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            در حال بررسی وضعیت جلسه…
          </span>
        )}
        <div className="text-[11px] text-muted-foreground mt-2">
          {senderName} — {time}
        </div>
      </div>
    </div>
  )
}
