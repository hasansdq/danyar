'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { LogOut, ShieldCheck, School, Users, Sparkles, MessageSquareText, Bell, Send, Palette, PaintBucket, Images, Activity, Video } from 'lucide-react'
import { ThemeToggle } from '@/components/theme-toggle'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { pushLogoutCleanup } from '@/lib/push-client'
import { useBranding } from '@/lib/use-branding'
import { ReactNode } from 'react'

interface AdminShellProps {
  user: { fullName: string }
  children: ReactNode
}

export function AdminShell({ user, children }: AdminShellProps) {
  const router = useRouter()
  const pathname = usePathname()
  const branding = useBranding()
  const appName = branding?.appName ?? 'دانیار'
  const logoUrl = branding?.logoUrl ?? '/daniar-logo.svg'

  async function logout() {
    await pushLogoutCleanup()
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/superadmin')
    router.refresh()
  }

  const navItems = [
    { href: '/admin', label: 'مدیریت مدارس', icon: School },
    { href: '/admin/users', label: 'کاربران پلتفرم', icon: Users },
    { href: '/admin/media', label: 'مدیریت رسانه‌ها', icon: Images },
    { href: '/admin/bulk', label: 'ارسال انبوه', icon: Send },
    { href: '/admin/ai', label: 'دستیار هوش مصنوعی', icon: Sparkles },
    { href: '/admin/sms', label: 'ورود پیامکی', icon: MessageSquareText },
    { href: '/admin/notifications', label: 'اعلان‌ها', icon: Bell },
    { href: '/admin/branding', label: 'هویت دانیار', icon: Palette },
    { href: '/admin/appearance', label: 'ظاهر و اسپلش', icon: PaintBucket },
    { href: '/superadmin/online-classes', label: 'مدیریت کلاس‌های آنلاین', icon: Video },
    { href: '/superadmin/infrastructure', label: 'وضعیت زیرساخت', icon: Activity },
  ]

  return (
    <div className="min-h-screen flex flex-col lg:flex-row-reverse lg:flex-row">
      {/* سایدبار دسکتاپ — ثابت هنگام اسکرول محتوا (فوتر/خروج همیشه دیده می‌شود) */}
      <aside className="hidden lg:flex lg:flex-col w-64 shrink-0 border-l bg-card lg:sticky lg:top-0 lg:h-dvh">
        <div className="flex items-center gap-2.5 p-4 border-b shrink-0">
          <img src={logoUrl} alt={appName} className="h-9 w-9 object-contain" />
          <div>
            <div className="font-bold text-lg leading-tight">{appName}</div>
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <ShieldCheck className="h-3 w-3 text-primary" />
              پنل مدیر کل
            </div>
          </div>
        </div>

        {/* منوی اسکرول‌پذیر — خروج در پایین ثابت می‌ماند */}
        <nav className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1" aria-label="منوی مدیر کل">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                (item.href === '/admin'
                  ? pathname === '/admin' ||
                    (pathname.startsWith('/admin/') &&
                      !pathname.startsWith('/admin/users') &&
                      !pathname.startsWith('/admin/bulk') &&
                      !pathname.startsWith('/admin/ai') &&
                      !pathname.startsWith('/admin/sms') &&
                      !pathname.startsWith('/admin/notifications') &&
                      !pathname.startsWith('/admin/branding') &&
                      !pathname.startsWith('/admin/appearance') &&
                      !pathname.startsWith('/admin/media'))
                  : pathname.startsWith(item.href))
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <item.icon className="h-4.5 w-4.5" />
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="p-3 border-t shrink-0">
          <div className="flex items-center gap-3 px-2 py-2">
            <Avatar className="h-9 w-9">
              <AvatarFallback className="bg-primary/10 text-primary text-sm font-bold">
                {user.fullName.trim().charAt(0)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">{user.fullName}</div>
              <div className="text-xs text-muted-foreground">مدیر کل</div>
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

      <div className="flex-1 flex flex-col min-h-screen lg:min-h-0">
        {/* هدر موبایل */}
        <header className="lg:hidden sticky top-0 z-40 flex items-center gap-2 border-b bg-card/95 backdrop-blur px-4 py-2.5">
          <img src={logoUrl} alt={appName} className="h-8 w-8 object-contain" />
          <span className="font-bold">{appName}</span>
          <ShieldCheck className="h-4 w-4 text-primary" />
          <div className="flex-1" />
          <ThemeToggle />
          <Button variant="ghost" size="icon" onClick={logout} aria-label="خروج">
            <LogOut className="h-5 w-5" />
          </Button>
        </header>

        <header className="hidden lg:flex sticky top-0 z-40 items-center gap-3 border-b bg-card/95 backdrop-blur px-6 py-3">
          <div className="flex-1" />
          <div className="text-sm text-muted-foreground">{user.fullName} — مدیر کل</div>
          <ThemeToggle />
        </header>

        <main className="flex-1">{children}</main>
      </div>
    </div>
  )
}
