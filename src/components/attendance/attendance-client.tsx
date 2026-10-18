'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Award,
  BookMarked,
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Download,
  Filter,
  Loader2,
  Plus,
  RotateCcw,
  Users,
  XCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { JalaliCalendar } from '@/components/attendance/jalali-calendar'
import {
  AttendanceSessionEditor,
  type SessionSummary,
} from '@/components/attendance/attendance-session-editor'
import {
  formatJalaliDate,
  todayDateKey,
  monthRange,
  parseDateKey,
  JALALI_MONTHS,
} from '@/lib/jalali'
import { faNum } from '@/lib/format'

const STATUS_FA: Record<string, string> = {
  PRESENT: 'حاضر',
  ABSENT: 'غایب',
  UNSET: 'ثبت‌نشده',
}

const STATUS_CLASS: Record<string, string> = {
  PRESENT: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  ABSENT: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
  UNSET: 'bg-slate-500/15 text-slate-600 dark:text-slate-400',
}

export function AttendanceClient({ role, fullName }: { role: string; fullName: string }) {
  if (role === 'STUDENT') return <StudentAttendance fullName={fullName} />
  // معاون همهٔ دسترسی‌های مدیر مدرسه را دارد (درخواست کاربر) — گزارش کامل مدرسه
  if (role === 'SCHOOL_ADMIN' || role === 'SCHOOL_VICE') return <AdminAttendance fullName={fullName} />
  return <TeacherAttendance fullName={fullName} />
}

/* ─────────────────────────── معلم ─────────────────────────── */

interface ClassItem {
  id: string
  name: string
  studentCount: number
}
interface SessionListItem extends SessionSummary {
  counts: { present: number; absent: number; recorded: number }
}
interface StudentItem {
  id: string
  fullName: string
  status: string
}

function TeacherAttendance({ fullName }: { fullName: string }) {
  const { toast } = useToast()
  const [classes, setClasses] = useState<ClassItem[]>([])
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [sessions, setSessions] = useState<SessionListItem[]>([])
  const [openSessionId, setOpenSessionId] = useState<string | null>(null)
  const [newForm, setNewForm] = useState<{ classroomId: string; students: StudentItem[]; title: string } | null>(null)
  const [creating, setCreating] = useState(false)
  const [month, setMonth] = useState(() => {
    const p = parseDateKey(todayDateKey())!
    return { jy: p.jy, jm: p.jm }
  })

  const loadClasses = useCallback(async () => {
    try {
      const res = await fetch('/api/attendance/classes', { cache: 'no-store' })
      const d = await res.json()
      if (res.ok) setClasses(d.classrooms ?? [])
    } catch { /* ignore */ }
  }, [])

  const loadSessions = useCallback(async (jy: number, jm: number) => {
    const { from, to } = monthRange(jy, jm)
    try {
      const res = await fetch(`/api/attendance/sessions?from=${from}&to=${to}`, { cache: 'no-store' })
      const d = await res.json()
      if (res.ok) setSessions(d.sessions ?? [])
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    loadClasses()
  }, [loadClasses])

  useEffect(() => {
    loadSessions(month.jy, month.jm)
  }, [loadSessions, month])

  // ماه تقویم از داخل خود تقویم تغییر می‌کند؛ برای همگام‌سازی نقطه‌ها،
  // بازه فهرست جلسات را وسیع نگه می‌داریم (کل سال جلالی جاری تا 1500)
  const dayInfo = useMemo(() => {
    const info: Record<string, { dots: { color: 'green' | 'amber'; count: number }[] }> = {}
    for (const s of sessions) {
      const cur = info[s.dateKey] ?? { dots: [{ color: 'green' as const, count: 0 }, { color: 'amber' as const, count: 0 }] }
      if (s.status === 'FINALIZED') cur.dots[0].count++
      else cur.dots[1].count++
      info[s.dateKey] = cur
    }
    return info
  }, [sessions])

  const daySessions = useMemo(
    () => (selectedDay ? sessions.filter((s) => s.dateKey === selectedDay) : []),
    [sessions, selectedDay],
  )

  const openNewForm = async (classroomId: string) => {
    if (!selectedDay) return
    try {
      const res = await fetch(`/api/attendance/students?classroomId=${classroomId}`, { cache: 'no-store' })
      const d = await res.json()
      if (!res.ok) {
        toast({ title: 'خطا', description: d.error ?? 'دریافت فهرست ناموفق بود', variant: 'destructive' })
        return
      }
      setNewForm({ classroomId, students: d.students ?? [], title: '' })
      setOpenSessionId(null)
    } catch {
      toast({ title: 'خطا', description: 'اتصال برقرار نشد', variant: 'destructive' })
    }
  }

  const createSession = async (finalize: boolean) => {
    if (!newForm || !selectedDay) return
    setCreating(true)
    try {
      const res = await fetch('/api/attendance/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          classroomId: newForm.classroomId,
          dateKey: selectedDay,
          title: newForm.title,
          records: newForm.students.map((s) => ({ studentId: s.id, status: s.status })),
        }),
      })
      const d = await res.json()
      if (!res.ok) {
        toast({ title: 'خطا', description: d.error ?? 'ایجاد جلسه ناموفق بود', variant: 'destructive' })
        return
      }
      const created: SessionSummary = d.session
      if (finalize) {
        const r2 = await fetch(`/api/attendance/sessions/${created.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'finalize' }),
        })
        if (!r2.ok) {
          const d2 = await r2.json()
          toast({ title: 'خطا در نهایی‌سازی', description: d2.error ?? '', variant: 'destructive' })
        }
      }
      toast({
        title: finalize ? 'جلسه نهایی شد' : 'پیش‌نویس ذخیره شد',
        description: finalize ? 'اعلان خصوصی برای دانش‌آموزان ارسال شد' : undefined,
      })
      setNewForm(null)
      setOpenSessionId(created.id)
      await loadSessions(month.jy, month.jm)
    } catch {
      toast({ title: 'خطا', description: 'اتصال برقرار نشد', variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  const selectedClassName = (id: string) => classes.find((c) => c.id === id)?.name ?? '—'

  return (
    <div className="max-w-6xl mx-auto p-4 lg:p-6 space-y-4">
      <div className="flex items-center gap-2.5">
        <CalendarCheck className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-lg font-bold leading-tight">حضور و غیاب</h1>
          <p className="text-xs text-muted-foreground">
            ثبت حضور و غیاب کلاس‌ها با تقویم جلالی — {fullName}
          </p>
        </div>
      </div>

      <Tabs defaultValue="register">
        <TabsList>
          <TabsTrigger value="register">
            <CalendarDays className="h-4 w-4 ml-1" />
            ثبت حضور
          </TabsTrigger>
          <TabsTrigger value="history">
            <ClipboardList className="h-4 w-4 ml-1" />
            سوابق جلسات من
          </TabsTrigger>
        </TabsList>

        {/* ── ثبت حضور: تقویم + انتخاب کلاس ── */}
        <TabsContent value="register" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[340px_1fr] items-start">
            <div className="space-y-3">
              <JalaliCalendar
                dayInfo={dayInfo}
                selected={selectedDay}
                onSelectDay={(k) => {
                  setSelectedDay(k)
                  setOpenSessionId(null)
                  setNewForm(null)
                }}
                onMonthChange={(jy, jm) => setMonth({ jy, jm })}
              />
              <div className="text-[11px] text-muted-foreground flex flex-wrap gap-3 px-1">
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" /> نهایی‌شده
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-amber-500" /> پیش‌نویس
                </span>
              </div>
            </div>

            <div className="space-y-3">
              {!selectedDay && (
                <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                  برای شروع، یک روز را در تقویم انتخاب کنید
                </div>
              )}

              {selectedDay && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">
                      {formatJalaliDate(selectedDay, { withWeekday: true })}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {/* جلسات موجود این روز */}
                    {daySessions.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          setOpenSessionId(s.id)
                          setNewForm(null)
                        }}
                        className={cn(
                          'w-full flex flex-wrap items-center gap-2 rounded-lg border p-3 text-right hover:bg-accent transition-colors',
                          openSessionId === s.id && 'border-primary bg-primary/5',
                        )}
                      >
                        <span className="font-bold text-sm">{s.title}</span>
                        <Badge variant="outline">{s.classroomName}</Badge>
                        {s.status === 'FINALIZED' ? (
                          <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                            نهایی‌شده
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="bg-amber-500/15 text-amber-600 dark:text-amber-400">
                            پیش‌نویس
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {faNum(s.counts.present)} حاضر · {faNum(s.counts.absent)} غایب
                        </span>
                      </button>
                    ))}

                    {/* کلاس‌ها برای جلسه جدید */}
                    {!newForm && (
                      <div>
                        <div className="text-xs font-medium text-muted-foreground mb-2">
                          {daySessions.length ? 'یا جلسه جدید در کلاس:' : 'انتخاب کلاس برای ثبت حضور:'}
                        </div>
                        {classes.length ? (
                          <div className="flex flex-wrap gap-2">
                            {classes.map((c) => (
                              <Button
                                key={c.id}
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => openNewForm(c.id)}
                              >
                                <Plus className="h-4 w-4" />
                                {c.name}
                                <span className="text-xs text-muted-foreground">
                                  ({faNum(c.studentCount)} دانش‌آموز)
                                </span>
                              </Button>
                            ))}
                          </div>
                        ) : (
                          <div className="text-sm text-muted-foreground">
                            هیچ کلاسی به شما منتسب نشده است
                          </div>
                        )}
                      </div>
                    )}

                    {/* فرم جلسه جدید — همه پیش‌فرض حاضر */}
                    {newForm && (
                      <div className="rounded-lg border bg-muted/30 p-3 space-y-3" data-testid="new-attendance-form">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-bold">
                            جلسه جدید — {selectedClassName(newForm.classroomId)}
                          </span>
                          <Input
                            value={newForm.title}
                            onChange={(e) => setNewForm({ ...newForm, title: e.target.value })}
                            placeholder="عنوان جلسه (خالی = خودکار)"
                            className="h-8 w-44 text-xs"
                            aria-label="عنوان جلسه"
                          />
                          <div className="flex-1" />
                          <Button size="sm" variant="ghost" onClick={() => setNewForm(null)}>
                            انصراف
                          </Button>
                        </div>
                        <div className="rounded-lg border divide-y bg-card max-h-72 overflow-y-auto">
                          {newForm.students.map((s) => (
                            <label
                              key={s.id}
                              className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-accent/50"
                            >
                              <input
                                type="checkbox"
                                checked={s.status === 'PRESENT'}
                                onChange={(e) =>
                                  setNewForm({
                                    ...newForm,
                                    students: newForm.students.map((x) =>
                                      x.id === s.id
                                        ? { ...x, status: e.target.checked ? 'PRESENT' : 'ABSENT' }
                                        : x,
                                    ),
                                  })
                                }
                                className="h-4 w-4 accent-[hsl(var(--primary))]"
                                aria-label={`حاضری ${s.fullName}`}
                              />
                              <span className="flex-1">{s.fullName}</span>
                              <span
                                className={cn(
                                  'text-xs px-2 py-0.5 rounded-full font-medium',
                                  s.status === 'PRESENT'
                                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                    : 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
                                )}
                              >
                                {s.status === 'PRESENT' ? 'حاضر' : 'غایب'}
                              </span>
                            </label>
                          ))}
                          {!newForm.students.length && (
                            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                              دانش‌آموزی در این کلاس ثبت‌نام نکرده است
                            </div>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => createSession(false)}
                            disabled={creating || !newForm.students.length}
                          >
                            {creating && <Loader2 className="h-4 w-4 animate-spin" />}
                            ذخیره پیش‌نویس
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => createSession(true)}
                            disabled={creating || !newForm.students.length}
                          >
                            نهایی‌سازی و ارسال اعلان
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* ویرایشگر جلسه باز */}
                    {openSessionId && (
                      <div className="pt-1">
                        <AttendanceSessionEditor
                          sessionId={openSessionId}
                          role="TEACHER"
                          onSessionUpdated={() => loadSessions(month.jy, month.jm)}
                        />
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ── سوابق جلسات من ── */}
        <TabsContent value="history">
          <HistoryList
            sessions={sessions}
            onOpen={(id) => {
              setOpenSessionId(id)
              setSelectedDay(null)
              const s = sessions.find((x) => x.id === id)
              if (s) {
                const p = parseDateKey(s.dateKey)!
                setMonth({ jy: p.jy, jm: p.jm })
                setSelectedDay(s.dateKey)
              }
            }}
            activeId={openSessionId}
          />
          {openSessionId && (
            <Card className="mt-4">
              <CardContent className="pt-4">
                <AttendanceSessionEditor
                  sessionId={openSessionId}
                  role="TEACHER"
                  onSessionUpdated={() => loadSessions(month.jy, month.jm)}
                />
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function HistoryList({
  sessions,
  onOpen,
  activeId,
}: {
  sessions: SessionListItem[]
  onOpen: (id: string) => void
  activeId: string | null
}) {
  if (!sessions.length) {
    return (
      <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
        هنوز جلسه‌ای ثبت نکرده‌اید
      </div>
    )
  }
  return (
    <div className="space-y-2">
      {sessions.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onOpen(s.id)}
          className={cn(
            'w-full flex flex-wrap items-center gap-2 rounded-xl border p-3 text-right hover:bg-accent transition-colors',
            activeId === s.id && 'border-primary bg-primary/5',
          )}
        >
          <span className="font-bold text-sm">{s.title}</span>
          <Badge variant="outline">{s.classroomName}</Badge>
          <Badge variant="outline" className="font-mono">
            {formatJalaliDate(s.dateKey)}
          </Badge>
          {s.status === 'FINALIZED' ? (
            <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
              نهایی‌شده
            </Badge>
          ) : (
            <Badge variant="secondary" className="bg-amber-500/15 text-amber-600 dark:text-amber-400">
              پیش‌نویس
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">
            {faNum(s.counts.present)} حاضر · {faNum(s.counts.absent)} غایب · ثبت‌کننده: {s.creatorName}
          </span>
        </button>
      ))}
    </div>
  )
}

/* ─────────────────────────── دانش‌آموز ─────────────────────────── */

interface MyRecord {
  sessionId: string
  dateKey: string
  title: string
  classroomName: string
  status: string
  note: string | null
  finalizedAt: string | null
  creatorName: string
}

/** تخلف ثبت‌شدهٔ دانش‌آموز (درخواست کاربر — نمایش در حضور و غیاب من) */
interface MyViolation {
  id: string
  dateKey: string
  classroomName: string
  text: string
  creatorName: string
  createdAt: string
}

/** نمرهٔ ثبت‌شدهٔ دانش‌آموز (درخواست کاربر — تب «نمره‌ها» در گزارش کار) */
interface MyGrade {
  id: string
  dateKey: string
  classroomName: string
  title: string
  lessonName: string | null
  score: string
  teacherName: string
  createdAt: string
}

function StudentAttendance({ fullName }: { fullName: string }) {
  const [records, setRecords] = useState<MyRecord[]>([])
  const [violations, setViolations] = useState<MyViolation[]>([])
  // نمرات ثبت‌شدهٔ دانش‌آموز (درخواست کاربر — تب «نمره‌ها»)
  const [grades, setGrades] = useState<MyGrade[]>([])
  const [stats, setStats] = useState({ total: 0, present: 0, absent: 0, violations: 0, grades: 0 })
  const [loading, setLoading] = useState(true)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  // تب گزارش کار دانش‌آموز (درخواست کاربر): نمره‌ها / غیبت‌ها / تخلفات
  const [tab, setTab] = useState<'grades' | 'absents' | 'violations'>('grades')

  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch('/api/attendance/my', { cache: 'no-store' })
        const d = await res.json()
        if (res.ok) {
          setRecords(d.records ?? [])
          setViolations(d.violations ?? [])
          setGrades(d.grades ?? [])
          setStats(
            d.stats ?? { total: 0, present: 0, absent: 0, violations: 0, grades: 0 },
          )
        }
      } catch { /* ignore */ } finally {
        setLoading(false)
      }
    })()
  }, [])

  const dayInfo = useMemo(() => {
    const info: Record<string, { dots: { color: 'green' | 'red' | 'amber' | 'blue'; count: number }[] }> = {}
    for (const r of records) {
      const cur = info[r.dateKey] ?? { dots: [{ color: 'green' as const, count: 0 }, { color: 'red' as const, count: 0 }, { color: 'amber' as const, count: 0 }, { color: 'blue' as const, count: 0 }] }
      if (r.status === 'PRESENT') cur.dots[0].count++
      else if (r.status === 'ABSENT') cur.dots[1].count++
      info[r.dateKey] = cur
    }
    for (const v of violations) {
      const cur = info[v.dateKey] ?? { dots: [{ color: 'green' as const, count: 0 }, { color: 'red' as const, count: 0 }, { color: 'amber' as const, count: 0 }, { color: 'blue' as const, count: 0 }] }
      cur.dots[2].count++
      info[v.dateKey] = cur
    }
    for (const g of grades) {
      const cur = info[g.dateKey] ?? { dots: [{ color: 'green' as const, count: 0 }, { color: 'red' as const, count: 0 }, { color: 'amber' as const, count: 0 }, { color: 'blue' as const, count: 0 }] }
      cur.dots[3].count++
      info[g.dateKey] = cur
    }
    return info
  }, [records, violations, grades])

  const dayRecords = useMemo(
    () => (selectedDay ? records.filter((r) => r.dateKey === selectedDay) : []),
    [records, selectedDay],
  )
  const dayViolations = useMemo(
    () => (selectedDay ? violations.filter((v) => v.dateKey === selectedDay) : []),
    [violations, selectedDay],
  )
  const dayGrades = useMemo(
    () => (selectedDay ? grades.filter((g) => g.dateKey === selectedDay) : []),
    [grades, selectedDay],
  )

  // رکوردهای غیبت‌ها (تب «غیبت‌ها» — فقط غایب‌ها)
  const absentRecords = useMemo(
    () => records.filter((r) => r.status === 'ABSENT'),
    [records],
  )

  return (
    <div className="max-w-6xl mx-auto p-4 lg:p-6 space-y-4">
      <div className="flex items-center gap-2.5">
        {/* نام بخش برای دانش‌آموز: «گزارش کار» (درخواست کاربر) — محتوای زیرین بدون تغییر */}
        <ClipboardList className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-lg font-bold leading-tight">گزارش کار من</h1>
          <p className="text-xs text-muted-foreground">
            نمره‌ها، غیبت‌ها و تخلفات ثبت‌شدهٔ شما — {fullName}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
          <Loader2 className="h-5 w-5 animate-spin" /> در حال بارگذاری…
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 max-w-3xl">
            <Card className="py-3">
              <CardContent className="px-3 text-center">
                <div className="text-xl font-bold text-sky-600 dark:text-sky-400">
                  {faNum(stats.grades ?? grades.length)}
                </div>
                <div className="text-[11px] text-muted-foreground">نمرات ثبت‌شده</div>
              </CardContent>
            </Card>
            <Card className="py-3">
              <CardContent className="px-3 text-center">
                <div className="text-xl font-bold">{faNum(stats.total)}</div>
                <div className="text-[11px] text-muted-foreground">جلسات نهایی</div>
              </CardContent>
            </Card>
            <Card className="py-3">
              <CardContent className="px-3 text-center">
                <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
                  {faNum(stats.present)}
                </div>
                <div className="text-[11px] text-muted-foreground">حاضر</div>
              </CardContent>
            </Card>
            <Card className="py-3">
              <CardContent className="px-3 text-center">
                <div className="text-xl font-bold text-rose-600 dark:text-rose-400">
                  {faNum(stats.absent)}
                </div>
                <div className="text-[11px] text-muted-foreground">غایب</div>
              </CardContent>
            </Card>
            <Card className="py-3">
              <CardContent className="px-3 text-center">
                <div className="text-xl font-bold text-amber-600 dark:text-amber-400">
                  {faNum(stats.violations ?? violations.length)}
                </div>
                <div className="text-[11px] text-muted-foreground">تخلفات ثبت‌شده</div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-[340px_1fr] items-start">
            <div className="space-y-2">
              <JalaliCalendar dayInfo={dayInfo} selected={selectedDay} onSelectDay={setSelectedDay} />
              <div className="text-[11px] text-muted-foreground flex flex-wrap gap-3 px-1">
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" /> حاضر
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-rose-500" /> غایب
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-amber-500" /> تخلف
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-sky-500" /> نمره
                </span>
              </div>
            </div>

            <div className="space-y-2">
              {/* سه تب گزارش کار (درخواست کاربر): نمره‌ها / غیبت‌ها / تخلفات */}
              <Tabs value={tab} onValueChange={(v) => setTab(v as 'grades' | 'absents' | 'violations')}>
                <TabsList className="grid grid-cols-3 w-full" data-testid="report-tabs">
                  <TabsTrigger value="grades" className="gap-1.5">
                    <Award className="h-4 w-4" />
                    نمره‌ها
                    <Badge variant="secondary" className="text-[10px] px-1.5">
                      {faNum(grades.length)}
                    </Badge>
                  </TabsTrigger>
                  <TabsTrigger value="absents" className="gap-1.5">
                    <XCircle className="h-4 w-4" />
                    غیبت‌ها
                    <Badge variant="secondary" className="text-[10px] px-1.5">
                      {faNum(absentRecords.length)}
                    </Badge>
                  </TabsTrigger>
                  <TabsTrigger value="violations" className="gap-1.5">
                    <ClipboardList className="h-4 w-4" />
                    تخلفات
                    <Badge variant="secondary" className="text-[10px] px-1.5">
                      {faNum(violations.length)}
                    </Badge>
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              {selectedDay && (
                <div className="rounded-xl border p-3 space-y-2">
                  <div className="text-sm font-bold">
                    {formatJalaliDate(selectedDay, { withWeekday: true })}
                  </div>
                  {dayRecords.length ? (
                    dayRecords.map((r) => <RecordRow key={r.sessionId} r={r} />)
                  ) : (
                    <div className="text-xs text-muted-foreground py-3 text-center">
                      در این روز جلسه نهایی‌شده‌ای برای شما ثبت نشده است
                    </div>
                  )}
                  {dayGrades.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      {dayGrades.map((g) => (
                        <GradeRowItem key={g.id} g={g} />
                      ))}
                    </div>
                  )}
                  {dayViolations.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      {dayViolations.map((v) => (
                        <ViolationRow key={v.id} v={v} />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── تب «نمره‌ها» (درخواست کاربر — عنوان، نمره، معلم و تاریخ) ── */}
              {tab === 'grades' &&
                (grades.length === 0 ? (
                  <div
                    className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground"
                    data-testid="grades-empty"
                  >
                    هنوز نمره‌ای برای شما ثبت نشده است. وقتی معلم در ثبت حضور و غیاب نمره
                    ثبت کند، اینجا نمایش داده می‌شود.
                  </div>
                ) : (
                  <div className="space-y-1.5" data-testid="student-grades-list">
                    {grades.map((g) => (
                      <GradeRowItem key={g.id} g={g} />
                    ))}
                  </div>
                ))}

              {/* ── تب «غیبت‌ها» ── */}
              {tab === 'absents' &&
                (absentRecords.length === 0 ? (
                  <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                    غیبتی برای شما ثبت نشده است.
                  </div>
                ) : (
                  <div className="space-y-1.5" data-testid="student-absents-list">
                    {absentRecords.map((r) => (
                      <RecordRow key={r.sessionId} r={r} />
                    ))}
                  </div>
                ))}

              {/* ── تب «تخلفات» ── */}
              {tab === 'violations' &&
                (violations.length === 0 ? (
                  <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                    تخلفی برای شما ثبت نشده است.
                  </div>
                ) : (
                  <div className="space-y-1.5" data-testid="student-violations-list">
                    {violations.map((v) => (
                      <ViolationRow key={v.id} v={v} />
                    ))}
                  </div>
                ))}

              {!records.length && !violations.length && !grades.length && (
                <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
                  هنوز سابقه نهایی‌شده‌ای وجود ندارد. وقتی معلم حضور و غیاب را نهایی کند، اینجا
                  نمایش داده می‌شود.
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/** ردیف نمرهٔ دانش‌آموز — تب «نمره‌ها» و جزئیات روز (عنوان، نمره، معلم و تاریخ) */
function GradeRowItem({ g }: { g: MyGrade }) {
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-xl border border-sky-500/30 bg-sky-500/5 p-3"
      data-testid="student-grade-row"
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
        className="bg-sky-500/15 text-sky-700 dark:text-sky-400 text-xs gap-1"
      >
        <Award className="h-3 w-3" />
        نمره: {g.score}
      </Badge>
      <span className="w-full text-[10px] text-muted-foreground sm:w-auto" data-testid="grade-teacher">
        معلم: {g.teacherName}
      </span>
    </div>
  )
}

/** ردیف تخلف دانش‌آموز — در فهرست تخلفات و جزئیات روز */
function ViolationRow({ v }: { v: MyViolation }) {
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3"
      data-testid="student-violation-row"
    >
      <Badge variant="secondary" className="bg-amber-500/15 text-amber-600 dark:text-amber-400">
        تخلف
      </Badge>
      <span className="text-sm font-medium text-amber-700 dark:text-amber-300">{v.text}</span>
      <Badge variant="outline">{v.classroomName}</Badge>
      <Badge variant="outline" className="font-mono">
        {formatJalaliDate(v.dateKey, { withWeekday: true })}
      </Badge>
      <span className="w-full text-[10px] text-muted-foreground sm:w-auto">
        ثبت‌کننده: {v.creatorName}
      </span>
    </div>
  )
}

function RecordRow({ r }: { r: MyRecord }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border p-3" data-testid="student-attendance-record">
      <span className="text-sm font-bold">{r.title}</span>
      <Badge variant="outline">{r.classroomName}</Badge>
      <Badge variant="outline" className="font-mono">
        {formatJalaliDate(r.dateKey, { withWeekday: true })}
      </Badge>
      <Badge variant="secondary" className={cn('text-xs', STATUS_CLASS[r.status])}>
        {r.status === 'PRESENT' ? (
          <CheckCircle2 className="h-3 w-3 ml-1" />
        ) : (
          <XCircle className="h-3 w-3 ml-1" />
        )}
        {STATUS_FA[r.status]}
      </Badge>
      {r.note ? <span className="text-xs text-muted-foreground">یادداشت: {r.note}</span> : null}
      <span className="w-full text-[10px] text-muted-foreground sm:w-auto" data-testid="record-creator">
        ثبت‌کننده: {r.creatorName}
      </span>
    </div>
  )
}

/* ─────────────────────────── مدیر مدرسه ─────────────────────────── */

interface ReportRow {
  sessionId: string
  sessionTitle: string
  dateKey: string
  classroomId: string
  classroomName: string
  studentId: string
  studentName: string
  status: string
  note: string | null
  creatorName: string
  finalizedAt: string | null
}
interface ReportData {
  rows: ReportRow[]
  stats: {
    perStudent: { studentId: string; fullName: string; className: string; present: number; absent: number; unset: number; sessions: number }[]
    perClass: { classroomId: string; name: string; present: number; absent: number; unset: number; sessions: number }[]
  }
  options: {
    classrooms: { id: string; name: string }[]
    teachers: { id: string; fullName: string; roleLabel: string }[]
    students: { id: string; fullName: string }[]
  }
}

/** ورودی تاریخ کاربر (۱۴۰۴/۰۷/۰۱ یا 1404-07-01) → کلید استاندارد یا همان ورودی برای خطای سرور */
function normalizeDateInput(v: string): string {
  const en = v
    .replace(/[۰-۹]/g, (c) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c)))
    .replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)))
    .trim()
    .replace(/[/.]/g, '-')
  const m = en.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (!m) return en
  return `${m[1]}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[3])).padStart(2, '0')}`
}

function AdminAttendance({ fullName }: { fullName: string }) {
  const { toast } = useToast()
  const [report, setReport] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [editingSession, setEditingSession] = useState<string | null>(null)
  const [filters, setFilters] = useState({
    classroomId: '',
    teacherId: '',
    studentId: '',
    from: '',
    to: '',
    status: '',
  })

  const query = useMemo(() => {
    const q = new URLSearchParams()
    if (filters.classroomId) q.set('classroomId', filters.classroomId)
    if (filters.teacherId) q.set('teacherId', filters.teacherId)
    if (filters.studentId) q.set('studentId', filters.studentId)
    if (filters.from) q.set('from', normalizeDateInput(filters.from))
    if (filters.to) q.set('to', normalizeDateInput(filters.to))
    if (filters.status) q.set('status', filters.status)
    return q.toString()
  }, [filters])

  const load = useCallback(async (q: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/attendance/report${q ? `?${q}` : ''}`, { cache: 'no-store' })
      const d = await res.json()
      if (res.ok) setReport(d)
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load('')
  }, [load])

  const exportExcel = () => {
    // دانلود مستقیم با همان فیلترهای فعال
    window.location.href = `/api/attendance/report/export${query ? `?${query}` : ''}`
  }

  const thisMonth = useMemo(() => {
    const p = parseDateKey(todayDateKey())!
    const { from, to } = monthRange(p.jy, p.jm)
    return { from, to, label: `${JALALI_MONTHS[p.jm - 1]} ${faNum(p.jy)}` }
  }, [])

  return (
    <div className="max-w-6xl mx-auto p-4 lg:p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <CalendarCheck className="h-6 w-6 text-primary" />
        <div className="flex-1">
          <h1 className="text-lg font-bold leading-tight">حضور و غیاب — گزارش مدرسه</h1>
          <p className="text-xs text-muted-foreground">همه کلاس‌ها — {fullName}</p>
        </div>
        <Button variant="outline" size="sm" onClick={exportExcel}>
          <Download className="h-4 w-4" />
          خروجی اکسل
        </Button>
      </div>

      {/* نوار فیلتر */}
      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Filter className="h-4 w-4" />
            جست‌وجو و فیلتر
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            <Select
              value={filters.classroomId || undefined}
              onValueChange={(v) => setFilters((f) => ({ ...f, classroomId: v === 'all' ? '' : v }))}
            >
              <SelectTrigger className="h-9 text-xs" aria-label="کلاس">
                <SelectValue placeholder="همه کلاس‌ها" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">همه کلاس‌ها</SelectItem>
                {report?.options.classrooms.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filters.teacherId || undefined}
              onValueChange={(v) => setFilters((f) => ({ ...f, teacherId: v === 'all' ? '' : v }))}
            >
              <SelectTrigger className="h-9 text-xs" aria-label="معلم">
                <SelectValue placeholder="همه معلمان" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">همه معلمان</SelectItem>
                {report?.options.teachers.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.fullName} ({t.roleLabel})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filters.studentId || undefined}
              onValueChange={(v) => setFilters((f) => ({ ...f, studentId: v === 'all' ? '' : v }))}
            >
              <SelectTrigger className="h-9 text-xs" aria-label="دانش‌آموز">
                <SelectValue placeholder="همه دانش‌آموزان" />
              </SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="all">همه دانش‌آموزان</SelectItem>
                {report?.options.students.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.fullName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={filters.from}
              onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
              placeholder="از تاریخ ۱۴۰۴/۰۷/۰۱"
              className="h-9 text-xs"
              aria-label="از تاریخ"
            />
            <Input
              value={filters.to}
              onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
              placeholder="تا تاریخ ۱۴۰۴/۰۷/۳۱"
              className="h-9 text-xs"
              aria-label="تا تاریخ"
            />
            <Select
              value={filters.status || undefined}
              onValueChange={(v) => setFilters((f) => ({ ...f, status: v === 'all' ? '' : v }))}
            >
              <SelectTrigger className="h-9 text-xs" aria-label="وضعیت">
                <SelectValue placeholder="همه وضعیت‌ها" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">همه وضعیت‌ها</SelectItem>
                <SelectItem value="PRESENT">حاضر</SelectItem>
                <SelectItem value="ABSENT">غایب</SelectItem>
                <SelectItem value="UNSET">ثبت‌نشده</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => load(query)}>
              اعمال فیلتر
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setFilters({ classroomId: '', teacherId: '', studentId: '', from: '', to: '', status: '' })
                load('')
              }}
            >
              <RotateCcw className="h-4 w-4" />
              پاک‌کردن
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setFilters((f) => ({ ...f, from: thisMonth.from, to: thisMonth.to }))
              }}
            >
              <CalendarDays className="h-4 w-4" />
              {thisMonth.label}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="rows">
        <TabsList>
          <TabsTrigger value="rows">سوابق</TabsTrigger>
          <TabsTrigger value="stats">آمار</TabsTrigger>
        </TabsList>

        <TabsContent value="rows" className="space-y-2">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
              <Loader2 className="h-5 w-5 animate-spin" /> در حال بارگذاری گزارش…
            </div>
          ) : report?.rows.length ? (
            <div className="rounded-xl border overflow-x-auto">
              <table className="w-full text-sm min-w-[760px]">
                <thead>
                  <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                    <th className="p-2.5 text-right font-medium">کلاس</th>
                    <th className="p-2.5 text-right font-medium">جلسه</th>
                    <th className="p-2.5 text-right font-medium">تاریخ</th>
                    <th className="p-2.5 text-right font-medium">دانش‌آموز</th>
                    <th className="p-2.5 text-right font-medium">وضعیت</th>
                    <th className="p-2.5 text-right font-medium">ثبت‌کننده</th>
                    <th className="p-2.5 text-left font-medium">عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((r, i) => (
                    <tr key={`${r.sessionId}-${r.studentId}-${i}`} className="border-b last:border-0" data-testid="report-row">
                      <td className="p-2.5">{r.classroomName}</td>
                      <td className="p-2.5">{r.sessionTitle}</td>
                      <td className="p-2.5 text-xs whitespace-nowrap">{formatJalaliDate(r.dateKey)}</td>
                      <td className="p-2.5 font-medium">{r.studentName}</td>
                      <td className="p-2.5">
                        <Badge variant="secondary" className={cn('text-xs', STATUS_CLASS[r.status])}>
                          {STATUS_FA[r.status]}
                        </Badge>
                        {r.note ? (
                          <div className="text-[11px] text-muted-foreground mt-0.5">{r.note}</div>
                        ) : null}
                      </td>
                      <td className="p-2.5 text-xs text-muted-foreground">{r.creatorName}</td>
                      <td className="p-2.5 text-left">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setEditingSession(r.sessionId)}
                        >
                          ویرایش جلسه
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
              رکوردی با این فیلترها یافت نشد
            </div>
          )}
          <p className="text-[11px] text-muted-foreground px-1">
            «ثبت‌نشده» جدا از غیبت نمایش داده می‌شود؛ جلسات پیش‌نویس در این گزارش و آمار محاسبه
            نمی‌شوند.
          </p>
        </TabsContent>

        <TabsContent value="stats" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Users className="h-4 w-4" /> آمار دانش‌آموزان
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm min-w-[560px]">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="p-2 text-right font-medium">دانش‌آموز</th>
                    <th className="p-2 text-right font-medium">کلاس</th>
                    <th className="p-2 text-center font-medium">حاضر</th>
                    <th className="p-2 text-center font-medium">غایب</th>
                    <th className="p-2 text-center font-medium">ثبت‌نشده</th>
                    <th className="p-2 text-center font-medium">جلسات نهایی</th>
                  </tr>
                </thead>
                <tbody>
                  {report?.stats.perStudent.map((s) => (
                    <tr key={s.studentId} className="border-b last:border-0" data-testid="stat-student-row">
                      <td className="p-2 font-medium">{s.fullName}</td>
                      <td className="p-2 text-xs text-muted-foreground">{s.className || '—'}</td>
                      <td className="p-2 text-center text-emerald-600 dark:text-emerald-400">{faNum(s.present)}</td>
                      <td className="p-2 text-center text-rose-600 dark:text-rose-400">{faNum(s.absent)}</td>
                      <td className="p-2 text-center text-muted-foreground">{faNum(s.unset)}</td>
                      <td className="p-2 text-center">{faNum(s.sessions)}</td>
                    </tr>
                  ))}
                  {!report?.stats.perStudent.length && (
                    <tr>
                      <td colSpan={6} className="p-6 text-center text-xs text-muted-foreground">
                        داده‌ای برای آمار وجود ندارد
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Users className="h-4 w-4" /> آمار کلاس‌ها
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm min-w-[480px]">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="p-2 text-right font-medium">کلاس</th>
                    <th className="p-2 text-center font-medium">حاضر</th>
                    <th className="p-2 text-center font-medium">غایب</th>
                    <th className="p-2 text-center font-medium">ثبت‌نشده</th>
                    <th className="p-2 text-center font-medium">جلسات نهایی</th>
                  </tr>
                </thead>
                <tbody>
                  {report?.stats.perClass.map((c) => (
                    <tr key={c.classroomId} className="border-b last:border-0" data-testid="stat-class-row">
                      <td className="p-2 font-medium">{c.name}</td>
                      <td className="p-2 text-center text-emerald-600 dark:text-emerald-400">{faNum(c.present)}</td>
                      <td className="p-2 text-center text-rose-600 dark:text-rose-400">{faNum(c.absent)}</td>
                      <td className="p-2 text-center text-muted-foreground">{faNum(c.unset)}</td>
                      <td className="p-2 text-center">{faNum(c.sessions)}</td>
                    </tr>
                  ))}
                  {!report?.stats.perClass.length && (
                    <tr>
                      <td colSpan={5} className="p-6 text-center text-xs text-muted-foreground">
                        داده‌ای برای آمار وجود ندارد
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* دیالوگ ویرایش جلسه (اصلاح وضعیت با حفظ سابقه) */}
      <Dialog open={!!editingSession} onOpenChange={(v) => !v && setEditingSession(null)}>
        <DialogContent className="max-w-2xl max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>اصلاح حضور و غیاب</DialogTitle>
            <DialogDescription>
              هر تغییر با نام شما در سابقه اصلاحات ثبت می‌شود و در صورت تغییر وضعیت دانش‌آموز
              نهایی‌شده، اعلان اصلاح خصوصی ارسال خواهد شد.
            </DialogDescription>
          </DialogHeader>
          {editingSession && (
            <AttendanceSessionEditor
              sessionId={editingSession}
              role="SCHOOL_ADMIN"
              onSessionUpdated={() => load(query)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
