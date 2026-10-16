import type { NextRequest } from 'next/server'
import { guardSuperAdminApi, infraJson } from '@/lib/infra/route-helpers'
import { iceServersConfig } from '@/lib/live-access'

/**
 * GET /api/superadmin/infrastructure/turn-config — پیکربندی ICE «فقط TURN»
 * برای آزمون relay مرورگرِ مدیر کل.
 *
 * - مقصد فقط از تنظیمات معتبر سرور (env) می‌آید؛ URL دلخواه پذیرفته نمی‌شود
 * - اعتبارنامه‌ها برنامه‌ای مصرف می‌شوند (همان الگوی API توکن کلاس) و
 *   هرگز در رابط/لاگ نمایش داده نمی‌شوند
 * - اگر TURN تنظیم نشده باشد configured=false برمی‌گردد (وضعیت صادقانه)
 */
export async function GET(req: NextRequest) {
  void req
  const guard = await guardSuperAdminApi('infra-turn-config', 12, 60_000)
  if ('response' in guard) return guard.response

  const servers = iceServersConfig()
    .map((s) => {
      const urls = Array.isArray(s.urls) ? s.urls : [s.urls]
      const turnUrls = urls.filter((u) => /^turn/i.test(String(u)))
      if (turnUrls.length === 0) return null
      return {
        urls: turnUrls,
        username: s.username,
        credential: s.credential,
      }
    })
    .filter((s): s is NonNullable<typeof s> => s !== null)

  return infraJson({
    configured: servers.length > 0,
    iceServers: servers,
  })
}
