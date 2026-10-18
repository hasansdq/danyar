'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { navigateAfterDialogClose } from '@/lib/dialog-history'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getSocket } from '@/components/messenger/socket-client'
import { ModuleBlocked } from '@/components/live/module-blocked'
import { toast } from 'sonner'
import {
  Video,
  LogIn,
  Users,
  Ban,
  Clock,
} from 'lucide-react'
import { faNum, faDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'

interface ClassroomInfo {
  id: string
  name: string
  /** سقف مؤثر این کلاس — ظرفیت اختصاصی پنل مدیر کل یا سقف سراسری */
  capacity?: number
  groups: { id: string; name: string; archived: boolean }[]
  activeSession: {
    id: string
    title: string
    startedAt: string
    /** اعلام رسمی شروع — null یعنی استریم معلم هنوز آماده نشده */
    announcedAt?: string | null
  } | null
}

interface StudentClassroom {
  id: string
  name: string
  activeSession: {
    id: string
    title: string
    hostName: string
    startedAt: string
    /** فقط جلسات اعلام‌شده دعوت پاپ‌آپ دارند */
    announcedAt?: string | null
  } | null
}

interface AdminActiveSession {
  id: string
  title: string
  classroomName: string
  hostName: string
  startedAt: string
  onlineCount: number
}

/**
 * صفحه «کلاس آنلاین» — نمای نقش‌محور:
 * معلم (سوییچ «شروع کلاس» برای هر کلاس مجاز + ورود به جلسه فعال)،
 * دانش‌آموز (ورود به جلسه فعال)، مدیر مدرسه (جلسات فعال مدرسه + ورود/پایان‌دادن)
 */
export function LiveClient({ role, fullName }: { role: string; fullName: string }) {
  const [loading, setLoading] = useState(true)
  const [teacherClasses, setTeacherClasses] = useState<ClassroomInfo[]>([])
  const [studentClasses, setStudentClasses] = useState<StudentClassroom[]>([])
  const [adminSessions, setAdminSessions] = useState<AdminActiveSession[]>([])
  const [maxParticipants, setMaxParticipants] = useState(32)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogClass, setDialogClass] = useState<ClassroomInfo | null>(null)
  const [title, setTitle] = useState('')
  const [notifyGroup, setNotifyGroup] = useState('')
  const [creating, setCreating] = useState(false)
  const [ending, setEnding] = useState<string | null>(null)
  // ماژول استریم این مدرسه خاموش است → نمایش پیام رسمی پشتیبانی به‌جای فهرست
  const [moduleDisabled, setModuleDisabled] = useState(false)
  // تأیید خاموش‌کردن سوییچ «شروع کلاس» — کلاس انتخاب‌شده برای پایان جلسه
  const [confirmEndClass, setConfirmEndClass] = useState<ClassroomInfo | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const router = useRouter()

  const load = useCallback(async () => {
    if (moduleDisabled) return
    try {
      const r = await fetch('/api/live-sessions')
      if (!r.ok) {
        // گیت ماژول مدرسه — پیام رسمی پشتیبانی نمایش داده می‌شود
        if (r.status === 403) setModuleDisabled(true)
        setLoading(false)
        return
      }
      const d = await r.json()
      if (role === 'TEACHER') {
        setTeacherClasses(d.classrooms ?? [])
        setMaxParticipants(d.maxParticipants ?? 32)
      } else if (role === 'STUDENT') {
        setStudentClasses(d.classrooms ?? [])
      } else {
        setAdminSessions(d.activeSessions ?? [])
        setMaxParticipants(d.maxParticipants ?? 32)
      }
    } finally {
      setLoading(false)
    }
  }, [role, moduleDisabled])

  useEffect(() => {
    load()
    // به‌روزرسانی بلادرنگ + پایش دوره‌ای (برای اطمینان از نمایش وضعیت فعلی جلسات)
    const socket = getSocket()
    const onChange = () => load()
    socket.on('live:list-changed', onChange)
    socket.on('live:session-status', onChange)
    timerRef.current = setInterval(load, 15000)
    return () => {
      socket.off('live:list-changed', onChange)
      socket.off('live:session-status', onChange)
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [load])

  function openCreateDialog(c: ClassroomInfo) {
    const groups = c.groups.filter((g) => !g.archived)
    if (!groups.length) {
      toast.error('این کلاس گروه درسی فعالی ندارد؛ ابتدا گروه بسازید')
      return
    }
    setDialogClass(c)
    setTitle('')
    setNotifyGroup(groups[0].id)
    setDialogOpen(true)
  }

  async function createSession() {
    if (!dialogClass) return
    const t = title.trim()
    if (!t) {
      toast.error('عنوان جلسه را وارد کنید')
      return
    }
    if (!notifyGroup) {
      toast.error('گروه اطلاع‌رسانی را انتخاب کنید')
      return
    }
    setCreating(true)
    try {
      const r = await fetch('/api/live-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          classroomId: dialogClass.id,
          notifyGroupId: notifyGroup,
          title: t,
        }),
      })
      const d = await r.json()
      if (!r.ok) {
        toast.error(d.error ?? 'خطا در شروع جلسه')
        return
      }
      if (d.reused) {
        // جلسه فعال این کلاس از قبل در جریان است — بدون خطا وارد همان جلسه می‌شویم
        toast('جلسه فعال این کلاس در جریان است؛ وارد جلسه شدید')
      } else {
        toast.success('جلسه ساخته شد؛ پس از آماده‌شدن استریم، اعلان شروع کلاس ارسال می‌شود')
      }
      setDialogOpen(false)
      // ناوبری پس از پاک‌سازی history دیالوگ — دکمه «شروع کلاس و ورود به اتاق» واقعاً وارد اتاق می‌شود
      navigateAfterDialogClose(() => router.push(`/live/${d.id}`))
    } finally {
      setCreating(false)
    }
  }

  async function endSession(id: string) {
    setEnding(id)
    try {
      const r = await fetch(`/api/live-sessions/${id}/end`, { method: 'POST' })
      const d = await r.json()
      if (!r.ok) {
        toast.error(d.error ?? 'خطا در پایان جلسه')
        return
      }
      toast.success('جلسه و استریم پایان یافت؛ سوییچ «شروع کلاس» خاموش شد')
      setConfirmEndClass(null)
      load()
    } finally {
      setEnding(null)
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto w-full">
      <div className="flex items-center gap-2.5 mb-1">
        <span className="h-10 w-10 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
          <Video className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-lg font-bold leading-tight">کلاس آنلاین</h1>
          <p className="text-xs text-muted-foreground">
            {role === 'TEACHER' && 'با سوییچ «شروع کلاس» جلسه هر کلاس مجاز خود را آغاز کنید — پس از ورود به اتاق و انتشار حداقل یک رسانه، سوییچ شروع کلاس فعال و اعلان برای دانش‌آموزان ارسال می‌شود'}
            {role === 'STUDENT' && 'جلسه فعال کلاس‌های خود را از همین‌جا وارد شوید'}
            {(role === 'SCHOOL_ADMIN' || role === 'SCHOOL_VICE') && 'جلسات فعال مدرسه شما — امکان ورود یا پایان‌دادن'}
          </p>
        </div>
      </div>

      {moduleDisabled ? (
        <ModuleBlocked />
      ) : loading ? (
        <div className="space-y-3 mt-5">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : role === 'TEACHER' ? (
        <TeacherView
          classes={teacherClasses}
          maxParticipants={maxParticipants}
          onToggle={(c, on) => (on ? openCreateDialog(c) : setConfirmEndClass(c))}
          endingId={ending}
        />
      ) : role === 'STUDENT' ? (
        <StudentView classes={studentClasses} />
      ) : (
        <AdminView sessions={adminSessions} ending={ending} onEnd={endSession} />
      )}

      {/* دیالوگ شروع کلاس (باز‌شونده با روشن‌کردن سوییچ) */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>شروع کلاس آنلاین — کلاس {dialogClass?.name}</DialogTitle>
            <DialogDescription>
              با ثبت، جلسه فعال و وارد اتاق می‌شوید؛ ورود بدون دوربین و میکروفون هم ممکن است.
              پس از ورود، با روشن‌کردن میکروفون، دوربین یا اشتراک صفحه، سوییچ «شروع کلاس» فعال
              می‌شود و با روشن‌کردن آن، اعلان شروع بلادرنگ برای دانش‌آموزان ارسال می‌شود.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="live-title">عنوان جلسه</Label>
              <Input
                id="live-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="مثلاً: رفع اشکال فصل ۳ ریاضی"
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <Label>گروه اطلاع‌رسانی (پیام دعوت در این گروه منتشر می‌شود)</Label>
              <Select value={notifyGroup} onValueChange={setNotifyGroup}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="انتخاب گروه" />
                </SelectTrigger>
                <SelectContent>
                  {(dialogClass?.groups ?? [])
                    .filter((g) => !g.archived)
                    .map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-[11px] text-muted-foreground leading-5">
              جلسه متعلق به کل کلاس است و همه دانش‌آموزان ثبت‌نام‌شده کلاس می‌توانند وارد
              شوند؛ ظرفیت این کلاس حداکثر {faNum(String(dialogClass?.capacity ?? maxParticipants))} شرکت‌کننده است.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              انصراف
            </Button>
            <Button onClick={createSession} disabled={creating}>
              {creating ? 'در حال شروع…' : 'شروع کلاس و ورود به اتاق'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* تأیید خاموش‌کردن سوییچ «شروع کلاس» */}
      <AlertDialog
        open={!!confirmEndClass}
        onOpenChange={(o) => !o && setConfirmEndClass(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>خاموش‌کردن سوییچ «شروع کلاس»؟</AlertDialogTitle>
            <AlertDialogDescription>
              با تأیید، جلسه آنلاین و استریم کلاس «{confirmEndClass?.name}» برای همه
              پایان می‌یابد و دعوت‌های فعال به «کلاس پایان یافته» تغییر می‌کند. این
              عمل بازگشت‌پذیر نیست.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>انصراف</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmEndClass && endSession(confirmEndClass.activeSession!.id)}
              disabled={!!confirmEndClass && ending === confirmEndClass.activeSession?.id}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {ending && confirmEndClass && ending === confirmEndClass.activeSession?.id
                ? 'در حال پایان…'
                : 'پایان جلسه و خاموشی سوییچ'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function TeacherView({
  classes,
  maxParticipants,
  onToggle,
  endingId,
}: {
  classes: ClassroomInfo[]
  maxParticipants: number
  /** روشن‌کردن سوییچ → دیالوگ شروع؛ خاموش‌کردن → تأیید پایان جلسه */
  onToggle: (c: ClassroomInfo, on: boolean) => void
  endingId: string | null
}) {
  if (!classes.length) {
    return (
      <EmptyState text="هنوز به هیچ کلاسی اختصاص ندارید؛ پس از انتساب گروه درسی، از این‌جا جلسه برگزار کنید" />
    )
  }
  return (
    <div className="space-y-3 mt-5">
      {classes.map((c) => {
        const active = !!c.activeSession
        const busy = endingId === c.activeSession?.id
        return (
          <div
            key={c.id}
            className="rounded-xl border bg-card p-4 flex items-center gap-3 flex-wrap"
          >
            <div className="min-w-0 flex-1">
              <div className="font-bold text-sm">{c.name}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {c.activeSession ? (
                  <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                    {c.activeSession.announcedAt
                      ? `کلاس شروع شده: ${c.activeSession.title} — اعلان برای دانش‌آموزان ارسال شد`
                      : `جلسه فعال: ${c.activeSession.title} — سوییچ شروع کلاس در اتاق پس از انتشار رسانه فعال می‌شود`}
                  </span>
                ) : (
                  <span>جلسه فعالی وجود ندارد — ظرفیت این کلاس: تا {faNum(String(c.capacity ?? maxParticipants))} نفر</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              {/* سوییچ «شروع کلاس» — وضعیت از سرور خوانده می‌شود و با تازه‌سازی صفحه نمی‌پرد */}
              <span className="flex items-center gap-2">
                <Switch
                  checked={active}
                  disabled={busy}
                  onCheckedChange={(v) => onToggle(c, v)}
                  aria-label={`سوییچ شروع کلاس ${c.name}`}
                />
                <span
                  className={cn(
                    'text-xs font-bold select-none',
                    active
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-muted-foreground',
                  )}
                >
                  {busy ? 'در حال پایان…' : 'شروع کلاس'}
                </span>
              </span>
              {c.activeSession && (
                <Link
                  href={`/live/${c.activeSession.id}`}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white hover:opacity-90"
                >
                  <LogIn className="h-4 w-4" />
                  ورود به جلسه
                </Link>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function StudentView({ classes }: { classes: StudentClassroom[] }) {
  if (!classes.length) {
    return <EmptyState text="شما در هیچ کلاسی ثبت‌نام نکرده‌اید" />
  }
  const anyActive = classes.some((c) => c.activeSession)
  return (
    <div className="space-y-3 mt-5">
      {!anyActive && (
        <div className="rounded-xl border border-dashed bg-card/50 p-5 text-center text-sm text-muted-foreground">
          در حال حاضر هیچ کلاس آنلاین فعالی وجود ندارد؛ به‌محض شروع جلسه توسط معلم،
          این‌جا و در گروه درسی پیام دعوت نمایش داده می‌شود.
        </div>
      )}
      {classes.map((c) => {
        const s = c.activeSession
        // جلسه اعلام‌نشده یعنی استریم معلم هنوز آماده نشده — مثل «نداشتن جلسه فعال» رندر می‌شود
        const ready = !!s?.announcedAt
        return (
          <div key={c.id} className="rounded-xl border bg-card p-4 flex items-center gap-3 flex-wrap">
            <div className="min-w-0 flex-1">
              <div className="font-bold text-sm">{c.name}</div>
              {s && ready ? (
                <div className="text-xs mt-1 space-y-0.5">
                  <div className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                    جلسه فعال: {s.title}
                  </div>
                  <div className="text-muted-foreground">
                    معلم: {s.hostName} — شروع: {faDateTime(s.startedAt)}
                  </div>
                </div>
              ) : s && !ready ? (
                <div className="text-xs mt-1 inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-medium">
                  <Clock className="h-3.5 w-3.5" />
                  جلسه در حال آماده‌سازی است؛ به‌محض آماده‌شدن استریم معلم، دکمه ورود فعال می‌شود
                </div>
              ) : (
                <div className="text-xs text-muted-foreground mt-1">جلسه فعالی وجود ندارد</div>
              )}
            </div>
            {s && ready && (
              <Link
                href={`/live/${s.id}`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white hover:opacity-90"
              >
                <LogIn className="h-4 w-4" />
                ورود به کلاس
              </Link>
            )}
          </div>
        )
      })}
    </div>
  )
}

function AdminView({
  sessions,
  ending,
  onEnd,
}: {
  sessions: AdminActiveSession[]
  ending: string | null
  onEnd: (id: string) => void
}) {
  if (!sessions.length) {
    return <EmptyState text="در حال حاضر جلسه فعالی در مدرسه شما برگزار نشده است" />
  }
  return (
    <div className="space-y-3 mt-5">
      {sessions.map((s) => (
        <div key={s.id} className="rounded-xl border bg-card p-4 flex items-center gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="font-bold text-sm flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
              {s.title}
            </div>
            <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
              <div>کلاس: {s.classroomName} — معلم: {s.hostName}</div>
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {faDateTime(s.startedAt)}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  {faNum(String(s.onlineCount))} حاضر
                </span>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Link
              href={`/live/${s.id}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:opacity-90"
            >
              <LogIn className="h-4 w-4" />
              ورود به جلسه
            </Link>
            <Button
              size="sm"
              variant="destructive"
              disabled={ending === s.id}
              onClick={() => onEnd(s.id)}
            >
              <Ban className="h-4 w-4" />
              {ending === s.id ? 'در حال پایان…' : 'پایان جلسه'}
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed bg-card/50 p-8 mt-5 text-center">
      <Video className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  )
}
