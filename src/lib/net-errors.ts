/**
 * ترجمه خطاهای شبکه‌ای سطح پایین (undici/fetch) به پیام فارسی روشن — مشترک بین
 * لایه هوش مصنوعی و لایه پیامک. «fetch failed» خام هرگز به کاربر نمایش داده
 * نمی‌شود؛ علت واقعی (کد خطای سیستم‌عامل در err.cause) استخراج و توضیح داده می‌شود.
 *
 * subject: نام سرویس در جمله — مثلا «سرویس هوش مصنوعی» یا «سرویس پیامکی»
 */
export function describeNetworkError(err: unknown, subject = 'سرویس'): string | null {
  if (!(err instanceof Error)) return null
  const name = err.name ?? ''
  const msg = err.message ?? ''
  const cause = (err as Error & { cause?: unknown }).cause
  let code = ''
  let detail = ''
  if (cause instanceof Error) {
    detail = cause.message ?? ''
    code = String((cause as NodeJS.ErrnoException).code ?? '')
  } else if (cause && typeof cause === 'object') {
    const c = cause as Record<string, unknown>
    code = String(c.code ?? '')
    detail = String(c.message ?? '')
  }
  const hay = `${name} ${msg} ${code} ${detail}`
  if (name === 'TimeoutError' || /timed?\s*out/i.test(hay)) {
    return `اتصال به ${subject} بیش از حد طول کشید (timeout) — بعداً تلاش کنید یا آدرس سرویس را بررسی کنید`
  }
  if (/ECONNREFUSED/i.test(hay)) {
    return `اتصال به ${subject} رد شد — سرویس‌دهنده در دسترس نیست یا آدرس/پورت اتصال اشتباه است (ECONNREFUSED)`
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(hay)) {
    return `آدرس ${subject} یافت نشد — آدرس اتصال را در تنظیمات بررسی کنید (خطای DNS)`
  }
  if (/ECONNRESET|socket hang up|EPIPE/i.test(hay)) {
    return `اتصال به ${subject} ناگهان قطع شد — سرویس‌دهنده یا شبکه میانی درخواست را بست (ECONNRESET)`
  }
  if (/CERT|SSL|TLS|self-signed|certificate/i.test(hay)) {
    return `خطای گواهی SSL/TLS در اتصال به ${subject} — گواهی یا آدرس را بررسی کنید`
  }
  if (/EACCES|EHOSTUNREACH|ENETUNREACH|ENETDOWN/i.test(hay)) {
    return `شبکه سرور اجازه اتصال به ${subject} را نمی‌دهد — فایروال/خروجی سرور را بررسی کنید`
  }
  if (/fetch failed/i.test(msg)) {
    return `اتصال به ${subject} برقرار نشد (خطای شبکه)${code ? ` — ${code}` : ''}`
  }
  return null
}
