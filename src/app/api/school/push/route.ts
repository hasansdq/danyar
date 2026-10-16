import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSchoolAdmin, jsonError } from '@/lib/api-auth'
import { getVapidStatus, getPushConfig, schoolPushAllowed } from '@/lib/push'

/**
 * GET /api/school/push — وضعیت پوش مدرسه خود مدیر (بدون امکان تغییر؛
 * کلیدها فقط در پنل مدیر کل تغییر می‌کنند).
 */
export async function GET() {
  const res = await requireSchoolAdmin()
  if ('response' in res) return res.response
  const session = res.session

  const [vapid, config, schoolEnabled, subscriptions] = await Promise.all([
    Promise.resolve(getVapidStatus()),
    getPushConfig(),
    schoolPushAllowed(session.schoolId),
    db.pushSubscription.count({ where: { user: { schoolId: session.schoolId } } }),
  ])

  // آمار ارسال مدرسه خودش — بدون هیچ محتوای خصوصی
  const since7d = new Date(Date.now() - 7 * 24 * 3600 * 1000)
  const [sent7d, failed7d] = await Promise.all([
    db.pushDelivery.count({
      where: { status: 'SENT', createdAt: { gte: since7d }, subscription: { user: { schoolId: session.schoolId } } },
    }),
    db.pushDelivery.count({
      where: { status: 'FAILED', createdAt: { gte: since7d }, subscription: { user: { schoolId: session.schoolId } } },
    }),
  ])

  return NextResponse.json({
    vapidConfigured: vapid.configured,
    platformEnabled: config.platformEnabled,
    schoolEnabled,
    active: vapid.configured && config.platformEnabled && schoolEnabled,
    subscriptions,
    stats: { last7d: { SENT: sent7d, FAILED: failed7d } },
  })
}

/** PUT /api/school/push — مدیر مدرسه حق تغییر کلیدها را ندارد */
export async function PUT() {
  const res = await requireSchoolAdmin()
  if ('response' in res) return res.response
  return jsonError('تنظیم پوش مدرسه فقط توسط مدیر کل پلتفرم انجام می‌شود', 403)
}
