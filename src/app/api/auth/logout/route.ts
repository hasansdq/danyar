import { NextResponse } from 'next/server'
import { clearSessionCookie } from '@/lib/session'

/**
 * خروج از حساب — کوکی نشست پاک می‌شود و مرورگر دستور پاک‌سازی
 * کش و ذخیره‌سازی می‌گیرد تا اطلاعات حساب قبلی برای کاربر بعدی نمایش داده نشود.
 */
export async function POST() {
  await clearSessionCookie()
  return NextResponse.json(
    { ok: true },
    {
      headers: {
        // پاک‌سازی کش و storage مرورگر (کوکی نشست بالا صریحاً پاک شده است)
        'Clear-Site-Data': '"cache", "storage"',
      },
    },
  )
}
