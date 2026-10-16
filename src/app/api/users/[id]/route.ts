import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSchoolAdmin, jsonError } from '@/lib/api-auth'
import { hashPassword, validatePassword, verifyPassword } from '@/lib/password'
import { normalizePhone } from '@/lib/phone'

type Params = { params: Promise<{ id: string }> }

/**
 * ویرایش کاربر مدرسه: نام، رمز جدید، فعال/غیرفعال، شماره ورود پیامکی،
 * کلاس‌ها و گروه‌های درسی دانش‌آموز (درخواست کاربر)، گروه‌های تدریس معلم.
 * تغییر شماره ورود یک عملیات حساس است و فقط با تأیید رمز عبور خودِ
 * مدیر مدرسه انجام می‌شود (گام دوم تأیید سمت سرور).
 * شماره تلفن در کل پلتفرم یکتاست.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const res = await requireSchoolAdmin()
  if ('response' in res) return res.response
  const { id } = await params

  const user = await db.user.findFirst({
    where: {
      id,
      schoolId: res.session.schoolId,
      role: { in: ['TEACHER', 'SCHOOL_VICE', 'STUDENT'] },
    },
  })
  if (!user) return jsonError('کاربر یافت نشد', 404)

  const body = await req.json().catch(() => null)
  const data: {
    fullName?: string
    firstName?: string
    lastName?: string
    isActive?: boolean
    passwordHash?: string
    phone?: string | null
  } = {}

  if (typeof body?.fullName === 'string') {
    const fullName = body.fullName.trim()
    if (fullName.length < 3) return jsonError('نام و نام خانوادگی الزامی است')
    data.fullName = fullName
  }

  // نام و نام خانوادگی جدا — fullName ترکیب دوگانه به‌روز می‌شود
  const newFirst = typeof body?.firstName === 'string' ? body.firstName.trim() : undefined
  const newLast = typeof body?.lastName === 'string' ? body.lastName.trim() : undefined
  if (newFirst !== undefined || newLast !== undefined) {
    const firstName = newFirst !== undefined ? newFirst : user.firstName ?? ''
    const lastName = newLast !== undefined ? newLast : user.lastName ?? ''
    if (firstName.length < 2) return jsonError('نام باید حداقل ۲ کاراکتر باشد')
    if (lastName.length < 2) return jsonError('نام خانوادگی باید حداقل ۲ کاراکتر باشد')
    data.firstName = firstName
    data.lastName = lastName
    data.fullName = `${firstName} ${lastName}`.trim()
  }

  if (typeof body?.isActive === 'boolean') {
    if (user.id === res.session.uid) return jsonError('نمی‌توانید حساب خود را غیرفعال کنید')
    data.isActive = body.isActive
  }
  if (typeof body?.newPassword === 'string' && body.newPassword.length > 0) {
    const pwError = validatePassword(body.newPassword)
    if (pwError) return jsonError(pwError)
    data.passwordHash = await hashPassword(body.newPassword)
  }

  // ─── تغییر شماره ورود — عملیات حساس ───
  if (body?.phone !== undefined) {
    // تأیید هویت مدیر با رمز عبور خودش
    const adminPassword = String(body?.adminPassword ?? '')
    if (!adminPassword) {
      return jsonError('برای تغییر شماره ورود، رمز عبور خودتان را وارد کنید', 403)
    }
    const admin = await db.user.findUnique({ where: { id: res.session.uid } })
    if (!admin || !(await verifyPassword(adminPassword, admin.passwordHash))) {
      return jsonError('رمز عبور مدیر صحیح نیست؛ تغییر شماره انجام نشد', 403)
    }

    if (body.phone === null || String(body.phone).trim() === '') {
      data.phone = null
    } else {
      const phone = normalizePhone(body.phone)
      if (!phone) {
        return jsonError('شماره تلفن معتبر نیست؛ قالب درست: ۰۹xxxxxxxxx')
      }
      const owner = await db.user.findUnique({ where: { phone }, select: { id: true } })
      if (owner && owner.id !== id) {
        return jsonError('این شماره قبلاً برای کاربر دیگری ثبت شده است', 409)
      }
      data.phone = phone
    }
  }

  if (Object.keys(data).length === 0 && body?.classroomIds === undefined && body?.subjectGroupIds === undefined) {
    return jsonError('تغییری ارسال نشده است')
  }

  try {
    const updated = await db.user.update({
      where: { id },
      data,
      select: { id: true, username: true, fullName: true, role: true, isActive: true, phone: true },
    })

    // ─── تغییر کلاس‌های دانش‌آموز (جایگزینی ثبت‌نام‌ها) ───
    if (Array.isArray(body?.classroomIds)) {
      if (user.role !== 'STUDENT') {
        return jsonError('تغییر کلاس فقط برای دانش‌آموز امکان‌پذیر است')
      }
      const rawIds: unknown[] = body.classroomIds
      const ids = [...new Set(rawIds.map((v) => String(v)))]
      const validClasses = await db.classroom.findMany({
        where: { id: { in: ids }, schoolId: res.session.schoolId },
        select: { id: true },
      })
      if (validClasses.length !== ids.length) {
        return jsonError('یکی از کلاس‌های انتخابی در این مدرسه یافت نشد')
      }
      await db.$transaction([
        db.classroomEnrollment.deleteMany({
          where: { studentId: id, classroomId: { notIn: ids } },
        }),
        ...ids.map((classroomId) =>
          db.classroomEnrollment.upsert({
            where: { studentId_classroomId: { studentId: id, classroomId } },
            create: { studentId: id, classroomId },
            update: {},
          }),
        ),
      ])
    }

    // ─── تغییر گروه‌های درسی ───
    // معلم: جایگزینی انتساب‌های تدریس
    // دانش‌آموز: عضویت مؤثر مطلوب → بازمحاسبه استثناها (ADD/REMOVE) نسبت به ثبت‌نام کلاسی
    if (Array.isArray(body?.subjectGroupIds)) {
      const rawIds: unknown[] = body.subjectGroupIds
      const ids = [...new Set(rawIds.map((v) => String(v)))]
      const validGroups = await db.subjectGroup.findMany({
        where: { id: { in: ids }, classroom: { schoolId: res.session.schoolId } },
        select: { id: true },
      })
      if (validGroups.length !== ids.length) {
        return jsonError('یکی از گروه‌های درسی انتخابی در این مدرسه یافت نشد')
      }

      if (user.role === 'TEACHER' || user.role === 'SCHOOL_VICE') {
        await db.$transaction([
          db.teachingAssignment.deleteMany({ where: { teacherId: id } }),
          ...ids.map((subjectGroupId) =>
            db.teachingAssignment.upsert({
              where: { teacherId_subjectGroupId: { teacherId: id, subjectGroupId } },
              create: { teacherId: id, subjectGroupId },
              update: {},
            }),
          ),
        ])
      } else {
        // دانش‌آموز — عضویت مؤثر در همه گروه‌های مدرسه بازمحاسبه می‌شود
        const [schoolGroups, enrollments, overrides] = await Promise.all([
          db.subjectGroup.findMany({
            where: { classroom: { schoolId: res.session.schoolId } },
            select: { id: true, classroomId: true },
          }),
          db.classroomEnrollment.findMany({
            where: { studentId: id },
            select: { classroomId: true },
          }),
          db.groupMemberOverride.findMany({
            where: { userId: id },
            select: { subjectGroupId: true, action: true },
          }),
        ])
        const enrolledSet = new Set(enrollments.map((e) => e.classroomId))
        const desiredSet = new Set(ids)
        const overrideMap = new Map(overrides.map((o) => [o.subjectGroupId, o.action]))

        for (const g of schoolGroups) {
          if (!g.classroomId) continue
          const derived = enrolledSet.has(g.classroomId)
          const desired = desiredSet.has(g.id)
          const current = overrideMap.get(g.id)
          if (derived && !desired) {
            // عضویت خودکار کلاسی باید حذف شود → استثنای REMOVE
            if (current !== 'REMOVE') {
              await db.groupMemberOverride.upsert({
                where: { subjectGroupId_userId: { subjectGroupId: g.id, userId: id } },
                create: { subjectGroupId: g.id, userId: id, action: 'REMOVE' },
                update: { action: 'REMOVE' },
              })
            }
          } else if (!derived && desired) {
            // عضویت اضافی غیر از کلاس → استثنای ADD
            if (current !== 'ADD') {
              await db.groupMemberOverride.upsert({
                where: { subjectGroupId_userId: { subjectGroupId: g.id, userId: id } },
                create: { subjectGroupId: g.id, userId: id, action: 'ADD' },
                update: { action: 'ADD' },
              })
            }
          } else if (current) {
            // وضعیت مؤثر با ثبت‌نام هم‌خوان است → استثنا لازم نیست
            await db.groupMemberOverride.delete({
              where: { subjectGroupId_userId: { subjectGroupId: g.id, userId: id } },
            })
          }
        }
      }
    }

    return NextResponse.json({ user: updated })
  } catch (e) {
    const err = e as { code?: string }
    if (err?.code === 'P2002') {
      return jsonError('این شماره قبلاً برای کاربر دیگری ثبت شده است', 409)
    }
    throw e
  }
}

/** حذف امن کاربر — بدون confirm فقط آمار وابستگی‌ها را برمی‌گرداند (409) */
export async function DELETE(req: NextRequest, { params }: Params) {
  const res = await requireSchoolAdmin()
  if ('response' in res) return res.response
  const { id } = await params

  const user = await db.user.findFirst({
    where: { id, schoolId: res.session.schoolId, role: { in: ['TEACHER', 'SCHOOL_VICE', 'STUDENT'] } },
  })
  if (!user) return jsonError('کاربر یافت نشد', 404)

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
