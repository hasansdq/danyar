import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSuperAdmin, jsonError } from '@/lib/api-auth'
import { hashPassword, DEFAULT_USER_PASSWORD } from '@/lib/password'
import { normalizePhone } from '@/lib/phone'
import { normalizeNationalId } from '@/lib/user-admin'

type Params = { params: Promise<{ id: string }> }

/**
 * ایجاد، بازنشانی یا تغییر حساب مدیر مدرسه (درخواست کاربر — امکان تغییر مدیر مدارس):
 *
 * دو مسیر:
 *  ۱) adminUserId — انتقال مدیریت به کاربر موجود (از هر مدرسه‌ای؛ جابه‌جا می‌شود)
 *  ۲) nationalId — ایجاد حساب مدیر جدید (نام کاربری = کدملی، رمز = 123456) یا
 *     بازنشانی حساب مدیر موجودِ همین مدرسه (رمز به 123456 برمی‌گردد)
 *
 * در هر دو مسیرِ «تغییر مدیر»، مدیر(ان) قبلیِ همین مدرسه غیرفعال می‌شوند
 * (حسابشان حذف نمی‌شود — از «کاربران پلتفرم» قابل فعال‌سازی مجدد است).
 */
export async function POST(req: NextRequest, { params }: Params) {
  const res = await requireSuperAdmin()
  if ('response' in res) return res.response
  const { id } = await params

  const school = await db.school.findUnique({ where: { id } })
  if (!school) return jsonError('مدرسه یافت نشد', 404)

  const body = await req.json().catch(() => null)

  // ─── مسیر ۱: انتقال مدیریت به کاربر موجود ───
  const adminUserId = String(body?.adminUserId ?? '').trim()
  if (adminUserId) {
    const pick = await db.user.findUnique({
      where: { id: adminUserId },
      select: { id: true, username: true, fullName: true, role: true, isActive: true },
    })
    if (!pick) return jsonError('کاربر انتخابی یافت نشد', 404)
    if (pick.role === 'SUPER_ADMIN') return jsonError('مدیر کل پلتفرم نمی‌تواند مدیر مدرسه شود', 400)
    // کاربر غیرفعال هم می‌تواند انتخاب شود — انتقال مدیریت او را دوباره فعال می‌کند
    // (بازگردانی مدیر قبلی که هنگام تغییر مدیر غیرفعال شده است)

    // مدیر فعلی همین مدرسه (برای گزارش تغییر)
    const previousAdmins = await db.user.findMany({
      where: { schoolId: id, role: 'SCHOOL_ADMIN', id: { not: pick.id } },
      select: { id: true, fullName: true },
    })

    const user = await db.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: pick.id },
        data: { role: 'SCHOOL_ADMIN', schoolId: id, isActive: true },
      })
      // مدیران قبلی همین مدرسه غیرفعال می‌شوند (حساب حذف نمی‌شود)
      if (previousAdmins.length > 0) {
        await tx.user.updateMany({
          where: { id: { in: previousAdmins.map((a) => a.id) } },
          data: { isActive: false },
        })
      }
      return updated
    })

    return NextResponse.json({
      admin: { id: user.id, username: user.username, fullName: user.fullName },
      changed: previousAdmins.length > 0,
      previousAdmins: previousAdmins.map((a) => a.fullName),
      mode: 'transfer',
    })
  }

  // ─── مسیر ۲: ایجاد/بازنشانی حساب مدیر با کدملی ───
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
    // مدیران قبلی همین مدرسه — پیش از ساخت حساب جدید
    const previousAdmins = await db.user.findMany({
      where: { schoolId: id, role: 'SCHOOL_ADMIN', username: { not: nationalId } },
      select: { id: true, fullName: true },
    })

    user = await db.$transaction(async (tx) => {
      const created = await tx.user.create({
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
      // تغییر مدیر: مدیران قبلی غیرفعال می‌شوند (حساب‌ها حذف نمی‌شوند)
      if (previousAdmins.length > 0) {
        await tx.user.updateMany({
          where: { id: { in: previousAdmins.map((a) => a.id) } },
          data: { isActive: false },
        })
      }
      return created
    })

    return NextResponse.json({
      admin: { id: user.id, username: user.username, fullName: user.fullName },
      changed: previousAdmins.length > 0,
      previousAdmins: previousAdmins.map((a) => a.fullName),
      defaultPassword: DEFAULT_USER_PASSWORD,
      mode: 'create',
    })
  }

  return NextResponse.json({
    admin: { id: user.id, username: user.username, fullName: user.fullName },
    changed: false,
    previousAdmins: [],
    defaultPassword: DEFAULT_USER_PASSWORD,
    mode: 'reset',
  })
}
