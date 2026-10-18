import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSchoolManager } from '@/lib/api-auth'
import { scoreToNumber, avgOf, cmpDateKey, type PerformanceRow } from '@/lib/performance'

/**
 * GET /api/performance — «گزارش عملکرد دانش‌آموزان» (درخواست کاربر):
 * فهرست آماری همهٔ دانش‌آموزان مدرسه برای مدیر/معاون:
 *   تعداد تخلفات · میانگین نمرات · آخرین نمره · تعداد غیبت‌ها
 * مبنای جدول بخش آماری مستقل در هاب مدیریت مدرسه (زیر باکس‌ها) است.
 * - غیبت‌ها فقط از جلسات نهایی‌شده شمرده می‌شوند (سازگار با گزارش کار دانش‌آموز)
 * - میانگین فقط روی نمرات عددی (ارقام فارسی پذیرفته می‌شود)؛ نمرات توصیفی («خیلی خوب»)
 *   در میانگین حساب نمی‌شوند اما در «آخرین نمره» دیده می‌شوند
 * - آخرین نمره = تازگی‌ترین رکورد بر اساس کلید تاریخ جلالی (سپس createdAt)
 * ?classroomId= اختیاری — فقط دانش‌آموزان همان کلاس
 */
export async function GET(req: NextRequest) {
  const res = await requireSchoolManager()
  if ('response' in res) return res.response
  const session = res.session
  const schoolId = session.schoolId

  const classroomId = req.nextUrl.searchParams.get('classroomId') ?? ''

  // دانش‌آموزان مدرسه + کلاس‌های ثبت‌نام‌شده (فیلتر اختیاری کلاس سمت سرور)
  const students = await db.user.findMany({
    where: {
      schoolId,
      role: 'STUDENT',
      ...(classroomId
        ? { enrollments: { some: { classroomId } } }
        : {}),
    },
    select: {
      id: true,
      fullName: true,
      username: true,
      isActive: true,
      enrollments: { select: { classroom: { select: { name: true } } } },
    },
    orderBy: { fullName: 'asc' },
  })

  // فهرست کلاس‌ها برای فیلتر سمت کلاینت
  const classrooms = await db.classroom.findMany({
    where: { schoolId },
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' },
  })

  if (!students.length) {
    return NextResponse.json({ students: [] as PerformanceRow[], classrooms })
  }
  const studentIds = students.map((s) => s.id)

  // تخلفات هر دانش‌آموز — groupBy برای پرهیز از N+1
  const violationCounts = await db.studentViolation.groupBy({
    by: ['studentId'],
    where: { studentId: { in: studentIds }, classroom: { schoolId } },
    _count: { _all: true },
  })
  const violationMap = new Map(violationCounts.map((v) => [v.studentId, v._count._all]))

  // غیبت‌ها — فقط جلسات نهایی‌شدهٔ همین مدرسه
  const absenceCounts = await db.attendanceRecord.groupBy({
    by: ['studentId'],
    where: {
      studentId: { in: studentIds },
      status: 'ABSENT',
      session: { status: 'FINALIZED', classroom: { schoolId } },
    },
    _count: { _all: true },
  })
  const absenceMap = new Map(absenceCounts.map((a) => [a.studentId, a._count._all]))

  // همهٔ نمرات دیده‌شدهٔ دانش‌آموزان (جلسهٔ نهایی یا بدون جلسه) — تجمیع در JS
  const grades = await db.studentGrade.findMany({
    where: {
      studentId: { in: studentIds },
      classroom: { schoolId },
      OR: [{ session: { status: 'FINALIZED' } }, { sessionId: null }],
    },
    select: {
      studentId: true,
      score: true,
      title: true,
      dateKey: true,
      createdAt: true,
      lesson: { select: { name: true } },
    },
  })

  // تجمیع نمرات هر دانش‌آموز: میانگین عددی + آخرین نمره
  const gradeAgg = new Map<
    string,
    {
      nums: number[]
      last: {
        score: string
        title: string
        lessonName: string | null
        dateKey: string
        createdAt: Date
      } | null
    }
  >()
  for (const g of grades) {
    const cur = gradeAgg.get(g.studentId) ?? { nums: [], last: null }
    const num = scoreToNumber(g.score)
    if (num !== null) cur.nums.push(num)
    // آخرین نمره: dateKey بزرگ‌تر؛ در تساوی، createdAt جدیدتر
    if (
      !cur.last ||
      cmpDateKey(g.dateKey, cur.last.dateKey) > 0 ||
      (g.dateKey === cur.last.dateKey && g.createdAt > cur.last.createdAt)
    ) {
      cur.last = {
        score: g.score,
        title: g.title,
        lessonName: g.lesson?.name ?? null,
        dateKey: g.dateKey,
        createdAt: g.createdAt,
      }
    }
    gradeAgg.set(g.studentId, cur)
  }

  const out: PerformanceRow[] = students.map((s) => {
    const agg = gradeAgg.get(s.id)
    return {
      id: s.id,
      fullName: s.fullName,
      username: s.username,
      isActive: s.isActive,
      classroomNames: s.enrollments.map((e) => e.classroom.name),
      violationCount: violationMap.get(s.id) ?? 0,
      avgScore: avgOf(agg?.nums ?? []),
      numericGradeCount: agg?.nums.length ?? 0,
      lastGrade: agg?.last
        ? {
            score: agg.last.score,
            title: agg.last.title,
            lessonName: agg.last.lessonName,
            dateKey: agg.last.dateKey,
          }
        : null,
      absentCount: absenceMap.get(s.id) ?? 0,
    }
  })

  return NextResponse.json({ students: out, classrooms })
}
