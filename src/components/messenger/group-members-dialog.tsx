'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Loader2,
  Info,
  Users,
  Settings2,
  MessageCircle,
  ShieldAlert,
  UserPlus,
  X,
  Search,
} from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { faNum } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { GroupMembersData, GroupMember, MemberCandidate } from './types'

function MemberRow({
  m,
  meId,
  onOpenDm,
  canRemove,
  onRemove,
}: {
  m: GroupMember
  meId: string
  onOpenDm: (userId: string) => void
  canRemove: boolean
  onRemove: (m: GroupMember) => void
}) {
  const isMe = m.id === meId
  const clickable = m.canDm && !isMe

  const inner = (
    <>
      <Avatar className="h-9 w-9 shrink-0">
        {m.avatarUrl && <AvatarImage src={m.avatarUrl} alt={m.fullName} />}
        <AvatarFallback
          className={cn(
            'text-sm font-bold',
            m.role === 'TEACHER'
              ? 'bg-primary/10 text-primary'
              : m.role === 'SCHOOL_ADMIN'
                ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                : 'bg-emerald-600/10 text-emerald-700 dark:text-emerald-400',
          )}
        >
          {m.fullName.trim().charAt(0)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{m.fullName}{isMe ? ' (شما)' : ''}</div>
        <div className="text-[11px] text-muted-foreground">
          {m.label}
          {m.status === 'ADDED' && (
            <span className="mr-1.5 rounded-full bg-sky-500/10 px-1.5 py-px text-[10px] text-sky-600 dark:text-sky-400">
              افزوده‌شده
            </span>
          )}
        </div>
      </div>
      {canRemove ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onRemove(m)
          }}
          className="shrink-0 rounded-full p-1.5 text-muted-foreground/70 transition-colors hover:bg-destructive/10 hover:text-destructive"
          title={`حذف ${m.fullName} از گروه`}
          aria-label={`حذف ${m.fullName} از گروه`}
        >
          <X className="h-4 w-4" />
        </button>
      ) : isMe ? (
        <span className="text-[10.5px] text-muted-foreground shrink-0">خودم</span>
      ) : clickable ? (
        <MessageCircle className="h-4 w-4 shrink-0 text-muted-foreground/60" />
      ) : (
        <ShieldAlert
          className="h-4 w-4 shrink-0 text-muted-foreground/40"
          aria-label="گفتگوی خصوصی با این عضو فعال نیست"
        />
      )}
    </>
  )

  if (!clickable) {
    return (
      <div
        className="flex items-center gap-3 px-2 py-2 rounded-lg opacity-90"
        title={isMe ? 'حساب خودتان' : 'گفتگوی خصوصی با این عضو مجاز نیست'}
      >
        {inner}
      </div>
    )
  }

  return (
    <button
      onClick={() => onOpenDm(m.id)}
      className="w-full text-right flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-accent transition-colors"
      title={`گفتگوی خصوصی با ${m.fullName}`}
    >
      {inner}
    </button>
  )
}

function Section({
  title,
  items,
  meId,
  onOpenDm,
  canRemove,
  onRemove,
}: {
  title: string
  items: GroupMember[]
  meId: string
  onOpenDm: (userId: string) => void
  canRemove: boolean
  onRemove: (m: GroupMember) => void
}) {
  if (items.length === 0) return null
  return (
    <div>
      <p className="text-[11px] font-bold text-muted-foreground px-2 pt-2 pb-1">
        {title} — {faNum(items.length)}
      </p>
      <div className="space-y-0.5">
        {items.map((m) => (
          <MemberRow
            key={m.id}
            m={m}
            meId={meId}
            onOpenDm={onOpenDm}
            canRemove={canRemove}
            onRemove={onRemove}
          />
        ))}
      </div>
    </div>
  )
}

/** دیالوگ جست‌وجو و افزودن عضو (دانش‌آموز برای معلم/مدیر؛ معلم فقط برای مدیر) */
function AddMemberDialog({
  open,
  onOpenChange,
  groupId,
  canEditTeachers,
  onAdded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  groupId: string
  canEditTeachers: boolean
  onAdded: () => void
}) {
  const [role, setRole] = useState<'STUDENT' | 'TEACHER'>('STUDENT')
  const [q, setQ] = useState('')
  const [items, setItems] = useState<MemberCandidate[]>([])
  const [loading, setLoading] = useState(false)
  const [addingId, setAddingId] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const search = useCallback(
    async (query: string, targetRole: 'STUDENT' | 'TEACHER') => {
      setLoading(true)
      try {
        const res = await fetch(`/api/chats/group/${groupId}/members`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ q: query, role: targetRole }),
        })
        const data = await res.json().catch(() => null)
        if (res.ok && data?.candidates) {
          setItems(data.candidates as MemberCandidate[])
        } else {
          setItems([])
          if (!res.ok && data?.error) toast.error(data.error)
        }
      } finally {
        setLoading(false)
      }
    },
    [groupId],
  )

  useEffect(() => {
    if (!open) return
    // جست‌وجوی زنده با تأخیر تایپ
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      search(q.trim(), role)
    }, 250)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [open, q, role, search])

  const add = async (c: MemberCandidate) => {
    setAddingId(c.id)
    try {
      const res = await fetch(`/api/chats/group/${groupId}/members`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ adds: [c.id] }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(data?.error ?? 'افزودن عضو ناموفق بود')
        return
      }
      toast.success(`${c.fullName} به گروه افزوده شد`)
      setItems((prev) => prev.filter((x) => x.id !== c.id))
      onAdded()
    } finally {
      setAddingId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <UserPlus className="h-4.5 w-4.5 text-primary" />
            افزودن عضو به گروه
          </DialogTitle>
          <DialogDescription>
            {role === 'TEACHER'
              ? 'معلم انتخابی به عضویت گروه درمی‌آید'
              : 'دانش‌آموز انتخابی به عضویت گروه درمی‌آید'}
          </DialogDescription>
        </DialogHeader>

        {canEditTeachers && (
          <div className="flex gap-1.5">
            <Button
              type="button"
              size="sm"
              variant={role === 'STUDENT' ? 'default' : 'outline'}
              onClick={() => setRole('STUDENT')}
            >
              دانش‌آموز
            </Button>
            <Button
              type="button"
              size="sm"
              variant={role === 'TEACHER' ? 'default' : 'outline'}
              onClick={() => setRole('TEACHER')}
            >
              معلم
            </Button>
          </div>
        )}

        <div className="relative">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="جست‌وجوی نام یا نام کاربری…"
            className="pr-9"
            aria-label="جست‌وجوی عضو"
          />
        </div>

        <div className="max-h-72 overflow-y-auto space-y-0.5 min-h-16">
          {loading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <p className="text-[12.5px] text-muted-foreground text-center py-6">
              {q.trim() ? 'کاربری یافت نشد' : 'نامی را برای جست‌وجو بنویسید'}
            </p>
          ) : (
            items.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-accent/60"
              >
                <Avatar className="h-8 w-8 shrink-0">
                  <AvatarFallback className="text-xs font-bold bg-primary/10 text-primary">
                    {c.fullName.trim().charAt(0)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{c.fullName}</div>
                  <div className="text-[11px] text-muted-foreground">{c.label}</div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1 h-8 shrink-0"
                  disabled={addingId === c.id}
                  onClick={() => add(c)}
                >
                  {addingId === c.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <UserPlus className="h-3.5 w-3.5" />
                  )}
                  افزودن
                </Button>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface GroupMembersDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  groupId: string
  meId: string
  /** باز کردن دیالوگ تنظیمات گروه از همین‌جا (برای مدیر/معلم) */
  onOpenSettings?: () => void
}

/**
 * اعضای گروه — با کلیک روی نام هر عضو (در صورت مجازبودن ماتریس گفتگوی
 * خصوصی) چت خصوصی باز می‌شود.
 * مدیریت اعضا: معلم دانش‌آموزان را حذف/افزوده می‌کند؛ مدیر مدرسه معلمان را
 * هم — در گروه درسی و گروه‌های عمومی مدرسه.
 */
export function GroupMembersDialog({
  open,
  onOpenChange,
  groupId,
  meId,
  onOpenSettings,
}: GroupMembersDialogProps) {
  const router = useRouter()
  const [data, setData] = useState<GroupMembersData | null>(null)
  const [loading, setLoading] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<GroupMember | null>(null)
  const [removing, setRemoving] = useState(false)
  const [addOpen, setAddOpen] = useState(false)

  const load = useCallback(async () => {
    if (!groupId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/chats/group/${groupId}/members`, {
        cache: 'no-store',
      })
      if (res.ok) setData(await res.json())
    } finally {
      setLoading(false)
    }
  }, [groupId])

  useEffect(() => {
    if (!open || !groupId) return
    setData(null)
    load()
  }, [open, groupId, load])

  const openDm = (userId: string) => {
    onOpenChange(false)
    router.push(`/chats/dm/${userId}`)
  }

  const confirmRemove = async () => {
    if (!removeTarget) return
    setRemoving(true)
    try {
      const res = await fetch(`/api/chats/group/${groupId}/members`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ removes: [removeTarget.id] }),
      })
      const d = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(d?.error ?? 'حذف عضو ناموفق بود')
        return
      }
      toast.success(`${removeTarget.fullName} از گروه حذف شد`)
      setRemoveTarget(null)
      await load()
    } finally {
      setRemoving(false)
    }
  }

  const canRemoveStudent = !!data?.canEditStudents
  const canRemoveTeacher = !!data?.canEditTeachers
  const canAdd = !!data && (data.canEditStudents || data.canEditTeachers) && !data.group.archived

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md max-h-[85dvh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Users className="h-4.5 w-4.5 text-primary" />
              {data ? data.group.name : 'اعضای گروه'}
            </DialogTitle>
            <DialogDescription>
              {data
                ? `${data.group.className} — روی نام هر عضو کلیک کنید تا گفتگوی خصوصی باز شود`
                : 'در حال دریافت اعضا…'}
            </DialogDescription>
          </DialogHeader>

          {loading && !data ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !data ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              اعضا دریافت نشد — دوباره تلاش کنید
            </p>
          ) : (
            <div className="space-y-1">
              {/* یادآوری محدودیت چت خصوصی بین دانش‌آموزان */}
              {data.isStudentViewer && !data.studentDmAllowed && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-[11.5px] text-amber-700 dark:text-amber-400">
                  <Info className="h-4 w-4 shrink-0 mt-0.5" />
                  گفتگوی خصوصی بین دانش‌آموزان توسط مدیر مدرسه فعال نشده است؛ فقط با
                  معلمان و مدیریت می‌توانید گفتگو کنید.
                </div>
              )}

              {canAdd && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-2"
                  onClick={() => setAddOpen(true)}
                >
                  <UserPlus className="h-4 w-4" />
                  افزودن عضو
                </Button>
              )}

              <Section
                title="معلمان"
                items={data.members.teachers}
                meId={meId}
                onOpenDm={openDm}
                canRemove={canRemoveTeacher}
                onRemove={setRemoveTarget}
              />
              <Section
                title="دانش‌آموزان"
                items={data.members.students}
                meId={meId}
                onOpenDm={openDm}
                canRemove={canRemoveStudent}
                onRemove={setRemoveTarget}
              />
              <Section
                title="مدیریت مدرسه"
                items={data.members.admins}
                meId={meId}
                onOpenDm={openDm}
                canRemove={false}
                onRemove={setRemoveTarget}
              />

              {data.canManage && onOpenSettings && (
                <Button
                  variant="outline"
                  className="w-full mt-2 gap-2"
                  onClick={() => {
                    onOpenChange(false)
                    onOpenSettings()
                  }}
                >
                  <Settings2 className="h-4 w-4" />
                  تنظیمات گروه
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* تأیید حذف عضو */}
      <AlertDialog open={!!removeTarget} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف از گروه</AlertDialogTitle>
            <AlertDialogDescription>
              «{removeTarget?.fullName}» از این گروه حذف می‌شود و دیگر به پیام‌های آن
              دسترسی نخواهد داشت. مطمئن هستید؟
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>انصراف</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRemove}
              disabled={removing}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {removing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              حذف از گروه
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* افزودن عضو */}
      {data && (
        <AddMemberDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          groupId={groupId}
          canEditTeachers={data.canEditTeachers}
          onAdded={load}
        />
      )}
    </>
  )
}
