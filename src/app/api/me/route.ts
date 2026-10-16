import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth, jsonError } from '@/lib/api-auth'
import { parseFeatures } from '@/lib/features'
import { getImpersonation } from '@/lib/session'

export async function GET() {
  const res = await requireAuth()
  if ('response' in res) return res.response

  const user = await db.user.findUnique({
    where: { id: res.session.uid },
    select: {
      id: true,
      username: true,
      fullName: true,
      role: true,
      phone: true,
      avatarKey: true,
      schoolId: true,
      school: { select: { id: true, name: true, isActive: true, features: true } },
    },
  })
  if (!user) return NextResponse.json({ error: 'یافت نشد' }, { status: 404 })

  // وضعیت جعل هویت — برای نمایش نوار هشدار در رابط کاربری
  const imp = res.session.impersonatedBy
    ? await getImpersonation()
    : null
  const impersonator = imp?.impersonatedBy
    ? await db.user.findUnique({
        where: { id: imp.impersonatedBy },
        select: { fullName: true },
      })
    : null

  return NextResponse.json({
    user: {
      ...user,
      avatarUrl: user.avatarKey ? '/api/me/avatar' : null,
    },
    features: parseFeatures(user.school?.features),
    impersonation: imp
      ? { byName: impersonator?.fullName ?? 'مدیر کل' }
      : null,
  })
}

/**
 * PATCH /api/me — تنظیم یا حذف تصویر پروفایل.
 * تصویر باید از قبل با /api/uploads آپلود شده باشد (هدف avatar).
 */
export async function PATCH(req: NextRequest) {
  const res = await requireAuth()
  if ('response' in res) return res.response
  const session = res.session

  const body = await req.json().catch(() => null)
  if (!body) return jsonError('درخواست نامعتبر است')

  if (body.clearAvatar === true) {
    await db.user.update({
      where: { id: session.uid },
      data: { avatarKey: null, avatarMime: null },
    })
    return NextResponse.json({ ok: true, avatarUrl: null })
  }

  const key = String(body?.avatarKey ?? '')
  if (!key) return jsonError('تصویری انتخاب نشده است')

  const upload = await db.upload.findUnique({ where: { key } })
  if (!upload || upload.uploaderId !== session.uid) {
    return jsonError('فایل آپلودشده یافت نشد؛ دوباره تلاش کنید', 400)
  }
  if (upload.type !== 'IMAGE') {
    return jsonError('تصویر پروفایل باید فایل تصویری باشد', 415)
  }

  const updated = await db.user.update({
    where: { id: session.uid },
    data: { avatarKey: upload.key, avatarMime: upload.mime },
  })

  // فایل از صف انتظار مصرف شد
  await db.upload.delete({ where: { key: upload.key } }).catch(() => null)

  return NextResponse.json({ ok: true, avatarUrl: `/api/me/avatar?v=${updated.updatedAt.getTime()}` })
}

