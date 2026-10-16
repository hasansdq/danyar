/**
 * اطلاع‌رسانی رویدادها به سرویس مستقل Socket.IO.
 * پیام‌ها همیشه در همین فرآیند (Next API) در دیتابیس نوشته می‌شوند و
 * این تابع فقط خبر broadcast می‌دهد؛ اگر سرویس socket در دسترس نباشد
 * پیام ذخیره‌شده باقی می‌ماند و پس از اتصال مجدد کلاینت‌ها همگام می‌شوند.
 */

const SOCKET_INTERNAL_URL =
  process.env.SOCKET_INTERNAL_URL ?? 'http://127.0.0.1:3003'

export interface EmitPayload {
  /** اتاق‌های مقصد مثل group:xyz یا user:xyz */
  rooms?: string[]
  /** فقط برای رویداد broadcast؛ بدون rooms/event فقط اتاق‌های کاربر بازسازی می‌شود */
  event?: string
  data?: unknown
  /** کاربری که اتاق‌هایش باید بر اساس عضویت جدید بازسازی شود */
  refreshUserIds?: string[]
}

export const roomForGroup = (groupId: string) => `group:${groupId}`
export const roomForUser = (userId: string) => `user:${userId}`

export async function notifySocket(payload: EmitPayload): Promise<boolean> {
  // رمز در هر فراخوانی خوانده می‌شود نه در سطح ماژول — اگر .env پس از بالا
  // آمدن پروسه بازنشانی شود، ثابتِ ماژول رمز کهنه را برای همیشه قفل می‌کرد و
  // رله بی‌صدا 403 می‌خورد: پیام در DB ذخیره می‌شد ولی هرگز بلادرنگ نمی‌رسید
  // (پروسهٔ next قبل از بازنشانی .env بالا مانده باشد) — علت ریشه‌ای
  // «پیام می‌رود ولی طرف مقابل بلادرنگ نمی‌بیند».
  const INTERNAL_SECRET =
    process.env.SOCKET_INTERNAL_SECRET ?? 'daniar-internal-dev-secret'
  try {
    const res = await fetch(`${SOCKET_INTERNAL_URL}/internal/emit`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-secret': INTERNAL_SECRET,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(2500),
    })
    if (!res.ok) {
      // قابل تشخیص بدون افشای محرمانه: فقط وضعیت و نام رویداد، نه محتوای پیام
      console.error(
        `[notify] رله سوکت رد شد — HTTP ${res.status} event=${payload.event ?? 'refresh'}`,
      )
    }
    return res.ok
  } catch {
    // سرویس socket در دسترس نیست؛ داده در DB امن است
    console.error(
      `[notify] سرویس سوکت در دسترس نیست — event=${payload.event ?? 'refresh'} (همگام‌سازی با اتصال مجدد)`,
    )
    return false
  }
}
