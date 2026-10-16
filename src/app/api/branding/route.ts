import { NextRequest, NextResponse } from 'next/server'
import { getBrandingPayload } from '@/lib/branding'

/**
 * GET /api/branding — هویت و ظاهر برنامه (عمومی؛ برای صفحه ورود و اسپلش)
 * - بخش عمومی: نام اپ، لوگو، فونت، اسپلش
 * - schoolDisplayName فقط برای کاربر واردشده با مدرسه (الگوی «مدرسه هوشمند + نام مدرسه»)
 * - chatBgUrl فقط برای کاربر واردشده (استایل داخلی)
 */
export async function GET(req: NextRequest) {
  const payload = await getBrandingPayload()
  return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } })
}
