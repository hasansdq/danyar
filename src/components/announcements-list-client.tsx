'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  Megaphone,
  Send,
  Trash2,
  User,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ModirSectionSubNav } from '@/components/modir/section-subnav'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { toast } from '@/hooks/use-toast'
import { faDateTime, faNum } from '@/lib/format'

interface AnnTarget {
  messageId: string
  groupId: string
  groupName: string
  classroomName: string | null
  archived: boolean
}

interface AnnEvent {
  id: string
  body: string
  createdAt: string
  senderName: string
  targets: AnnTarget[]
}

/**
 * لیست اطلاعیه‌های اخیر و مدیریت آنها (درخواست کاربر: با کلیک روی آیکون تنظیمات
 * باکس اطلاعیه‌ها در هاب مدیریت مدرسه به این صفحه می‌رسیم). هر اطلاعیه همهٔ
 * گروه‌های هدفش را نشان می‌دهد و با حذف، از همهٔ گفتگوها یکجا برداشته می‌شود.
 */
export function AnnouncementsListClient() {
  const [announcements, setAnnouncements] = useState<AnnEvent[] | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/announcements/list', { cache: 'no-store' })
      if (res.ok) {
        const d = await res.json()
        setAnnouncements(d.announcements ?? [])
      } else {
        setAnnouncements([])
      }
    } catch {
      setAnnouncements([])
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function deleteAnnouncement(ev: AnnEvent) {
    if (deletingId) return
    setDeletingId(ev.id)
    try {
      const res = await fetch(`/api/announcements/list?id=${encodeURIComponent(ev.id)}`, {
        method: 'DELETE',
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        toast({ title: data?.error ?? 'حذف ناموفق بود', variant: 'destructive' })
        return
      }
      toast({
        title: 'اطلاعیه حذف شد',
        description: `از ${faNum(data?.deleted ?? 1)} گروه برداشته شد`,
      })
      await load()
    } catch {
      toast({ title: 'خطا در برقراری ارتباط با سرور', variant: 'destructive' })
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-3 py-5 sm:px-4 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Megaphone className="h-5.5 w-5.5 text-primary" />
            اطلاعیه‌های اخیر
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            لیست اطلاعیه‌های ارسال‌شدهٔ مدرسه — گروه‌های تحویل، فرستنده و حذف یکجا
          </p>
        </div>
        <Button asChild size="sm" className="gap-1.5 shrink-0" data-testid="send-announcement-link">
          <a href="/modir/announcements/add">
            <Send className="h-4 w-4 -scale-x-100" />
            اطلاعیه جدید
          </a>
        </Button>
      </div>

      <ModirSectionSubNav
        active="list"
        listHref="/modir/announcements"
        addHref="/modir/announcements/add"
        listLabel="اطلاعیه‌های اخیر"
        addLabel="ارسال اطلاعیه"
      />

      {announcements === null ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : announcements.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center space-y-2">
            <Megaphone className="mx-auto h-9 w-9 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              هنوز اطلاعیه‌ای ارسال نشده است.
            </p>
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <a href="/modir/announcements/add">
                <Send className="h-4 w-4 -scale-x-100" />
                ارسال اولین اطلاعیه
              </a>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {announcements.map((ev) => {
            const isOpen = expanded.has(ev.id)
            return (
              <Card key={ev.id} data-testid="announcement-card">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-sm leading-relaxed font-medium min-w-0">
                      <span className={isOpen ? '' : 'line-clamp-2'}>{ev.body}</span>
                    </CardTitle>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="حذف اطلاعیه"
                          title="حذف اطلاعیه (از همهٔ گروه‌ها)"
                          disabled={deletingId === ev.id}
                          className="shrink-0"
                        >
                          {deletingId === ev.id ? (
                            <Loader2 className="h-4.5 w-4.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-4.5 w-4.5 text-destructive" />
                          )}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>حذف این اطلاعیه؟</AlertDialogTitle>
                          <AlertDialogDescription>
                            اطلاعیه از همهٔ {faNum(ev.targets.length)} گروه تحویل حذف می‌شود و
                            اعضا دیگر آن را نمی‌بینند. این عمل قابل بازگشت نیست.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>انصراف</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => deleteAnnouncement(ev)}
                            className="bg-destructive text-white hover:bg-destructive/90"
                          >
                            حذف قطعی
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                  <CardDescription className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
                    <span className="flex items-center gap-1">
                      <User className="h-3 w-3" />
                      {ev.senderName}
                    </span>
                    <span className="font-mono">{faDateTime(ev.createdAt)}</span>
                    <Badge variant="secondary" className="text-[10px]">
                      {faNum(ev.targets.length)} گروه
                    </Badge>
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    {ev.targets.map((t) => (
                      <Link
                        key={t.messageId}
                        href={`/chats/group/${t.groupId}`}
                        title={t.classroomName ? `کلاس ${t.classroomName}` : 'گروه مدرسه'}
                        className={
                          t.archived
                            ? 'text-xs rounded-full border border-dashed px-2.5 py-1 text-muted-foreground'
                            : 'text-xs rounded-full border px-2.5 py-1 transition-colors hover:bg-accent'
                        }
                      >
                        {t.groupName}
                        {t.archived ? ' (بایگانی)' : ''}
                      </Link>
                    ))}
                  </div>
                  {ev.body.length > 120 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 text-xs text-muted-foreground"
                      onClick={() => toggleExpanded(ev.id)}
                    >
                      {isOpen ? (
                        <>
                          <ChevronUp className="h-3.5 w-3.5" />
                          نمایش کمتر
                        </>
                      ) : (
                        <>
                          <ChevronDown className="h-3.5 w-3.5" />
                          نمایش کامل
                        </>
                      )}
                    </Button>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
