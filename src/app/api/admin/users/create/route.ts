import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSuperAdmin, jsonError } from '@/lib/api-auth'
import {
  createUserAccount,
  normalizeNationalId,
  parseRoleToken,
  roleFa,
  type CreatableRole,
} from '@/lib/user-admin'

/**
 * ایجاد حساب تکی توسط مدیر کل (درخواست کاربر):
 * فیلدها: نام، نام خانوادگی، نقش، کدملی، شماره تماس، کلاس + مدرسه
 * نام کاربری = کدملی؛ رمز عبور پیش‌فرض = 123456
 */
export async function POST(req: NextRequest) {
  const res = await requireSuperAdmin()
  if ('response' in res) return res.response

  const body = await req.json().catch(() => null)
  const role: CreatableRole | null = parseRoleToken(body?.role)
  if (!role) {
    return jsonError('نقش باید دانش‌آموز، معلم یا مدیر مدرسه باشد')
  }

  const schoolId = String(body?.schoolId ?? '')
  if (!schoolId) return jsonError('انتخاب مدرسه الزامی است')
  const school = await db.school.findUnique({ where: { id: schoolId }, select: { id: true } })
  if (!school) return jsonError('مدرسه یافت نشد', 404)

  const nationalId = normalizeNationalId(body?.nationalId ?? body?.username)
  if (!nationalId) return jsonError('کدملی باید فقط عدد باشد (کدملی استاندارد ۱۰ رقم است)')

  const result = await createUserAccount({
    schoolId,
    role,
    firstName: String(body?.firstName ?? ''),
    lastName: String(body?.lastName ?? ''),
    nationalId,
    phone: body?.phone ?? null,
    // کلاس فقط برای دانش‌آموز اعمال می‌شود
    classroomId: body?.classroomId ?? null,
  })
  if (!result.ok) return jsonError(result.error, result.error.includes('قبلاً') ? 409 : 400)

  return NextResponse.json(
    { user: { ...result.user, roleFa: roleFa(result.user.role) } },
    { status: 201 },
  )
}
