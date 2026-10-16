import {
  CalendarX2,
  PenLine,
  BookOpen,
  PartyPopper,
  Trophy,
  Brain,
  Bus,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'
import type { ClassEventType } from '@/lib/calendar-events'

/**
 * متادیتای نمایش انواع رویداد تقویم آموزشی — هر نوع آیکون و رنگ سفارشی خودش را دارد.
 * فقط برای نقش مدیر مدرسه نوع «تعطیل» در فرم ثبت نمایش داده می‌شود
 * (ولی در فهرست/راهنما برای همه نقش‌ها دیده می‌شود چون مدیر ممکن است ثبت کرده باشد).
 */
export interface EventTypeMeta {
  type: ClassEventType
  label: string
  icon: LucideIcon
  /** حباب آیکون در فهرست رویدادها */
  chipClass: string
  /** نقطه رنگی تقویم شبکه‌ای */
  dotClass: string
  /** متن راهنما (tooltip) */
  hint: string
}

export const EVENT_TYPE_META: Record<ClassEventType, EventTypeMeta> = {
  HOLIDAY: {
    type: 'HOLIDAY',
    label: 'تعطیل',
    icon: CalendarX2,
    chipClass: 'bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-300',
    dotClass: 'bg-rose-500',
    hint: 'روز تعطیل — فقط مدیر مدرسه',
  },
  EXAM: {
    type: 'EXAM',
    label: 'امتحان',
    icon: PenLine,
    chipClass: 'bg-violet-100 text-violet-600 dark:bg-violet-500/20 dark:text-violet-300',
    dotClass: 'bg-violet-500',
    hint: 'امتحان',
  },
  HOMEWORK: {
    type: 'HOMEWORK',
    label: 'تکلیف',
    icon: BookOpen,
    chipClass: 'bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-300',
    dotClass: 'bg-amber-500',
    hint: 'تکلیف درسی — معلم همراه با ثبت رویداد، تکلیف گروه درسی را می‌سازد',
  },
  PARTY: {
    type: 'PARTY',
    label: 'جشن',
    icon: PartyPopper,
    chipClass: 'bg-pink-100 text-pink-600 dark:bg-pink-500/20 dark:text-pink-300',
    dotClass: 'bg-pink-500',
    hint: 'جشن',
  },
  SPORTS: {
    type: 'SPORTS',
    label: 'مسابقه ورزشی',
    icon: Trophy,
    chipClass: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300',
    dotClass: 'bg-emerald-500',
    hint: 'مسابقه ورزشی',
  },
  ACADEMIC: {
    type: 'ACADEMIC',
    label: 'مسابقه علمی',
    icon: Brain,
    chipClass: 'bg-sky-100 text-sky-600 dark:bg-sky-500/20 dark:text-sky-300',
    dotClass: 'bg-sky-500',
    hint: 'مسابقه علمی',
  },
  TRIP: {
    type: 'TRIP',
    label: 'اردو',
    icon: Bus,
    chipClass: 'bg-teal-100 text-teal-600 dark:bg-teal-500/20 dark:text-teal-300',
    dotClass: 'bg-teal-500',
    hint: 'اردو',
  },
  CUSTOM: {
    type: 'CUSTOM',
    label: 'رویداد سفارشی',
    icon: Sparkles,
    chipClass: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300',
    dotClass: 'bg-indigo-500',
    hint: 'رویداد سفارشی',
  },
}

/** ترتیب نمایش انواع رویداد در فرم ثبت و راهنما */
export const EVENT_TYPE_ORDER: ClassEventType[] = [
  'HOLIDAY',
  'EXAM',
  'HOMEWORK',
  'PARTY',
  'SPORTS',
  'ACADEMIC',
  'TRIP',
  'CUSTOM',
]

/** عنوان نمایشی رویداد (نام سفارشی در صورت وجود) */
export function eventDisplayLabel(type: string, customTitle?: string | null): string {
  if (type === 'CUSTOM' && customTitle) return customTitle
  const meta = EVENT_TYPE_META[type as ClassEventType]
  return meta ? meta.label : type
}
