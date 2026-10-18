import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSchoolManager, jsonError } from '@/lib/api-auth'
import { toPersianDigits } from '@/lib/school'

type Params = { params: Promise<{ id: string }> }

/** ویرایش درس — تغییر نام (مدیر/معاونِ دارای مجوز درس‌ها) */
export async function PATCH(req: NextRequest, { params }: Params) {
  const res = await requireSchoolManager('lessons')
  if ('response' in res) return res.response
  const { id } = await params

  const lesson = await db.lesson.findFirst({
    where: { id, schoolId: res.session.schoolId },
  })
  if (!lesson) return jsonError('درس یافت نشد', 404)

  const body = await req.json().catch(() => null)
  const name = toPersianDigits(String(body?.name ?? '').trim().replace(/\s+/g, ' '))
  if (name.length < 2) return jsonError('نام درس باید حداقل ۲ کاراکتر باشد')
  if (name.length > 60) return jsonError('نام درس حداکثر ۶۰ کاراکتر است')

  const duplicate = await db.lesson.findFirst({
    where: { schoolId: res.session.schoolId, name, id: { not: id } },
    select: { id: true },
  })
  if (duplicate) return jsonError('درسی با این نام در این مدرسه وجود دارد', 409)

  const updated = await db.lesson.update({
    where: { id },
    data: { name },
    select: { id: true, name: true },
  })
  return NextResponse.json({ lesson: updated })
}

/** حذف درس — بدون confirm آمار وابستگی‌ها را برمی‌گرداند (409) */
export async function DELETE(req: NextRequest, { params }: Params) {
  const res = await requireSchoolManager('lessons')
  if ('response' in res) return res.response
  const { id } = await params

  const lesson = await db.lesson.findFirst({
    where: { id, schoolId: res.session.schoolId },
  })
  if (!lesson) return jsonError('درس یافت نشد', 404)

  const [teacherCount, gradeCount] = await Promise.all([
    db.teacherLesson.count({ where: { lessonId: id } }),
    db.studentGrade.count({ where: { lessonId: id } }),
  ])

  const confirmed = req.nextUrl.searchParams.get('confirm') === 'true'
  if (!confirmed && (teacherCount > 0 || gradeCount > 0)) {
    return NextResponse.json(
      {
        error: 'این درس داده‌های وابسته دارد؛ برای حذف قطعی تأیید کنید',
        dependencies: { teacherCount, gradeCount },
      },
      { status: 409 },
    )
  }

  // انتساب‌های معلم حذف می‌شوند؛ نمرات ثبت‌شده می‌مانند (درسشان خالی می‌شود)
  await db.lesson.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
