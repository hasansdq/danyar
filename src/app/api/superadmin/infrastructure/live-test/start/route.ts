import type { NextRequest } from 'next/server'
import { guardSuperAdminApi, infraJson } from '@/lib/infra/route-helpers'
import { createDiagRoom } from '@/lib/infra/livekit-admin'
import { diagRegistry, pruneDiagRegistry } from '@/lib/infra/diag-registry'
import { livekitClientUrl, createLivekitToken, type LivekitServerConfig } from '@/lib/livekit'
import { iceServersConfig } from '@/lib/live-access'
import { ensureLivekitRuntime } from '@/lib/media-selfheal'
import crypto from 'crypto'

/**
 * POST /api/superadmin/infrastructure/live-test/start — آزمون اتصال رسانه (با اقدام مدیر).
 *
 * اتاق تشخیصی موقت و مجزا:
 * - نام یکتا diag:infra:{random} — هیچ تداخلی با جلسه‌های واقعی (live:{sessionId})
 * - empty_timeout=90s + max_participants=2 در خود LiveKit
 * - توکن ۱۲۰ ثانیه‌ای؛ بدون هیچ رکورد LiveSession/اعلان/حضورغیاب
 * - توکن و TURN هرگز در UI نمایش داده نمی‌شوند (مثل مسیر توکن کلاس)
 */

export async function POST(req: NextRequest) {
  const guard = await guardSuperAdminApi('infra-livetest-start', 6, 10 * 60_000)
  if ('response' in guard) return guard.response
  const session = guard.session

  // خودترمیم رسانه (همان مسیر کلاس) — اگر سرویس رسانه بالغِ‌بایدْ کند، اینجا
  // پیکربندی بازگردانی/راه‌اندازی می‌شود؛ ۵۰۳ فقط وقتی هیچ راهی نبود
  let cfg: LivekitServerConfig | null = null
  try {
    cfg = await ensureLivekitRuntime()
  } catch {
    cfg = null
  }
  if (!cfg || !cfg.configured) {
    return infraJson(
      { error: 'سرویس رسانه (LiveKit) پیکربندی/در دسترس نیست — ابتدا وضعیت سرویس‌ها را ببینید' },
      503,
    )
  }

  const testId = crypto.randomBytes(8).toString('hex')
  const room = `diag:infra:${testId}`
  try {
    await createDiagRoom(room)
  } catch (e) {
    return infraJson(
      {
        error:
          'ساخت اتاق تشخیصی ناموفق بود' +
          (e instanceof Error && /timeout|ECONN|fetch/i.test(e.message) ? ' — سرویس LiveKit پاسخ نداد' : ''),
      },
      503,
    )
  }

  const identity = `diag:${session.uid}:${testId}`
  let token: string
  try {
    token = await createLivekitToken(cfg, {
      identity,
      name: 'آزمون تشخیصی مدیر',
      room,
      metadata: JSON.stringify({ name: 'آزمون تشخیصی', role: 'SUPER_ADMIN', diag: true }),
      canPublish: true,
      canPublishSources: ['microphone', 'camera', 'screen_share'],
      canSubscribe: true,
      roomAdmin: false,
      ttlSeconds: 120,
      maxParticipants: 2,
    })
  } catch {
    return infraJson({ error: 'صدور توکن آزمون ناموفق بود' }, 500)
  }

  diagRegistry().set(testId, { room, uid: session.uid, at: Date.now() })
  pruneDiagRegistry()

  const url = livekitClientUrl(
    req.headers.get('host'),
    req.headers.get('x-forwarded-proto'),
    req.headers.get('x-forwarded-host'),
    req.headers.get('origin'),
  )

  return infraJson({
    testId,
    room,
    token,
    url,
    identity,
    iceServers: iceServersConfig(),
    expiresAt: Date.now() + 120_000,
    roomAutoDeleteAfterSec: 90,
  })
}
