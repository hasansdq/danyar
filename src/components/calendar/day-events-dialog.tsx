'use client'

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { toast as sonnerToast } from 'sonner'
import {
  BookOpen,
  CalendarCheck2,
  Loader2,
  Paperclip,
  School,
  Trash2,
  X,
  CalendarDays,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatJalaliDate } from '@/lib/jalali'
import {
  EVENT_TYPE_META,
  EVENT_TYPE_ORDER,
  eventDisplayLabel,
} from '@/components/calendar/event-meta'
import type { ClassEventType } from '@/lib/calendar-events'
import { parseDateKey } from '@/lib/jalali'
import { toGregorian } from 'jalaali-js'
import {
  faBytes,
  uploadAssignmentFile,
  type GroupMeta,
  type StagedFile,
} from '@/components/assignments/shared'
import { ANSWER_MODES, ANSWER_MODE_LABELS, type AnswerMode } from '@/lib/assignment-status'
import { DayAttendanceDialog } from '@/components/calendar/day-attendance-dialog'

/** شکل رویداد برگشتی از API (هم‌سان با CalendarEventDto) */
export interface CalendarEventDto {
  id: string
  dateKey: string
  type: string
  customTitle: string | null
  description: string
  scope: 'CLASS' | 'SCHOOL'
  classroomId: string | null
  createdById: string
  creatorName: string
  createdAt: string
  /** تکلیف درسی مرتبط — فقط نوع HOMEWORK ثبت‌شده از تقویم */
  assignmentId: string | null
  assignmentTitle: string | null
}

interface DayEventsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  dateKey: string | null
  events: CalendarEventDto[]
  /** SCHOOL_ADMIN | TEACHER | STUDENT */
  role: string
  uid: string
  classId: string
  className: string
  onChanged: () => void
  /** توکن «بازکردن خودکار ویرایشگر ثبت غیبت/نمره/تخلف» (دیپ‌لینک FAB معلم) —
   *  هر مقدار فقط یک بار مصرف می‌شود؛ توکن تازه = بازشدن دوباره */
  autoOpenAttendance?: string
}

/**
 * دیالوگ روز تقویم آموزشی:
 * - همه نقش‌ها: مشاهده رویدادها و توضیحات ثبت‌شده توسط معلم/مدیر
 * - معلم و مدیر مدرسه: ثبت رویداد جدید (تعطیل فقط مدیر + انتخاب دامنه کلاس/کل مدرسه)
 * - تکلیف: بخش تکالیف قدیمی به این‌جا منتقل شد — معلم با انتخاب نوع «تکلیف» هم‌زمان
 *   تکلیف درسی (گروه درسی، مهلت، نمره، پیوست) می‌سازد و رویداد تقویم به آن وصل می‌شود
 * - حضور و غیاب و تخلفات: دکمه «ثبت غیبت/نمره/تخلف» برای معلم و مدیر (لیست دانش‌آموزان کلاس)
 * - حذف: مدیر هر رویداد مدرسه خودش، معلم فقط رویدادهای ثبت‌شده خودش
 */
export function DayEventsDialog({
  open,
  onOpenChange,
  dateKey,
  events,
  role,
  uid,
  classId,
  className,
  onChanged,
  autoOpenAttendance,
}: DayEventsDialogProps) {
  // از sonner استفاده می‌کنیم (نه توست radix) تا لایه‌ای بالای دیالوگ باز نشود و
  // کلید Escape همیشه بتواند دیالوگ را ببندد
  // معاون همهٔ دسترسی‌های مدیر مدرسه را دارد (درخواست کاربر) — محدودیت‌ها سمت API اعمال می‌شود
  const isAdmin = role === 'SCHOOL_ADMIN' || role === 'SCHOOL_VICE'
  const isTeacher = role === 'TEACHER'
  const canCreate = isAdmin || isTeacher

  const [type, setType] = useState<ClassEventType>('EXAM')
  const [customTitle, setCustomTitle] = useState('')
  const [description, setDescription] = useState('')
  const [scope, setScope] = useState<'CLASS' | 'SCHOOL'>('CLASS')
  const [posting, setPosting] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // ── فرم تکلیف درسی (نوع «تکلیف» برای معلم) ──
  const [groups, setGroups] = useState<GroupMeta[] | null>(null)
  const [groupId, setGroupId] = useState('')
  const [assignmentTitle, setAssignmentTitle] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [maxGrade, setMaxGrade] = useState('')
  const [answerMode, setAnswerMode] = useState<AnswerMode>('BOTH')
  const [allowEdit, setAllowEdit] = useState(true)
  const [attachment, setAttachment] = useState<StagedFile | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // ── حضور و غیاب این روز ──
  const [attendanceOpen, setAttendanceOpen] = useState(false)

  // گروه‌های درسی معلم در همین کلاس — برای فرم تکلیف
  useEffect(() => {
    if (!open || !isTeacher || !classId) return
    let alive = true
    setGroups(null)
    ;(async () => {
      try {
        const res = await fetch('/api/assignments', { cache: 'no-store' })
        if (!res.ok) {
          if (alive) setGroups([])
          return
        }
        const d = await res.json()
        const all: GroupMeta[] = d.groups ?? []
        if (alive) setGroups(all.filter((g) => g.classroomId === classId))
      } catch {
        if (alive) setGroups([])
      }
    })()
    return () => {
      alive = false
    }
  }, [open, isTeacher, classId])

  // ریست فرم با تغییر روز یا بستن دیالوگ
  useEffect(() => {
    setCustomTitle('')
    setDescription('')
    setConfirmDeleteId(null)
    setScope('CLASS')
    setAssignmentTitle('')
    setDueAt('')
    setMaxGrade('')
    setAttachment(null)
    setAnswerMode('BOTH')
    setAllowEdit(true)
    setAttendanceOpen(false)
  }, [dateKey, open])

  // دیپ‌لینک FAB معلم — با باز شدن دیالوگ روز، ویرایشگر «ثبت غیبت/نمره/تخلف»
  // مستقیم باز شود (هر توکن فقط یک بار؛ بعد از اثر ریست بالا اجرا می‌شود)
  const autoAttFiredFor = useRef<string | null>(null)
  useEffect(() => {
    if (!open || !autoOpenAttendance || !canCreate) return
    if (autoAttFiredFor.current === autoOpenAttendance) return
    autoAttFiredFor.current = autoOpenAttendance
    setAttendanceOpen(true)
  }, [open, autoOpenAttendance, canCreate])

  // انتخاب پیش‌فرض گروه پس از رسیدن فهرست گروه‌ها
  useEffect(() => {
    if (groups && groups.length > 0 && !groups.some((g) => g.id === groupId)) {
      setGroupId(groups[0].id)
    }
  }, [groups])

  const sorted = useMemo(
    () =>
      [...events].sort((a, b) =>
        a.dateKey === b.dateKey ? a.createdAt.localeCompare(b.createdAt) : 0,
      ),
    [events],
  )

  const canDeleteEvent = (e: CalendarEventDto) =>
    role === 'SCHOOL_ADMIN' || role === 'SCHOOL_VICE' || (role === 'TEACHER' && e.createdById === uid)

  const pickFile = async (f: File | null) => {
    if (!f) return
    setUploading(true)
    try {
      const staged = await uploadAssignmentFile(f)
      setAttachment(staged)
    } catch (e) {
      sonnerToast.error(e instanceof Error ? e.message : 'آپلود پیوست ناموفق بود')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  /** پایان روز انتخاب‌شده (جلالی) به‌وقت محلی — پیش‌فرض دکمه «مهلت پایان همین روز» */
  const endOfSelectedDay = () => {
    const p = parseDateKey(dateKey)
    if (!p) return ''
    const g = toGregorian(p.jy, p.jm, p.jd)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${g.gy}-${pad(g.gm)}-${pad(g.gd)}T23:59`
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!dateKey || !classId) return

    // ── نوع «تکلیف» برای معلم = ایجاد تکلیف درسی + رویداد متصل در تقویم ──
    if (type === 'HOMEWORK' && isTeacher) {
      if (!groupId) {
        sonnerToast.error('گروه درسی تکلیف را انتخاب کنید')
        return
      }
      if (!assignmentTitle.trim()) {
        sonnerToast.error('عنوان تکلیف را وارد کنید')
        return
      }
      setPosting(true)
      try {
        const r1 = await fetch('/api/assignments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subjectGroupId: groupId,
            title: assignmentTitle.trim(),
            description: description.trim(),
            answerMode,
            allowEdit,
            maxGrade: maxGrade ? Number(maxGrade) : null,
            dueAt: dueAt ? new Date(dueAt).toISOString() : null,
            ...(attachment ? { attachment } : {}),
          }),
        })
        const d1 = await r1.json().catch(() => ({}))
        if (!r1.ok) {
          sonnerToast.error(d1.error ?? 'ثبت تکلیف ناموفق بود')
          return
        }
        // رویداد تقویم متصل به تکلیف — نمای «تکلیف» در تقویم آموزشی
        const r2 = await fetch('/api/calendar/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            classroomId: classId,
            dateKey,
            type: 'HOMEWORK',
            description: description.trim() || undefined,
            assignmentId: d1.id,
          }),
        })
        if (!r2.ok) {
          const d2 = await r2.json().catch(() => ({}))
          sonnerToast.error(
            d2.error ?? 'تکلیف ساخته شد اما ثبت آن در تقویم آموزشی ناموفق بود',
          )
          onChanged()
          return
        }
        sonnerToast.success('تکلیف ثبت شد، اعلان ارسال شد و در تقویم آموزشی نمایش داده می‌شود')
        setAssignmentTitle('')
        setDescription('')
        setDueAt('')
        setMaxGrade('')
        setAttachment(null)
        onChanged()
      } catch {
        sonnerToast.error('ارتباط با سرور برقرار نشد')
      } finally {
        setPosting(false)
      }
      return
    }

    // ── سایر انواع رویداد (و «تکلیف» برای مدیر مدرسه) ──
    setPosting(true)
    try {
      const res = await fetch('/api/calendar/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classroomId: classId,
          dateKey,
          type,
          customTitle: type === 'CUSTOM' ? customTitle.trim() : undefined,
          description: description.trim() || undefined,
          scope: isAdmin ? scope : 'CLASS',
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        sonnerToast.error(d.error ?? 'ثبت رویداد ناموفق بود')
        return
      }
      sonnerToast.success(d.message ?? 'رویداد ثبت شد')
      setCustomTitle('')
      setDescription('')
      onChanged()
    } catch {
      sonnerToast.error('ارتباط با سرور برقرار نشد')
    } finally {
      setPosting(false)
    }
  }

  async function doDelete(eventId: string) {
    setDeletingId(eventId)
    try {
      const res = await fetch(`/api/calendar/events/${eventId}`, { method: 'DELETE' })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        sonnerToast.error(d.error ?? 'حذف رویداد ناموفق بود')
        return
      }
      sonnerToast.success(d.message ?? 'رویداد حذف شد')
      setConfirmDeleteId(null)
      onChanged()
    } catch {
      sonnerToast.error('ارتباط با سرور برقرار نشد')
    } finally {
      setDeletingId(null)
    }
  }

  if (!dateKey) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
            <CalendarDays className="h-5 w-5 text-primary" />
            {formatJalaliDate(dateKey, { withWeekday: true })}
          </DialogTitle>
          <DialogDescription>
            {canCreate
              ? `مشاهده و ثبت رویدادهای روز — کلاس «${className}»`
              : `رویدادهای ثبت‌شده توسط معلم و مدیر مدرسه — کلاس «${className}»`}
          </DialogDescription>
        </DialogHeader>

        {/* فهرست رویدادهای این روز */}
        <div className="space-y-3" aria-label="رویدادهای این روز">
          {sorted.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
              رویدادی برای این روز ثبت نشده است
            </p>
          ) : (
            sorted.map((ev) => {
              const meta = EVENT_TYPE_META[ev.type as ClassEventType] ?? EVENT_TYPE_META.CUSTOM
              const Icon = meta.icon
              const label = eventDisplayLabel(ev.type, ev.customTitle)
              return (
                <div key={ev.id} className="rounded-xl border p-3">
                  <div className="flex items-start gap-3">
                    <span
                      className={cn(
                        'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
                        meta.chipClass,
                      )}
                      aria-hidden="true"
                    >
                      <Icon className="h-4.5 w-4.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold">{label}</span>
                        {ev.type !== 'CUSTOM' && ev.customTitle ? (
                          <span className="text-xs text-muted-foreground">{ev.customTitle}</span>
                        ) : null}
                        {ev.assignmentTitle ? (
                          <span className="text-xs text-muted-foreground">
                            — {ev.assignmentTitle}
                          </span>
                        ) : null}
                        {ev.scope === 'SCHOOL' && (
                          <Badge variant="outline" className="gap-1 text-[10px]">
                            <School className="h-3 w-3" />
                            کل مدرسه
                          </Badge>
                        )}
                      </div>
                      {ev.description ? (
                        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                          {ev.description}
                        </p>
                      ) : null}
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        ثبت‌کننده: {ev.creatorName}
                      </p>
                      {/* لینک تکلیف متصل — جایگزین بخش مستقل «تکالیف» */}
                      {ev.type === 'HOMEWORK' && ev.assignmentId && (
                        <Link
                          href={`/assignments/${ev.assignmentId}`}
                          className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-bold text-amber-800 transition-colors hover:bg-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:hover:bg-amber-500/25"
                        >
                          <BookOpen className="h-3.5 w-3.5" />
                          {role === 'STUDENT'
                            ? 'مشاهده تکلیف و ارسال پاسخ'
                            : 'مشاهده تکلیف و پاسخ‌ها'}
                        </Link>
                      )}
                    </div>
                    {canDeleteEvent(ev) &&
                      (confirmDeleteId === ev.id ? (
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            size="sm"
                            variant="destructive"
                            className="h-8 px-2.5"
                            disabled={deletingId === ev.id}
                            onClick={() => doDelete(ev.id)}
                          >
                            {deletingId === ev.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              'تایید حذف'
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 px-2.5"
                            onClick={() => setConfirmDeleteId(null)}
                          >
                            انصراف
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                          aria-label={`حذف رویداد ${label}`}
                          title="حذف رویداد"
                          onClick={() => setConfirmDeleteId(ev.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      ))}
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* حضور و غیاب این روز — ادغام بخش «حضور و غیاب» در تقویم آموزشی */}
        {canCreate && (
          <div
            className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3"
            data-testid="day-attendance-section"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300">
              <CalendarCheck2 className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold">برای امروز غیبت، نمره یا تخلف ثبت کنید</div>
              <div className="text-[11px] text-muted-foreground">
                ثبت حاضر/غایب و تخلف دانش‌آموزان کلاس «{className}»
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAttendanceOpen(true)}
              data-testid="open-attendance-button"
            >
              <CalendarCheck2 className="h-4 w-4" />
              ثبت غیبت/نمره/تخلف
            </Button>
          </div>
        )}

        {/* فرم ثبت رویداد — فقط معلم و مدیر مدرسه */}
        {canCreate && (
          <form onSubmit={submit} className="space-y-3 rounded-xl border bg-muted/30 p-3">
            <div className="text-sm font-bold">
              {type === 'HOMEWORK' && isTeacher ? 'ثبت تکلیف جدید' : 'ثبت رویداد جدید'}
            </div>

            {/* انتخاب نوع رویداد — «تعطیل» فقط برای مدیر مدرسه */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="نوع رویداد">
              {EVENT_TYPE_ORDER.filter((t) => t !== 'HOLIDAY' || isAdmin).map((t) => {
                const meta = EVENT_TYPE_META[t]
                const Icon = meta.icon
                const active = type === t
                return (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={active}
                    aria-label={`نوع ${meta.label}`}
                    title={meta.hint}
                    onClick={() => setType(t)}
                    className={cn(
                      'flex flex-col items-center gap-1.5 rounded-xl border px-2 py-2.5 text-xs font-medium transition-colors',
                      active
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-8 w-8 items-center justify-center rounded-full',
                        meta.chipClass,
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    {meta.label}
                  </button>
                )
              })}
            </div>

            {type === 'CUSTOM' && (
              <div className="space-y-1.5">
                <Label htmlFor="custom-event-title">نام رویداد سفارشی</Label>
                <Input
                  id="custom-event-title"
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  placeholder="مثلاً جشن زنجیر معرفت"
                  maxLength={60}
                  required
                />
              </div>
            )}

            {/* مدیر: ثبت تکلیف درسیِ متصل به گروه درسی فقط توسط معلم انجام می‌شود */}
            {type === 'HOMEWORK' && isAdmin && (
              <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-700 dark:text-amber-300">
                تکلیف درسیِ متصل به گروه درسی و دریافت پاسخ توسط معلم ثبت می‌شود؛ شما می‌توانید
                رویداد تقویمی «تکلیف» برای این کلاس یا کل مدرسه ثبت کنید.
              </p>
            )}

            {/* فرم تکلیف درسی — معلم: گروه درسی + جزئیات تکلیف */}
            {type === 'HOMEWORK' && isTeacher && (
              <div className="space-y-3 rounded-lg border bg-card p-3" data-testid="homework-form">
                <div className="space-y-1.5">
                  <Label>گروه درسی تکلیف</Label>
                  {groups === null ? (
                    <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      در حال بارگذاری گروه‌های درسی…
                    </div>
                  ) : groups.length === 0 ? (
                    <p className="text-xs text-amber-600">
                      گروه درسی فعالی از این کلاس به شما اختصاص ندارد؛ ابتدا از مدیریت مدرسه
                      گروه درسی بسازید.
                    </p>
                  ) : (
                    <Select value={groupId} onValueChange={setGroupId}>
                      <SelectTrigger dir="rtl" className="w-full" aria-label="گروه درسی تکلیف">
                        <SelectValue placeholder="انتخاب گروه درسی" />
                      </SelectTrigger>
                      <SelectContent>
                        {groups.map((g) => (
                          <SelectItem key={g.id} value={g.id}>
                            {g.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="assignment-title">عنوان تکلیف</Label>
                  <Input
                    id="assignment-title"
                    value={assignmentTitle}
                    onChange={(e) => setAssignmentTitle(e.target.value)}
                    placeholder="مثلاً حل تمرین‌های فصل کسرها"
                    maxLength={120}
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="assignment-due">مهلت ارسال (اختیاری)</Label>
                    <Input
                      id="assignment-due"
                      type="datetime-local"
                      value={dueAt}
                      onChange={(e) => setDueAt(e.target.value)}
                    />
                    {!dueAt && (
                      <button
                        type="button"
                        className="text-[11px] text-primary underline underline-offset-2"
                        onClick={() => setDueAt(endOfSelectedDay())}
                      >
                        مهلت پایان همین روز
                      </button>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="assignment-grade">نمره بیشینه (اختیاری)</Label>
                    <Input
                      id="assignment-grade"
                      type="number"
                      min={1}
                      max={1000}
                      value={maxGrade}
                      onChange={(e) => setMaxGrade(e.target.value)}
                      placeholder="مثلاً ۲۰"
                    />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>نحوه ارسال پاسخ</Label>
                    <Select
                      value={answerMode}
                      onValueChange={(v) => setAnswerMode(v as AnswerMode)}
                    >
                      <SelectTrigger dir="rtl" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ANSWER_MODES.map((m) => (
                          <SelectItem key={m} value={m}>
                            {ANSWER_MODE_LABELS[m]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end pb-1.5">
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <Switch checked={allowEdit} onCheckedChange={setAllowEdit} />
                      <span>امکان اصلاح پاسخ توسط دانش‌آموز</span>
                    </label>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>فایل پیوست تکلیف (اختیاری)</Label>
                  {attachment ? (
                    <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                      <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {faBytes(attachment.size)}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setAttachment(null)}
                        aria-label="حذف پیوست"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <div>
                      <input
                        ref={fileRef}
                        type="file"
                        className="hidden"
                        onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full"
                        disabled={uploading}
                        onClick={() => fileRef.current?.click()}
                      >
                        {uploading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Paperclip className="h-4 w-4" />
                        )}
                        {uploading ? 'در حال آپلود...' : 'انتخاب فایل پیوست'}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="event-description">
                {type === 'HOMEWORK' && isTeacher ? 'توضیحات تکلیف' : 'توضیحات'}
              </Label>
              <Textarea
                id="event-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={
                  type === 'HOMEWORK' && isTeacher
                    ? 'شرح تکلیف، نکات و راهنما...'
                    : 'مثلاً امتحان میان‌ترم فصل ۲ — ساعت ۸ صبح'
                }
                maxLength={type === 'HOMEWORK' && isTeacher ? 4000 : 1000}
                rows={3}
              />
            </div>

            {/* دامنه رویداد — فقط مدیر مدرسه: کلاس انتخابی یا کل مدرسه */}
            {isAdmin && (
              <div className="space-y-1.5">
                <Label>دامنه رویداد</Label>
                <div className="flex gap-2" role="group" aria-label="دامنه رویداد">
                  <button
                    type="button"
                    aria-pressed={scope === 'CLASS'}
                    onClick={() => setScope('CLASS')}
                    className={cn(
                      'flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors',
                      scope === 'CLASS'
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'bg-card text-muted-foreground hover:bg-accent',
                    )}
                  >
                    فقط کلاس «{className}»
                  </button>
                  <button
                    type="button"
                    aria-pressed={scope === 'SCHOOL'}
                    onClick={() => setScope('SCHOOL')}
                    className={cn(
                      'flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors',
                      scope === 'SCHOOL'
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'bg-card text-muted-foreground hover:bg-accent',
                    )}
                  >
                    کل مدرسه
                  </button>
                </div>
                {scope === 'SCHOOL' && (
                  <p className="text-[11px] text-muted-foreground">
                    این رویداد در تقویم همه کلاس‌های مدرسه نمایش داده می‌شود.
                  </p>
                )}
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={
                posting ||
                uploading ||
                (type === 'CUSTOM' && !customTitle.trim()) ||
                (type === 'HOMEWORK' &&
                  isTeacher &&
                  (!groupId || !assignmentTitle.trim() || (groups ?? []).length === 0))
              }
              data-testid="submit-day-form"
            >
              {posting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  در حال ثبت…
                </>
              ) : type === 'HOMEWORK' && isTeacher ? (
                'ثبت تکلیف و رویداد تقویم'
              ) : (
                'ثبت رویداد'
              )}
            </Button>
          </form>
        )}

        {/* دیالوگ حضور و غیاب این روز — لیست دانش‌آموزان برای معلم و مدیر */}
        <DayAttendanceDialog
          open={attendanceOpen}
          onOpenChange={setAttendanceOpen}
          dateKey={dateKey}
          classId={classId}
          className={className}
          role={role}
        />
      </DialogContent>
    </Dialog>
  )
}
