'use client'

/**
 * اجزای مشترک صفحهٔ وضعیت زیرساخت — نشان وضعیت، نمودار کوچک، قالب‌بندی.
 */

import { cn } from '@/lib/utils'
import { faNum } from '@/lib/format'
import type { ServiceCheckStatus } from '@/lib/infra/types'

export function StatusBadge({
  status,
  label,
}: {
  status: ServiceCheckStatus
  label: string
}) {
  const styles: Record<ServiceCheckStatus, string> = {
    ok: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
    degraded: 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30',
    checking: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30',
    not_configured: 'bg-neutral-500/15 text-neutral-600 dark:text-neutral-400 border-neutral-500/30',
    unchecked: 'bg-neutral-500/10 text-neutral-500 dark:text-neutral-500 border-neutral-500/25',
  }
  const dot: Record<ServiceCheckStatus, string> = {
    ok: 'bg-emerald-500',
    degraded: 'bg-red-500',
    checking: 'bg-amber-500 animate-pulse',
    not_configured: 'bg-neutral-400',
    unchecked: 'bg-neutral-300 dark:bg-neutral-600',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
        styles[status],
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', dot[status])} aria-hidden />
      {label}
    </span>
  )
}

/** نمودار کوچک SVG — سبک، بدون کتابخانهٔ نمودار */
export function Sparkline({
  values,
  threshold,
  className,
  height = 40,
}: {
  values: (number | null)[]
  threshold?: number
  className?: string
  height?: number
}) {
  const W = 160
  const H = height
  const pts = values.map((v) => (v === null || !Number.isFinite(v) ? null : Math.max(0, Math.min(100, v))))
  const valid = pts.filter((p): p is number => p !== null)
  if (valid.length < 2) {
    return (
      <div
        className={cn('flex items-center justify-center text-[10px] text-muted-foreground', className)}
        style={{ height: H }}
        aria-label="نمونهٔ کافی برای نمودار موجود نیست"
      >
        نمونهٔ کافی برای نمودار نیست
      </div>
    )
  }
  const step = W / (pts.length - 1)
  // شروع مسیر از اولین نمونهٔ معتبر — نقاط null باعث پرش غلط نمی‌شوند
  let d = ''
  let started = false
  pts.forEach((p, i) => {
    if (p === null) return
    const x = (i * step).toFixed(1)
    const y = (H - 2 - (p / 100) * (H - 4)).toFixed(1)
    d += `${started ? 'L' : 'M'}${x},${y} `
    started = true
  })
  const lastVal = valid[valid.length - 1]
  const over = threshold !== undefined && lastVal > threshold
  const stroke = over ? 'stroke-red-500' : 'stroke-primary'
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={cn('w-full', className)}
      style={{ height: H }}
      role="img"
      aria-label={`روند اخیر: آخرین مقدار ${faNum(lastVal)} درصد`}
      preserveAspectRatio="none"
    >
      {threshold !== undefined && threshold > 0 && threshold < 100 ? (
        <line
          x1="0"
          x2={W}
          y1={H - 2 - (threshold / 100) * (H - 4)}
          y2={H - 2 - (threshold / 100) * (H - 4)}
          className="stroke-red-400/60"
          strokeDasharray="4 3"
          strokeWidth="1"
        />
      ) : null}
      <path d={d} fill="none" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" className={stroke} />
    </svg>
  )
}

/** بایت → نمایش خوانا فارسی */
export function fmtBytes(bytes: number | null | undefined, digits = 1): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return 'در دسترس نیست'
  const units = ['بایت', 'کیلوبایت', 'مگابایت', 'گیگابایت', 'ترابایت']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  const num = new Intl.NumberFormat('fa-IR', {
    maximumFractionDigits: v >= 100 ? 0 : digits,
  }).format(v)
  return `${num} ${units[i]}`
}

/** نرخ بایت/ثانیه → نمایش خوانا فارسی */
export function fmtBytesRate(bytesPerSec: number | null | undefined): string {
  if (bytesPerSec === null || bytesPerSec === undefined || !Number.isFinite(bytesPerSec))
    return 'در دسترس نیست'
  return `${fmtBytes(bytesPerSec, 1)}/ث`
}

/** ثانیه → مدت خوانا (روز/ساعت/دقیقه/ثانیه) */
export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0)
    return 'در دسترس نیست'
  const s = Math.floor(seconds)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const parts: string[] = []
  if (d > 0) parts.push(`${faNum(d)} روز`)
  if (h > 0) parts.push(`${faNum(h)} ساعت`)
  if (m > 0) parts.push(`${faNum(m)} دقیقه`)
  if (parts.length === 0) parts.push(`${faNum(sec)} ثانیه`)
  return parts.slice(0, 2).join(' و ')
}

/** زمان نسبی فارسی برای «X دقیقه پیش» */
export function fmtAgo(ts: number | string | null | undefined, now = Date.now()): string {
  if (ts === null || ts === undefined) return '—'
  const t = typeof ts === 'string' ? new Date(ts).getTime() : ts
  if (!Number.isFinite(t)) return '—'
  const diff = Math.max(0, now - t)
  return `${fmtDuration(diff / 1000)} پیش`
}

export function fmtTime(ts: number | string | null | undefined): string {
  if (ts === null || ts === undefined) return '—'
  const d = typeof ts === 'string' ? new Date(ts) : new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('fa-IR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(d)
}

export function fmtDateTime(ts: number | string | null | undefined): string {
  if (ts === null || ts === undefined) return '—'
  const d = typeof ts === 'string' ? new Date(ts) : new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('fa-IR', { dateStyle: 'short', timeStyle: 'medium' }).format(d)
}
