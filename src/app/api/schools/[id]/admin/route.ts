import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSuperAdmin, jsonError } from '@/lib/api-auth'
import { hashPassword, DEFAULT_USER_PASSWORD } from '@/lib/password'
import { normalizePhone } from '@/lib/phone'
import { normalizeNationalId } from '@/lib/user-admin'

type Params = { params: Promise<{ id: string }> }

/**
 * ایجاد یا بازنشانی حساب مدیر مدرسه (درخواست کاربر):
 * نام کاربری مدیر = کدملی؛ رمز عبور پیش‌فرض = 123456
 * فیلدها: نام، نام خانوادگی، کدملی (+ شماره تماس اختیاری)
 */
export async function POST(req: NextRequest, { params }: Params) {
  const res = await requireSuperAdmin()
  if ('response' in res) return res.response
  const { id } = await params

  const school = await db.school.findUnique({ where: { id } })
  if (!school) return jsonError('مدرسه یافت نشد', 404)

  const body = await req.json().catch(() => null)
  const firstName = String(body?.firstName ?? '').trim()
  const lastName = String(body?.lastName ?? '').trim()
  if (firstName.length < 2) return jsonError('نام باید حداقل ۲ کاراکتر باشد')
  if (lastName.length < 2) return jsonError('نام خانوادگی باید حداقل ۲ کاراکتر باشد')

  const nationalId = normalizeNationalId(body?.nationalId ?? body?.username)
  if (!nationalId) {
    return jsonError('کدملی باید فقط عدد باشد (کدملی استاندارد ۱۰ رقم است)')
  }

  const fullName = `${firstName} ${lastName}`.trim()

  // شماره تماس اختیاری — یکتا در کل پلتفرم
  let phone: string | null = null
  if (body?.phone !== undefined && body?.phone !== null && String(body.phone).trim() !== '') {
    phone = normalizePhone(body.phone)
    if (!phone) return jsonError('شماره تلفن معتبر نیست؛ قالب درست: ۰۹xxxxxxxxx')
    const owner = await db.user.findUnique({ where: { phone }, select: { id: true } })
    if (owner) return jsonError('این شماره قبلاً برای کاربر دیگری ثبت شده است', 409)
  }

  const existing = await db.user.findUnique({ where: { username: nationalId } })
  if (existing && existing.schoolId !== id) {
    return jsonError('این کدملی قبلاً در پلتفرم ثبت شده است', 409)
  }

  let user
  if (existing && existing.role === 'SCHOOL_ADMIN') {
    // بازنشانی حساب مدیر موجودِ همین مدرسه — رمز به پیش‌فرض برمی‌گردد
    user = await db.user.update({
      where: { id: existing.id },
      data: {
        passwordHash: await hashPassword(DEFAULT_USER_PASSWORD),
        fullName,
        firstName,
        lastName,
        isActive: true,
        ...(phone !== null ? { phone } : {}),
      },
    })
  } else if (existing) {
    return jsonError('این کدملی قبلاً در پلتفرم ثبت شده است', 409)
  } else {
    user = await db.user.create({
      data: {
        username: nationalId,
        passwordHash: await hashPassword(DEFAULT_USER_PASSWORD),
        fullName,
        firstName,
        lastName,
        role: 'SCHOOL_ADMIN',
        schoolId: id,
        phone,
      },
    })
  }

  return NextResponse.json({
    admin: { id: user.id, username: user.username, fullName: user.fullName },
    defaultPassword: DEFAULT_USER_PASSWORD,
  })
}
