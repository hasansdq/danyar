'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
  MessageCircle,
  School,
  Settings,
  LogOut,
  Video,
  CalendarDays,
  BookOpen,
  UsersRound,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ThemeToggle } from '@/components/theme-toggle'
import { NotificationBell } from '@/components/notifications/bell'
import { PushRuntimeBridge } from '@/components/push/push-bridge'
import { ClassStartPopup } from '@/components/live/class-start-popup'
import { pushLogoutCleanup } from '@/lib/push-client'
import { roleLabel } from '@/lib/format'
import { useBranding } from '@/lib/use-branding'
import { ShieldAlert } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { ReactNode } from 'react'

interface NavItem {
  href: string
  label: string
  /** برچسب کوتاه برای نوار پایین موبایل (اختیاری) */
  shortLabel?: string
  icon: React.ComponentType<{ className?: string }>
  show: boolean
}

interface AppShellProps {
  user: { fullName: string; role: string }
  children: ReactNode
  /** ارتفاع ثابت صفحه (برای پیام‌رسان) */
  hFixed?: boolean
  /** مخفی‌کردن منوی پایین موبایل (داخل گفتگوها) */
  hideMobileNav?: boolean
  /** مخفی‌کردن هدر موبایل (داخل گفتگوها) */
  hideMobileHeader?: boolean
}

export function AppShell({ user, children, hFixed, hideMobileNav, hideMobileHeader }: AppShellProps) {
  const pathname = usePathname()
  const router = useRouter()
  const branding = useBranding()
  const appName = branding?.appName ?? 'دانیار'
  const logoUrl = branding?.logoUrl ?? '/daniar-logo.svg'
  const displayName = branding?.schoolDisplayName ?? null
  // تصویر پروفایل کاربر (در صورت وجود)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  // حالت جعل هویت مدیر کل
  const [impersonation, setImpersonation] = useState<{ byName: string } | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch('/api/me', { cache: 'no-store' })
        if (!res.ok || !alive) return
        const d = await res.json()
        if (alive) {
          setAvatarUrl(d.user?.avatarUrl ?? null)
          setImpersonation(d.impersonation ?? null)
        }
      } catch {
        /* ignore */
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  async function exitImpersonation() {
    await fetch('/api/admin/impersonate', { method: 'DELETE' })
    window.location.href = '/admin'
  }

  const navItems: NavItem[] = [
    { href: '/', label: 'گفتگوها', icon: MessageCircle, show: true },
    // «تکالیف» و «حضور و غیاب» از منوها حذف شدند — هر دو در «تقویم آموزشی» ادغام شدند:
    // تکلیف از ثبت رویداد نوع «تکلیف» در دیالوگ روز ثبت می‌شود و حضور و غیاب با
    // دکمه «ثبت غیبت» در همان دیالوگ؛ صفحات گزارش با لینک‌های درون تقویم در دسترس‌اند
    {
      href: '/sample-questions',
      label: 'نمونه‌سؤالات',
      shortLabel: 'نمونه‌سؤال',
      icon: BookOpen,
      show: user.role === 'TEACHER' || user.role === 'STUDENT' || user.role === 'SCHOOL_ADMIN',
    },
    {
      href: '/calendar',
      label: 'تقویم آموزشی',
      shortLabel: 'تقویم',
      icon: CalendarDays,
      show:
        user.role === 'TEACHER' || user.role === 'STUDENT' || user.role === 'SCHOOL_ADMIN',
    },
    {
      href: '/live',
      label: 'کلاس آنلاین',
      icon: Video,
      show: user.role === 'TEACHER' || user.role === 'STUDENT' || user.role === 'SCHOOL_ADMIN',
    },
    // داشبورد حذف شد: دانش‌آموز/معلم به گفتگوها رسیدگی می‌کنند؛ آمار مدیر مدرسه در «مدیریت مدرسه» ادغام شد
    {
      href: '/modir/classes',
      label: 'مدیریت مدرسه',
      icon: School,
      show: user.role === 'SCHOOL_ADMIN',
    },
    // مدیریت گروه‌ها — بخش مجزا در سایدبار (درخواست کاربر)
    {
      href: '/modir/groups',
      label: 'مدیریت گروه‌ها',
      shortLabel: 'گروه‌ها',
      icon: UsersRound,
      show: user.role === 'SCHOOL_ADMIN',
    },
    // تنظیمات از منوها حذف شد — با آیکون چرخ‌دنده در هدر در دسترس است
  ].filter((item) => item.show)

  async function logout() {
    // لغو اتصال اشتراک پوش همین دستگاه به حساب فعلی (قبل از پاک‌شدن نشست)
    await pushLogoutCleanup()
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
    router.refresh()
  }

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/')

  return (
    <>
      {/* پل پوش: پاسخ به «همین گفتگو باز است» و هدایت کلیک اعلان بدون پنجره اضافه */}
      <PushRuntimeBridge />

      {/* پاپ‌آپ «کلاس شما شروع شد!» — دانش‌آموزان، روی هر صفحه‌ای (صف چند جلسه، ضدتکرار) */}
      <ClassStartPopup role={user.role} />

      {/* نوار جعل هویت — هشدار دائمی بالای برنامه */}
      {impersonation && (
        <div className="sticky top-0 z-50 bg-amber-500 text-amber-950 px-4 py-1.5 text-xs font-medium flex items-center justify-center gap-2">
          <ShieldAlert className="h-3.5 w-3.5" />
          <span>
            شما به‌عنوان «{user.fullName}» توسط {impersonation.byName} وارد شده‌اید — همه اقدامات با هویت این کاربر ثبت می‌شود
          </span>
          <button
            onClick={exitImpersonation}
            className="underline underline-offset-2 font-bold hover:opacity-80"
          >
            خروج و بازگشت به پنل مدیر کل
          </button>
        </div>
      )}

      <div
      className={cn(
        'flex flex-col lg:flex-row-reverse lg:flex-row',
        // حالت ارتفاع ثابت (پیام‌رسان): دقیقاً بلندی viewport — بدون min-h-screen تا
        // مرورگر موبایل نتواند کل پوسته را اسکرول کند (هدر و کامپوزر همیشه ثابت می‌مانند)
        hFixed ? 'h-dvh overflow-hidden overscroll-none' : 'min-h-screen',
      )}
    >
      {/* سایدبار دسکتاپ (سمت راست در RTL) — ثابت هنگام اسکرول محتوا؛ خروج پایین همیشه دیده می‌شود */}
      <aside className="hidden lg:flex lg:flex-col w-64 shrink-0 border-l bg-card lg:sticky lg:top-0 lg:h-dvh">
        <div className="flex items-center gap-2.5 p-4 border-b shrink-0">
          <img src={logoUrl} alt={appName} className="h-9 w-9 object-contain" />
          <div className="min-w-0">
            <div className="font-bold text-lg leading-tight">{appName}</div>
            <div className="text-xs text-muted-foreground truncate">
              {displayName ?? 'پیام‌رسان آموزشی'}
            </div>
          </div>
        </div>

        {/* منوی اسکرول‌پذیر */}
        <nav className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1" aria-label="منوی اصلی">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                isActive(item.href)
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="p-3 border-t shrink-0">
          <div className="flex items-center gap-3 px-2 py-2">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt=""
                className="h-9 w-9 rounded-full object-cover border"
              />
            ) : (
              <Avatar className="h-9 w-9">
                <AvatarFallback className="bg-primary/10 text-primary text-sm font-bold">
                  {user.fullName.trim().charAt(0)}
                </AvatarFallback>
              </Avatar>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">{user.fullName}</div>
              <div className="text-xs text-muted-foreground">{roleLabel(user.role)}</div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={logout}
              aria-label="خروج از حساب"
              title="خروج"
            >
              <LogOut className="h-4.5 w-4.5" />
            </Button>
          </div>
        </div>
      </aside>

      <div className={cn('flex-1 flex flex-col', hFixed ? 'min-h-0' : 'min-h-screen lg:min-h-0')}>
        {/* هدر موبایل */}
        {!hideMobileHeader && (
          <header className="lg:hidden sticky top-0 z-40 flex items-center gap-2 border-b bg-card/95 backdrop-blur px-4 py-2.5">
            <img src={logoUrl} alt={appName} className="h-8 w-8 object-contain" />
            <span className="font-bold">{appName}</span>
            <div className="flex-1" />
            <Link
              href="/settings"
              aria-label="تنظیمات"
              title="تنظیمات"
              className={cn(
                'inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors',
                isActive('/settings')
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              <Settings className="h-5 w-5" />
            </Link>
            <NotificationBell />
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              onClick={logout}
              aria-label="خروج از حساب"
              title="خروج"
            >
              <LogOut className="h-5 w-5" />
            </Button>
          </header>
        )}

        {/* هدر دسکتاپ */}
        <header className="hidden lg:flex sticky top-0 z-40 items-center gap-3 border-b bg-card/95 backdrop-blur px-6 py-3">
          <div className="flex-1" />
          <div className="text-sm text-muted-foreground">
            {user.fullName} — {roleLabel(user.role)}
          </div>
          <Link
            href="/settings"
            aria-label="تنظیمات"
            title="تنظیمات"
            className={cn(
              'inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors',
              isActive('/settings')
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            <Settings className="h-5 w-5" />
          </Link>
          <NotificationBell />
          <ThemeToggle />
        </header>

        <main className={cn('flex-1', hFixed ? 'flex flex-col min-h-0' : '', hideMobileNav ? '' : 'pb-20 lg:pb-0')}>
          {children}
        </main>
      </div>

      {/* ناوبری پایین موبایل — داخل گفتگوها نمایش داده نمی‌شود */}
      {!hideMobileNav && (
        <nav
          className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t bg-card/95 backdrop-blur flex"
          aria-label="ناوبری موبایل"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 py-2 px-0.5 text-[10px] font-medium transition-colors',
                isActive(item.href)
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <item.icon className="h-5 w-5 shrink-0" />
              <span className="w-full text-center leading-tight truncate">
                {item.shortLabel ?? item.label}
              </span>
            </Link>
          ))}
        </nav>
      )}
    </div>
    </>
  )
}
