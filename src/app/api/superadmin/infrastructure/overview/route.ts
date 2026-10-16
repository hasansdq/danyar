import type { NextRequest } from 'next/server'
import { runServiceChecks } from '@/lib/infra/checks'
import { guardSuperAdminApi, infraJson } from '@/lib/infra/route-helpers'
import { runModeInfo, appVersion, processStartedAt } from '@/lib/infra/run-mode'
import { getThresholds, logInfraEvent, sweepInfraEvents } from '@/lib/infra/settings'
import type { ServiceCheckStatus } from '@/lib/infra/types'

/**
 * GET /api/superadmin/infrastructure/overview — وضعیت سرویس‌ها + حالت اجرا.
 *
 * فقط مدیر کل (گارد سرور)؛ rate-limit؛ بدون کش.
 * خرابی یک سرویس هرگز مانع نمایش بقیه نمی‌شود (Promise.allSettled داخلی).
 * رویداد فقط در «تغییر وضعیت» ثبت می‌شود تا دیتابیس رشد نکند.
 */

const g = globalThis as unknown as { __infraPrevStatus?: Record<string, ServiceCheckStatus> }

export async function GET(req: NextRequest) {
  void req // فقط برای علامت dynamic (Next 16 بهتر است route صریح داینامیک بماند)
  const guard = await guardSuperAdminApi('infra-overview', 30, 60_000)
  if ('response' in guard) return guard.response

  const { checks, totalLatencyMs } = await runServiceChecks()

  // ثبت تغییر وضعیت‌ها (خطا/بازیابی) — صرفاً تغییر لبه، نه هر poll
  const prev = g.__infraPrevStatus ?? {}
  for (const c of checks) {
    if (c.key === 'web') continue // خود این API
    const before = prev[c.key]
    if (before && before !== c.status) {
      if (c.status === 'degraded') {
        await logInfraEvent('error', c.key, `${c.label}: ${c.error ?? 'اختلال'}`, c.hint)
      } else if (before === 'degraded' && (c.status === 'ok' || c.status === 'not_configured')) {
        await logInfraEvent('recovery', c.key, `${c.label}: وضعیت به حالت سالم بازگشت`)
      }
    }
  }
  g.__infraPrevStatus = Object.fromEntries(checks.map((c) => [c.key, c.status]))
  sweepInfraEvents().catch(() => undefined)

  const thresholds = await getThresholds()
  const version = await appVersion()

  return infraJson({
    runMode: runModeInfo(),
    appVersion: version,
    processStartedAt: processStartedAt(),
    generatedAt: Date.now(),
    checks,
    totalLatencyMs,
    thresholds,
  })
}
