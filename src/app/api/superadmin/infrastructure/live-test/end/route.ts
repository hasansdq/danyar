import type { NextRequest } from 'next/server'
import { guardSuperAdminApi, infraJson } from '@/lib/infra/route-helpers'
import { deleteDiagRoom } from '@/lib/infra/livekit-admin'
import { getDiagEntry, deleteDiagEntry } from '@/lib/infra/diag-registry'
import { logInfraEvent } from '@/lib/infra/settings'

/**
 * POST /api/superadmin/infrastructure/live-test/end — پاک‌سازی آزمون رسانه.
 *
 * - فقط اتاق‌های تشخیصی «همین فرایند» و «همین مدیر» حذف می‌شوند (registry)؛
 *   حذف اتاق دلخواه/جلسهٔ واقعی از این مسیر ممکن نیست
 * - حذف با DeleteRoom واقعی + راستی‌آزمایی؛ پشتیبان: انقضای خودکار اتاق (۹۰s)
 * - رویداد ناموفق‌ماندنِ پاک‌سازی برای ردیابی ثبت می‌شود
 */
export async function POST(req: NextRequest) {
  const guard = await guardSuperAdminApi('infra-livetest-end', 12, 10 * 60_000)
  if ('response' in guard) return guard.response
  const session = guard.session

  let body: { testId?: string }
  try {
    body = (await req.json()) as { testId?: string }
  } catch {
    return infraJson({ error: 'بدنهٔ درخواست معتبر نیست' }, 400)
  }
  const testId = String(body.testId ?? '')
  if (!/^[\da-f]{16}$/.test(testId)) {
    return infraJson({ error: 'شناسهٔ آزمون نامعتبر است' }, 400)
  }

  const entry = getDiagEntry(testId)
  if (!entry) {
    // شاید از قبل پایان یافته یا منقضی — اتاق هم به‌طور خودکار حذف شده است
    return infraJson({ cleaned: false, alreadyEnded: true })
  }
  if (entry.uid !== session.uid) {
    return infraJson({ error: 'این آزمون متعلق به این حساب نیست' }, 403)
  }

  const { deleted } = await deleteDiagRoom(entry.room)
  deleteDiagEntry(testId)

  if (!deleted) {
    await logInfraEvent(
      'error',
      'livekit',
      'پاک‌سازی اتاق تشخیصی تأیید نشد',
      `اتاق ${entry.room} در فهرست LiveKit یافت نشد یا حذف قابل راستی‌آزمایی نبود — انقضای خودکار حداکثر ۹۰ ثانیه`,
    )
  }

  return infraJson({
    cleaned: deleted,
    room: entry.room,
    fallback: deleted ? null : 'اتاق تشخیصی حداکثر ۹۰ ثانیه بعد به‌طور خودکار حذف می‌شود (empty_timeout)',
  })
}
