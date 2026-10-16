import type { NextRequest } from 'next/server'
import { guardSuperAdminApi, infraJson } from '@/lib/infra/route-helpers'
import { sampleResources } from '@/lib/infra/resources'
import { getThresholds, logInfraEvent, sweepInfraEvents } from '@/lib/infra/settings'
import type { AlertState } from '@/lib/infra/types'

/**
 * GET /api/superadmin/infrastructure/resources — منابع سرور/کانتینر.
 *
 * نمونه‌برداری واقعی از /proc و statfs با برچسب منبع (کانتینر/میزبان/پیش‌نمایش)؛
 * شاخص دردسترس‌ناپذیر صریحاً «در دسترس نیست» گزارش می‌شود.
 * هشدار فقط در «مصرف پایدار» (N نمونهٔ متوالی بالای آستانه) فعال است و
 * رویداد هشدار/بازیابی فقط در تغییر لبه ثبت می‌شود.
 */

const METRIC_LABELS: Record<AlertState['metric'], string> = {
  cpu: 'پردازنده (CPU)',
  ram: 'حافظه (RAM)',
  disk: 'دیسک',
}

const g = globalThis as unknown as { __infraPrevAlerts?: Record<string, boolean> }

export async function GET(req: NextRequest) {
  void req
  const guard = await guardSuperAdminApi('infra-resources', 30, 60_000)
  if ('response' in guard) return guard.response

  const thresholds = await getThresholds()
  const { snapshot, alerts } = await sampleResources(thresholds)

  // ثبت هشدار پایدار/بازیابی — فقط تغییر لبه
  const prev = g.__infraPrevAlerts ?? {}
  for (const a of alerts) {
    const before = prev[a.metric] ?? false
    if (a.active && !before) {
      await logInfraEvent(
        'alert',
        a.metric,
        `${METRIC_LABELS[a.metric]}: مصرف پایدار ${a.percent}٪ بالای آستانه ${a.threshold}٪ (${a.consecutiveOver} نمونهٔ متوالی)`,
      )
    } else if (!a.active && before) {
      await logInfraEvent('recovery', a.metric, `${METRIC_LABELS[a.metric]}: مصرف به زیر آستانه بازگشت`)
    }
    prev[a.metric] = a.active
  }
  g.__infraPrevAlerts = prev
  sweepInfraEvents().catch(() => undefined)

  return infraJson({ snapshot, alerts, thresholds })
}
