import type { NextRequest } from 'next/server'
import { guardSuperAdminApi, infraJson } from '@/lib/infra/route-helpers'
import { getThresholds, saveThresholds } from '@/lib/infra/settings'

/**
 * GET/PUT /api/superadmin/infrastructure/settings — آستانه‌های هشدار.
 * فقط همین چهار عدد؛ هیچ تنظیم زیرساخت/اجرای فرمانی از پنل تغییر نمی‌کند.
 */

export async function GET() {
  const guard = await guardSuperAdminApi('infra-settings-get', 30, 60_000)
  if ('response' in guard) return guard.response
  return infraJson({ thresholds: await getThresholds() })
}

export async function PUT(req: NextRequest) {
  const guard = await guardSuperAdminApi('infra-settings-put', 12, 60_000)
  if ('response' in guard) return guard.response
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return infraJson({ error: 'بدنهٔ درخواست معتبر نیست' }, 400)
  }
  const num = (v: unknown): number | undefined => {
    const n = Number(v)
    return v !== undefined && Number.isFinite(n) ? n : undefined
  }
  try {
    const thresholds = await saveThresholds({
      cpuThreshold: num(body.cpuThreshold),
      ramThreshold: num(body.ramThreshold),
      diskThreshold: num(body.diskThreshold),
      sustainedCount: num(body.sustainedCount),
    })
    return infraJson({ thresholds })
  } catch {
    return infraJson({ error: 'ذخیرهٔ تنظیمات ناموفق بود — دیتابیس را بررسی کنید' }, 500)
  }
}
