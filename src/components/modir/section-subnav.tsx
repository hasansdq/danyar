import Link from 'next/link'
import { ListPlus, PlusCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * ناوبری زیربخش عمومی مدیریت مدرسه — دو صفحهٔ مجزا برای هر بخش (درخواست کاربر:
 * آیکون + کارت‌های آماری باید به صفحهٔ «فقط فرم افزودن» برود و آیکون تنظیمات به
 * صفحهٔ «فهرست و مدیریت»):
 *  - اطلاعیه‌ها: /modir/announcements (اطلاعیه‌های اخیر) و /modir/announcements/add (ارسال)
 *  - گروه‌ها: /modir/groups (فهرست) و /modir/groups/add (افزودن)
 *  - معاونین: /modir/deputies (فهرست و دسترسی‌ها) و /modir/deputies/add (افزودن)
 *  (کلاس‌ها subnav ندارند: فرم افزودن و فهرست داخل همان باکس کلاس‌ها ادغام شده‌اند — درخواست کاربر)
 */
export function ModirSectionSubNav({
  active,
  listHref,
  addHref,
  listLabel = 'فهرست',
  addLabel = 'افزودن',
}: {
  active: 'list' | 'add'
  listHref: string
  addHref: string
  listLabel?: string
  addLabel?: string
}) {
  const items = [
    { href: listHref, active: active === 'list', icon: ListPlus, label: listLabel },
    { href: addHref, active: active === 'add', icon: PlusCircle, label: addLabel },
  ]
  return (
    <div
      className="inline-flex items-center gap-1 rounded-lg bg-muted p-1"
      role="tablist"
      aria-label="بخش‌های مدیریت"
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
