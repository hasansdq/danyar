'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  List,
  Loader2,
  School,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  JALALI_MONTHS,
  JALALI_WEEKDAYS,
  JALALI_WEEKDAYS_FULL,
  jalaliMonthGrid,
  jalaliMonthLength,
  monthRange,
  parseDateKey,
  todayDateKey,
  weekdayOfDateKey,
} from '@/lib/jalali'
import { faNum, faNumPlain } from '@/lib/format'
import { DayEventsDialog, type CalendarEventDto } from '@/components/calendar/day-events-dialog'
import { EVENT_TYPE_META, EVENT_TYPE_ORDER, eventDisplayLabel } from '@/components/calendar/event-meta'
import type { ClassEventType } from '@/lib/calendar-events'

const pad2 = (n: number) => String(n).padStart(2, '0')
const dayKeyOf = (jy: number, jm: number, d: number) => `${jy}-${pad2(jm)}-${pad2(d)}`

interface CalendarClassItem {
  id: string
  name: string
  studentCount: number
}

interface ClassCalendarClientProps {
  role: string
  uid: string
  /** کلاس انتخابی از صفحه جزئیات کلاس (?class=…) */
  initialClassId?: string
  /** توکن دیپ‌لینک «ثبت غیبت/نمره/تخلف امروز» (?open=attendance&t=…) —
   *  هر توکن یک بار مصرف است: امروز انتخاب و ویرایشگر حضور و غیاب مستقیم باز می‌شود */
  autoAttendance?: string
}

/**
 * تقویم آموزشی کلاسی — کاملاً کلاس‌محور با تقویم جلالی ایرانی:
 * - نمای شبکه‌ای: ماه کامل با ناوبری آزاد (گذشته هم قابل مشاهده است)؛
 *   روزهای دارای رویداد با رنگ مجزا مشخص می‌شوند.
 * - نمای لیستی: تک‌ستونه از امروز به بعد (گذشته نمایش داده نمی‌شود؛ امروز در صدر)؛
 *   رویدادهای هر روز به‌صورت آیکونی خلاصه می‌شوند.
 * - معلم و مدیر: ثبت رویداد (تعطیل فقط مدیر؛ دامنه کلاس/کل مدرسه فقط مدیر)
 * - دانش‌آموز: فقط مشاهده
 */
export function ClassCalendarClient({ role, uid, initialClassId, autoAttendance }: ClassCalendarClientProps) {
  // معاون همهٔ دسترسی‌های مدیر مدرسه را دارد (درخواست کاربر) — محدودیت‌ها سمت API اعمال می‌شود
  const isAdmin = role === 'SCHOOL_ADMIN' || role === 'SCHOOL_VICE'
  const canCreate = role === 'SCHOOL_ADMIN' || role === 'SCHOOL_VICE' || role === 'TEACHER'

  const [classes, setClasses] = useState<CalendarClassItem[] | null>(null)
  const [classId, setClassId] = useState<string | null>(null)
  // پیش‌فرض: نمای لیستی (تک‌ستونه از امروز به بعد)؛ نمای شبکه‌ای با سوییچ در دسترس است
  const [view, setView] = useState<'grid' | 'list'>('list')
  const [events, setEvents] = useState<CalendarEventDto[]>([])
  const [loadingEvents, setLoadingEvents] = useState(false)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)

  const todayJ = useMemo(() => parseDateKey(todayDateKey())!, [])
  const [gridMonth, setGridMonth] = useState({ jy: todayJ.jy, jm: todayJ.jm })
  const [listMonth, setListMonth] = useState({ jy: todayJ.jy, jm: todayJ.jm })

  // توکن فعال دیپ‌لینک (FAB معلم) — با تغییر prop به‌روز می‌شود
  const [attToken, setAttToken] = useState<string | undefined>(autoAttendance)
  useEffect(() => {
    if (autoAttendance) setAttToken(autoAttendance)
  }, [autoAttendance])

  /* ───── بارگذاری کلاس‌های قابل دسترس ───── */
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch('/api/calendar/classes', { cache: 'no-store' })
        const d = await res.json()
        if (!alive || !res.ok) return
        const list: CalendarClassItem[] = d.classrooms ?? []
        setClasses(list)
        const initial = initialClassId && list.some((c) => c.id === initialClassId)
          ? initialClassId
          : (list[0]?.id ?? null)
        setClassId(initial)
      } catch {
        if (alive) setClasses([])
      }
    })()
    return () => {
      alive = false
    }
  }, [initialClassId])

  /* ───── دیپ‌لینک «ثبت غیبت/نمره/تخلف امروز» (دکمه شناور «+» معلم) ─────
     پس از رسیدن کلاس‌ها: ماه‌ها به امروز برمی‌گردند و امروز انتخاب می‌شود؛
     هر توکن فقط یک بار مصرف است (FAB هر بار توکن تازه می‌فرستد). */
  const attTokenFiredFor = useRef<string | null>(null)
  useEffect(() => {
    if (!attToken || !classes || classes.length === 0) return
    if (attTokenFiredFor.current === attToken) return
    attTokenFiredFor.current = attToken
    setGridMonth({ jy: todayJ.jy, jm: todayJ.jm })
    setListMonth({ jy: todayJ.jy, jm: todayJ.jm })
    setSelectedDay(todayDateKey())
  }, [attToken, classes, todayJ])

  /* ───── بارگذاری رویدادها (پوشش هر دو نما) ───── */
  const fetchEvents = useCallback(async () => {
    if (!classId) return
    const gR = monthRange(gridMonth.jy, gridMonth.jm)
    const lR = monthRange(listMonth.jy, listMonth.jm)
    const from = gR.from < lR.from ? gR.from : lR.from
    const to = gR.to > lR.to ? gR.to : lR.to
    setLoadingEvents(true)
    try {
      const res = await fetch(
        `/api/calendar/events?classroomId=${classId}&from=${from}&to=${to}`,
        { cache: 'no-store' },
      )
      const d = await res.json()
      if (res.ok) setEvents(d.events ?? [])
    } catch {
      /* ignore */
    } finally {
      setLoadingEvents(false)
    }
  }, [classId, gridMonth, listMonth])

  useEffect(() => {
    fetchEvents()
  }, [fetchEvents])

  const eventsByDay = useMemo(() => {
    const map: Record<string, CalendarEventDto[]> = {}
    for (const e of events) {
      ;(map[e.dateKey] ??= []).push(e)
    }
    return map
  }, [events])

  const currentClassName = useMemo(
    () => classes?.find((c) => c.id === classId)?.name ?? '',
    [classes, classId],
  )

  /* ───── ناوبری ماه ───── */
  const moveMonth = (
    m: { jy: number; jm: number },
    dir: 1 | -1,
  ): { jy: number; jm: number } => {
    let jy = m.jy
    let jm = m.jm + dir
    if (jm > 12) {
      jm = 1
      jy++
    }
    if (jm < 1) {
      jm = 12
      jy--
    }
    return { jy, jm }
  }

  const gridCells = useMemo(() => jalaliMonthGrid(gridMonth.jy, gridMonth.jm), [gridMonth])
  const isCurrentListMonth = listMonth.jy === todayJ.jy && listMonth.jm === todayJ.jm
  const listPrevDisabled =
    listMonth.jy * 12 + listMonth.jm <= todayJ.jy * 12 + todayJ.jm

  const listDays = useMemo(() => {
    const startDay = isCurrentListMonth ? todayJ.jd : 1
    const len = jalaliMonthLength(listMonth.jy, listMonth.jm)
    const out: { key: string; day: number }[] = []
    for (let d = startDay; d <= len; d++) {
      out.push({ day: d, key: dayKeyOf(listMonth.jy, listMonth.jm, d) })
    }
    return out
  }, [listMonth, isCurrentListMonth, todayJ])

  if (classes === null) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  if (classes.length === 0) {
    return (
      <div className="mx-auto max-w-xl p-4 sm:p-6">
        <CalendarHeader isAdmin={isAdmin} />
        <Card>
          <CardContent className="p-8 text-center space-y-2">
            <CalendarDays className="mx-auto h-10 w-10 text-muted-foreground/50" />
            <p className="font-bold">کلاسی برای نمایش تقویم آموزشی وجود ندارد</p>
            <p className="text-sm text-muted-foreground">
              {isAdmin
                ? 'برای نمایش تقویم، ابتدا از بخش «مدیریت مدرسه» یک کلاس ایجاد کنید.'
                : role === 'TEACHER'
                  ? 'هنوز به کلاسی منتسب نشده‌اید؛ پس از انتساب گروه درسی، تقویم آن کلاس اینجا نمایش داده می‌شود.'
                  : 'پس از ثبت‌نام در کلاس، تقویم آموزشی آن کلاس اینجا نمایش داده می‌شود.'}
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
      <CalendarHeader isAdmin={isAdmin} />

      {/* انتخاب کلاس + سوییچ نمای شبکه‌ای/لیستی */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <School className="h-4.5 w-4.5 text-muted-foreground" />
          {classes.length > 1 ? (
            <Select
              value={classId ?? undefined}
              onValueChange={(v) => {
                setClassId(v)
                setSelectedDay(null)
              }}
            >
              <SelectTrigger className="w-full sm:w-56" aria-label="انتخاب کلاس تقویم">
                <SelectValue placeholder="انتخاب کلاس" />
              </SelectTrigger>
              <SelectContent>
                {classes.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Badge variant="outline" className="px-3 py-1.5 text-sm">
              کلاس «{currentClassName}»
            </Badge>
          )}
          {loadingEvents && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        <div
          className="inline-flex w-fit rounded-lg border p-1"
          role="group"
          aria-label="نوع نمایش تقویم"
        >
          <button
            type="button"
            aria-pressed={view === 'grid'}
            aria-label="نمای شبکه‌ای"
            onClick={() => setView('grid')}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              view === 'grid'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent',
            )}
          >
            <LayoutGrid className="h-4 w-4" />
            شبکه‌ای
          </button>
          <button
            type="button"
            aria-pressed={view === 'list'}
            aria-label="نمای لیستی"
            onClick={() => setView('list')}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              view === 'list'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent',
            )}
          >
            <List className="h-4 w-4" />
            لیستی
          </button>
        </div>
      </div>

      {/* ───── نمای شبکه‌ای ───── */}
      {view === 'grid' && (
        <div className="rounded-xl border bg-card p-3 sm:p-4" dir="rtl">
          <MonthNav
            title={`${JALALI_MONTHS[gridMonth.jm - 1]} ${faNumPlain(gridMonth.jy)}`}
            onPrev={() => setGridMonth((m) => moveMonth(m, -1))}
            onNext={() => setGridMonth((m) => moveMonth(m, 1))}
          />

          <div className="grid grid-cols-7 gap-1 mb-1">
            {JALALI_WEEKDAYS.map((d, i) => (
              <div
                key={d + i}
                className={cn(
                  'text-center text-[11px] font-medium py-1',
                  i === 6 ? 'text-rose-500' : 'text-muted-foreground',
                )}
              >
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {gridCells.map((day, idx) => {
              if (day === null) return <div key={`e${idx}`} />
              const key = dayKeyOf(gridMonth.jy, gridMonth.jm, day)
              const evs = eventsByDay[key] ?? []
              const hasEvents = evs.length > 0
              const types = [...new Set(evs.map((e) => e.type))] as ClassEventType[]
              const isToday = key === todayDateKey()
              const isSelected = key === selectedDay
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedDay(key)}
                  aria-label={`روز ${faNum(day)} ${JALALI_MONTHS[gridMonth.jm - 1]}${hasEvents ? ' — دارای رویداد' : ''}`}
                  title={hasEvents ? types.map((t) => eventDisplayLabel(t)).join('، ') : undefined}
                  className={cn(
                    'relative flex aspect-square min-h-9 flex-col items-center justify-center rounded-lg border text-sm transition-colors',
                    isSelected
                      ? 'border-primary bg-primary font-bold text-primary-foreground'
                      : hasEvents
                        ? 'border-amber-300 bg-amber-100/80 font-semibold text-amber-900 hover:bg-amber-100 dark:border-amber-500/50 dark:bg-amber-500/15 dark:text-amber-200 dark:hover:bg-amber-500/25'
                        : cn(
                            'border-transparent hover:bg-accent',
                            idx % 7 === 6 && 'text-rose-500',
                          ),
                    !isSelected && isToday && 'ring-2 ring-primary font-bold',
                  )}
                >
                  {/* عدد روز — در دسکتاپ کمی بزرگ‌تر تا در کادر مربعی روز کوچک به نظر نرسد */}
                  <span className="text-[13px] font-medium sm:text-lg sm:leading-7">{faNum(day)}</span>
                  {hasEvents && (
                    <span className="absolute bottom-1 flex gap-0.5" dir="ltr">
                      {types.slice(0, 4).map((t) => (
                        <span
                          key={t}
                          className={cn(
                            'h-1.5 w-1.5 rounded-full',
                            EVENT_TYPE_META[t]?.dotClass ?? 'bg-slate-500',
                            isSelected && 'ring-1 ring-white/70',
                          )}
                        />
                      ))}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            روزهای دارای رویداد با رنگ کهربایی مشخص شده‌اند — برای مشاهده یا ثبت رویداد روی روز کلیک کنید
          </p>
        </div>
      )}

      {/* ───── نمای لیستی ───── */}
      {view === 'list' && (
        <div className="rounded-xl border bg-card p-3 sm:p-4" dir="rtl">
          <MonthNav
            title={`${JALALI_MONTHS[listMonth.jm - 1]} ${faNumPlain(listMonth.jy)}`}
            hint={isCurrentListMonth ? 'از امروز' : undefined}
            onPrev={() => setListMonth((m) => moveMonth(m, -1))}
            onNext={() => setListMonth((m) => moveMonth(m, 1))}
            prevDisabled={listPrevDisabled}
          />

          <div className="divide-y rounded-lg border" aria-label="فهرست روزهای تقویم">
            {listDays.map(({ key, day }) => {
              const evs = eventsByDay[key] ?? []
              const hasEvents = evs.length > 0
              const labels = [...new Set(evs.map((e) => eventDisplayLabel(e.type, e.customTitle)))]
              const weekday = JALALI_WEEKDAYS_FULL[weekdayOfDateKey(key)]
              const isToday = key === todayDateKey()
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedDay(key)}
                  aria-label={`روز ${faNum(day)} ${JALALI_MONTHS[listMonth.jm - 1]}${hasEvents ? ' — دارای رویداد' : ''}`}
                  className={cn(
                    'flex w-full items-center gap-3 p-3 text-right transition-colors hover:bg-accent/60',
                    isToday && 'bg-primary/5',
                  )}
                >
                  <div
                    className={cn(
                      'flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl border',
                      hasEvents
                        ? 'border-amber-300 bg-amber-100/80 text-amber-900 dark:border-amber-500/50 dark:bg-amber-500/15 dark:text-amber-200'
                        : 'text-muted-foreground',
                    )}
                  >
                    <span className="text-base font-bold leading-none">{faNum(day)}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold">
                        {weekday} {faNum(day)} {JALALI_MONTHS[listMonth.jm - 1]}
                      </span>
                      {isToday && (
                        <Badge className="px-2 py-0 text-[10px]" aria-label="امروز">
                          امروز
                        </Badge>
                      )}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {labels.length ? labels.join('، ') : 'بدون رویداد'}
                    </div>
                  </div>
                  {/* پیش‌نمایش آیکونی رویدادهای روز */}
                  <div className="flex shrink-0 items-center gap-1" aria-hidden="true">
                    {evs.slice(0, 5).map((e) => {
                      const meta = EVENT_TYPE_META[e.type as ClassEventType] ?? EVENT_TYPE_META.CUSTOM
                      const Icon = meta.icon
                      return (
                        <span
                          key={e.id}
                          title={eventDisplayLabel(e.type, e.customTitle)}
                          className={cn(
                            'flex h-7 w-7 items-center justify-center rounded-full border-2 border-card',
                            meta.chipClass,
                          )}
                        >
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                      )
                    })}
                    {evs.length > 5 && (
                      <span className="text-[10px] font-medium text-muted-foreground">
                        +{faNum(evs.length - 5)}
                      </span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            نمای لیستی از امروز به بعد است و روزهای گذشته را نمایش نمی‌دهد — روزهای گذشته در نمای شبکه‌ای قابل مشاهده‌اند
          </p>
        </div>
      )}

      {/* راهنمای انواع رویداد (آیکون و رنگ سفارشی هر رویداد) — طبق درخواست کاربر
          از بالای باکس تقویم به پایین آن منتقل شد */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5" aria-label="راهنمای انواع رویداد">
        {EVENT_TYPE_ORDER.map((t) => {
          const meta = EVENT_TYPE_META[t]
          const Icon = meta.icon
          return (
            <span key={t} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground" title={meta.hint}>
              <span className={cn('flex h-5 w-5 items-center justify-center rounded-full', meta.chipClass)}>
                <Icon className="h-3 w-3" />
              </span>
              {meta.label}
            </span>
          )
        })}
      </div>

      {/* دیالوگ روز — مشاهده برای همه، ثبت برای معلم و مدیر */}
      <DayEventsDialog
        open={selectedDay !== null}
        onOpenChange={(o) => {
          if (!o) setSelectedDay(null)
        }}
        dateKey={selectedDay}
        events={selectedDay ? (eventsByDay[selectedDay] ?? []) : []}
        role={role}
        uid={uid}
        classId={classId ?? ''}
        className={currentClassName}
        onChanged={fetchEvents}
        autoOpenAttendance={attToken}
      />
    </div>
  )
}

/* ─────────────────────────── اجزای کمکی ─────────────────────────── */

function CalendarHeader({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div className="space-y-1">
      <h1 className="flex items-center gap-2 text-xl font-bold sm:text-2xl">
        <CalendarDays className="h-6 w-6 text-primary" />
        تقویم آموزشی
      </h1>
      {/* متن «تقویم جلالی کلاس — رویدادهای حال و آینده» حذف شد (درخواست کاربر) — فقط راهنمای ثبت مدیر می‌ماند */}
      {isAdmin && (
        <p className="text-sm text-muted-foreground">ثبت برای کل مدرسه یا کلاس انتخابی</p>
      )}
    </div>
  )
}

function MonthNav({
  title,
  hint,
  onPrev,
  onNext,
  prevDisabled,
}: {
  title: string
  hint?: string
  onPrev: () => void
  onNext: () => void
  prevDisabled?: boolean
}) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <button
        type="button"
        onClick={onNext}
        className="rounded-lg p-1.5 hover:bg-accent"
        aria-label="ماه بعد"
      >
        <ChevronRight className="h-5 w-5" />
      </button>
      <div className="flex items-baseline gap-2 font-bold text-sm sm:text-base">
        {title}
        {hint && <span className="text-[11px] font-normal text-muted-foreground">({hint})</span>}
      </div>
      <button
        type="button"
        onClick={onPrev}
        disabled={prevDisabled}
        className="rounded-lg p-1.5 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-30"
        aria-label="ماه قبل"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
    </div>
  )
}
