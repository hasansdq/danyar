'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  BarChart3,
  Search,
  Users,
  AlertTriangle,
  Award,
  TrendingUp,
  XCircle,
  ChevronLeft,
  ArrowUpDown,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { faNum } from '@/lib/format'
import { formatJalaliDate } from '@/lib/jalali'
import type { PerformanceRow } from '@/lib/performance'

/** نوع ستون مرتب‌سازی جدول عملکرد */
type SortKey = 'fullName' | 'violationCount' | 'avgScore' | 'lastGrade' | 'absentCount'

interface ClassroomsItem {
  id: string
  name: string
}

/**
 * بخش آماری مستقل «گزارش عملکرد دانش‌آموزان» (درخواست کاربر):
 * زیر باکس‌های آماری هاب مدیریت مدرسه — جدول/فهرست دانش‌آموزان با ستون‌های
 * (تعداد تخلفات · میانگین نمرات · آخرین نمره · تعداد غیبت‌ها)؛
 * کلیک روی هر دانش‌آموز → صفحهٔ ریز گزارش آماری و نموداری همان دانش‌آموز.
 */
export function HubPerformanceSection() {
  const router = useRouter()
  const [rows, setRows] = useState<PerformanceRow[] | null>(null)
  const [classrooms, setClassrooms] = useState<ClassroomsItem[]>([])
  const [classroomId, setClassroomId] = useState<string>('all')
  const [q, setQ] = useState('')
  const [error, setError] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('violationCount')
  const [sortDesc, setSortDesc] = useState(true)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const url = classroomId === 'all' ? '/api/performance' : `/api/performance?classroomId=${classroomId}`
        const res = await fetch(url, { cache: 'no-store' })
        if (!res.ok) throw new Error('failed')
        const d = await res.json()
        if (!alive) return
        setRows(d.students ?? [])
        if (!classrooms.length) setClassrooms(d.classrooms ?? [])
        setError(false)
      } catch {
        if (alive) setError(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [classroomId])

  // جست‌وجو بر اساس نام/کد دانش‌آموزی
  const filtered = useMemo(() => {
    if (!rows) return []
    const needle = q.trim()
    const out = needle
      ? rows.filter(
          (r) =>
            r.fullName.includes(needle) ||
            r.username.includes(needle) ||
            r.classroomNames.some((c) => c.includes(needle)),
        )
      : rows
    // مرتب‌سازی ستونی
    const sorted = [...out]
    sorted.sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'fullName':
          cmp = a.fullName.localeCompare(b.fullName, 'fa')
          break
        case 'violationCount':
          cmp = a.violationCount - b.violationCount
          break
        case 'absentCount':
          cmp = a.absentCount - b.absentCount
          break
        case 'avgScore':
          cmp = (a.avgScore ?? -1) - (b.avgScore ?? -1)
          break
        case 'lastGrade': {
          const av = a.lastGrade ? scoreSortValue(a.lastGrade.score) : -Infinity
          const bv = b.lastGrade ? scoreSortValue(b.lastGrade.score) : -Infinity
          cmp = av - bv
          break
        }
      }
      return sortDesc ? -cmp : cmp
    })
    return sorted
  }, [rows, q, sortKey, sortDesc])

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDesc((v) => !v)
    else {
      setSortKey(key)
      setSortDesc(key === 'fullName' ? false : true)
    }
  }

  return (
    <section
      aria-labelledby="performance-report-title"
      data-testid="performance-section"
      className="space-y-3"
    >
      <Card className="overflow-hidden">
        <CardHeader className="p-4 pb-3 sm:p-6 sm:pb-3 space-y-0">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <BarChart3 className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <CardTitle id="performance-report-title" className="text-base sm:text-lg leading-tight">
                  گزارش عملکرد دانش‌آموزان
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  آمار گزارش کار دانش‌آموزان — تخلفات، نمرات و غیبت‌ها
                </p>
              </div>
            </div>
            {rows && (
              <Badge variant="secondary" className="gap-1.5 shrink-0">
                <Users className="h-3.5 w-3.5" />
                {faNum(rows.length)} دانش‌آموز
              </Badge>
            )}
          </div>

          {/* جست‌وجو + فیلتر کلاس */}
          <div className="mt-3 flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="جست‌وجوی دانش‌آموز (نام، کد یا کلاس)…"
                className="pr-9"
                inputMode="search"
                data-testid="performance-search"
              />
            </div>
            {classrooms.length > 0 && (
              <Select value={classroomId} onValueChange={setClassroomId}>
                <SelectTrigger className="sm:w-52" data-testid="performance-class-filter">
                  <SelectValue placeholder="همهٔ کلاس‌ها" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">همهٔ کلاس‌ها</SelectItem>
                  {classrooms.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0 pt-0">
          {/* اسکلتون بارگذاری */}
          {rows === null && !error && (
            <div className="space-y-2 p-4 sm:p-6" aria-busy="true" data-testid="performance-skeleton">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-4 w-36 rounded" />
                  <Skeleton className="h-4 w-12 rounded" />
                  <Skeleton className="h-4 w-12 rounded" />
                  <Skeleton className="h-4 w-16 rounded" />
                  <Skeleton className="h-4 w-12 rounded" />
                </div>
              ))}
            </div>
          )}

          {error && (
            <div className="p-8 text-center text-sm text-muted-foreground">
              خطا در بارگذاری گزارش عملکرد — دوباره تلاش کنید.
            </div>
          )}

          {rows !== null && !error && filtered.length === 0 && (
            <div className="p-10 text-center text-sm text-muted-foreground" data-testid="performance-empty">
              دانش‌آموزی با این مشخصات یافت نشد.
            </div>
          )}

          {rows !== null && !error && filtered.length > 0 && (
            <>
              {/* جدول دسکتاپ */}
              <div
                className="hidden md:block max-h-[26rem] overflow-y-auto"
                data-testid="performance-table"
              >
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-background">
                    <TableRow className="hover:bg-transparent">
                      <SortableHead
                        label="دانش‌آموز"
                        active={sortKey === 'fullName'}
                        desc={sortDesc}
                        onClick={() => toggleSort('fullName')}
                      />
                      <SortableHead
                        label="تعداد تخلفات"
                        icon={<AlertTriangle className="h-3.5 w-3.5" />}
                        active={sortKey === 'violationCount'}
                        desc={sortDesc}
                        onClick={() => toggleSort('violationCount')}
                        className="text-center"
                      />
                      <SortableHead
                        label="میانگین نمرات"
                        icon={<Award className="h-3.5 w-3.5" />}
                        active={sortKey === 'avgScore'}
                        desc={sortDesc}
                        onClick={() => toggleSort('avgScore')}
                        className="text-center"
                      />
                      <SortableHead
                        label="آخرین نمره"
                        icon={<TrendingUp className="h-3.5 w-3.5" />}
                        active={sortKey === 'lastGrade'}
                        desc={sortDesc}
                        onClick={() => toggleSort('lastGrade')}
                        className="text-center"
                      />
                      <SortableHead
                        label="تعداد غیبت‌ها"
                        icon={<XCircle className="h-3.5 w-3.5" />}
                        active={sortKey === 'absentCount'}
                        desc={sortDesc}
                        onClick={() => toggleSort('absentCount')}
                        className="text-center"
                      />
                      <TableHead className="w-8" aria-label="جزئیات" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((r) => (
                      <TableRow
                        key={r.id}
                        onClick={() => router.push(`/modir/performance/${r.id}`)}
                        className="cursor-pointer"
                        data-testid="performance-row"
                        data-student={r.fullName}
                      >
                        <TableCell className="max-w-[16rem]">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="truncate font-medium">{r.fullName}</span>
                            {!r.isActive && <Badge variant="outline">غیرفعال</Badge>}
                          </div>
                          <div className="text-[11px] text-muted-foreground truncate">
                            {r.classroomNames.length ? r.classroomNames.join('، ') : 'بدون کلاس'}
                            {' · '}
                            {r.username}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <CountBadge
                            value={r.violationCount}
                            tone="amber"
                            zeroMuted
                          />
                        </TableCell>
                        <TableCell className="text-center">
                          {r.avgScore === null ? (
                            <span className="text-muted-foreground text-sm">—</span>
                          ) : (
                            <Badge
                              variant="secondary"
                              className="bg-sky-500/15 text-sky-700 dark:text-sky-300 font-semibold tabular-nums"
                            >
                              {faNum(r.avgScore)}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {r.lastGrade ? (
                            <div className="inline-flex flex-col items-start">
                              <Badge
                                variant="secondary"
                                className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-semibold gap-1"
                              >
                                {r.lastGrade.score}
                              </Badge>
                              <span className="text-[10px] text-muted-foreground mt-0.5">
                                {r.lastGrade.title}
                                {r.lastGrade.lessonName ? ` · ${r.lastGrade.lessonName}` : ''}
                              </span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-sm">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          <CountBadge value={r.absentCount} tone="rose" zeroMuted />
                        </TableCell>
                        <TableCell className="text-center text-muted-foreground">
                          <ChevronLeft className="h-4 w-4" />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* کارت‌های موبایل */}
              <div
                className="md:hidden max-h-[26rem] overflow-y-auto divide-y"
                data-testid="performance-mobile-list"
              >
                {filtered.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => router.push(`/modir/performance/${r.id}`)}
                    className="w-full text-right p-4 flex flex-col gap-2.5 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:bg-muted/60"
                    data-testid="performance-mobile-card"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium truncate flex items-center gap-1.5">
                          {r.fullName}
                          {!r.isActive && <Badge variant="outline">غیرفعال</Badge>}
                        </div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          {r.classroomNames.length ? r.classroomNames.join('، ') : 'بدون کلاس'}
                        </div>
                      </div>
                      <ChevronLeft className="h-4 w-4 text-muted-foreground shrink-0" />
                    </div>
                    <div className="grid grid-cols-4 gap-1.5 text-center">
                      <MobileStat
                        icon={<AlertTriangle className="h-3 w-3" />}
                        label="تخلفات"
                        value={r.violationCount === 0 ? '۰' : faNum(r.violationCount)}
                        tone="amber"
                      />
                      <MobileStat
                        icon={<Award className="h-3 w-3" />}
                        label="میانگین"
                        value={r.avgScore === null ? '—' : faNum(r.avgScore)}
                        tone="sky"
                      />
                      <MobileStat
                        icon={<TrendingUp className="h-3 w-3" />}
                        label="آخرین"
                        value={r.lastGrade ? r.lastGrade.score : '—'}
                        tone="emerald"
                      />
                      <MobileStat
                        icon={<XCircle className="h-3 w-3" />}
                        label="غیبت‌ها"
                        value={r.absentCount === 0 ? '۰' : faNum(r.absentCount)}
                        tone="rose"
                      />
                    </div>
                  </button>
                ))}
              </div>

              {/* راهنمای تعامل */}
              <div className="px-4 sm:px-6 py-2.5 text-[11px] text-muted-foreground border-t">
                برای مشاهدهٔ ریز گزارش آماری و نموداری، روی هر دانش‌آموز کلیک کنید
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  )
}

/** مقدار عددی برای مرتب‌سازی آخرین نمره (توصیفی‌ها ته لیست) */
function scoreSortValue(score: string): number {
  const fa = '۰۱۲۳۴۵۶۷۸۹'
  const en = score.replace(/[۰-۹]/g, (d) => String(fa.indexOf(d)))
  const n = Number(en.replace(/[٫,]/g, '.'))
  return Number.isFinite(n) ? n : -1
}

/** سرستون قابل مرتب‌سازی */
function SortableHead({
  label,
  icon,
  active,
  desc,
  onClick,
  className,
}: {
  label: string
  icon?: React.ReactNode
  active: boolean
  desc: boolean
  onClick: () => void
  className?: string
}) {
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={onClick}
        aria-label={`مرتب‌سازی بر اساس ${label}`}
        className={cn(
          'inline-flex items-center gap-1 font-medium transition-colors hover:text-foreground',
          active ? 'text-foreground' : 'text-muted-foreground',
          className,
        )}
      >
        {icon}
        {label}
        <ArrowUpDown
          className={cn(
            'h-3 w-3 transition-opacity',
            active ? 'opacity-100' : 'opacity-0',
          )}
          aria-hidden
        />
      </button>
    </TableHead>
  )
}

/** بج شمارنده رنگی — صفر کم‌رنگ */
function CountBadge({ value, tone, zeroMuted }: { value: number; tone: 'amber' | 'rose'; zeroMuted?: boolean }) {
  const cls =
    tone === 'amber'
      ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
      : 'bg-rose-500/15 text-rose-700 dark:text-rose-400'
  if (value === 0 && zeroMuted) {
    return <span className="text-sm text-muted-foreground tabular-nums">{faNum(0)}</span>
  }
  return <Badge variant="secondary" className={cn(cls, 'font-semibold tabular-nums')}>{faNum(value)}</Badge>
}

/** آمار کوچک موبایل */
function MobileStat({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode
  label: string
  value: string
  tone: 'amber' | 'sky' | 'emerald' | 'rose'
}) {
  const cls = {
    amber: 'text-amber-600 dark:text-amber-400',
    sky: 'text-sky-600 dark:text-sky-400',
    emerald: 'text-emerald-600 dark:text-emerald-400',
    rose: 'text-rose-600 dark:text-rose-400',
  }[tone]
  return (
    <div className="rounded-lg bg-muted/60 py-1.5 px-1">
      <div className={cn('text-sm font-bold tabular-nums flex items-center justify-center gap-1', cls)}>
        {value}
      </div>
      <div className="text-[10px] text-muted-foreground flex items-center justify-center gap-0.5 mt-0.5">
        {icon}
        {label}
      </div>
    </div>
  )
}
