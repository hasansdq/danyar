import { NextRequest, NextResponse } from 'next/server'
import { verifySessionToken, SESSION_COOKIE_NAME, IMPERSONATE_COOKIE } from '@/lib/session'

const APP_ROLES = ['SCHOOL_ADMIN', 'SCHOOL_VICE', 'TEACHER', 'STUDENT']

function homeFor(role: string): string {
  return role === 'SUPER_ADMIN' ? '/admin' : '/'
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // گارد CSRF برای APIهای تغییردهنده (جبران SameSite=None که برای کارکرد نشست داخل
  // iframe پیش‌نمایش لازم است): درخواست‌های ارسالی از سند خودِ اپ — حتی داخل iframe —
  // همیشه Sec-Fetch-Site: same-origin/same-site دارند؛ فقط صفحات مخرب cross-site می‌فرستند
  if (pathname.startsWith('/api/')) {
    const method = req.method.toUpperCase()
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      const fetchSite = req.headers.get('sec-fetch-site')
      const crossSite =
        fetchSite === 'cross-site' ||
        // مرورگرهای بدون Sec-Fetch: در صورت وجود Origin، نام هاست آن باید با هاست مقصد یکی باشد
        // (مقایسه فقط hostname — کوکی سبه‌سایت است نه پورت‌محور؛ پروکسی‌ها گاهی پورت Host را حذف می‌کنند)
        (!fetchSite && (() => {
          const origin = req.headers.get('origin')
          const host = req.headers.get('host')
          if (!origin || !host) return false
          try {
            return new URL(origin).hostname !== host.split(':')[0].toLowerCase()
          } catch { return false }
        })())
      if (crossSite)
        return NextResponse.json(
          { error: 'درخواست بین‌سایتی مجاز نیست' },
          { status: 403 },
        )
    }
    return NextResponse.next()
  }

  const session =
    (await verifySessionToken(req.cookies.get(IMPERSONATE_COOKIE)?.value)) ??
    (await verifySessionToken(req.cookies.get(SESSION_COOKIE_NAME)?.value))
  const role = session?.role

  /** تغییر رمز اجباری (درخواست کاربر): کاربرِ واردشده با رمز پیش‌فرض (123456) فقط
   * می‌تواند رمز خود را در تنظیمات عوض کند یا خارج شود؛ بقیهٔ صفحات قفل است. */
  if (session?.pwdDefault) {
    const allowed =
      pathname === '/login' || pathname === '/settings' || pathname.startsWith('/settings/')
    if (!allowed) {
      return NextResponse.redirect(new URL('/settings?force=1', req.url))
    }
  }

  /** هدایت به ورود با حفظ مقصد — پس از ورود به همان مسیر برمی‌گردد (مثلاً کلیک اعلان) */
  const loginRedirect = () => {
    const url = new URL('/login', req.url)
    url.searchParams.set('next', pathname + (req.nextUrl.search || ''))
    return NextResponse.redirect(url)
  }

  // صفحه اصلی: فهرست گفتگوها برای کاربران اپ، پنل مدیر کل برای سوپرادمین
  if (pathname === '/') {
    if (!session) return NextResponse.redirect(new URL('/login', req.url))
    if (role === 'SUPER_ADMIN')
      return NextResponse.redirect(new URL('/admin', req.url))
    return NextResponse.next()
  }

  // ورود اپ: کاربر واردشده هدایت شود
  if (pathname === '/login') {
    if (session) return NextResponse.redirect(new URL(homeFor(role!), req.url))
    return NextResponse.next()
  }

  // ورود مدیر کل
  if (pathname === '/superadmin') {
    if (role === 'SUPER_ADMIN')
      return NextResponse.redirect(new URL('/admin', req.url))
    if (role) // نقش‌های غیرمدیرکل به صفحه خودشان هدایت شوند
      return NextResponse.redirect(new URL(homeFor(role), req.url))
    return NextResponse.next()
  }

  // صفحهٔ وضعیت زیرساخت — فقط مدیر کل (گارد مسیر، مکمل گارد صفحه و API)
  if (
    pathname === '/superadmin/infrastructure' ||
    pathname.startsWith('/superadmin/infrastructure/')
  ) {
    if (!session) return NextResponse.redirect(new URL('/superadmin', req.url))
    if (role !== 'SUPER_ADMIN')
      return NextResponse.redirect(new URL(homeFor(role!), req.url))
    return NextResponse.next()
  }

  // صفحهٔ مدیریت کلاس‌های آنلاین — فقط مدیر کل (گارد مسیر، مکمل گارد صفحه و API)
  if (
    pathname === '/superadmin/online-classes' ||
    pathname.startsWith('/superadmin/online-classes/')
  ) {
    if (!session) return NextResponse.redirect(new URL('/superadmin', req.url))
    if (role !== 'SUPER_ADMIN')
      return NextResponse.redirect(new URL(homeFor(role!), req.url))
    return NextResponse.next()
  }

  // منطقه مدیر کل
  if (pathname.startsWith('/admin')) {
    if (!session) return NextResponse.redirect(new URL('/superadmin', req.url))
    if (role !== 'SUPER_ADMIN')
      return NextResponse.redirect(new URL(homeFor(role!), req.url))
    return NextResponse.next()
  }

  // مسیر قدیمی /school → /modir (سازگاری)
  if (pathname === '/school' || pathname.startsWith('/school/')) {
    const target = pathname.replace(/^\/school/, '/modir') || '/modir'
    return NextResponse.redirect(new URL(target, req.url))
  }

  // پنل مدیریت مدرسه (جدا از پیام‌رسان) — مدیر و معاون (معاون همهٔ دسترسی‌ها را دارد؛
  // محدودیت‌های هر معاون در سطح صفحه/API از VicePermission اعمال می‌شود)
  if (pathname.startsWith('/modir')) {
    if (!session) return loginRedirect()
    if (role !== 'SCHOOL_ADMIN' && role !== 'SCHOOL_VICE')
      return NextResponse.redirect(new URL(homeFor(role!), req.url))
    return NextResponse.next()
  }

  // گفتگوی دستیار هوش مصنوعی — مدیر و معاون مدرسه (مجوز ai_assistant در سطح API)
  if (pathname === '/assistant' || pathname.startsWith('/assistant/')) {
    if (!session) return loginRedirect()
    if (role === 'SUPER_ADMIN') return NextResponse.redirect(new URL('/admin', req.url))
    if (role !== 'SCHOOL_ADMIN' && role !== 'SCHOOL_VICE')
      return NextResponse.redirect(new URL(homeFor(role!), req.url))
    return NextResponse.next()
  }

  // مسیر قدیمی /chats → صفحه اصلی
  if (pathname === '/chats') {
    return NextResponse.redirect(new URL(homeFor(role || 'STUDENT'), req.url))
  }

  // تنظیمات — برای همهٔ نقش‌ها از جمله مدیر کل (درخواست کاربر: همه کاربران بتوانند
  // از آیکون چرخ‌دنده رمز خود را تغییر دهند)
  if (pathname === '/settings' || pathname.startsWith('/settings/')) {
    if (!session) return loginRedirect()
    return NextResponse.next()
  }

  // گفتگوها، داشبورد، تکالیف، کلاس آنلاین، اعلان‌ها، حضور و غیاب، نمونه‌سؤالات: نقش‌های اپ
  if (
    pathname.startsWith('/chats/') ||
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/assignments') ||
    pathname.startsWith('/live') ||
    pathname.startsWith('/notifications') ||
    pathname.startsWith('/attendance') ||
    pathname.startsWith('/sample-questions')
  ) {
    if (!session) return loginRedirect()
    if (role === 'SUPER_ADMIN')
      return NextResponse.redirect(new URL('/admin', req.url))
    if (!APP_ROLES.includes(role!))
      return NextResponse.redirect(new URL('/login', req.url))
    return NextResponse.next()
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/',
    '/login',
    '/superadmin',
    '/superadmin/infrastructure',
    '/superadmin/infrastructure/:path*',
    '/superadmin/online-classes',
    '/superadmin/online-classes/:path*',
    '/api/:path*',
    '/admin/:path*',
    '/school/:path*',
    '/modir/:path*',
    '/chats/:path*',
    '/dashboard/:path*',
    '/settings',
    '/settings/:path*',
    '/calendar',
    '/calendar/:path*',
    '/assignments/:path*',
    '/assignments',
    '/live/:path*',
    '/live',
    '/notifications/:path*',
    '/notifications',
    '/attendance/:path*',
    '/attendance',
    '/sample-questions/:path*',
    '/sample-questions',
    '/assistant/:path*',
    '/assistant',
  ],
}
