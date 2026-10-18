'use client'

/**
 * fetch مشترک سمت کلاینت — خروجی استاندارد fetch با یک تفاوت:
 *
 * پاسخ 401 (نشست باطل/منقضی/زامبی) → بارگذاری کامل صفحه ورود با حفظ مقصد.
 *
 * چرا مهم؟ بدون این، خطای 401 در کامپوننت‌هایی که فقط res.ok را بررسی می‌کنند
 * بی‌صدا نادیده گرفته می‌شود و «لودینگ بی‌پایان» می‌ماند. با apiFetch، نخستین
 * درخواستِ نوک‌خورده کاربر را به ورود هدایت می‌کند و پس از ورود به همان صفحه
 * برمی‌گردد (?next=).
 *
 * نکته: در صفحات ورود خودشان (login/superadmin) هداشتی انجام نمی‌شود —
 * ورود ناموفق (401 فرم ورود) نباید حلقه بسازد. این تابع فقط برای فراخوانی‌های
 * «دادهٔ احراز‌هویت‌شده» است، نه فرم ورود.
 */
export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init)
  if (res.status === 401) {
    const path = window.location.pathname
    const onLoginPage =
      path === '/login' ||
      path.startsWith('/login/') ||
      path === '/superadmin' ||
      path.startsWith('/superadmin/')
    if (!onLoginPage) {
      // منطقهٔ مدیر کل → ورود مخصوص خودش؛ بقیه → ورود اپ (هر دو فرم مشترکاً ?next= را می‌فهمند)
      const portal = path.startsWith('/admin') || path.startsWith('/superadmin') ? '/superadmin' : '/login'
      const next = encodeURIComponent(path + window.location.search)
      window.location.replace(`${portal}?next=${next}`)
    }
  }
  return res
}
