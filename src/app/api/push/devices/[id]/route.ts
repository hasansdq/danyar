import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth, jsonError } from '@/lib/api-auth'

/** PATCH /api/push/devices/[id] — خاموش/روشن‌کردن پوش فقط برای همین اشتراک دستگاه */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const res = await requireAuth()
  if ('response' in res) return res.response
  const session = res.session
  const { id } = await params

  const body = await req.json().catch(() => null)
  if (!body || typeof body.enabled !== 'boolean') return jsonError('درخواست نامعتبر است')

  // فقط اشتراک خود کاربر
  const sub = await db.pushSubscription.findFirst({
    where: { id, userId: session.uid },
    select: { id: true },
  })
  if (!sub) return jsonError('دستگاه یافت نشد', 404)

  const updated = await db.pushSubscription.update({
    where: { id },
    data: { enabled: body.enabled },
    select: { id: true, enabled: true },
  })
  return NextResponse.json({ ok: true, ...updated })
}

/** DELETE /api/push/devices/[id] — لغو اشتراک یک دستگاه از فهرست دستگاه‌ها */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const res = await requireAuth()
  if ('response' in res) return res.response
  const session = res.session
  const { id } = await params

  const sub = await db.pushSubscription.findFirst({
    where: { id, userId: session.uid },
    select: { id: true },
  })
  if (!sub) return jsonError('دستگاه یافت نشد', 404)

  await db.pushSubscription.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
