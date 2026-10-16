/**
 * هم‌ترازی اسکیم URL سیگنالینگ LiveKit با پروتکل صفحه — سمت کلاینت
 *
 * ریشه ارور «اتصال رسانه برقرار نشد: could not establish signal connection:
 * room connection has timed out (signal)» پشت درگاه‌های HTTPS:
 *
 * سرور اسکیم را از هدر X-Forwarded-Proto می‌خواند؛ اما برخی درگاه‌ها (لبه پیش‌نمایش
 * زنده، و هر پراکسی‌ای که XFP را با اسکیمِ هاپِ داخلی بازنویسی می‌کند) این هدر را
 * «http» تحویل می‌دهند حتی وقتی کاربر روی صفحه HTTPS است. سرور بنابراین
 * «ws://…» برمی‌گرداند و مرورگر اتصال ناامن را به‌عنوان محتوای مختلط (mixed content)
 * «قبل از هر بایتی» مسدود می‌کند:
 *   Failed to construct 'WebSocket': An insecure WebSocket connection may not be
 *   initiated from a page loaded over HTTPS.
 * نتیجه: هیچ خطای شبکه‌ای هم رخ نمی‌دهد؛ فقط تایم‌اوت سیگنال.
 *
 * سوکت این مشکل را ندارد چون socket.io اسکیم را از خود صفحه (window.location) می‌گیرد؛
 * این همان رفتار را برای LiveKit بازتولید می‌کند: صفحه https → wss، صفحه http → ws.
 *
 * محدوده اصلاح: فقط «هم‌نام میزبان» (همین مبدأ/درگاه) — اگر مدیر سرور رسانه جداگانه
 * (NEXT_PUBLIC_LIVEKIT_WS_URL) تنظیم کرده باشد، پیکربندی آگاهانه اوست و دست نمی‌خورد.
 * مقایسه بر اساس hostname است (پورت نادیده) تا استقرار پشت درگاهِ با پورت سفارشی
 * (مثلاً https://domain:8443 که پراکسی پورت را از هدر حذف می‌کند) هم پوشش داده شود.
 */

/** تابع خالص و قابل تست — ورودی/خروجی رشته‌ای، بدون وابستگی به مرورگر */
export function alignSignalUrlToPage(
  rawUrl: string,
  pageProtocol: string,
  pageHost: string,
): string {
  try {
    const u = new URL(rawUrl)
    if (u.protocol !== 'ws:' && u.protocol !== 'wss:') return rawUrl
    // رسانه‌سرور جداگانه با میزبان متفاوت → پیکربندی عمدی مدیر، بدون تغییر
    if (u.hostname !== new URL(`${pageProtocol}//${pageHost}`).hostname) return rawUrl
    const pageHttps = pageProtocol === 'https:'
    if (pageHttps && u.protocol === 'ws:') return rawUrl.replace(/^ws:/, 'wss:')
    if (!pageHttps && u.protocol === 'wss:') return rawUrl.replace(/^wss:/, 'ws:')
    return rawUrl
  } catch {
    // URL بد.Shape → همان ورودی برمی‌گردد؛ livekit-client خودش خطای شفاف می‌دهد
    return rawUrl
  }
}

/** فراخوانی مرورگری — پروتکل/میزبان صفحه را از window می‌خواند */
export function alignSignalUrl(rawUrl: string): string {
  if (typeof window === 'undefined') return rawUrl
  return alignSignalUrlToPage(rawUrl, window.location.protocol, window.location.host)
}
