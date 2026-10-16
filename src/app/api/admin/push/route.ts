import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSuperAdmin, jsonError } from '@/lib/api-auth'
import { getVapidStatus, getPushConfig } from '@/lib/push'

/**
 * GET /api/admin/push — وضعیت پیکربندی و آمار ارسال پوش (فقط مدیر کل).
 * هیچ محتوای خصوصی (متن اعلان، endpoint، کلید) در پاسخ نیست.
 */
export async function GET() {
  const res = await requireSuperAdmin()
  if ('response' in res) return res.response

  const vapid = getVapidStatus()
  const config = await getPushConfig()

  const since7d = new Date(Date.now() - 7 * 24 * 3600 * 1000)
  const [subscriptions, byStatus, sent7d, failed7d, recent] = await Promise.all([
    db.pushSubscription.count(),
    db.pushDelivery.groupBy({ by: ['status'], _count: { _all: true } }),
    db.pushDelivery.count({ where: { status: 'SENT', createdAt: { gte: since7d } } }),
    db.pushDelivery.count({ where: { status: 'FAILED', createdAt: { gte: since7d } } }),
    db.pushDelivery.findMany({
      where: { status: { in: ['FAILED', 'EXPIRED'] } },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { id: true, type: true, status: true, lastError: true, attempts: true, createdAt: true },
    }),
  ])

  const statusMap: Record<string, number> = {}
  for (const row of byStatus) statusMap[row.status] = row._count._all

  return NextResponse.json({
    vapidConfigured: vapid.configured,
    // موضوع VAPID غیرمحرمانه است (آدرس تماس) — کلید خصوصی هرگز
    vapidSubject: vapid.configured ? vapid.subject : null,
    platformEnabled: config.platformEnabled,
    stats: {
      subscriptions,
      byStatus: {
        SENT: statusMap.SENT ?? 0,
        FAILED: statusMap.FAILED ?? 0,
        EXPIRED: statusMap.EXPIRED ?? 0,
        SKIPPED: statusMap.SKIPPED ?? 0,
        PENDING: statusMap.PENDING ?? 0,
      },
      last7d: { SENT: sent7d, FAILED: failed7d },
    },
    recent,
  })
}

/** PUT /api/admin/push — فعال/غیرفعال‌کردن پوش در سطح کل پلتفرم */
export async function PUT(req: NextRequest) {
  const res = await requireSuperAdmin()
  if ('response' in res) return res.response

  const body = await req.json().catch(() => null)
  if (!body || typeof body.platformEnabled !== 'boolean')
    return jsonError('درخواست نامعتبر است')

  const config = await getPushConfig()
  const updated = await db.pushConfig.update({
    where: { id: config.id },
    data: { platformEnabled: body.platformEnabled },
  })
  return NextResponse.json({ ok: true, platformEnabled: updated.platformEnabled })
}
