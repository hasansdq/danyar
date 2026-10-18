import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth, jsonError } from '@/lib/api-auth'
import { verifyPassword, hashPassword, validatePassword, DEFAULT_USER_PASSWORD } from '@/lib/password'
import { setSessionCookie, getImpersonation, setImpersonationCookie } from '@/lib/session'

export async function POST(req: NextRequest) {
  const res = await requireAuth()
  if ('response' in res) return res.response

  const body = await req.json().catch(() => null)
  if (!body?.currentPassword || !body?.newPassword) {
    return jsonError('همه فیلدها الزامی است')
  }
  // حداقل ۶ کاراکتر — رمز ضعیف (فقط عدد یا فقط حرف) مجاز است
  const pwError = validatePassword(String(body.newPassword))
  if (pwError) return jsonError(pwError)

  // رمز جدید نباید همان رمز پیش‌فرض باشد — تغییر رمز اجباری پیش‌فرض معنا ندارد (درخواست کاربر)
  if (String(body.newPassword) === DEFAULT_USER_PASSWORD) {
    return jsonError('رمز جدید نمی‌تواند همان رمز پیش‌فرض (۱۲۳۴۵۶) باشد')
  }

  const user = await db.user.findUnique({ where: { id: res.session.uid } })
  if (!user) return jsonError('کاربر یافت نشد', 404)

  const ok = await verifyPassword(String(body.currentPassword), user.passwordHash)
  if (!ok) return jsonError('رمز فعلی اشتباه است', 403)

  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(String(body.newPassword)) },
  })

  const session = res.session
  if (session.impersonatedBy) {
    // جعل هویت: نشست اصلی مدیر کل دست‌نخورده می‌ماند؛ فقط کوکی جعل بدون پرچم بازصادر می‌شود
    const imp = await getImpersonation()
    if (imp && imp.uid === session.uid) {
      await setImpersonationCookie({
        uid: imp.uid,
        username: imp.username,
        fullName: imp.fullName,
        role: imp.role,
        schoolId: imp.schoolId,
        impersonatedBy: imp.impersonatedBy,
      })
    }
  } else {
    // نشست دوباره صادر می‌شود تا پرچم «رمز پیش‌فرض» پاک شود و کاربر آزادانه ادامه دهد
    await setSessionCookie({
      uid: session.uid,
      username: session.username,
      fullName: session.fullName,
      role: session.role,
      schoolId: session.schoolId,
    })
  }

  return NextResponse.json({ ok: true })
}
