'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Bell } from 'lucide-react'
import { getSocket } from '@/components/messenger/socket-client'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

/**
 * زنگ اعلان‌ها — شمارنده نخوانده‌ها + به‌روزرسانی بلادرنگ با Socket.IO.
 * اعلان سیستم‌عاملی (پوش واقعی) توسط Service Worker مدیریت می‌شود و
 * وقتی پنجره فعال است اعلان سیستم تکراری ساخته نمی‌شود؛
 * بنابراین اینجا هیچ اعلان مرورگر موازی‌ای ساخته نمی‌شود.
 */
export function NotificationBell() {
  const [unread, setUnread] = useState(0)
  const { toast } = useToast()

  useEffect(() => {
    let alive = true

    const refresh = async () => {
      try {
        const r = await fetch('/api/notifications?count=1', { cache: 'no-store' })
        if (!r.ok) return
        const d = await r.json()
        if (alive) setUnread(d.unreadCount ?? 0)
      } catch {
        /* ignore */
      }
    }
    refresh()

    // به‌روزرسانی دوره‌ای به‌عنوان پشتیبان سکت (ضربان صف پوش هم هست)
    const timer = setInterval(refresh, 60_000)

    const socket = getSocket()
    const onNew = (data: { title?: string } | undefined) => {
      setUnread((u) => u + 1)
      if (data?.title) {
        toast({
          title: 'اعلان جدید',
          description: data.title,
        })
      }
    }
    socket.on('notification:new', onNew)
    socket.on('connect', () => refresh())

    return () => {
      alive = false
      clearInterval(timer)
      socket.off('notification:new', onNew)
      socket.off('connect')
    }
  }, [toast])

  return (
    <Link
      href="/notifications"
      aria-label={`اعلان‌ها${unread ? ` — ${unread} نخوانده` : ''}`}
      title="اعلان‌ها"
      className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <Bell className="h-5 w-5" />
      {unread > 0 && (
        <span
          className={cn(
            'absolute -top-0.5 -left-0.5 min-w-[18px] rounded-full bg-red-500 px-1 text-center',
            'text-[10px] font-bold leading-[18px] text-white',
          )}
        >
          {unread > 99 ? '99+' : new Intl.NumberFormat('fa-IR').format(unread)}
        </span>
      )}
    </Link>
  )
}
