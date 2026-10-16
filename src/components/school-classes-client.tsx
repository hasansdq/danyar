'use client'

import { useCallback, useEffect, useRef, useState, FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Plus,
  Loader2,
  Layers,
  ChevronLeft,
  Trash2,
  BookOpen,
  GraduationCap,
  Search,
  Megaphone,
  Bell,
  Users,
  UsersRound,
  Video,
  Settings2,
  MessageSquareLock,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { toast } from '@/hooks/use-toast'
import { faNum } from '@/lib/format'
import {
  BRANCH_MAX,
  GRADE_OPTIONS,
  SUBJECT_OPTIONS,
  composeClassName,
  toPersianDigits,
} from '@/lib/school'

interface Classroom {
  id: string
  name: string
  grade?: string | null
  allowStudentDm: boolean
  _count: { subjectGroups: number; enrollments: number }
}

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
  students: GraduationCap,
  announcements: Megaphone,
  onlineClasses: Video,
  notifications: Bell,
}

/** مقصد مدیریت هر کارت آماری — یا لینک خارجی یا تغییر تب همین صفحه؛
 *  کارت‌های معلمان/دانش‌آموزان علاوه بر مدیریت، آیکون + برای ایجاد مستقیم دارند */
const STAT_LINKS: Record<
  string,
  { href?: string; tab?: 'classes'; title: string; createHref?: string; createTitle?: string }
> = {
  classes: { tab: 'classes', title: 'لیست کلاس‌ها و مدیریت آنها' },
  groups: { href: '/modir/groups', title: 'مدیریت گروه‌ها' },
  teachers: {
    href: '/modir/users?role=TEACHER',
    title: 'لیست معلمان و مدیریت آنها',
    createHref: '/modir/users?create=teacher',
    createTitle: 'ایجاد معلم جدید',
  },
  students: {
    href: '/modir/users?role=STUDENT',
    title: 'لیست دانش‌آموزان و مدیریت آنها',
    createHref: '/modir/users?create=student',
    createTitle: 'ایجاد دانش‌آموز جدید',
  },
  announcements: { href: '/modir/announcements', title: 'مدیریت اطلاعیه‌ها' },
  onlineClasses: { href: '/live', title: 'مدیریت کلاس‌های آنلاین' },
  notifications: { href: '/modir/notifications', title: 'مدیریت اعلان‌ها' },
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
    let timer = 0
    if (reduced) {
      // بدون انیمیشن — پرش مستقیم به مقدار نهایی (در فریم بعد برای پرهیز از رندر آبشاری)
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
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(timer)
    }
  }, [value])

  return <span className="tabular-nums" dir="ltr">{faNum(display)}</span>
}

export function SchoolClassesClient() {
  const router = useRouter()
  const tabsRef = useRef<HTMLDivElement>(null)
  const [classes, setClasses] = useState<Classroom[] | null>(null)
  const [schoolStats, setSchoolStats] = useState<DashboardStats | null>(null)
  // فرم دو فیلدی ایجاد کلاس: پایه (کشویی) + شعبه (متنی) → «هفتم ۷۰۳»
  const [grade, setGrade] = useState('')
  const [branch, setBranch] = useState('')
  const [creating, setCreating] = useState(false)
  const [query, setQuery] = useState('')
  // محدودیت گروه‌ها: کلید گفتگوی خصوصی دانش‌آموزان — id کلاس در حال ذخیره یا 'all'
  const [dmPendingId, setDmPendingId] = useState<string | null>(null)

  const classNamePreview = grade && branch.trim() ? composeClassName(grade, branch) : ''

  const load = useCallback(async () => {
    const res = await fetch('/api/classes')
    if (res.ok) {
      const data = await res.json()
      setClasses(data.classrooms)
    }
  }, [])

  // آمار مدرسه (داشبورد سابق مدیر مدرسه — اینجا ادغام شد)
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
        /* بی‌صدا — آمار فقط نمایشی است و خطای بارگذاری مانع مدیریت نمی‌شود */
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function createClass(e: FormEvent) {
    e.preventDefault()
    if (creating) return
    setCreating(true)
    try {
      const res = await fetch('/api/classes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grade, branch: branch.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: data.error ?? 'ایجاد کلاس ناموفق بود', variant: 'destructive' })
        return
      }
      toast({ title: `کلاس «${data.classroom.name}» ایجاد شد` })
      setGrade('')
      setBranch('')
      await load()
    } finally {
      setCreating(false)
    }
  }

  async function deleteClass(id: string, className: string) {
    const res = await fetch(`/api/classes/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const data = await res.json()
      toast({ title: data.error ?? 'حذف ناموفق بود', variant: 'destructive' })
      return
    }
    toast({ title: `کلاس «${className}» حذف شد` })
    await load()
  }

  // جست‌وجو با ارقام لاتین هم باید «هفتم ۷۰۳» را بیابد → پرس‌وجو به ارقام فارسی نرمال می‌شود
  const filteredClasses = (classes ?? []).filter((c) =>
    query.trim() ? c.name.includes(toPersianDigits(query.trim())) : true,
  )
  const canCreateClass = Boolean(grade) && Boolean(branch.trim()) && !creating

  /** اسکرول به بخش کلاس‌ها (ورود از کارت آماری کلاس‌ها) */
  function goToClasses() {
    requestAnimationFrame(() => {
      tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  /** عملکرد آیکون ورود به مدیریت هر کارت */
  function statAction(key: string): { title: string; onClick: () => void } | null {
    const link = STAT_LINKS[key]
    if (!link) return null
    if (link.tab) return { title: link.title, onClick: () => goToClasses() }
    return { title: link.title, onClick: () => router.push(link.href!) }
  }

  /** عملکرد آیکون + (ایجاد سریع) برای کارت‌های معلمان/دانش‌آموزان */
  function statCreateAction(key: string): { title: string; onClick: () => void } | null {
    const link = STAT_LINKS[key]
    if (!link?.createHref) return null
    return { title: link.createTitle!, onClick: () => router.push(link.createHref!) }
  }

  /** تعداد کلاس‌هایی که گفتگوی خصوصی دانش‌آموزانشان فعال است + وضعیت کلید سراسری */
  const enabledDmCount = (classes ?? []).filter((c) => c.allowStudentDm).length
  const allDmEnabled = (classes ?? []).length > 0 && enabledDmCount === (classes ?? []).length

  /** تغییر کلید گفتگوی خصوصی دانش‌آموزان — یک کلاس یا همه کلاس‌ها ('all') */
  async function setClassroomDm(classroomId: string | 'all', allow: boolean) {
    if (dmPendingId) return
    setDmPendingId(classroomId)
    try {
      const url = classroomId === 'all' ? '/api/classes' : `/api/classes/${classroomId}`
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowStudentDm: allow }),
      })
      if (!res.ok) {
        const data = await res.json()
        toast({ title: data.error ?? 'ثبت تنظیم ناموفق بود', variant: 'destructive' })
        return
      }
      setClasses(
        (prev) =>
          prev?.map((c) =>
            classroomId === 'all' || c.id === classroomId ? { ...c, allowStudentDm: allow } : c,
          ) ?? null,
      )
      toast({
        title:
          allow
            ? classroomId === 'all'
              ? 'گفتگوی خصوصی بین دانش‌آموزان در همه کلاس‌ها فعال شد'
              : 'گفتگوی خصوصی هم‌کلاسی‌ها فعال شد'
            : classroomId === 'all'
              ? 'گفتگوی خصوصی بین دانش‌آموزان در همه کلاس‌ها غیرفعال شد'
              : 'گفتگوی خصوصی هم‌کلاسی‌ها غیرفعال شد',
      })
    } catch {
      toast({ title: 'خطا در برقراری ارتباط با سرور', variant: 'destructive' })
    } finally {
      setDmPendingId(null)
    }
  }

  /** تعیین پایهٔ کلاس‌های قدیمی بدون پایه — همه دانش‌آموزان کلاس پایهٔ آن را می‌گیرند */
  async function setClassGrade(classroomId: string, grade: string) {
    try {
      const res = await fetch(`/api/classes/${classroomId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grade }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        toast({ title: data?.error ?? 'ثبت پایه ناموفق بود', variant: 'destructive' })
        return
      }
      setClasses(
        (prev) =>
          prev?.map((c) => (c.id === classroomId ? { ...c, grade } : c)) ?? null,
      )
      toast({ title: `پایه «${grade}» برای کلاس ثبت شد` })
    } catch {
      toast({ title: 'خطا در برقراری ارتباط با سرور', variant: 'destructive' })
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-3 py-5 sm:px-4 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">مدیریت مدرسه</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {schoolStats?.schoolName || 'آمار و کلاس‌های مدرسه'}
          </p>
        </div>
        <div className="flex gap-2 shrink-0 flex-wrap">
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <a href="/modir/users">
              <UsersRound className="h-4 w-4" />
              کاربران
            </a>
          </Button>
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <a href="/modir/groups">
              <BookOpen className="h-4 w-4" />
              گروه‌ها
            </a>
          </Button>
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <a href="/modir/notifications">
              <Bell className="h-4 w-4" />
              اعلان‌ها
            </a>
          </Button>
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <a href="/modir/announcements">
              <Megaphone className="h-4 w-4" />
              اطلاعیه‌ها
            </a>
          </Button>
        </div>
      </div>

      {/* آمار مدرسه (ادغام داشبورد سابق) — فقط اعداد واقعی از سرور، شمارنده متحرک و آیکون ورود به مدیریت */}
      {schoolStats && schoolStats.stats.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {schoolStats.stats.map((s) => {
            const Icon = STAT_ICONS[s.key] ?? Layers
            const action = statAction(s.key)
            const createAction = statCreateAction(s.key)
            return (
              <StatCard
                key={s.key}
                icon={<Icon className="h-5 w-5 text-primary" />}
                label={s.label}
                value={s.value}
                action={action}
                createAction={createAction}
              />
            )
          })}
        </div>
      )}

      {/* بخش کلاس‌ها — ایجاد + فهرست */}
      <div ref={tabsRef} className="scroll-mt-4 space-y-5">
      {/* ایجاد کلاس — الگوی دو فیلدی: پایه (کشویی) + شعبه (متنی) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Plus className="h-4.5 w-4.5 text-primary" />
            ایجاد کلاس جدید
          </CardTitle>
          <CardDescription>نام کلاس با الگوی «پایه + شعبه» ساخته می‌شود — مثلاً: هفتم ۷۰۳</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={createClass} className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="space-y-1.5 sm:w-52">
                <Label htmlFor="grade-select">انتخاب پایه</Label>
                <Select value={grade} onValueChange={setGrade} name="grade">
                  <SelectTrigger id="grade-select" className="w-full" aria-label="انتخاب پایه">
                    <SelectValue placeholder="انتخاب پایه" />
                  </SelectTrigger>
                  <SelectContent>
                    {GRADE_OPTIONS.map((g) => (
                      <SelectItem key={g} value={g}>
                        {g}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 flex-1">
                <Label htmlFor="branch-input">انتخاب نام شعبه</Label>
                <Input
                  id="branch-input"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  placeholder="مثلاً ۷۰۳"
                  required
                  maxLength={BRANCH_MAX}
                  className="w-full"
                />
              </div>
              <div className="flex items-end">
                <Button type="submit" disabled={!canCreateClass} className="gap-1.5 w-full sm:w-auto">
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  ایجاد کلاس
                </Button>
              </div>
            </div>
            {classNamePreview && (
              <p className="text-xs text-muted-foreground" aria-live="polite">
                نام کلاس: <span className="font-semibold text-foreground">«{classNamePreview}»</span>
              </p>
            )}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">فهرست کلاس‌ها</CardTitle>
          <div className="relative mt-2">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="جست‌وجوی نام کلاس…"
              className="ps-9"
              aria-label="جست‌وجوی کلاس"
            />
          </div>
        </CardHeader>
        <CardContent>
          {classes === null ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredClasses.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {query ? 'کلاسی با این نام یافت نشد.' : 'هنوز کلاسی ایجاد نشده است.'}
            </p>
          ) : (
            <div className="divide-y">
              {filteredClasses.map((c) => (
                <div key={c.id} className="py-3 flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <Layers className="h-5 w-5" />
                  </div>
                  <button
                    className="flex-1 min-w-0 text-right"
                    onClick={() => router.push(`/modir/classes/${c.id}`)}
                  >
                    <div className="font-medium text-sm">{c.name}</div>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {c.grade ? (
                        <Badge variant="secondary" className="gap-1 text-[11px] bg-sky-500/10 text-sky-700 dark:text-sky-400">
                          <GraduationCap className="h-3 w-3" />
                          پایه {c.grade}
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                          <GraduationCap className="h-3 w-3" />
                          بدون پایه
                        </Badge>
                      )}
                      <Badge variant="secondary" className="gap-1 text-[11px]">
                        <BookOpen className="h-3 w-3" />
                        {faNum(c._count.subjectGroups)} گروه درسی
                      </Badge>
                      <Badge variant="secondary" className="gap-1 text-[11px]">
                        <GraduationCap className="h-3 w-3" />
                        {faNum(c._count.enrollments)} دانش‌آموز
                      </Badge>
                    </div>
                  </button>
                  {!c.grade && (
                    <Select
                      value=""
                      onValueChange={(g) => void setClassGrade(c.id, g)}
                    >
                      <SelectTrigger
                        className="w-[120px] h-8 text-[11px] shrink-0"
                        aria-label={`تعیین پایه برای کلاس ${c.name}`}
                      >
                        <SelectValue placeholder="تعیین پایه…" />
                      </SelectTrigger>
                      <SelectContent>
                        {GRADE_OPTIONS.map((g) => (
                          <SelectItem key={g} value={g}>
                            پایه {g}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={`حذف کلاس ${c.name}`}>
                        <Trash2 className="h-4.5 w-4.5 text-destructive" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>حذف کلاس «{c.name}»؟</AlertDialogTitle>
                        <AlertDialogDescription>
                          همه گروه‌های درسی، انتساب معلمان، ثبت‌نام دانش‌آموزان و پیام‌های این کلاس
                          حذف می‌شوند و قابل بازگشت نیست.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>انصراف</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => deleteClass(c.id, c.name)}
                          className="bg-destructive text-white hover:bg-destructive/90"
                        >
                          حذف قطعی
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  <Button asChild variant="ghost" size="icon" aria-label="مدیریت کلاس">
                    <Link href={`/modir/classes/${c.id}`}>
                      <ChevronLeft className="h-4.5 w-4.5" />
                    </Link>
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      </div>
    </div>
  )
}

/** کارت آماری مربعی — شمارنده متحرک + آیکون‌های ورود به مدیریت (+ ایجاد برای معلمان/دانش‌آموزان) در گوشه پایین */
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
    <Card className="relative overflow-hidden">
      <CardContent className="p-4 pb-5 flex flex-col items-center gap-1.5 text-center">
        {icon}
        <span className="text-2xl font-bold">
          {value === undefined ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : (
            <AnimatedNumber value={value} />
          )}
        </span>
        <span className="text-xs text-muted-foreground leading-tight">{label}</span>
      </CardContent>
      {(action || createAction) && (
        <div className="absolute bottom-2 end-2 flex items-center gap-1.5">
          {createAction && (
            <button
              type="button"
              onClick={createAction.onClick}
              title={createAction.title}
              aria-label={createAction.title}
              className="h-7 w-7 rounded-full border bg-background/70 text-muted-foreground flex items-center justify-center transition-colors hover:bg-primary hover:text-primary-foreground hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          )}
          {action && (
            <button
              type="button"
              onClick={action.onClick}
              title={action.title}
              aria-label={action.title}
              className="h-7 w-7 rounded-full border bg-background/70 text-muted-foreground flex items-center justify-center transition-colors hover:bg-primary hover:text-primary-foreground hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Settings2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
    </Card>
  )
}
