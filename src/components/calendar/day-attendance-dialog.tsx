'use client'

import { useCallback, useEffect, useState } from 'react'
import { CalendarCheck2, Loader2, Plus, BarChart3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
import { faNum } from '@/lib/format'
import {
  AttendanceSessionEditor,
  type SessionSummary,
} from '@/components/attendance/attendance-session-editor'

interface DayAttendanceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** کلید جلالی روز انتخاب‌شده در تقویم */
  dateKey: string | null
  classId: string
  className: string
}

/**
 * دیالوگ «ثبت غیبت‌های امروز» — ادغام حضور و غیاب در تقویم آموزشی:
 * - اگر برای (کلاس، روز) جلسه‌ای وجود داشته باشد ویرایشگر همان جلسه باز می‌شود
 * - در غیر این صورت با یک کلیک جلسه جدید ساخته می‌شود (همه دانش‌آموزان پیش‌فرض حاضر)
 * - ویرایشگر جلسه: لیست دانش‌آموزان با چک‌باکس حاضری، یادداشت غیبت، پیش‌نویس و نهایی‌سازی
 */
export function DayAttendanceDialog({
  open,
  onOpenChange,
  dateKey,
  classId,
  className,
}: DayAttendanceDialogProps) {
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)

  const loadSessions = useCallback(async () => {
    if (!classId || !dateKey) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(
        `/api/attendance/sessions?classroomId=${classId}&from=${dateKey}&to=${dateKey}`,
        { cache: 'no-store' },
      )
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(d.error ?? 'خطا در بارگذاری جلسات حضور و غیاب')
        setSessions([])
        return
      }
      const list: SessionSummary[] = d.sessions ?? []
      setSessions(list)
      // اولویت با جلسه پیش‌نویسِ همان روز؛ سپس جدیدترین جلسه
      const preferred =
        list.find((s) => s.status === 'DRAFT') ?? (list.length ? list[0] : null)
      setActiveSessionId(preferred?.id ?? null)
    } catch {
      setError('اتصال برقرار نشد')
    } finally {
      setLoading(false)
    }
  }, [classId, dateKey])

  useEffect(() => {
    if (open && dateKey) loadSessions()
    if (!open) {
      setError('')
      setSessions([])
      setActiveSessionId(null)
    }
  }, [open, dateKey, loadSessions])

  async function createSession() {
    if (!classId || !dateKey) return
    setCreating(true)
    setError('')
    try {
      const res = await fetch('/api/attendance/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classroomId: classId, dateKey }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(d.error ?? 'ایجاد جلسه حضور و غیاب ناموفق بود')
        return
      }
      setActiveSessionId(d.session?.id ?? null)
      await loadSessions()
      // پس از بارگذاری مجدد، جلسه تازه انتخاب شود
      if (d.session?.id) setActiveSessionId(d.session.id)
    } catch {
      setError('اتصال برقرار نشد')
    } finally {
      setCreating(false)
    }
  }

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
            <CalendarCheck2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            ثبت حضور و غیاب — {dateKey ? formatJalaliDate(dateKey, { withWeekday: true }) : ''}
          </DialogTitle>
          <DialogDescription>
            لیست دانش‌آموزان کلاس «{className}» — هر دانش‌آموز پیش‌فرض «حاضر» است؛
            چک‌باکس را بردارید تا «غایب» ثبت شود (با امکان یادداشت غیبت).
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            در حال بارگذاری…
          </div>
        ) : error ? (
          <div className="space-y-3 py-4 text-center">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" onClick={loadSessions}>
              تلاش مجدد
            </Button>
          </div>
        ) : sessions.length === 0 ? (
          <div className="space-y-4 py-2 text-center" data-testid="attendance-empty">
            <p className="text-sm text-muted-foreground">
              برای این روز هنوز جلسه حضور و غیابی ثبت نشده است.
            </p>
            <Button onClick={createSession} disabled={creating} data-testid="create-attendance-button">
              {creating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  در حال آماده‌سازی لیست…
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  شروع ثبت غیبت‌های امروز
                </>
              )}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {sessions.length > 1 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">جلسه:</span>
                <Select
                  value={activeSessionId ?? undefined}
                  onValueChange={(v) => setActiveSessionId(v)}
                >
                  <SelectTrigger className="w-56" aria-label="انتخاب جلسه حضور و غیاب">
                    <SelectValue placeholder="انتخاب جلسه" />
                  </SelectTrigger>
                  <SelectContent>
                    {sessions.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.title} — {s.status === 'FINALIZED' ? 'نهایی‌شده' : 'پیش‌نویس'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={createSession}
                  disabled={creating}
                >
                  {creating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  جلسه جدید
                </Button>
              </div>
            )}
            {sessions.length === 1 && activeSession && (
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{activeSession.title}</Badge>
                <Badge
                  variant="outline"
                  className={
                    activeSession.status === 'FINALIZED'
                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                      : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                  }
                >
                  {activeSession.status === 'FINALIZED' ? 'نهایی‌شده' : 'پیش‌نویس'}
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  className="ms-auto"
                  onClick={createSession}
                  disabled={creating}
                >
                  {creating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  جلسه جدید
                </Button>
              </div>
            )}
            {activeSessionId && (
              <AttendanceSessionEditor
                key={activeSessionId}
                sessionId={activeSessionId}
                onSessionUpdated={loadSessions}
              />
            )}
          </div>
        )}

        {/* گزارش کامل حضور و غیاب کلاس — صفحه ادغام‌شده قبلی */}
        <div className="flex items-center justify-between border-t pt-3">
          <p className="text-[11px] text-muted-foreground">
            وضعیت حضور و غیاب در تقویم آموزشی ثبت می‌شود و اعلان خصوصی برای دانش‌آموز ارسال خواهد شد.
          </p>
          <a
            href="/attendance"
            className="inline-flex shrink-0 items-center gap-1.5 text-xs font-bold text-primary hover:underline"
          >
            <BarChart3 className="h-3.5 w-3.5" />
            گزارش کامل ({faNum(sessions.length)} جلسه)
          </a>
        </div>
      </DialogContent>
    </Dialog>
  )
}
