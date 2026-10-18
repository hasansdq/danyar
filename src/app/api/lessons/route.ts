import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAppRole, requireSchoolManager, jsonError } from '@/lib/api-auth'
import { toPersianDigits } from '@/lib/school'

/**
 * درس‌های مدرسه (درخواست کاربر — باکس «درس‌ها» پنل مدیریت مدرسه):
 * - مدیر/معاون مدرسه: فهرست همهٔ درس‌های مدرسه (با تعداد معلمان منتسب)
 *   + فرم چندانتخابی درس در فرم ایجاد معلم از همین فهرست استفاده می‌کند
 * - معلم: فقط درس‌های منتسب به خودش (مبنای dropdown «درس» در ثبت نمره)
 */
export async function GET() {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session

  // معلم — فقط درس‌های خودش
  if (session.role === 'TEACHER') {
    const rows = await db.teacherLesson.findMany({
      where: { teacherId: session.uid },
      orderBy: { lesson: { name: 'asc' } },
      select: { lesson: { select: { id: true, name: true } } },
    })
    return NextResponse.json({ lessons: rows.map((r) => r.lesson) })
  }

  if (session.role !== 'SCHOOL_ADMIN' && session.role !== 'SCHOOL_VICE') {
    return jsonError('دسترسی غیرمجاز', 403)
  }

  const lessons = await db.lesson.findMany({
    where: { schoolId: session.schoolId },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      createdAt: true,
      _count: { select: { teacherLessons: true, grades: true } },
    },
  })

  return NextResponse.json({
    lessons: lessons.map((l) => ({
      id: l.id,
      name: l.name,
      createdAt: l.createdAt,
      teacherCount: l._count.teacherLessons,
      gradeCount: l._count.grades,
    })),
  })
}

/**
 * افزودن درس‌ها — فرم لیستی چند درس هم‌زمان (درخواست کاربر):
 * بدنه: { names: string[] } — نام‌های خالی/تکراری حذف می‌شوند؛
 * تکراری‌های موجود در مدرسه گزارش و بقیه ساخته می‌شوند.
 */
export async function POST(req: NextRequest) {
  // معاون: مدیریت درس‌ها فقط با مجوز مربوطه (سوییچ مدیر مدرسه)
  const res = await requireSchoolManager('lessons')
  if ('response' in res) return res.response

  const body = await req.json().catch(() => null)
  const rawNames: unknown[] = Array.isArray(body?.names) ? body.names : []
  if (rawNames.length === 0) return jsonError('حداقل یک نام درس وارد کنید')
  if (rawNames.length > 100) return jsonError('حداکثر ۱۰۰ درس در هر ارسال')

  // نرمال‌سازی: تبدیل ارقام فارسی، حذف فاصله‌های اضافی و تکراری‌های ارسالی
  const seen = new Set<string>()
  const names: string[] = []
  for (const raw of rawNames) {
    const name = toPersianDigits(String(raw ?? '').trim().replace(/\s+/g, ' '))
    if (name.length < 2 || name.length > 60) continue
    if (seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  if (names.length === 0) {
    return jsonError('نام درس باید حداقل ۲ و حداکثر ۶۰ کاراکتر باشد')
  }

  // تکراری‌های موجود در همین مدرسه
  const existing = await db.lesson.findMany({
    where: { schoolId: res.session.schoolId, name: { in: names } },
    select: { name: true },
  })
  const existingSet = new Set(existing.map((e) => e.name))
  const fresh = names.filter((n) => !existingSet.has(n))

  if (fresh.length === 0) {
    return jsonError('همهٔ درس‌های ارسالی قبلاً در این مدرسه ثبت شده‌اند', 409)
  }

  const created = await db.lesson.createMany({
    data: fresh.map((name) => ({ name, schoolId: res.session.schoolId })),
  })

  return NextResponse.json(
    {
      createdCount: created.count,
      duplicates: names.filter((n) => existingSet.has(n)),
      lessons: await db.lesson.findMany({
        where: { schoolId: res.session.schoolId, name: { in: fresh } },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
    },
    { status: 201 },
  )
}
