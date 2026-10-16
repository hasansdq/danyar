'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast as sonnerToast } from 'sonner'
import { CheckCircle2, History, Loader2, Save, Send, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { formatJalaliDate } from '@/lib/jalali'
import { faDateTime, faNum } from '@/lib/format'
import { statusLabel } from '@/lib/attendance-access'

export interface SessionSummary {
  id: string
  dateKey: string
  title: string
  status: string // DRAFT | FINALIZED
  classroomId: string
  classroomName: string
  creatorName?: string
  finalizedAt?: string | null
}

interface StudentRow {
  studentId: string
  fullName: string
  status: string // PRESENT | ABSENT | UNSET
  note: string | null
}

interface EditRow {
  id: string
  studentName: string
  oldStatus: string
  newStatus: string
  oldNote: string | null
  newNote: string | null
  editorName: string
  createdAt: string
}

const STATUS_STYLE: Record<string, string> = {
  PRESENT: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  ABSENT: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
  UNSET: 'bg-slate-500/15 text-slate-600 dark:text-slate-400',
}

/**
 * ویرایشگر جلسه حضور و غیاب — مشترک بین معلم و مدیر مدرسه.
 * همه دانش‌آموزان پیش‌فرض «حاضر» هستند؛ چک‌باکس را بردارید تا «غایب» شود.
 * پس از نهایی‌سازی، اصلاح‌ها سابقه‌دار می‌شوند و اعلان اصلاح برای دانش‌آموز می‌رود.
 */
export function AttendanceSessionEditor({
  sessionId,
  onSessionUpdated,
  onSessionDeleted,
}: {
  sessionId: string
  onSessionUpdated?: (s: SessionSummary) => void
  onSessionDeleted?: (id: string) => void
}) {
  // توست sonner (نه radix) — لایه توست radix کلید Escape دیالوگ را می‌بلعد؛
  // این ویرایشگر حالا در دیالوگ تو‌در‌توی تقویم آموزشی هم باز می‌شود
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [session, setSession] = useState<SessionSummary | null>(null)
  const [students, setStudents] = useState<StudentRow[]>([])
  const [edits, setEdits] = useState<EditRow[]>([])
  const [editing, setEditing] = useState(false)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/attendance/sessions/${sessionId}`, { cache: 'no-store' })
      const d = await res.json()
      if (!res.ok) {
        setError(d.error ?? 'خطا در بارگذاری جلسه')
        return
      }
      setSession(d.session)
      setStudents(
        (d.students as StudentRow[]).map((s) => ({ ...s, note: s.note ?? '' })),
      )
      setEdits(d.edits ?? [])
      setEditing(false)
    } catch {
      setError('اتصال برقرار نشد')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  const toggleStudent = (studentId: string, present: boolean) => {
    setStudents((prev) =>
      prev.map((s) =>
        s.studentId === studentId
          ? { ...s, status: present ? 'PRESENT' : 'ABSENT' }
          : s,
      ),
    )
  }

  const setNote = (studentId: string, note: string) => {
    setStudents((prev) =>
      prev.map((s) => (s.studentId === studentId ? { ...s, note } : s)),
    )
  }

  const save = async (finalize: boolean) => {
    if (!session) return
    if (finalize) {
      const absent = students.filter((s) => s.status === 'ABSENT').length
      const unset = students.filter((s) => s.status === 'UNSET').length
      const ok = window.confirm(
        `حضور و غیاب نهایی شود؟\n${faNum(students.filter((s) => s.status === 'PRESENT').length)} حاضر، ${faNum(absent)} غایب` +
          (unset ? `، ${faNum(unset)} ثبت‌نشده` : '') +
        `\nپس از نهایی‌سازی، اعلان خصوصی برای هر دانش‌آموز ارسال می‌شود.`,
      )
      if (!ok) return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/attendance/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          records: students
            .filter((s) => s.status !== 'UNSET')
            .map((s) => ({ studentId: s.studentId, status: s.status, note: s.note || null })),
          ...(finalize ? { action: 'finalize' } : {}),
        }),
      })
      const d = await res.json()
      if (!res.ok) {
        sonnerToast.error(d.error ?? 'ذخیره انجام نشد')
        return
      }
      setSession((prev) => (prev ? { ...prev, status: d.session.status } : prev))
      setEditing(false)
      sonnerToast.success(
        finalize ? 'جلسه نهایی شد — اعلان خصوصی برای دانش‌آموزان ارسال شد' : 'پیش‌نویس ذخیره شد — می‌توانید بعداً ادامه دهید و نهایی کنید',
      )
      onSessionUpdated?.(d.session)
      await load()
    } catch {
      sonnerToast.error('اتصال برقرار نشد')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
        <Loader2 className="h-5 w-5 animate-spin" /> در حال بارگذاری جلسه…
      </div>
    )
  }
  if (error || !session) {
    return <div className="py-16 text-center text-destructive">{error || 'جلسه یافت نشد'}</div>
  }

  const isFinalized = session.status === 'FINALIZED'
  const canEdit = !isFinalized || editing
  const presentCount = students.filter((s) => s.status === 'PRESENT').length
  const absentCount = students.filter((s) => s.status === 'ABSENT').length
  const unsetCount = students.filter((s) => s.status === 'UNSET').length

  return (
    <div className="space-y-4" data-testid="attendance-editor">
      <div className="flex flex-wrap items-center gap-2">
        <div className="font-bold">{session.title}</div>
        <Badge variant="outline">{session.classroomName}</Badge>
        <Badge variant="outline" className="font-mono" dir="rtl">
          {formatJalaliDate(session.dateKey, { withWeekday: true })}
        </Badge>
        {isFinalized ? (
          <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" variant="secondary">
            نهایی‌شده
          </Badge>
        ) : (
          <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400" variant="secondary">
            پیش‌نویس
          </Badge>
        )}
        <div className="flex-1" />
        <span className="text-xs text-muted-foreground">
          {faNum(presentCount)} حاضر · {faNum(absentCount)} غایب
          {unsetCount ? ` · ${faNum(unsetCount)} ثبت‌نشده` : ''}
        </span>
      </div>

      {isFinalized && !editing && (
        <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
          این جلسه نهایی شده است. برای اصلاح وضعیت‌ها دکمه «اصلاح وضعیت‌ها» را بزنید؛ هر تغییر با
          نام شما در سابقه اصلاحات ثبت می‌شود و اعلان اصلاح برای دانش‌آموز ارسال خواهد شد.
        </div>
      )}

      <div className="rounded-xl border divide-y">
        {students.map((s) => (
          <div key={s.studentId} className="flex items-center gap-3 px-3 py-2.5" data-testid="att-student-row">
            <Checkbox
              id={`cb-${sessionId}-${s.studentId}`}
              checked={s.status === 'PRESENT'}
              disabled={!canEdit}
              onCheckedChange={(v) => toggleStudent(s.studentId, v === true)}
              aria-label={`حاضری ${s.fullName}`}
            />
            <label
              htmlFor={`cb-${sessionId}-${s.studentId}`}
              className="flex-1 text-sm font-medium cursor-pointer select-none"
            >
              {s.fullName}
            </label>
            {canEdit ? (
              <span
                className={cn(
                  'text-xs px-2 py-0.5 rounded-full font-medium',
                  s.status === 'PRESENT' && 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
                  s.status === 'ABSENT' && 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
                  s.status === 'UNSET' && 'bg-slate-500/15 text-slate-600 dark:text-slate-400',
                )}
              >
                {s.status === 'PRESENT' ? 'حاضر' : s.status === 'ABSENT' ? 'غایب' : 'ثبت‌نشده'}
              </span>
            ) : (
              <Badge variant="secondary" className={cn('text-xs', STATUS_STYLE[s.status])}>
                {statusLabel(s.status)}
              </Badge>
            )}
            {canEdit && s.status === 'ABSENT' && (
              <Input
                value={s.note ?? ''}
                onChange={(e) => setNote(s.studentId, e.target.value)}
                placeholder="یادداشت غیبت (اختیاری)"
                className="h-8 w-40 sm:w-56 text-xs"
                aria-label={`یادداشت غیبت ${s.fullName}`}
              />
            )}
            {!canEdit && s.note ? (
              <span className="text-xs text-muted-foreground max-w-40 truncate" title={s.note}>
                {s.note}
              </span>
            ) : null}
          </div>
        ))}
        {!students.length && (
          <div className="px-3 py-8 text-center text-sm text-muted-foreground">
            دانش‌آموزی در این کلاس ثبت‌نام نکرده است
          </div>
        )}
      </div>

      {canEdit && (
        <div className="flex flex-wrap gap-2">
          {!isFinalized && (
            <>
              <Button variant="outline" onClick={() => save(false)} disabled={saving || !students.length}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                ذخیره پیش‌نویس
              </Button>
              <Button onClick={() => save(true)} disabled={saving || !students.length}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                نهایی‌سازی و ارسال اعلان
              </Button>
            </>
          )}
          {isFinalized && editing && (
            <Button onClick={() => save(false)} disabled={saving || !students.length}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              ذخیره اصلاحات
            </Button>
          )}
        </div>
      )}

      {isFinalized && !editing && (
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          اصلاح وضعیت‌ها
        </Button>
      )}

      {edits.length > 0 && (
        <Accordion type="single" collapsible>
          <AccordionItem value="history">
            <AccordionTrigger className="text-sm">
              <span className="flex items-center gap-2">
                <History className="h-4 w-4" />
                سابقه اصلاحات ({faNum(edits.length)})
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-2">
                {edits.map((e) => (
                  <div key={e.id} className="rounded-lg border p-2.5 text-xs space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold">{e.studentName}</span>
                      <span className="flex items-center gap-1">
                        <span className={cn('px-1.5 py-0.5 rounded-full', STATUS_STYLE[e.oldStatus])}>
                          {statusLabel(e.oldStatus)}
                        </span>
                        <XCircle className="h-3 w-3 text-muted-foreground rotate-45" />
                        <span className={cn('px-1.5 py-0.5 rounded-full', STATUS_STYLE[e.newStatus])}>
                          {statusLabel(e.newStatus)}
                        </span>
                      </span>
                    </div>
                    {(e.newNote || e.oldNote) && (
                      <div className="text-muted-foreground">
                        یادداشت: {e.oldNote ? `«${e.oldNote}»` : '—'} → {e.newNote ? `«${e.newNote}»` : '—'}
                      </div>
                    )}
                    <div className="text-muted-foreground">
                      توسط {e.editorName} · {faDateTime(e.createdAt)}
                    </div>
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}
    </div>
  )
}
