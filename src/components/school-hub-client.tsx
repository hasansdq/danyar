'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Layers,
  BookOpen,
  BookMarked,
  GraduationCap,
  Megaphone,
  Bell,
  ShieldCheck,
  Users,
  Video,
  Settings2,
  Loader2,
  UsersRound,
  FileQuestion,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import { faNum } from '@/lib/format'
import { HubPerformanceSection } from '@/components/performance/hub-performance-section'

interface StatItem {
  key: string
  label: string
  value: number
}

interface DashboardStats {
  schoolName: string
  stats: StatItem[]
}

const STAT_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  classes: Layers,
  groups: BookOpen,
  teachers: Users,
  deputies: ShieldCheck,
  students: GraduationCap,
  lessons: BookMarked,
  announcements: Megaphone,
  onlineClasses: Video,
  notifications: Bell,
}

/** مقصد آیکون‌های هر کارت آماری:
 *  + → صفحهٔ «فقط فرم افزودن» همان مورد؛ تنظیمات (⚙) → صفحهٔ فهرست و مدیریت.
 *  اطلاعیه‌ها هم مثل بقیه دو آیکون دارد (درخواست کاربر):
 *  + → ارسال اطلاعیه جدید، تنظیمات → لیست اطلاعیه‌های اخیر و مدیریت آنها */
const STAT_LINKS: Record<
  string,
  { href?: string; title: string; createHref?: string; createTitle?: string }
> = {
  classes: {
    href: '/modir/classes',
    title: 'لیست کلاس‌ها و مدیریت آنها',
    createHref: '/modir/classes/add',
    createTitle: 'ایجاد کلاس جدید',
  },
  groups: {
    href: '/modir/groups',
    title: 'لیست گروه‌ها و مدیریت آنها',
    createHref: '/modir/groups/add',
    createTitle: 'ایجاد گروه جدید',
  },
  teachers: {
    href: '/modir/users?role=TEACHER',
    title: 'لیست معلمان و مدیریت آنها',
    createHref: '/modir/users/add?create=teacher',
    createTitle: 'ایجاد معلم جدید',
  },
  deputies: {
    href: '/modir/deputies',
    title: 'لیست معاونین و مدیریت آنها',
    createHref: '/modir/deputies/add',
    createTitle: 'افزودن معاون جدید',
  },
  students: {
    href: '/modir/users?role=STUDENT',
    title: 'لیست دانش‌آموزان و مدیریت آنها',
    createHref: '/modir/users/add?create=student',
    createTitle: 'ایجاد دانش‌آموز جدید',
  },
  // درس‌ها (درخواست کاربر): + → فرم لیستی افزودن چند درس؛ تنظیمات → فهرست و مدیریت
  lessons: {
    href: '/modir/lessons',
    title: 'لیست درس‌ها و مدیریت آنها',
    createHref: '/modir/lessons/add',
    createTitle: 'افزودن درس‌ها',
  },
  announcements: {
    href: '/modir/announcements',
    title: 'لیست اطلاعیه‌های اخیر و مدیریت آنها',
    createHref: '/modir/announcements/add',
    createTitle: 'ارسال اطلاعیه جدید',
  },
  onlineClasses: { href: '/live', title: 'مدیریت کلاس‌های آنلاین' },
  notifications: { href: '/modir/notifications', title: 'مدیریت اعلان‌ها' },
}

/** مجوز مربوط به هر کارت برای معاون (کلیدهای VicePermission) —
 *  نبود کلید list یعنی صفحهٔ فهرست همیشه باز است؛ نبود کلید create یعنی افزودن همیشه مجاز.
 *  adminOnly یعنی کارت فقط برای مدیر مدرسی نمایش داده می‌شود. */
const CARD_PERMS: Record<string, { list?: string; create?: string; adminOnly?: boolean }> = {
  classes: { list: 'classes', create: 'classes' },
  groups: { list: 'groups', create: 'groups' },
  lessons: { list: 'lessons', create: 'lessons' },
  // فهرست معلمان/دانش‌آموزان برای معاون همیشه باز است؛ افزودن نیازمند مجوز ثبت‌نام
  teachers: { create: 'register_teachers' },
  students: { create: 'register_students' },
  deputies: { adminOnly: true },
  announcements: { list: 'announcements', create: 'announcements' },
  onlineClasses: { list: 'live' },
  notifications: { list: 'push_notifications' },
}

/**
 * شمارنده متحرک آمار — نمایش عدد از ۰ تا مقدار نهایی با easing;
 * در به‌روزرسانی‌های بعدی از مقدار قبلی تا مقدار جدید حرکت می‌کند;
 * با prefers-reduced-motion بلافاصله مقدار نهایی نمایش داده می‌شود.
 */
function AnimatedNumber({ value }: { value?: number }) {
  const [display, setDisplay] = useState(0)
  const prevRef = useRef(0)

  useEffect(() => {
    if (value === undefined) return
    const from = prevRef.current
    const to = value
    if (to === from) return
    const reduced =
      typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    let raf = 0
    if (reduced) {
      // بدون انیمیشن — پرش مستقیم به مقدار نهایی (در فریم بعدی برای پرهیز از رندر آبشاری)
      raf = requestAnimationFrame(() => {
        prevRef.current = to
        setDisplay(to)
      })
      return () => cancelAnimationFrame(raf)
    }
    const duration = 1100
    const start = performance.now()
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - p, 3) // ease-out cubic
      setDisplay(Math.round(from + (to - from) * eased))
      if (p < 1) raf = requestAnimationFrame(tick)
      else prevRef.current = to
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value])

  return (
    <span className="tabular-nums" dir="ltr">
      {faNum(display)}
    </span>
  )
}

/**
 * هاب «مدیریت مدرسه» — صفحهٔ مستقل باکس‌های آماری (درخواست کاربر: هشت باکس
 * کاملاً جداگانه در صفحهٔ خودشان قرار بگیرند، نه داخل تب فهرست کلاس‌ها).
 * هر باکس: شمارنده + آیکون + (صفحهٔ فقط-فرم افزودن) + آیکون تنظیمات (فهرست و مدیریت).
 */
export function SchoolHubClient({
  role,
  canManageDeputies = true,
}: {
  role: string
  canManageDeputies?: boolean
}) {
  const router = useRouter()
  const [schoolStats, setSchoolStats] = useState<DashboardStats | null>(null)
  // نقشهٔ مجوزهای معاون (سوییچ‌های مدیر مدرسه) — null یعنی بدون محدودیت/مدیر مدرسه
  const [perms, setPerms] = useState<Record<string, boolean> | null>(null)
  const isVice = role === 'SCHOOL_VICE'

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch('/api/dashboard', { cache: 'no-store' })
        if (res.ok && alive) {
          const d = await res.json()
          setSchoolStats({ schoolName: d.schoolName ?? '', stats: d.stats ?? [] })
        }
      } catch {
        /* بی‌صدا — آمار فقط نمایشی است */
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  // مجوزهای معاون برای نمایش/مخفی‌کردن آیکون‌های هر کارت
  useEffect(() => {
    if (!isVice) return
    let alive = true
    ;(async () => {
      try {
        const res = await fetch('/api/me', { cache: 'no-store' })
        if (res.ok && alive) {
          const d = await res.json()
          if (d.vicePermissions) setPerms(d.vicePermissions)
        }
      } catch {
        /* ignore */
      }
    })()
    return () => {
      alive = false
    }
  }, [isVice])

  /** مجوز روشن است؟ (مدیر مدرسه همیشه؛ معاون بر اساس سوییچ — پیش‌فرض روشن) */
  const permOn = (key?: string) => {
    if (!key || !isVice) return true
    return perms ? (perms[key] ?? true) : true
  }

  const stats = (schoolStats?.stats ?? []).filter((s) => {
    // کارت معاونین فقط برای مدیر مدرسه — صفحهٔ مدیریت معاونین برای معاون بسته است
    if (isVice && CARD_PERMS[s.key]?.adminOnly) return false
    return true
  })

  return (
    <div className="max-w-5xl mx-auto px-3 py-5 sm:px-4 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">مدیریت مدرسه</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {schoolStats?.schoolName || 'آمار مدرسه'}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap min-w-0">
          {canManageDeputies && (
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <a href="/modir/deputies" data-testid="deputies-link">
                <ShieldCheck className="h-4 w-4" />
                معاونین و دسترسی‌ها
              </a>
            </Button>
          )}
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <a href="/modir/users">
              <UsersRound className="h-4 w-4" />
              کاربران
            </a>
          </Button>
          {permOn('push_notifications') && (
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <a href="/modir/notifications">
                <Bell className="h-4 w-4" />
                اعلان‌ها
              </a>
            </Button>
          )}
          {permOn('announcements') && (
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <a href="/modir/announcements">
                <Megaphone className="h-4 w-4" />
                اطلاعیه‌ها
              </a>
            </Button>
          )}
          {/* نمونه‌سؤالات — از سایدبار به دکمهٔ بالای صفحهٔ مدیریت مدرسه منتقل شد (درخواست کاربر) */}
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <a href="/sample-questions" data-testid="sample-questions-link">
              <FileQuestion className="h-4 w-4" />
              نمونه‌سؤالات
            </a>
          </Button>
        </div>
      </div>

      {/* باکس‌های آماری — صفحهٔ مستقل هاب؛ هر باکس + (افزودن) و تنظیمات (فهرست/مدیریت) */}
      {schoolStats === null ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3" aria-busy="true">
          {(isVice
            ? ['classes', 'groups', 'teachers', 'students', 'lessons', 'announcements', 'onlineClasses', 'notifications']
            : ['classes', 'groups', 'teachers', 'students', 'lessons', 'deputies', 'announcements', 'onlineClasses', 'notifications']
          ).map((k) => (
              <Card key={k} className="animate-pulse">
                <CardContent className="p-4 pb-3 flex flex-col items-center gap-2 text-center">
                  <div className="h-5 w-5 rounded bg-muted" />
                  <div className="h-7 w-10 rounded bg-muted" />
                  <div className="h-3 w-16 rounded bg-muted" />
                </CardContent>
              </Card>
            ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {stats.map((s) => {
            const Icon = STAT_ICONS[s.key] ?? Layers
            const link = STAT_LINKS[s.key]
            const cardPerms = CARD_PERMS[s.key]
            const showSettings = !!link?.href && permOn(cardPerms?.list)
            const showCreate = !!link?.createHref && permOn(cardPerms?.create)
            return (
              <StatCard
                key={s.key}
                icon={<Icon className="h-5 w-5 text-primary" />}
                label={s.label}
                value={s.value}
                action={
                  showSettings
                    ? { title: link!.title!, onClick: () => router.push(link!.href!) }
                    : null
                }
                createAction={
                  showCreate
                    ? { title: link!.createTitle!, onClick: () => router.push(link!.createHref!) }
                    : null
                }
              />
            )
          })}
        </div>
      )}

      {/* بخش آماری مستقل «گزارش عملکرد دانش‌آموزان» — زیر باکس‌ها (درخواست کاربر):
          فهرست آماری با ستون‌های تخلفات/میانگین/آخرین نمره/غیبت‌ها + ورود به ریز گزارش */}
      <HubPerformanceSection />
    </div>
  )
}

/** کارت آماری مربعی — شمارنده متحرک + دکمه‌های + و تنظیمات (۵۰٪ بزرگ‌تر)
 *  + هاور زوم: با آمدن موس کارت کمی بزرگ‌تر و برجسته می‌شود */
function StatCard({
  icon,
  label,
  value,
  action,
  createAction,
}: {
  icon: React.ReactNode
  label: string
  value?: number
  action?: { title: string; onClick: () => void } | null
  createAction?: { title: string; onClick: () => void } | null
}) {
  return (
    <Card
      className="relative overflow-hidden transition-all duration-200 ease-out
        hover:scale-[1.05] hover:shadow-lg hover:border-primary/40 hover:z-10
        active:scale-[0.98] cursor-default
        motion-reduce:transition-none motion-reduce:hover:scale-100"
    >
      <CardContent className="p-4 pb-3 flex flex-col items-center gap-1.5 text-center">
        {icon}
        <span className="text-2xl font-bold">
          {value === undefined ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : (
            <AnimatedNumber value={value} />
          )}
        </span>
        <span className="text-xs text-muted-foreground leading-tight">{label}</span>
        {(action || createAction) && (
          <div className="mt-1 flex items-center justify-center gap-2">
            {createAction && (
              <button
                type="button"
                onClick={createAction.onClick}
                title={createAction.title}
                aria-label={createAction.title}
                className="h-[42px] w-[42px] rounded-full border bg-background/70 text-muted-foreground flex items-center justify-center transition-colors hover:bg-primary hover:text-primary-foreground hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Plus className="h-[21px] w-[21px]" />
              </button>
            )}
            {action && (
              <button
                type="button"
                onClick={action.onClick}
                title={action.title}
                aria-label={action.title}
                className="h-[42px] w-[42px] rounded-full border bg-background/70 text-muted-foreground flex items-center justify-center transition-colors hover:bg-primary hover:text-primary-foreground hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Settings2 className="h-[21px] w-[21px]" />
              </button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
