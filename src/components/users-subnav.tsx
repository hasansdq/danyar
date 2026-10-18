import Link from 'next/link'
import { ListPlus, UserPlus } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * ناوبری زیربخش «کاربران» — دو صفحهٔ مجزا (درخواست کاربر: باکس‌های افزودن کاربر
 * از لیست کاربران جدا شوند):
 *  - پنل مدیر کل: فهرست (/admin/users) و افزودن (/admin/users/add)
 *  - پنل مدیر مدرسه: فهرست (/modir/users) و افزودن (/modir/users/add)
 */
export function UsersSubNav({
  active,
  base = '/admin/users',
}: {
  active: 'list' | 'add'
  /** پیشوند مسیرهای زیربخش — /admin/users یا /modir/users */
  base?: '/admin/users' | '/modir/users'
}) {
  const items = [
    {
      href: base,
      active: active === 'list',
      icon: ListPlus,
      label: 'فهرست کاربران',
    },
    {
      href: `${base}/add`,
      active: active === 'add',
      icon: UserPlus,
      label: 'افزودن کاربر',
    },
  ]
  return (
    <div
      className="inline-flex items-center gap-1 rounded-lg bg-muted p-1"
      role="tablist"
      aria-label="بخش‌های مدیریت کاربران"
    >
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          role="tab"
          aria-selected={item.active}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            item.active
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <item.icon className="h-4 w-4" />
          {item.label}
        </Link>
      ))}
    </div>
  )
}
