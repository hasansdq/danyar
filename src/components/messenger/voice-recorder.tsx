'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** سقف مدت پیام صوتی — ۵ دقیقه */
export const MAX_VOICE_SEC = 300

/** تعداد ستون موج نهایی — هماهنگ با VoicePlayer */
const WAVE_BARS = 44

export interface VoiceRecording {
  blob: Blob
  mime: string
  duration: number
  waveform: number[] | null
}

/** کدک پشتیبانی‌شده به ترتیب ترجیح (Chromium: webm/opus — Safari: mp4/AAC) */
const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
]

function pickMime(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? ''
}

/** سطح لحظه‌ای صدا از آنالایزر (۰ تا ۱) */
function sampleLevel(analyser: AnalyserNode, buf: Uint8Array<ArrayBuffer>): number {
  analyser.getByteTimeDomainData(buf)
  let max = 0
  for (let i = 0; i < buf.length; i++) {
    const v = Math.abs(buf[i] - 128) / 128
    if (v > max) max = v
  }
  return Math.min(1, Math.round(max * 100) / 100)
}

/** نمونه‌برداری مجدد سطوح خام به تعداد ستون موج نهایی */
function toWaveform(levels: number[], count = WAVE_BARS): number[] | null {
  if (levels.length < 8) return null
  const out: number[] = []
  const block = levels.length / count
  for (let i = 0; i < count; i++) {
    const start = Math.floor(i * block)
    const end = Math.min(levels.length, Math.max(start + 1, Math.floor((i + 1) * block)))
    let max = 0
    for (let j = start; j < end; j++) if (levels[j] > max) max = levels[j]
    out.push(Math.round(max * 100) / 100)
  }
  const mx = Math.max(...out, 0.08)
  return out.map((v) => Math.min(1, v / mx))
}

function faClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${new Intl.NumberFormat('fa-IR').format(m)}:${new Intl.NumberFormat('fa-IR', {
    minimumIntegerDigits: 2,
  }).format(r)}`
}

interface VoiceRecorderPanelProps {
  /** پیام آماده ارسال شد */
  onDone: (rec: VoiceRecording) => void
  /** انصراف؛ micDenied = خطای دسترسی میکروفون */
  onCancel: (micDenied?: boolean) => void
}

/**
 * پنل ضبط پیام صوتی — جای ردیف کامپوزر می‌نشیند:
 * تایمر + موج زنده + انصراف + ارسال؛ سقف ۵ دقیقه با توقف و ارسال خودکار
 */
export function VoiceRecorderPanel({ onDone, onCancel }: VoiceRecorderPanelProps) {
  const [seconds, setSeconds] = useState(0)
  const [levels, setLevels] = useState<number[]>([])
  const [finishing, setFinishing] = useState(false)
  const [micDenied, setMicDenied] = useState(false)

  const recorderRef = useRef<(MediaRecorder & { __chunks?: BlobPart[] }) | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const levelBufRef = useRef<Uint8Array<ArrayBuffer> | null>(null)
  const levelsRef = useRef<number[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startedAtRef = useRef(0)
  const finalizedRef = useRef(false)

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    ctxRef.current?.close().catch(() => null)
    ctxRef.current = null
    analyserRef.current = null
  }, [])

  /** انصراف — دوربین قطع و پنل بسته می‌شود */
  const cancel = useCallback(() => {
    if (finalizedRef.current) return
    finalizedRef.current = true
    try {
      recorderRef.current?.state !== 'inactive' && recorderRef.current?.stop()
    } catch {
      /* ignore */
    }
    cleanup()
    onCancel()
  }, [cleanup, onCancel])

  /** ارسال — پس از توقف ضبط، Blob از chunks ساخته و تحویل داده می‌شود */
  const send = useCallback(() => {
    if (finalizedRef.current) return
    finalizedRef.current = true
    setFinishing(true)
    const rec = recorderRef.current
    if (!rec || rec.state === 'inactive') {
      cleanup()
      onCancel()
      return
    }
    const chunks = rec.__chunks ?? []
    const duration = Math.max(0.5, (Date.now() - startedAtRef.current) / 1000)
    rec.onstop = () => {
      const mime = rec.mimeType || 'audio/webm'
      const blob = new Blob(chunks, { type: mime })
      cleanup()
      const waveform = toWaveform(levelsRef.current)
      onDone({ blob, mime, duration, waveform })
    }
    try {
      rec.stop()
    } catch {
      cleanup()
      onCancel()
    }
  }, [cleanup, onDone, onCancel])

  // شروع ضبط هنگام mount + توقف خودکار در سقف مدت
  useEffect(() => {
    let alive = true
    const mime = pickMime()
    if (!mime || !navigator.mediaDevices?.getUserMedia) {
      const t = setTimeout(() => onCancel(), 0)
      return () => clearTimeout(t)
    }
    ;(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        })
        if (!alive) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        const rec = new MediaRecorder(stream, { mimeType: mime }) as MediaRecorder & {
          __chunks?: BlobPart[]
        }
        recorderRef.current = rec
        rec.__chunks = []
        rec.ondataavailable = (e) => {
          if (e.data.size > 0) rec.__chunks!.push(e.data)
        }
        startedAtRef.current = Date.now()

        // آنالایزر موج زنده
        const AC =
          window.AudioContext ??
          (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (AC) {
          const ctx = new AC()
          ctxRef.current = ctx
          const src = ctx.createMediaStreamSource(stream)
          const analyser = ctx.createAnalyser()
          analyser.fftSize = 256
          src.connect(analyser)
          analyserRef.current = analyser
          levelBufRef.current = new Uint8Array(analyser.frequencyBinCount)
        }

        rec.start(250)

        // تایمر + نمونه‌برداری موج زنده
        timerRef.current = setInterval(() => {
          const elapsed = (Date.now() - startedAtRef.current) / 1000
          setSeconds(elapsed)
          const an = analyserRef.current
          const buf = levelBufRef.current
          if (an && buf) {
            const lv = sampleLevel(an, buf)
            levelsRef.current = [...levelsRef.current, lv].slice(-WAVE_BARS * 3)
            setLevels((prev) => [...prev, lv].slice(-28))
          }
          if (elapsed >= MAX_VOICE_SEC) send()
        }, 120)
      } catch {
        if (!alive) return
        setMicDenied(true)
        setTimeout(() => {
          if (!finalizedRef.current) {
            finalizedRef.current = true
            cleanup()
            onCancel(true)
          }
        }, 700)
      }
    })()
    return () => {
      alive = false
      // اگر هنوز ضبط فعال است (خروج از صفحه) — پاک‌سازی
      if (!finalizedRef.current) {
        finalizedRef.current = true
        try {
          recorderRef.current?.stop()
        } catch {
          /* ignore */
        }
      }
      cleanup()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex items-center gap-2 p-2.5" dir="rtl">
      {/* انصراف */}
      <Button
        variant="ghost"
        size="icon"
        className="shrink-0 text-destructive hover:text-destructive"
        onClick={cancel}
        disabled={finishing}
        aria-label="انصراف از ضبط"
        title="حذف پیام صوتی"
      >
        <Trash2 className="h-5 w-5" />
      </Button>

      {/* موج زنده + تایمر */}
      <div
        className={cn(
          'flex-1 flex items-center gap-2 rounded-xl px-3 py-2.5 min-w-0',
          micDenied ? 'bg-destructive/10' : 'bg-muted/60',
        )}
      >
        {micDenied ? (
          <span className="text-xs text-destructive truncate">دسترسی میکروفون داده نشد</span>
        ) : (
          <>
            <span className="h-2.5 w-2.5 rounded-full bg-destructive animate-pulse shrink-0" />
            <span className="text-xs tabular-nums text-muted-foreground shrink-0">
              {faClock(seconds)}
            </span>
            <div className="flex items-center gap-[2px] h-6 flex-1 min-w-0 overflow-hidden">
              {levels.map((lv, i) => (
                <span
                  key={i}
                  className="flex-1 min-w-[2px] max-w-[5px] rounded-full bg-primary/70"
                  style={{ height: `${Math.min(100, Math.max(10, lv * 100))}%` }}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* ارسال */}
      <Button
        size="icon"
        className="shrink-0"
        onClick={send}
        disabled={finishing || micDenied}
        aria-label="ارسال پیام صوتی"
        title="ارسال پیام صوتی"
      >
        {finishing ? (
          <Loader2 className="h-4.5 w-4.5 animate-spin" />
        ) : (
          <Check className="h-5 w-5" />
        )}
      </Button>
    </div>
  )
}
