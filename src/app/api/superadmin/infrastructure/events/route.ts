import type { NextRequest } from 'next/server'
import { guardSuperAdminApi, infraJson } from '@/lib/infra/route-helpers'
import { recentInfraEvents, INFRA_EVENT_POLICY } from '@/lib/infra/settings'

/**
 * GET /api/superadmin/infrastructure/events — فهرست خطاها/هشدارهای اخیر.
 * با ?count=50 (سقف ۲۰۰). سیاست پاک‌سازی در پاسخ اعلام می‌شود.
 */
export async function GET(req: NextRequest) {
  const guard = await guardSuperAdminApi('infra-events', 20, 60_000)
  if ('response' in guard) return guard.response
  const count = Number(req.nextUrl.searchParams.get('count') ?? 50)
  const events = await recentInfraEvents(Number.isFinite(count) ? count : 50)
  return infraJson({
    events,
    policy: {
      retentionDays: INFRA_EVENT_POLICY.retentionDays,
      hardCap: INFRA_EVENT_POLICY.hardCap,
      note: 'فقط تغییر وضعیت ثبت می‌شود (نه هر بررسی) — مانیتورینگ باعث رشد نامحدود دیتابیس نمی‌شود',
    },
  })
}
