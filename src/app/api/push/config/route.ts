import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth, jsonError } from '@/lib/api-auth'
import { getVapidStatus, getPushConfig, schoolPushAllowed } from '@/lib/push'
import { parsePushEventTypes } from '@/lib/push-types'

/**
 * GET /api/push/config — وضعیت پوش برای کاربر واردشده.
 * کلید خصوصی VAPID و endpoint/کلیدهای اشتراک‌ها هرگز در پاسخ نیستند.
 */
export async function GET() {
  const res = await requireAuth()
  if ('response' in res) return res.response
  const session = res.session

  const [vapid, config, pref] = await Promise.all([
    Promise.resolve(getVapidStatus()),
    getPushConfig(),
    db.notificationPref.findUnique({ where: { userId: session.uid } }),
  ])

  const schoolEnabled = session.schoolId ? await schoolPushAllowed(session.schoolId) : null

  const devices = await db.pushSubscription.findMany({
    where: { userId: session.uid },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      deviceId: true,
      label: true,
      enabled: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  return NextResponse.json({
    vapidConfigured: vapid.configured,
    // فقط کلید عمومی برای subscribe سمت مرورگر
    publicKey: vapid.publicKey,
    platformEnabled: config.platformEnabled,
    schoolEnabled,
    // انواع رویداد انتخابی کاربر (خالی = همه)
    eventTypes: [...parsePushEventTypes(pref?.pushEventTypes)],
    previewEnabled: pref?.previewEnabled ?? false,
    devices,
  })
}
