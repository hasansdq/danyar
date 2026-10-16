import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth, jsonError } from '@/lib/api-auth'
import { verifyPassword, hashPassword, validatePassword } from '@/lib/password'

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

  const user = await db.user.findUnique({ where: { id: res.session.uid } })
  if (!user) return jsonError('کاربر یافت نشد', 404)

  const ok = await verifyPassword(String(body.currentPassword), user.passwordHash)
  if (!ok) return jsonError('رمز فعلی اشتباه است', 403)

  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(String(body.newPassword)) },
  })
  return NextResponse.json({ ok: true })
}
