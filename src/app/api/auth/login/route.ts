import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyPassword } from '@/lib/password'
import { setSessionCookie, type Role } from '@/lib/session'
import { jsonError } from '@/lib/api-auth'
import { ensureSmsConfig } from '@/lib/sms/config'

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

  // گیت سراسری ورود با رمز — فقط برای کاربران عادی؛ مدیر کل همیشه با رمز وارد می‌شود
  if (realm === 'app') {
    const smsConfig = await ensureSmsConfig()
    if (!smsConfig.passwordLoginEnabled) {
      return jsonError('ورود با رمز عبور موقتاً غیرفعال است؛ با پشتیبانی تماس بگیرید', 403)
    }
  }

  const user = await db.user.findUnique({
    where: { username },
    include: { school: { select: { isActive: true } } },
  })

  const passwordOk = user ? await verifyPassword(password, user.passwordHash) : false
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

  await setSessionCookie({
    uid: user.id,
    username: user.username,
    fullName: user.fullName,
    role: user.role as Role,
    schoolId: user.schoolId,
  })

  return NextResponse.json({
    ok: true,
    redirect: user.role === 'SUPER_ADMIN' ? '/admin' : '/chats',
    user: {
      username: user.username,
      fullName: user.fullName,
      role: user.role,
    },
  })
}
