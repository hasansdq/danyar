import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin, jsonError } from '@/lib/api-auth'
import { getPlatformSettings, updatePlatformSettings, type BrandingPatch } from '@/lib/branding'

/**
 * GET /api/admin/branding — تنظیمات کامل هویت/ظاهر (فقط مدیر کل)
 * PATCH /api/admin/branding — ذخیره تنظیمات با اعتبارسنجی
 */
export async function GET() {
  const res = await requireSuperAdmin()
  if ('response' in res) return res.response
  const s = await getPlatformSettings()
  return NextResponse.json({ settings: s })
}

export async function PATCH(req: NextRequest) {
  const res = await requireSuperAdmin()
  if ('response' in res) return res.response

  const body = (await req.json().catch(() => null)) as BrandingPatch | null
  if (!body || typeof body !== 'object') return jsonError('درخواست نامعتبر است')

  try {
    const settings = await updatePlatformSettings(body)
    return NextResponse.json({ settings })
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : 'ذخیره تنظیمات ناموفق بود', 400)
  }
}
