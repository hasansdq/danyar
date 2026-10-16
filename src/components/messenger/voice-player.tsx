'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { cn } from '@/lib/utils'

/** تعداد ستون‌های موج — همان سمت سرور در sanitizeVoiceMeta سقف ۶۴ */
const BAR_COUNT = 44

/** فرمت زمان فارسی m:ss */
export function voiceTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${new Intl.NumberFormat('fa-IR').format(m)}:${new Intl.NumberFormat('fa-IR', {
    minimumIntegerDigits: 2,
  }).format(r)}`
}

/** کش تحلیل موج بر اساس URL — هر فایل فقط یک‌بار دیکد می‌شود */
const peaksCache = new Map<string, number[]>()

/**
 * استخراج موج واقعی از فایل صوتی با WebAudio —
 * برای پیام‌های قدیمی بدون متا یا وقتی کلاینت نمونه نفرستاده
 */
async function analyzePeaks(url: string, count = BAR_COUNT): Promise<number[] | null> {
  const cached = peaksCache.get(url)
  if (cached) return cached
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    const AC =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    const ctx = new AC()
    const audio = await ctx.decodeAudioData(buf)
    const data = audio.getChannelData(0)
    const block = Math.max(1, Math.floor(data.length / count))
    const peaks: number[] = []
    for (let i = 0; i < count; i++) {
      let max = 0
      const start = i * block
      // نمونه‌برداری پرش‌دار برای سرعت
      for (let j = 0; j < block; j += 24) {
        const v = Math.abs(data[start + j] ?? 0)
        if (v > max) max = v
      }
      peaks.push(Math.round(max * 100) / 100)
    }
    await ctx.close()
    const mx = Math.max(...peaks, 0.02)
    const norm = peaks.map((p) => Math.min(1, p / mx))
    peaksCache.set(url, norm)
    return norm
  } catch {
    return null
  }
}

interface VoicePlayerProps {
  url: string
  /** مدت از متای سرور (اختیاری — از فایل هم خوانده می‌شود) */
  duration?: number | null
  /** نمونه‌های موج از متای سرور (اختیاری — در صورت نبود از فایل تحلیل می‌شود) */
  waveform?: number[] | null
  mine?: boolean
  /** در حال ارسال (پیام موقت) — پلیر غیرفعال */
  sending?: boolean
}

/**
 * پلیر پیام صوتی با نمایش موج — پخش/توقف، جست‌وجو با کشیدن روی موج، زمان
 */
export function VoicePlayer({ url, duration, waveform, mine, sending }: VoicePlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const barsRef = useRef<HTMLDivElement | null>(null)
  const draggingRef = useRef(false)

  const [bars, setBars] = useState<number[] | null>(waveform ?? null)
  const [analyzing, setAnalyzing] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [pos, setPos] = useState(0)
  const [dur, setDur] = useState(duration ?? 0)

  // موج واقعی فقط وقتی بارگیری می‌شود که کاربر پلیر را می‌بیند و متا موجود نیست
  useEffect(() => {
    if (bars || analyzing || sending) return
    let alive = true
    setAnalyzing(true)
    analyzePeaks(url).then((p) => {
      if (!alive) return
      if (p) setBars(p)
      setAnalyzing(false)
    })
    return () => {
      alive = false
    }
  }, [url, bars, analyzing, sending])

  const toggle = useCallback(() => {
    const a = audioRef.current
    if (!a || sending) return
    if (a.paused) {
      a.play().catch(() => null)
    } else {
      a.pause()
    }
  }, [sending])

  const seekFromPointer = useCallback((clientX: number) => {
    const el = barsRef.current
    const a = audioRef.current
    if (!el || !a || !isFinite(a.duration) || a.duration <= 0) return
    const rect = el.getBoundingClientRect()
    // RTL: موج از راست (شروع) به چپ (پایان) — نسبت از لبه راست
    const ratio = Math.min(1, Math.max(0, (rect.right - clientX) / rect.width))
    a.currentTime = ratio * a.duration
    setPos(a.currentTime)
  }, [])

  const progress = dur > 0 ? Math.min(1, pos / dur) : 0
  const remaining = Math.max(0, (dur || 0) - pos)

  const displayBars =
    bars ?? Array.from({ length: BAR_COUNT }, (_, i) => 0.18 + 0.1 * Math.abs(Math.sin(i * 1.7)))

  return (
    <div
      className={cn(
        'flex items-center gap-2.5 rounded-xl px-2.5 py-2 select-none',
        mine ? 'bg-primary-foreground/10' : 'bg-muted/60',
        sending && 'opacity-60',
      )}
      dir="rtl"
    >
      {/* فایل صوتی مخفی — منبع پخش */}
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration
          if (isFinite(d) && d > 0) setDur((prev) => (prev && Math.abs(prev - d) < 0.4 ? prev : d))
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false)
          setPos(0)
        }}
        onTimeUpdate={(e) => {
          if (!draggingRef.current) setPos(e.currentTarget.currentTime)
        }}
      />

      {/* دکمه پخش/توقف */}
      <button
        type="button"
        onClick={toggle}
        disabled={sending}
        aria-label={playing ? 'توقف پخش' : 'پخش پیام صوتی'}
        className={cn(
          'h-9 w-9 shrink-0 rounded-full flex items-center justify-center transition-transform active:scale-90',
          mine
            ? 'bg-primary-foreground text-primary hover:bg-primary-foreground/90'
            : 'bg-primary text-primary-foreground hover:bg-primary/90',
        )}
      >
        {playing ? (
          <Pause className="h-4.5 w-4.5 fill-current" />
        ) : (
          <Play className="h-4.5 w-4.5 fill-current translate-x-[1px]" />
        )}
      </button>

      {/* موج صوتی قابل جست‌وجو */}
      <div
        ref={barsRef}
        role="slider"
        tabIndex={0}
        aria-label="نوار پیشرفت پیام صوتی"
        aria-valuemin={0}
        aria-valuemax={Math.round(dur)}
        aria-valuenow={Math.round(pos)}
        onPointerDown={(e) => {
          if (sending) return
          draggingRef.current = true
          e.currentTarget.setPointerCapture(e.pointerId)
          seekFromPointer(e.clientX)
        }}
        onPointerMove={(e) => {
          if (draggingRef.current) seekFromPointer(e.clientX)
        }}
        onPointerUp={() => {
          draggingRef.current = false
        }}
        onKeyDown={(e) => {
          const a = audioRef.current
          if (!a || sending) return
          if (e.key === 'ArrowLeft') a.currentTime = Math.min(a.duration || 0, a.currentTime + 2)
          if (e.key === 'ArrowRight') a.currentTime = Math.max(0, a.currentTime - 2)
        }}
        className="flex items-center gap-[2px] h-8 flex-1 min-w-36 cursor-pointer touch-none"
      >
        {displayBars.map((v, i) => {
          const played = i / displayBars.length <= progress
          return (
            <span
              key={i}
              className={cn(
                'flex-1 min-w-[2px] max-w-[5px] rounded-full transition-colors',
                mine
                  ? played
                    ? 'bg-white'
                    : 'bg-white/35'
                  : played
                    ? 'bg-primary'
                    : 'bg-primary/25',
              )}
              style={{ height: `${Math.min(100, Math.max(12, v * 100))}%` }}
            />
          )
        })}
      </div>

      {/* زمان */}
      <span
        className={cn(
          'text-[10.5px] shrink-0 tabular-nums w-9 text-center',
          mine ? 'text-primary-foreground/80' : 'text-muted-foreground',
        )}
      >
        {voiceTime(playing || pos > 0 ? remaining : dur)}
      </span>
    </div>
  )
}
