'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { MonitorPlay, LogIn, Ban, Loader2 } from 'lucide-react'
import { getSocket } from '@/components/messenger/socket-client'

/**
 * پاپ‌آپ «کلاس شما شروع شد!» — برای دانش‌آموزان، روی هر صفحه‌ای که باشند:
 * - با رویداد بلادرنگ live:class-started (فقط دانش‌آموزان عضو همان کلاس دریافت می‌کنند)
 * - هر شروع جلسه شناسه یکتا دارد؛ دریافت تکراری/اتصال مجدد هرگز پاپ‌آپ دوباره نمی‌سازد
 *   (ضدتکرار با مجموعه seen در localStorage + بررسی درون‌صفحه‌ای)
 * - دانش‌آموزی که داخل همان جلسه است پاپ‌آپ نمی‌بیند (و تا خروج از جلسه، صف پنهان می‌ماند)
 * - دانش‌آموز آفلاین: پس از اتصال مجدد سوکت، جلسات فعال اعلام‌شده از سرور خوانده و دعوت معتبر نمایش داده می‌شود
 * - جلسه پایان‌یافته پاپ‌آپ شروع نمی‌سازد؛ اگر هنگام نمایش پایان یابد، دکمه ورود غیرفعال و
 *   وضعیت «کلاس پایان یافته است» نمایش داده می‌شود
 * - چند جلسه هم‌زمان → صف عمودی قابل مدیریت، بدون روی‌هم‌افتادگی
 * - صدای هشدار اختیاری و مطابق تنظیمات کاربر و محدودیت مرورگر؛ نمایش پاپ‌آپ به صدا وابسته نیست
 * - ورود به کلاس مجدد در سرور بررسی می‌شود؛ دوربین/میکروفون بدون اقدام خود کاربر روشن نمی‌شود
 */

interface ClassStartInvite {
  sessionId: string
  title: string
  teacherName: string
  classroomName: string
  startedAt: string
  ended: boolean
}

const SEEN_KEY = 'daniar_class_start_seen'

/** زنگ کوتاه دو نتی — اختیاری؛ اگر مرورگر پخش خودکار را مجاز نداند بی‌صدا رد می‌شود */
function playStartChime() {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    if (ctx.state !== 'running') {
      // بدون تعامل کاربر مرورگر پخش را مسدود کرده — صدا اختیاری است و پاپ‌آپ مستقل نمایش داده می‌شود
      void ctx.close()
      return
    }
    const now = ctx.currentTime
    const notes: [number, number][] = [
      [880, 0],
      [1174.66, 0.18],
    ]
    for (const [freq, delay] of notes) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, now + delay)
      gain.gain.exponentialRampToValueAtTime(0.09, now + delay + 0.03)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.55)
      osc.connect(gain).connect(ctx.destination)
      osc.start(now + delay)
      osc.stop(now + delay + 0.6)
    }
    window.setTimeout(() => void ctx.close().catch(() => null), 1400)
  } catch {
    /* صدا اختیاری است */
  }
}

export function ClassStartPopup({ role }: { role: string }) {
  const router = useRouter()
  const pathname = usePathname()

  const [invites, setInvites] = useState<ClassStartInvite[]>([])
  const [entering, setEntering] = useState<string | null>(null)

  const seenRef = useRef<Set<string> | null>(null)
  const soundPrefRef = useRef<boolean>(true)
  const pathnameRef = useRef(pathname)
  pathnameRef.current = pathname
  // آینه وضعیت دعوت‌ها برای بررسی ضدتکرار همگام (پیش از setInvites)
  const invitesRef = useRef<ClassStartInvite[]>([])
  invitesRef.current = invites

  const isStudent = role === 'STUDENT'

  // ─── مجموعه «دیده‌شده‌ها» برای ضدتکرار ماندگار ───
  const loadSeen = useCallback((): Set<string> => {
    if (seenRef.current) return seenRef.current
    try {
      const raw = localStorage.getItem(SEEN_KEY)
      seenRef.current = new Set<string>(raw ? (JSON.parse(raw) as string[]) : [])
    } catch {
      seenRef.current = new Set<string>()
    }
    return seenRef.current
  }, [])

  const markSeen = useCallback(
    (id: string) => {
      const s = loadSeen()
      s.add(id)
      const arr = [...s].slice(-60) // سقف حافظه: ۶۰ شناسه اخیر
      seenRef.current = new Set(arr)
      try {
        localStorage.setItem(SEEN_KEY, JSON.stringify(arr))
      } catch {
        /* ignore */
      }
    },
    [loadSeen],
  )

  const isViewing = useCallback(
    (sessionId: string) => {
      const p = pathnameRef.current ?? ''
      return p === `/live/${sessionId}` || p.startsWith(`/live/${sessionId}/`)
    },
    [],
  )

  // ─── افزودن دعوت به صف (با همه گیت‌های ضدتکرار) ───
  const addInvite = useCallback(
    (inv: Omit<ClassStartInvite, 'ended'>) => {
      if (isViewing(inv.sessionId)) return
      // بررسی پیشِ همگام: زنگ فقط برای دعوتی پخش می‌شود که واقعاً به صف اضافه می‌شود
      // (قبلاً زنگ برای دعوت تکراری/دیده‌شده هم پخش می‌شد بدون نمایش پاپ‌آپ)
      if (invitesRef.current.some((x) => x.sessionId === inv.sessionId)) return
      if (loadSeen().has(inv.sessionId)) return
      setInvites((prev) => {
        if (prev.some((x) => x.sessionId === inv.sessionId)) return prev
        if (loadSeen().has(inv.sessionId)) return prev
        return [...prev, { ...inv, ended: false }]
      })
      if (soundPrefRef.current) playStartChime()
    },
    [isViewing, loadSeen],
  )

  // ─── بازیابی جلسات فعال اعلام‌شده از سرور (اتصال مجدد / بازکردن برنامه) ───
  const refreshActive = useCallback(async () => {
    try {
      const r = await fetch('/api/live-sessions', { cache: 'no-store' })
      if (!r.ok) return
      const d = await r.json()
      for (const c of d.classrooms ?? []) {
        const s = c.activeSession
        // فقط جلسات «اعلام‌شده» دعوت دارند؛ جلسه بدون استریم آماده هرگز پاپ‌آپ نمی‌شود
        if (s?.announcedAt) {
          addInvite({
            sessionId: s.id,
            title: s.title,
            teacherName: s.hostName,
            classroomName: c.name,
            startedAt: s.startedAt,
          })
        }
      }
    } catch {
      /* ignore */
    }
  }, [addInvite])

  // تنظیم صدای هشدار کاربر (نمایش پاپ‌آپ به آن وابسته نیست)
  useEffect(() => {
    if (!isStudent) return
    let alive = true
    fetch('/api/me/notification-prefs', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d && typeof d.soundEnabled === 'boolean') {
          soundPrefRef.current = d.soundEnabled
        }
      })
      .catch(() => null)
    return () => {
      alive = false
    }
  }, [isStudent])

  // شنونده‌های بلادرنگ + بازیابی اولیه
  useEffect(() => {
    if (!isStudent) return
    const socket = getSocket()

    const onStarted = (data: {
      sessionId?: string
      title?: string
      teacherName?: string
      classroomName?: string
      startedAt?: string
    }) => {
      if (!data?.sessionId) return
      addInvite({
        sessionId: data.sessionId,
        title: data.title ?? 'کلاس آنلاین',
        teacherName: data.teacherName ?? '',
        classroomName: data.classroomName ?? '',
        startedAt: data.startedAt ?? new Date().toISOString(),
      })
    }

    const onStatus = (data: { sessionId?: string; status?: string }) => {
      if (!data?.sessionId) return
      if (data.status === 'ACTIVE') return
      setInvites((prev) =>
        prev.map((x) => (x.sessionId === data.sessionId ? { ...x, ended: true } : x)),
      )
    }

    const onConnect = () => {
      // اتصال مجدد پس از آفلاین بودن هنگام شروع کلاس → بررسی جلسات فعال معتبر
      refreshActive()
    }

    socket.on('live:class-started', onStarted)
    socket.on('live:session-status', onStatus)
    socket.on('connect', onConnect)
    // بارگذاری اولیه: اگر کلاس هنگام نبودن کاربر شروع شده باشد
    refreshActive()

    return () => {
      socket.off('live:class-started', onStarted)
      socket.off('live:session-status', onStatus)
      socket.off('connect', onConnect)
    }
  }, [isStudent, addInvite, refreshActive])

  // دانش‌آموزی که وارد همان جلسه شد، پاپ‌آپ ورود آن جلسه را نمی‌بیند
  useEffect(() => {
    setInvites((prev) =>
      prev.filter((x) => {
        const p = pathname ?? ''
        const viewing = p === `/live/${x.sessionId}` || p.startsWith(`/live/${x.sessionId}/`)
        return !viewing
      }),
    )
  }, [pathname])

  // ─── اقدام‌ها ───
  const enter = useCallback(
    async (sessionId: string) => {
      setEntering(sessionId)
      try {
        // بررسی مجوز و وضعیت واقعی جلسه در سرور (ورود نهایی هم در سرور بررسی می‌شود)
        const r = await fetch(`/api/live-sessions/${sessionId}`, { cache: 'no-store' })
        const d = await r.json().catch(() => null)
        if (!r.ok || !d || d.status !== 'ACTIVE') {
          setInvites((prev) =>
            prev.map((x) => (x.sessionId === sessionId ? { ...x, ended: true } : x)),
          )
          return
        }
        markSeen(sessionId)
        setInvites((prev) => prev.filter((x) => x.sessionId !== sessionId))
        router.push(`/live/${sessionId}`)
      } catch {
        /* خطای شبکه — دعوت می‌ماند تا دوباره تلاش شود */
      } finally {
        setEntering(null)
      }
    },
    [markSeen, router],
  )

  const later = useCallback(
    (sessionId: string) => {
      // «بعداً»: پاپ‌آپ همین جلسه بسته می‌شود؛ جلسه فعال همچنان در بخش
      // کلاس آنلاین و پیام دعوت گروه قابل دسترسی است
      markSeen(sessionId)
      setInvites((prev) => prev.filter((x) => x.sessionId !== sessionId))
    },
    [markSeen],
  )

  if (!isStudent || !invites.length) return null

  // داخل اتاق جلسه پاپ‌آپ نمایش داده نمی‌شود (صف حفظ می‌شود و پس از خروج برمی‌گردد)
  if (pathname.startsWith('/live/')) return null

  return (
    <div
      className="fixed z-[60] bottom-20 lg:bottom-6 start-3 sm:start-6 w-[calc(100vw-1.5rem)] sm:w-96 flex flex-col gap-2.5 pointer-events-none"
      role="region"
      aria-label="دعوت به کلاس آنلاین"
    >
      {invites.map((inv) => (
        <div
          key={inv.sessionId}
          data-class-start-popup={inv.sessionId}
          className="daniar-pop-in pointer-events-auto rounded-2xl border-2 border-emerald-500/50 bg-card shadow-xl overflow-hidden"
        >
          <div className="flex items-start gap-3 p-4 pb-2.5">
            <span
              className="daniar-attention h-11 w-11 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0"
              aria-hidden="true"
            >
              <MonitorPlay className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-extrabold text-emerald-700 dark:text-emerald-400">
                کلاس شما شروع شد!
              </div>
              <div className="text-xs font-bold mt-0.5 truncate">{inv.title}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                معلم: {inv.teacherName} — کلاس: {inv.classroomName}
              </div>
              {inv.ended && (
                <div className="text-[11px] text-red-600 dark:text-red-400 font-bold mt-1.5 flex items-center gap-1">
                  <Ban className="h-3.5 w-3.5" />
                  کلاس پایان یافته است
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-2 px-4 pb-3.5">
            <button
              onClick={() => enter(inv.sessionId)}
              disabled={inv.ended || entering === inv.sessionId}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {entering === inv.sessionId ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LogIn className="h-4 w-4" />
              )}
              {inv.ended ? 'کلاس پایان یافته است' : 'ورود به کلاس'}
            </button>
            <button
              onClick={() => later(inv.sessionId)}
              className="inline-flex items-center justify-center rounded-lg border bg-muted/50 px-3.5 py-2 text-xs font-bold text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              بعداً
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
