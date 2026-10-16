import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSuperAdmin, jsonError } from '@/lib/api-auth'
import { normalizePhone } from '@/lib/phone'
import { hashPassword, validatePassword } from '@/lib/password'

type Params = { params: Promise<{ id: string }> }

/** جزئیات کامل کاربر برای ویرایش — فقط مدیر کل */
export async function GET(_req: NextRequest, { params }: Params) {
  const res = await requireSuperAdmin()
  if ('response' in res) return res.response
  const { id } = await params

  const user = await db.user.findUnique({
    where: { id },
    select: {
      id: true,
      username: true,
      fullName: true,
      firstName: true,
      lastName: true,
      role: true,
      phone: true,
      isActive: true,
      schoolId: true,
      school: { select: { id: true, name: true, isActive: true } },
      enrollments: { select: { classroom: { select: { id: true, name: true } } } },
      teachingAssignments: { select: { subjectGroup: { select: { name: true, classroom: { select: { name: true } } } } } },
    },
  })
  if (!user) return jsonError('کاربر یافت نشد', 404)

  // کلاس‌های مدرسه کاربر (برای تغییر کلاس دانش‌آموز)
  const classrooms = user.schoolId
    ? await db.classroom.findMany({
        where: { schoolId: user.schoolId },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      })
    : []
  // فهرست مدارس برای انتقال کاربر
  const schools = await db.school.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true, isActive: true },
  })

  return NextResponse.json({
    user: {
      ...user,
      className: user.enrollments[0]?.classroom.name ?? null,
      classroomId: user.enrollments[0]?.classroom.id ?? null,
    },
    classrooms,
    schools,
    // رمز عبور به‌صورت bcrypt هش می‌شود و هرگز قابل نمایش نیست
    passwordRecoverable: false,
  })
}

/**
 * ویرایش کامل کاربر توسط مدیر کل:
 * نام و نام خانوادگی، شماره تلفن، مدرسه، کلاس (دانش‌آموز)، وضعیت فعال
 * تغییر مدرسه، اتصال‌های کلاسی/انتساب‌های آموزشی قبلی را پاک می‌کند.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const res = await requireSuperAdmin()
  if ('response' in res) return res.response
  const { id } = await params
  const meId = res.session.uid

  const user = await db.user.findUnique({ where: { id } })
  if (!user) return jsonError('کاربر یافت نشد', 404)

  const body = await req.json().catch(() => null)
  if (!body) return jsonError('درخواست نامعتبر است')

  const data: { fullName?: string; firstName?: string; lastName?: string; phone?: string | null; schoolId?: string | null; isActive?: boolean } = {}

  // نام و نام خانوادگی جدا — fullName ترکیب دوگانه به‌روز می‌شود
  const newFirst = typeof body.firstName === 'string' ? body.firstName.trim() : undefined
  const newLast = typeof body.lastName === 'string' ? body.lastName.trim() : undefined
  if (newFirst !== undefined || newLast !== undefined) {
    const firstName = newFirst !== undefined ? newFirst : user.firstName ?? ''
    const lastName = newLast !== undefined ? newLast : user.lastName ?? ''
    if (firstName.length < 2) return jsonError('نام باید حداقل ۲ کاراکتر باشد')
    if (lastName.length < 2) return jsonError('نام خانوادگی باید حداقل ۲ کاراکتر باشد')
    data.firstName = firstName
    data.lastName = lastName
    data.fullName = `${firstName} ${lastName}`.trim()
  } else if (typeof body.fullName === 'string') {
    const name = body.fullName.trim()
    if (name.length < 2 || name.length > 80) return jsonError('نام باید بین ۲ تا ۸۰ کاراکتر باشد')
    data.fullName = name
  }

  // شماره تلفن (یکتا در کل پلتفرم)
  if ('phone' in body) {
    if (body.phone === null || body.phone === '') {
      data.phone = null
    } else {
      const phone = normalizePhone(body.phone)
      if (!phone) return jsonError('شماره تلفن معتبر نیست (مثلاً 09123456789)')
      const dup = await db.user.findFirst({ where: { phone, NOT: { id } } })
      if (dup) return jsonError('این شماره قبلاً برای کاربر دیگری ثبت شده است', 409)
      data.phone = phone
    }
  }

  // تغییر مدرسه
  if ('schoolId' in body) {
    const schoolId = body.schoolId ? String(body.schoolId) : null
    if (schoolId) {
      const school = await db.school.findUnique({ where: { id: schoolId } })
      if (!school) return jsonError('مدرسه یافت نشد', 404)
    }
    if (user.role === 'SUPER_ADMIN') return jsonError('مدرسه مدیر کل قابل تغییر نیست', 400)
    if (schoolId !== user.schoolId) {
      // اتصال‌های کلاسی و انتساب‌های آموزشی با مدرسه قبلی باطل می‌شوند
      await db.classroomEnrollment.deleteMany({ where: { studentId: id } })
      await db.teachingAssignment.deleteMany({ where: { teacherId: id } })
      await db.groupMemberOverride.deleteMany({ where: { userId: id } })
      await db.groupReadState.deleteMany({ where: { userId: id } })
    }
    data.schoolId = schoolId
  }

  // وضعیت فعال
  if (typeof body.isActive === 'boolean') {
    if (id === meId) return jsonError('نمی‌توانید وضعیت حساب خودتان را تغییر دهید')
    data.isActive = body.isActive
  }

  // تغییر کلاس (فقط دانش‌آموز دارای مدرسه)
  if ('classroomId' in body && user.role === 'STUDENT') {
    const schoolId = data.schoolId !== undefined ? data.schoolId : user.schoolId
    if (!schoolId) return jsonError('ابتدا مدرسه دانش‌آموز را مشخص کنید')
    if (body.classroomId) {
      const classroom = await db.classroom.findFirst({
        where: { id: String(body.classroomId), schoolId },
      })
      if (!classroom) return jsonError('کلاس در مدرسه انتخابی یافت نشد', 404)
      // بازسازی ثبت‌نام: حذف قبلی‌ها + ثبت کلاس جدید
      await db.classroomEnrollment.deleteMany({ where: { studentId: id } })
      await db.classroomEnrollment.create({ data: { studentId: id, classroomId: classroom.id } })
    } else {
      await db.classroomEnrollment.deleteMany({ where: { studentId: id } })
    }
  }

  if (Object.keys(data).length === 0) {
    const fresh = await db.user.findUnique({
      where: { id },
      select: { id: true, fullName: true, phone: true, isActive: true, schoolId: true },
    })
    return NextResponse.json({ user: fresh })
  }

  const updated = await db.user.update({
    where: { id },
    data,
    select: { id: true, username: true, fullName: true, phone: true, isActive: true, schoolId: true },
  })

  // اگر کاربرِ در حال مشاهده (جعل هویت) ویرایش شد، لاگ بماند
  console.log(`[admin] user ${id} updated by ${meId}: ${Object.keys(data).join(',')}`)
  return NextResponse.json({ user: updated })
}

/** تعیین رمز عبور جدید توسط مدیر کل — bcrypt؛ رمز فعلی قابل نمایش/بازیابی نیست */
export async function POST(req: NextRequest, { params }: Params) {
  const res = await requireSuperAdmin()
  if ('response' in res) return res.response
  const { id } = await params

  const body = await req.json().catch(() => null)
  const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : ''
  const pwError = validatePassword(newPassword)
  if (pwError) return jsonError(pwError)

  const user = await db.user.findUnique({ where: { id }, select: { id: true } })
  if (!user) return jsonError('کاربر یافت نشد', 404)

  const passwordHash = await hashPassword(newPassword)
  await db.user.update({ where: { id }, data: { passwordHash } })
  console.log(`[admin] password of user ${id} reset by ${res.session.uid}`)
  return NextResponse.json({ ok: true })
}

/** حذف امن کاربر توسط مدیر کل — بدون confirm فقط آمار وابستگی‌ها را برمی‌گرداند */
export async function DELETE(req: NextRequest, { params }: Params) {
  const res = await requireSuperAdmin()
  if ('response' in res) return res.response
  const { id } = await params

  if (id === res.session.uid) return jsonError('نمی‌توانید حساب خودتان را حذف کنید')

  const user = await db.user.findUnique({ where: { id } })
  if (!user) return jsonError('کاربر یافت نشد', 404)
  if (user.role === 'SUPER_ADMIN') return jsonError('حساب مدیر کل قابل حذف نیست', 403)

  const [enrollments, assignments, groupMessages, dmSent, dmReceived] = await Promise.all([
    db.classroomEnrollment.count({ where: { studentId: id } }),
    db.teachingAssignment.count({ where: { teacherId: id } }),
    db.message.count({ where: { senderId: id, kind: 'GROUP' } }),
    db.message.count({ where: { senderId: id, kind: 'DIRECT' } }),
    db.message.count({ where: { recipientId: id, kind: 'DIRECT' } }),
  ])
  const dmTotal = dmSent + dmReceived
  const total = enrollments + assignments + groupMessages + dmTotal

  const confirmed = req.nextUrl.searchParams.get('confirm') === 'true'

  if (!confirmed && total > 0) {
    return NextResponse.json(
      {
        error: 'این کاربر داده‌های وابسته دارد؛ برای حذف قطعی تأیید کنید',
        dependencies: { enrollments, assignments, groupMessages, dmTotal },
      },
      { status: 409 },
    )
  }

  await db.user.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
