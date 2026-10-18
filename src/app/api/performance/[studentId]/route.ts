import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSchoolManager, jsonError } from '@/lib/api-auth'
import { scoreToNumber, avgOf, cmpDateKey, monthKeyOf, monthLabelOf } from '@/lib/performance'
import { formatJalaliDate } from '@/lib/jalali'
import type {
  MonthlyBucket,
  GradeTrendPoint,
  LessonAvg,
  PerfRecord,
  PerfViolation,
  PerfGrade,
} from '@/lib/performance'

/**
 * GET /api/performance/[studentId] — ریز گزارش عملکرد یک دانش‌آموز (درخواست کاربر):
 * آمار کامل + دادهٔ نمودارها (روند نمرات، میانگین درس‌ها، وضعیت حضور، سبد ماهانه)
 * + رکوردهای خام (نمره‌ها/غیبت‌ها/تخلفات) برای تب‌های جزئیات.
 * فقط مدیر/معاون مدرسهٔ خودِ دانش‌آموز (جداسازی مدارس).
 * - غیبت‌ها: فقط جلسات نهایی‌شده (سازگار با «گزارش کار» دانش‌آموز)
 * - میانگین: فقط نمرات عددی؛ نمرات توصیفی در رکوردها و «آخرین نمره» می‌مانند
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ studentId: string }> },
) {
  const res = await requireSchoolManager()
  if ('response' in res) return res.response
  const session = res.session
  const { studentId } = await params

  const student = await db.user.findUnique({
    where: { id: studentId },
    select: {
      id: true,
      fullName: true,
      username: true,
      isActive: true,
      schoolId: true,
      role: true,
      enrollments: { select: { classroom: { select: { id: true, name: true } } } },
    },
  })
  if (!student || student.role !== 'STUDENT' || student.schoolId !== session.schoolId) {
    return jsonError('دانش‌آموز یافت نشد', 404)
  }

  // رکوردهای حضور/غیاب نهایی‌شده
  const records = await db.attendanceRecord.findMany({
    where: {
      studentId,
      session: { status: 'FINALIZED', classroom: { schoolId: session.schoolId } },
    },
    include: {
      session: {
        include: {
          classroom: { select: { name: true } },
          creator: { select: { fullName: true } },
        },
      },
    },
    orderBy: [{ session: { dateKey: 'desc' } }, { updatedAt: 'desc' }],
  })

  const violations = await db.studentViolation.findMany({
    where: { studentId, classroom: { schoolId: session.schoolId } },
    include: {
      creator: { select: { fullName: true } },
      classroom: { select: { name: true } },
    },
    orderBy: [{ dateKey: 'desc' }, { createdAt: 'desc' }],
  })

  const grades = await db.studentGrade.findMany({
    where: {
      studentId,
      classroom: { schoolId: session.schoolId },
      OR: [{ session: { status: 'FINALIZED' } }, { sessionId: null }],
    },
    include: {
      creator: { select: { fullName: true } },
      classroom: { select: { name: true } },
      lesson: { select: { name: true } },
    },
    orderBy: [{ dateKey: 'desc' }, { createdAt: 'desc' }],
  })

  // ─── آمار کلی ───
  const present = records.filter((r) => r.status === 'PRESENT').length
  const absent = records.filter((r) => r.status === 'ABSENT').length
  const numericGrades = grades
    .map((g) => scoreToNumber(g.score))
    .filter((n): n is number => n !== null)
  const avgScore = avgOf(numericGrades)
  // آخرین نمره — تازگی‌ترین بر اساس dateKey سپس createdAt (grades نزولی مرتب شده)
  const lastGradeRow = grades[0] ?? null

  // ─── روند نمرات (صعودی برای نمودار خطی) ───
  const gradeTrend: GradeTrendPoint[] = grades
    .map((g) => ({
      dateKey: g.dateKey,
      label: formatJalaliDate(g.dateKey),
      score: scoreToNumber(g.score),
      title: g.title,
      lessonName: g.lesson?.name ?? null,
    }))
    .filter((p): p is GradeTrendPoint & { score: number } => p.score !== null)
    .sort((a, b) => cmpDateKey(a.dateKey, b.dateKey))
    .map((p) => ({ ...p }))

  // ─── میانگین هر درس (فقط نمرات عددی؛ درس خالی = «بدون درس») ───
  const byLesson = new Map<string, number[]>()
  for (const g of grades) {
    const n = scoreToNumber(g.score)
    if (n === null) continue
    const key = g.lesson?.name ?? 'بدون درس'
    const cur = byLesson.get(key) ?? []
    cur.push(n)
    byLesson.set(key, cur)
  }
  const perLesson: LessonAvg[] = Array.from(byLesson.entries())
    .map(([lessonName, nums]) => ({
      lessonName,
      avgScore: avgOf(nums) ?? 0,
      count: nums.length,
    }))
    .sort((a, b) => b.avgScore - a.avgScore)

  // ─── سبد ماهانهٔ جلالی (مرتب صعودی) ───
  const monthlyMap = new Map<string, { absences: number; violations: number; nums: number[] }>()
  const bucket = (dateKey: string) => {
    const mk = monthKeyOf(dateKey)
    const cur = monthlyMap.get(mk) ?? { absences: 0, violations: 0, nums: [] }
    monthlyMap.set(mk, cur)
    return cur
  }
  for (const r of records) {
    if (r.status === 'ABSENT') bucket(r.session.dateKey).absences++
  }
  for (const v of violations) {
    bucket(v.dateKey).violations++
  }
  for (const g of grades) {
    const n = scoreToNumber(g.score)
    if (n !== null) bucket(g.dateKey).nums.push(n)
  }
  const monthly: MonthlyBucket[] = Array.from(monthlyMap.entries())
    .sort((a, b) => cmpDateKey(a[0], b[0]))
    .map(([monthKey, m]) => ({
      monthKey,
      label: monthLabelOf(monthKey),
      absences: m.absences,
      violations: m.violations,
      avgScore: avgOf(m.nums),
      gradeCount: m.nums.length,
    }))

  const perfRecords: PerfRecord[] = records.map((r) => ({
    sessionId: r.sessionId,
    dateKey: r.session.dateKey,
    title: r.session.title,
    classroomName: r.session.classroom.name,
    status: r.status,
    note: r.note,
    creatorName: r.session.creator?.fullName ?? '—',
  }))

  const perfViolations: PerfViolation[] = violations.map((v) => ({
    id: v.id,
    dateKey: v.dateKey,
    classroomName: v.classroom.name,
    text: v.text,
    creatorName: v.creator?.fullName ?? '—',
    createdAt: v.createdAt.toISOString(),
  }))

  const perfGrades: PerfGrade[] = grades.map((g) => ({
    id: g.id,
    dateKey: g.dateKey,
    classroomName: g.classroom.name,
    title: g.title,
    lessonName: g.lesson?.name ?? null,
    score: g.score,
    teacherName: g.creator?.fullName ?? '—',
    createdAt: g.createdAt.toISOString(),
  }))

  return NextResponse.json({
    student: {
      id: student.id,
      fullName: student.fullName,
      username: student.username,
      isActive: student.isActive,
      classroomNames: student.enrollments.map((e) => e.classroom.name),
    },
    stats: {
      sessions: records.length,
      present,
      absent,
      violationCount: violations.length,
      gradeCount: grades.length,
      numericGradeCount: numericGrades.length,
      avgScore,
      lastGrade: lastGradeRow
        ? {
            score: lastGradeRow.score,
            title: lastGradeRow.title,
            lessonName: lastGradeRow.lesson?.name ?? null,
            dateKey: lastGradeRow.dateKey,
          }
        : null,
    },
    gradeTrend,
    perLesson,
    monthly,
    records: perfRecords,
    violations: perfViolations,
    grades: perfGrades,
  })
}
