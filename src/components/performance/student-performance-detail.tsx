'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowRight,
  Loader2,
  AlertTriangle,
  Award,
  TrendingUp,
  XCircle,
  ClipboardList,
  BookMarked,
  CalendarDays,
  LineChart as LineChartIcon,
  BarChart3,
  PieChart as PieChartIcon,
  GraduationCap,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts'
import { faNum } from '@/lib/format'
import { formatJalaliDate } from '@/lib/jalali'
import type {
  PerfGrade,
  PerfRecord,
  PerfViolation,
  MonthlyBucket,
  GradeTrendPoint,
  LessonAvg,
} from '@/lib/performance'

interface DetailResponse {
  student: {
    id: string
    fullName: string
    username: string
    isActive: boolean
    classroomNames: string[]
  }
  stats: {
    sessions: number
    present: number
    absent: number
    violationCount: number
    gradeCount: number
    numericGradeCount: number
    avgScore: number | null
    lastGrade: { score: string; title: string; lessonName: string | null; dateKey: string } | null
  }
  gradeTrend: GradeTrendPoint[]
  perLesson: LessonAvg[]
  monthly: MonthlyBucket[]
  records: PerfRecord[]
  violations: PerfViolation[]
  grades: PerfGrade[]
}

/** رنگ ثابت برندهای نمودار (هماهنگ با پالت پروژه — بدون آبی خالص/ایندیگو) */
const CH = {
  grade: 'var(--chart-2)', // فیروزه‌ای — نمرات
  lesson: 'var(--chart-1)', // نارنجی-قرمز گرم — میانگین درس
  present: '#10b981', // سبز
  absent: '#f43f5e', // رز
  violation: '#f59e0b', // کهربایی
}

const trendConfig = {
  score: { label: 'نمره', color: CH.grade },
} satisfies ChartConfig

const lessonConfig = {
  avgScore: { label: 'میانگین نمره', color: CH.lesson },
} satisfies ChartConfig

const attendanceConfig = {
  present: { label: 'حاضر', color: CH.present },
  absent: { label: 'غایب', color: CH.absent },
} satisfies ChartConfig

const monthlyConfig = {
  absences: { label: 'غیبت', color: CH.absent },
  violations: { label: 'تخلف', color: CH.violation },
} satisfies ChartConfig

/**
 * ریز گزارش عملکرد دانش‌آموز (درخواست کاربر) — آماری و نموداری:
 * ۴ کارت کلیدی (همان ستون‌های فهرست) + ۴ نمودار + تب جزئیات رکوردها.
 */
export function StudentPerformanceDetail({ studentId }: { studentId: string }) {
  const router = useRouter()
  const [data, setData] = useState<DetailResponse | null>(null)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch(`/api/performance/${studentId}`, { cache: 'no-store' })
        if (res.status === 404) {
          if (alive) setNotFound(true)
          return
        }
        if (!res.ok) throw new Error('failed')
        const d = await res.json()
        if (alive) setData(d)
      } catch {
        if (alive) setNotFound(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [studentId])

  // دادهٔ نمودار دایره‌ای حضور
  const attendanceData = useMemo(() => {
    if (!data) return []
    return [
      { key: 'present', value: data.stats.present },
      { key: 'absent', value: data.stats.absent },
    ].filter((d) => d.value > 0)
  }, [data])

  if (notFound) {
    return (
      <div className="max-w-4xl mx-auto p-4 lg:p-6">
        <div className="rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground">
          دانش‌آموز یافت نشد یا به مدرسهٔ شما متعلق نیست.
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="max-w-4xl mx-auto p-4 lg:p-6 space-y-4" aria-busy="true">
        <Skeleton className="h-16 w-64 rounded-xl" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl" />
        <div className="flex items-center justify-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> در حال بارگذاری گزارش عملکرد…
        </div>
      </div>
    )
  }

  const s = data.stats
  const st = data.student
  const hasTrend = data.gradeTrend.length >= 1
  const hasLessons = data.perLesson.length >= 1
  const hasAttendance = attendanceData.length >= 1
  const hasMonthly = data.monthly.some((m) => m.absences > 0 || m.violations > 0)

  return (
    <div className="max-w-4xl mx-auto p-4 lg:p-6 space-y-5" data-testid="performance-detail">
      {/* سرصفحه — بازگشت + مشخصات دانش‌آموز */}
      <div className="flex items-start gap-3">
        <Button
          variant="outline"
          size="icon"
          onClick={() => router.push('/modir')}
          aria-label="بازگشت به مدیریت مدرسه"
          data-testid="performance-back"
          className="shrink-0"
        >
          <ArrowRight className="h-4 w-4" />
        </Button>
        <div className="flex items-start gap-2.5 min-w-0">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <GraduationCap className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-lg font-bold leading-tight flex items-center gap-2 flex-wrap">
              {st.fullName}
              {!st.isActive && <Badge variant="outline">غیرفعال</Badge>}
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span>کد: {st.username}</span>
              {st.classroomNames.length > 0 && (
                <>
                  <span aria-hidden>·</span>
                  <span>{st.classroomNames.join('، ')}</span>
                </>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* ۴ کارت کلیدی — همان ستون‌های فهرست عملکرد */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="performance-stat-cards">
        <Card className="py-3">
          <CardContent className="px-3 text-center space-y-1">
            <div className="text-xl font-bold text-amber-600 dark:text-amber-400 tabular-nums">
              {faNum(s.violationCount)}
            </div>
            <div className="text-[11px] text-muted-foreground flex items-center justify-center gap-1">
              <AlertTriangle className="h-3 w-3" /> تعداد تخلفات
            </div>
          </CardContent>
        </Card>
        <Card className="py-3">
          <CardContent className="px-3 text-center space-y-1">
            <div className="text-xl font-bold text-sky-600 dark:text-sky-400 tabular-nums">
              {s.avgScore === null ? '—' : faNum(s.avgScore)}
            </div>
            <div className="text-[11px] text-muted-foreground flex items-center justify-center gap-1">
              <Award className="h-3 w-3" /> میانگین نمرات
            </div>
          </CardContent>
        </Card>
        <Card className="py-3">
          <CardContent className="px-3 text-center space-y-1">
            <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
              {s.lastGrade ? s.lastGrade.score : '—'}
            </div>
            <div
              className="text-[11px] text-muted-foreground flex items-center justify-center gap-1 truncate"
              title={s.lastGrade ? s.lastGrade.title : undefined}
            >
              <TrendingUp className="h-3 w-3 shrink-0" /> آخرین نمره
              {s.lastGrade && (
                <span className="text-[10px] text-muted-foreground/80 truncate">
                  {s.lastGrade.lessonName ? `(${s.lastGrade.lessonName})` : ''}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
        <Card className="py-3">
          <CardContent className="px-3 text-center space-y-1">
            <div className="text-xl font-bold text-rose-600 dark:text-rose-400 tabular-nums">
              {faNum(s.absent)}
            </div>
            <div className="text-[11px] text-muted-foreground flex items-center justify-center gap-1">
              <XCircle className="h-3 w-3" /> تعداد غیبت‌ها
            </div>
          </CardContent>
        </Card>
      </div>

      {/* آمار تکمیلی */}
      <div className="flex flex-wrap gap-2 text-xs">
        <Badge variant="secondary" className="gap-1">
          <ClipboardList className="h-3 w-3" /> {faNum(s.gradeCount)} نمرهٔ ثبت‌شده
        </Badge>
        {s.numericGradeCount > 0 && s.numericGradeCount !== s.gradeCount && (
          <Badge variant="secondary" className="gap-1">
            <Award className="h-3 w-3" /> {faNum(s.numericGradeCount)} نمرهٔ عددی در میانگین
          </Badge>
        )}
        <Badge variant="secondary" className="gap-1">
          <CalendarDays className="h-3 w-3" /> {faNum(s.sessions)} جلسهٔ نهایی‌شده
        </Badge>
        <Badge variant="secondary" className="gap-1">
          <PieChartIcon className="h-3 w-3" /> {faNum(s.present)} حضور
        </Badge>
        {s.lastGrade && (
          <Badge variant="secondary" className="gap-1">
            <CalendarDays className="h-3 w-3" /> {formatJalaliDate(s.lastGrade.dateKey)}
          </Badge>
        )}
      </div>

      {/* ── نمودارها ── */}
      <div className="grid gap-4 lg:grid-cols-2" data-testid="performance-charts">
        {/* روند نمرات */}
        <Card>
          <CardHeader className="p-4 pb-0">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <LineChartIcon className="h-4 w-4 text-primary" /> روند نمرات
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-2">
            {hasTrend ? (
              <div dir="ltr" className="aspect-[4/3]">
                <ChartContainer config={trendConfig} className="h-full w-full">
                  <LineChart data={data.gradeTrend} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="dateKey"
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 10 }}
                      tickFormatter={(v: string) => v.slice(5)}
                    />
                    <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          labelFormatter={(_, payload) => {
                            const p = payload?.[0]?.payload as GradeTrendPoint | undefined
                            return p ? `${p.title}${p.lessonName ? ` — ${p.lessonName}` : ''}` : ''
                          }}
                        />
                      }
                    />
                    <Line
                      dataKey="score"
                      type="monotone"
                      stroke={CH.grade}
                      strokeWidth={2.5}
                      dot={{ r: 4, fill: CH.grade, strokeWidth: 0 }}
                      activeDot={{ r: 6 }}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ChartContainer>
              </div>
            ) : (
              <ChartEmpty text="هنوز نمرهٔ عددی‌ای برای این دانش‌آموز ثبت نشده است" />
            )}
          </CardContent>
        </Card>

        {/* میانگین نمرات درس‌ها */}
        <Card>
          <CardHeader className="p-4 pb-0">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <BookMarked className="h-4 w-4 text-primary" /> میانگین نمرات درس‌ها
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-2">
            {hasLessons ? (
              <div dir="ltr" className="aspect-[4/3]">
                <ChartContainer config={lessonConfig} className="h-full w-full">
                  <BarChart data={data.perLesson} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="lessonName"
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 10 }}
                      interval={0}
                    />
                    <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar
                      dataKey="avgScore"
                      fill={CH.lesson}
                      radius={[6, 6, 0, 0]}
                      maxBarSize={48}
                      isAnimationActive={false}
                    />
                  </BarChart>
                </ChartContainer>
              </div>
            ) : (
              <ChartEmpty text="برای محاسبهٔ میانگین درسی، نمرهٔ عددی ثبت نشده است" />
            )}
          </CardContent>
        </Card>

        {/* وضعیت حضور و غیاب */}
        <Card>
          <CardHeader className="p-4 pb-0">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <PieChartIcon className="h-4 w-4 text-primary" /> وضعیت حضور و غیاب
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-2">
            {hasAttendance ? (
              <div dir="ltr" className="aspect-[4/3]">
                <ChartContainer config={attendanceConfig} className="h-full w-full">
                  <PieChart>
                    <ChartTooltip content={<ChartTooltipContent nameKey="key" />} />
                    <Pie
                      data={attendanceData}
                      dataKey="value"
                      nameKey="key"
                      innerRadius="55%"
                      outerRadius="85%"
                      paddingAngle={3}
                      strokeWidth={0}
                      isAnimationActive={false}
                    >
                      {attendanceData.map((d) => (
                        <Cell
                          key={d.key}
                          fill={d.key === 'present' ? CH.present : CH.absent}
                        />
                      ))}
                    </Pie>
                  </PieChart>
                </ChartContainer>
              </div>
            ) : (
              <ChartEmpty text="هنوز جلسهٔ نهایی‌شده‌ای برای این دانش‌آموز ثبت نشده است" />
            )}
            {hasAttendance && (
              <div className="flex justify-center gap-4 text-xs text-muted-foreground -mt-1 pb-1">
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: CH.present }} />
                  حاضر: {faNum(s.present)}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: CH.absent }} />
                  غایب: {faNum(s.absent)}
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* غیبت‌ها و تخلفات ماهانه */}
        <Card>
          <CardHeader className="p-4 pb-0">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <BarChart3 className="h-4 w-4 text-primary" /> غیبت‌ها و تخلفات ماهانه
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-2">
            {hasMonthly ? (
              <div dir="ltr" className="aspect-[4/3]">
                <ChartContainer config={monthlyConfig} className="h-full w-full">
                  <BarChart data={data.monthly} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="label"
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 10 }}
                      interval={0}
                    />
                    <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10 }} allowDecimals={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar
                      dataKey="absences"
                      fill={CH.absent}
                      radius={[5, 5, 0, 0]}
                      maxBarSize={26}
                      isAnimationActive={false}
                    />
                    <Bar
                      dataKey="violations"
                      fill={CH.violation}
                      radius={[5, 5, 0, 0]}
                      maxBarSize={26}
                      isAnimationActive={false}
                    />
                  </BarChart>
                </ChartContainer>
              </div>
            ) : (
              <ChartEmpty text="غیبت یا تخلفی برای این دانش‌آموز ثبت نشده است" />
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── ریز رکوردها: نمره‌ها / غیبت‌ها / تخلفات ── */}
      <Tabs defaultValue="grades" data-testid="performance-detail-tabs">
        <TabsList className="grid grid-cols-3 w-full">
          <TabsTrigger value="grades" className="gap-1.5">
            <Award className="h-4 w-4" />
            نمره‌ها
            <Badge variant="secondary" className="text-[10px] px-1.5">
              {faNum(data.grades.length)}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="absents" className="gap-1.5">
            <XCircle className="h-4 w-4" />
            غیبت‌ها
            <Badge variant="secondary" className="text-[10px] px-1.5">
              {faNum(data.records.filter((r) => r.status === 'ABSENT').length)}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="violations" className="gap-1.5">
            <ClipboardList className="h-4 w-4" />
            تخلفات
            <Badge variant="secondary" className="text-[10px] px-1.5">
              {faNum(data.violations.length)}
            </Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="grades" className="mt-3 space-y-1.5" data-testid="detail-grades">
          {data.grades.length === 0 ? (
            <EmptyRow text="هنوز نمره‌ای برای این دانش‌آموز ثبت نشده است." />
          ) : (
            <div className="max-h-96 overflow-y-auto space-y-1.5 pr-1">
              {data.grades.map((g) => (
                <div
                  key={g.id}
                  className="flex flex-wrap items-center gap-2 rounded-xl border border-sky-500/30 bg-sky-500/5 p-3"
                >
                  <span className="text-sm font-bold">{g.title}</span>
                  {g.lessonName ? (
                    <Badge variant="outline" className="gap-1">
                      <BookMarked className="h-3 w-3" />
                      {g.lessonName}
                    </Badge>
                  ) : null}
                  <Badge variant="outline">{g.classroomName}</Badge>
                  <Badge variant="outline" className="font-mono">
                    {formatJalaliDate(g.dateKey, { withWeekday: true })}
                  </Badge>
                  <Badge
                    variant="secondary"
                    className="bg-sky-500/15 text-sky-700 dark:text-sky-300 text-xs gap-1"
                  >
                    <Award className="h-3 w-3" />
                    نمره: {g.score}
                  </Badge>
                  <span className="w-full text-[10px] text-muted-foreground sm:w-auto">
                    معلم: {g.teacherName}
                  </span>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="absents" className="mt-3" data-testid="detail-absents">
          {data.records.filter((r) => r.status === 'ABSENT').length === 0 ? (
            <EmptyRow text="غیبتی برای این دانش‌آموز ثبت نشده است." />
          ) : (
            <div className="max-h-96 overflow-y-auto space-y-1.5 pr-1">
              {data.records
                .filter((r) => r.status === 'ABSENT')
                .map((r) => (
                  <div
                    key={r.sessionId}
                    className="flex flex-wrap items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/5 p-3"
                  >
                    <Badge
                      variant="secondary"
                      className="bg-rose-500/15 text-rose-700 dark:text-rose-300 gap-1"
                    >
                      <XCircle className="h-3 w-3" /> غایب
                    </Badge>
                    <span className="text-sm font-medium">{r.title}</span>
                    <Badge variant="outline">{r.classroomName}</Badge>
                    <Badge variant="outline" className="font-mono">
                      {formatJalaliDate(r.dateKey, { withWeekday: true })}
                    </Badge>
                    {r.note ? (
                      <span className="text-xs text-muted-foreground">یادداشت: {r.note}</span>
                    ) : null}
                    <span className="w-full text-[10px] text-muted-foreground sm:w-auto">
                      ثبت‌کننده: {r.creatorName}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="violations" className="mt-3" data-testid="detail-violations">
          {data.violations.length === 0 ? (
            <EmptyRow text="تخلفی برای این دانش‌آموز ثبت نشده است." />
          ) : (
            <div className="max-h-96 overflow-y-auto space-y-1.5 pr-1">
              {data.violations.map((v) => (
                <div
                  key={v.id}
                  className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3"
                >
                  <Badge
                    variant="secondary"
                    className="bg-amber-500/15 text-amber-700 dark:text-amber-400 gap-1"
                  >
                    <AlertTriangle className="h-3 w-3" /> تخلف
                  </Badge>
                  <span className="text-sm font-medium">{v.text}</span>
                  <Badge variant="outline">{v.classroomName}</Badge>
                  <Badge variant="outline" className="font-mono">
                    {formatJalaliDate(v.dateKey, { withWeekday: true })}
                  </Badge>
                  <span className="w-full text-[10px] text-muted-foreground sm:w-auto">
                    ثبت‌کننده: {v.creatorName}
                  </span>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

/** جای‌خالی نمودار بدون داده */
function ChartEmpty({ text }: { text: string }) {
  return (
    <div className="aspect-[4/3] rounded-xl border border-dashed flex flex-col items-center justify-center gap-2 text-muted-foreground">
      <BarChart3 className="h-7 w-7 opacity-40" />
      <p className="text-xs px-6 text-center leading-relaxed">{text}</p>
    </div>
  )
}

/** جای‌خالی تب بدون رکورد */
function EmptyRow({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
      {text}
    </div>
  )
}
