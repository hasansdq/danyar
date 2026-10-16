'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ClipboardList,
  MessageSquareQuote,
  CheckCheck,
  BellOff,
  MessageCircle,
  Users,
  Megaphone,
  Video,
  CalendarCheck,
  CalendarClock,
  BookOpen,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { chatTime } from '@/lib/format'
import { cn } from '@/lib/utils'

interface NotificationItem {
  id: string
  type: string
  title: string
  body: string
  link: string | null
  readAt: string | null
  createdAt: string
}

const TYPE_META: Record<string, { icon: typeof ClipboardList; className: string }> = {
  ASSIGNMENT_NEW: { icon: ClipboardList, className: 'bg-primary/10 text-primary' },
  FEEDBACK_POSTED: { icon: MessageSquareQuote, className: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
  PRIVATE_MESSAGE: { icon: MessageCircle, className: 'bg-sky-500/15 text-sky-600 dark:text-sky-400' },
  GROUP_MESSAGE: { icon: Users, className: 'bg-violet-500/15 text-violet-600 dark:text-violet-400' },
  SCHOOL_ANNOUNCEMENT: { icon: Megaphone, className: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' },
  LIVE_SESSION_NEW: { icon: Video, className: 'bg-rose-500/15 text-rose-600 dark:text-rose-400' },
  ATTENDANCE_FINALIZED: { icon: CalendarCheck, className: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
  ATTENDANCE_CORRECTION: { icon: CalendarClock, className: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' },
  SAMPLEQ_NEW: { icon: BookOpen, className: 'bg-sky-500/15 text-sky-600 dark:text-sky-400' },
}

/** صفحه اعلان‌ها — نمایش اعلان‌های تکلیف جدید و ثبت بازخورد */
export function NotificationsClient() {
  const router = useRouter()
  const [items, setItems] = useState<NotificationItem[] | null>(null)
  const [unread, setUnread] = useState(0)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/notifications', { cache: 'no-store' })
      if (!r.ok) return
      const d = await r.json()
      setItems(d.items ?? [])
      setUnread(d.unreadCount ?? 0)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const markAll = async () => {
    setBusy(true)
    try {
      await fetch('/api/notifications/read', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ all: true }),
      })
      await load()
    } finally {
      setBusy(false)
    }
  }

  const open = async (n: NotificationItem) => {
    if (!n.readAt) {
      fetch('/api/notifications/read', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: [n.id] }),
      }).catch(() => null)
    }
    router.push(n.link ?? '/')
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-5">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-lg font-bold">اعلان‌ها</h1>
        {unread > 0 && (
          <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-bold text-red-600 dark:text-red-400">
            {new Intl.NumberFormat('fa-IR').format(unread)} نخوانده
          </span>
        )}
        <div className="flex-1" />
        {unread > 0 && (
          <Button variant="outline" size="sm" onClick={markAll} disabled={busy}>
            <CheckCheck className="h-4 w-4" />
            خواندن همه
          </Button>
        )}
      </div>

      {items === null ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border bg-card py-14 text-center">
          <BellOff className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">هنوز اعلانی ندارید</p>
          <p className="max-w-xs text-xs text-muted-foreground/70">
            اعلان پیام جدید، تکلیف، بازخورد معلم، کلاس آنلاین و اطلاعیه مدرسه در اینجا نمایش داده می‌شود
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((n) => {
            const meta = TYPE_META[n.type] ?? TYPE_META.ASSIGNMENT_NEW
            const Icon = meta.icon
            return (
              <li key={n.id}>
                <button
                  onClick={() => open(n)}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-xl border bg-card p-3.5 text-right transition-colors hover:bg-accent/50',
                    !n.readAt && 'border-primary/30 bg-primary/5',
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                      meta.className,
                    )}
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-bold">{n.title}</span>
                      {!n.readAt && (
                        <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="نخوانده" />
                      )}
                    </span>
                    {n.body && (
                      <span className="mt-0.5 block text-xs text-muted-foreground">{n.body}</span>
                    )}
                    <span className="mt-1 block text-[11px] text-muted-foreground/70">
                      {chatTime(n.createdAt)}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
