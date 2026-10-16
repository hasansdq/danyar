import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAppRole, jsonError } from '@/lib/api-auth'

/**
 * POST /api/notifications/read — علامت‌گذاری اعلان‌ها به‌عنوان خوانده‌شده
 * بدنه: { ids?: string[] } برای موارد مشخص یا { all: true } برای همه
 */
export async function POST(req: NextRequest) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session

  const body = await req.json().catch(() => null)
  if (!body) return jsonError('درخواست نامعتبر است')

  const data = { readAt: new Date() }

  if (body.all === true) {
    await db.notification.updateMany({
      where: { userId: session.uid, readAt: null },
      data,
    })
  } else if (Array.isArray(body.ids) && body.ids.length) {
    await db.notification.updateMany({
      where: { userId: session.uid, id: { in: body.ids.map(String).slice(0, 100) } },
      data,
    })
  } else {
    return jsonError('شناسه اعلان مشخص نشده است')
  }

  const unreadCount = await db.notification.count({
    where: { userId: session.uid, readAt: null },
  })
  return NextResponse.json({ unreadCount })
}
