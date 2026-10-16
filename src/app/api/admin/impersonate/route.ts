import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSuperAdmin, jsonError } from '@/lib/api-auth'
import {
  setImpersonationCookie,
  clearImpersonationCookie,
  getImpersonation,
  type SessionPayload,
} from '@/lib/session'

/**
 * POST /api/admin/impersonate — ورود مدیر کل به‌جای کاربر (جعل هویت).
 * - نشست واقعی مدیر کل دست‌نخورده می‌ماند؛ کوکی جداگانه با عمر ۲ ساعت ست می‌شود
 * - روی مدیر کل دیگر قابل اجرا نیست؛ خروج همیشه از نوار بالای برنامه
 * - شروع هر جلسه در ImpersonationLog ثبت می‌شود
 */
export async function POST(req: NextRequest) {
  const res = await requireSuperAdmin()
  if ('response' in res) return res.response
  const admin = res.session

  const body = await req.json().catch(() => null)
  const userId = String(body?.userId ?? '')
  if (!userId) return jsonError('شناسه کاربر الزامی است')
  if (userId === admin.uid) return jsonError('ورود به‌جای خودتان لازم نیست')

  const target = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, fullName: true, role: true, schoolId: true, isActive: true },
  })
  if (!target) return jsonError('کاربر یافت نشد', 404)
  if (target.role === 'SUPER_ADMIN') return jsonError('ورود به‌جای مدیر کل دیگر مجاز نیست', 403)
  if (!target.isActive) return jsonError('حساب این کاربر غیرفعال است')

  // نشست واقعی مدیر کل باید معتبر باشد (نه نشست جعل هویت جاری)
  const currentImp = await getImpersonation()
  if (currentImp) return jsonError('ابتدا از حالت جعل هویت فعلی خارج شوید')

  const payload: SessionPayload = {
    uid: target.id,
    username: target.username,
    fullName: target.fullName,
    role: target.role as SessionPayload['role'],
    schoolId: target.schoolId,
    impersonatedBy: admin.uid,
  }
  await setImpersonationCookie(payload)

  await db.impersonationLog.create({
    data: { adminId: admin.uid, targetId: target.id },
  })
  console.log(`[admin] impersonation START admin=${admin.uid} target=${target.id}`)

  return NextResponse.json({ ok: true, redirect: '/' })
}

/** DELETE /api/admin/impersonate — خروج از حالت جعل هویت و بازگشت به نشست مدیر کل */
export async function DELETE() {
  const imp = await getImpersonation()
  await clearImpersonationCookie()
  if (imp) {
    // بستن آخرین جلسه بازِ همین مدیر کل روی همین کاربر
    const open = await db.impersonationLog.findFirst({
      where: { adminId: imp.impersonatedBy ?? '', targetId: imp.uid, endedAt: null },
      orderBy: { startedAt: 'desc' },
    })
    if (open) {
      await db.impersonationLog.update({ where: { id: open.id }, data: { endedAt: new Date() } })
    }
    console.log(`[admin] impersonation END admin=${imp.impersonatedBy} target=${imp.uid}`)
  }
  return NextResponse.json({ ok: true, redirect: '/admin' })
}
