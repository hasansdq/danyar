'use client'

import { useMemo, useState } from 'react'
import { ChevronRight, ChevronLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  JALALI_MONTHS,
  JALALI_WEEKDAYS,
  jalaliMonthGrid,
  parseDateKey,
  todayDateKey,
  monthRange,
} from '@/lib/jalali'

export interface CalendarDayInfo {
  /** نقطه‌های نشانگر: کلید رنگ → تعداد (مثلاً حاضر/غایب/پیش‌نویس) */
  dots?: { color: 'green' | 'red' | 'amber' | 'blue'; count: number }[]
}

export interface JalaliCalendarProps {
  /** کلیدهای روز دارای رکورد → اطلاعات نشانگر */
  dayInfo?: Record<string, CalendarDayInfo>
  selected?: string | null
  onSelectDay?: (dateKey: string) => void
  /** ماه اولیه 1404-07 */
  initialMonth?: string
  /** تغییر ماه توسط کاربر (برای بارگذاری نقطه‌های آن ماه) */
  onMonthChange?: (jy: number, jm: number) => void
  className?: string
}

/** تقویم جلالی کاملاً ایرانی — هفته از شنبه، ماه‌های فارسی، اعداد فارسی */
export function JalaliCalendar({
  dayInfo = {},
  selected,
  onSelectDay,
  initialMonth,
  onMonthChange,
  className,
}: JalaliCalendarProps) {
  const today = useMemo(() => todayDateKey(), [])
  const init = useMemo(() => {
    const key = initialMonth ?? today
    const p = parseDateKey(key)
    return { jy: p!.jy, jm: p!.jm }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [jy, setJy] = useState(init.jy)
  const [jm, setJm] = useState(init.jm)

  const cells = useMemo(() => jalaliMonthGrid(jy, jm), [jy, jm])
  const range = useMemo(() => monthRange(jy, jm), [jy, jm])

  const move = (dir: 1 | -1) => {
    let y = jy
    let m = jm + dir
    if (m > 12) {
      m = 1
      y++
    }
    if (m < 1) {
      m = 12
      y--
    }
    setJy(y)
    setJm(m)
    onMonthChange?.(y, m)
  }

  const faNum = (n: number) => new Intl.NumberFormat('fa-IR').format(n)

  return (
    <div className={cn('rounded-xl border bg-card p-3 sm:p-4', className)} dir="rtl">
      <div className="flex items-center justify-between mb-3">
        <button
          type="button"
          onClick={() => move(1)}
          className="rounded-lg p-1.5 hover:bg-accent"
          aria-label="ماه بعد"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
        <div className="font-bold text-sm sm:text-base">
          {JALALI_MONTHS[jm - 1]} {faNum(jy)}
        </div>
        <button
          type="button"
          onClick={() => move(-1)}
          className="rounded-lg p-1.5 hover:bg-accent"
          aria-label="ماه قبل"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
      </div>

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
        {cells.map((day, idx) => {
          if (day === null) return <div key={`e${idx}`} />
          const key = `${jy}-${String(jm).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const isToday = key === today
          const isSelected = key === selected
          const info = dayInfo[key]
          const hasDots = info?.dots?.some((d) => d.count > 0)
          const inRange = key >= range.from && key <= range.to
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelectDay?.(key)}
              aria-label={`${day} ${JALALI_MONTHS[jm - 1]}`}
              className={cn(
                'relative aspect-square min-h-9 rounded-lg text-sm flex flex-col items-center justify-center transition-colors',
                isSelected
                  ? 'bg-primary text-primary-foreground font-bold'
                  : 'hover:bg-accent',
                !isSelected && isToday && 'ring-1 ring-primary text-primary font-bold',
                !isSelected && !isToday && idx % 7 === 6 && 'text-rose-500',
                inRange && hasDots && !isSelected && 'bg-primary/5',
              )}
            >
              <span>{faNum(day)}</span>
              {info?.dots?.length ? (
                <span className="absolute bottom-1 flex gap-0.5" dir="ltr">
                  {info.dots
                    .filter((d) => d.count > 0)
                    .slice(0, 3)
                    .map((d, i) => (
                      <span
                        key={i}
                        title={`${d.count}`}
                        className={cn(
                          'h-1.5 w-1.5 rounded-full',
                          d.color === 'green' && 'bg-emerald-500',
                          d.color === 'red' && 'bg-rose-500',
                          d.color === 'amber' && 'bg-amber-500',
                          d.color === 'blue' && 'bg-sky-500',
                          isSelected && 'ring-1 ring-white/70',
                        )}
                      />
                    ))}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}
