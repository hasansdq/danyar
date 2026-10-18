import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyPassword, DEFAULT_USER_PASSWORD } from '@/lib/password'
import { setSessionCookie, type Role } from '@/lib/session'
import { jsonError } from '@/lib/api-auth'
import { ensureSmsConfig } from '@/lib/sms/config'
import { normalizeDigits } from '@/lib/phone'
import { ensureSeeded } from '@/lib/bootstrap'

export async function POST(req: NextRequest) {
  let body: { username?: string; password?: string; realm?: string }
  try {
    body = await req.json()
  } catch {
    return jsonError('درخواست نامعتبر است')
  }

  const username = (body.username ?? '').trim().toLowerCase()
  const password = body.password ?? ''
  const realm = body.realm === 'superadmin' ? 'superadmin' : 'app'

  if (!username || !password) {
    return jsonError('نام کاربری و رمز عبور الزامی است')
  }

  // خودترمیم: اگر دادهٔ دیتابیس بین‌جلسه‌ای پاک شده باشد، حساب‌ها همین‌جا بازسازی
  // می‌شوند تا رمزهای اعلامی (مدیر کل/دمو) همیشه کار کنند — رمز حساب موجود هرگز بازنویسی نمی‌شود
  await ensureSeeded()

  // گیت سراسری ورود با رمز — فقط برای کاربران عادی؛ مدیر کل همیشه با رمز وارد می‌شود
  if (realm === 'app') {
    const smsConfig = await ensureSmsConfig()
    if (!smsConfig.passwordLoginEnabled) {
      return jsonError('ورود با رمز عبور موقتاً غیرفعال است؛ با پشتیبانی تماس بگیرید', 403)
    }
  }

  let user = await db.user.findUnique({
    where: { username },
    include: { school: { select: { isActive: true } } },
  })
  let passwordOk = user ? await verifyPassword(password, user.passwordHash) : false

  if (!user || !passwordOk) {
    // شاید دادهٔ دیتابیس همین لحظه پاک شده باشد — بازرسی اجباری و تلاش دوباره
    const heal = await ensureSeeded(true)
    if (heal.healed) {
      user = await db.user.findUnique({
        where: { username },
        include: { school: { select: { isActive: true } } },
      })
      passwordOk = user ? await verifyPassword(password, user.passwordHash) : false
    }
  }

  if (!user || !passwordOk) {
    return jsonError('نام کاربری یا رمز عبور اشتباه است', 401)
  }
  if (!user.isActive) {
    return jsonError('حساب کاربری شما غیرفعال شده است', 403)
  }

  // جداسازی ورودی مدیر کل از ورودی بقیه نقش‌ها
  if (realm === 'superadmin' && user.role !== 'SUPER_ADMIN') {
    return jsonError('این صفحه مخصوص مدیر کل پلتفرم است', 403)
  }
  if (realm === 'app' && user.role === 'SUPER_ADMIN') {
    return jsonError('مدیر کل باید از صفحه مخصوص وارد شود', 403)
  }
  if (user.role !== 'SUPER_ADMIN' && (!user.school || !user.school.isActive)) {
    return jsonError('مدرسه شما غیرفعال است؛ با پشتیبانی تماس بگیرید', 403)
  }

  // ورود با رمز پیش‌فرض (123456) — کاربر باید پیش از ادامهٔ کار رمز خود را تغییر دهد (درخواست کاربر)
  const usingDefaultPassword =
    normalizeDigits(password) === DEFAULT_USER_PASSWORD

  await setSessionCookie({
    uid: user.id,
    username: user.username,
    fullName: user.fullName,
    role: user.role as Role,
    schoolId: user.schoolId,
    ...(usingDefaultPassword ? { pwdDefault: true } : {}),
  })

  return NextResponse.json({
    ok: true,
    redirect: usingDefaultPassword ? '/settings?force=1' : user.role === 'SUPER_ADMIN' ? '/admin' : '/chats',
    mustChangePassword: usingDefaultPassword,
    user: {
      username: user.username,
      fullName: user.fullName,
      role: user.role,
    },
  })
}
