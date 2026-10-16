import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSuperAdmin, jsonError } from '@/lib/api-auth'
import { sanitizeFeatures, parseFeatures } from '@/lib/features'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const res = await requireSuperAdmin()
  if ('response' in res) return res.response
  const { id } = await params

  const school = await db.school.findUnique({
    where: { id },
    include: {
      _count: { select: { classrooms: true, users: true } },
      classrooms: {
        orderBy: { createdAt: 'asc' },
        include: { _count: { select: { subjectGroups: true, enrollments: true } } },
      },
      users: {
        where: { role: 'SCHOOL_ADMIN' },
        select: { id: true, username: true, fullName: true, isActive: true },
      },
    },
  })
  if (!school) return jsonError('مدرسه یافت نشد', 404)
  return NextResponse.json({ school, features: parseFeatures(school.features) })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const res = await requireSuperAdmin()
  if ('response' in res) return res.response
  const { id } = await params

  const school = await db.school.findUnique({ where: { id } })
  if (!school) return jsonError('مدرسه یافت نشد', 404)

  const body = await req.json().catch(() => null)
  const data: { name?: string; isActive?: boolean; features?: string } = {}

  if (typeof body?.name === 'string') {
    const name = body.name.trim()
    if (name.length < 2) return jsonError('نام مدرسه باید حداقل ۲ کاراکتر باشد')
    const duplicate = await db.school.findFirst({ where: { name, NOT: { id } } })
    if (duplicate) return jsonError('مدرسه‌ای با این نام قبلاً ثبت شده است', 409)
    data.name = name
  }
  if (typeof body?.isActive === 'boolean') data.isActive = body.isActive
  if (body && 'features' in body) {
    const features = sanitizeFeatures(body.features)
    if (!features) return jsonError('ساختار امکانات نامعتبر است')
    // کلیدهای اختیاری که کلاینت قدیمی نفرستاده (attendance/sampleq/push)
    // از مقدار فعلی مدرسه حفظ می‌شوند تا بی‌دلیل بازنویسی نشوند
    const current = parseFeatures(school.features)
    const merged = {
      ...features,
      attendance: features.attendance === undefined ? current.attendance : features.attendance,
      sampleq: features.sampleq === undefined ? current.sampleq : features.sampleq,
      push: features.push === undefined ? current.push : features.push,
    }
    data.features = JSON.stringify(merged)
  }
  if (Object.keys(data).length === 0) return jsonError('تغییری ارسال نشده است')

  const school2 = await db.school.update({ where: { id }, data })
  return NextResponse.json({ school: school2 })
}

/** حذف مدرسه — بدون confirm فقط آمار وابستگی‌ها را برمی‌گرداند (409) */
export async function DELETE(req: NextRequest, { params }: Params) {
  const res = await requireSuperAdmin()
  if ('response' in res) return res.response
  const { id } = await params

  const school = await db.school.findUnique({ where: { id } })
  if (!school) return jsonError('مدرسه یافت نشد', 404)

  const [users, classrooms, groups, messages] = await Promise.all([
    db.user.count({ where: { schoolId: id } }),
    db.classroom.count({ where: { schoolId: id } }),
    db.subjectGroup.count({ where: { classroom: { schoolId: id } } }),
    db.message.count({ where: { subjectGroup: { classroom: { schoolId: id } } } }),
  ])

  const confirmed = req.nextUrl.searchParams.get('confirm') === 'true'

  if (!confirmed) {
    return NextResponse.json(
      {
        error: 'حذف مدرسه وابستگی‌های زیادی دارد؛ برای حذف قطعی تأیید کنید',
        dependencies: { users, classrooms, groups, messages },
      },
      { status: 409 },
    )
  }

  await db.school.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
