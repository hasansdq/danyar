'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast as sonnerToast } from 'sonner'
import {
  Award,
  CheckCircle2,
  CircleMinus,
  GraduationCap,
  History,
  Info,
  Loader2,
  Save,
  Send,
  XCircle,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { formatJalaliDate } from '@/lib/jalali'
import { faDateTime, faNum } from '@/lib/format'
import { statusLabel, GRADE_TITLE_REQUIRED_MSG, GRADE_LESSON_REQUIRED_MSG } from '@/lib/attendance-access'

export interface SessionSummary {
  id: string
  dateKey: string
  title: string
  status: string // DRAFT | FINALIZED
  classroomId: string
  classroomName: string
  creatorId?: string
  creatorName?: string
  /** معلم: فقط جلسهٔ خودش قابل ویرایش است (درخواست کاربر) */
  canManageRecords?: boolean
  /** جلسهٔ خودِ کاربر است؟ (از فهرست جلسات) */
  isMine?: boolean
  finalizedAt?: string | null
}

interface StudentRow {
  studentId: string
  fullName: string
  status: string // PRESENT | ABSENT | UNSET
  note: string | null
}

/** تخلف ثبت‌شدهٔ دانش‌آموز در این جلسه/روز */
interface ViolationRow {
  id: string
  studentId: string
  studentName: string
  dateKey: string
  text: string
  creatorId: string
  creatorName: string
  createdAt: string
}

/** نمرهٔ ثبت‌شدهٔ دانش‌آموز در این جلسه (درخواست کاربر — ستون «نمره» معلم) */
interface GradeRow {
  id: string
  studentId: string
  studentName: string
  title: string
  lessonId: string | null
  lessonName: string | null
  score: string
  dateKey: string
  creatorId: string
  creatorName: string
  createdAt: string
  updatedAt: string
}

/** درس منتسب به معلم — گزینه‌های dropdown «درس» */
interface LessonOption {
  id: string
  name: string
}

/** نوع تخلف قابل انتخاب (درخواست کاربر) — فهرست کشویی چندانتخابی از پنل مدیر کل */
interface ViolationTypeOption {
  id: string
  label: string
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
 *
 * نقش معلم (درخواست کاربر):
 * - مالکیت جلسه: معلم فقط جلسهٔ خودش را ویرایش می‌کند؛ جلسهٔ معلم دیگر فقط-مشاهده است
 *   (جلسهٔ خودش از دیالوگ روز به‌صورت خودکار ساخته می‌شود)
 * - ستون «نمره» برای هر دانش‌آموز + فیلد «عنوان نمره» (اجباری با ثبت نمره) و «درس» (اجباری)
 * - ثبت تخلف: فهرست چندانتخابی «انواع تخلف» (مدیریت از پنل مدیر کل) — فیلد متنی حذف شد
 * - «یادداشت غیبت» حذف شد (درخواست کاربر)
 */
export function AttendanceSessionEditor({
  sessionId,
  role,
  onSessionUpdated,
  onSessionDeleted,
}: {
  sessionId: string
  /** نقش کاربر فعلی — ستون نمره فقط برای TEACHER نمایش داده می‌شود */
  role?: string
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

  // ── ثبت تخلف (درخواست کاربر) — آیکون منفی کنار هر دانش‌آموز ──
  const [violations, setViolations] = useState<ViolationRow[]>([])
  /** studentId که فرم تخلفش باز است */
  const [violationOpenFor, setViolationOpenFor] = useState<string | null>(null)
  /** انواع تخلف قابل انتخاب (فهرست کشویی — مدیریت از پنل مدیر کل) */
  const [violationTypes, setViolationTypes] = useState<ViolationTypeOption[] | null>(null)
  /** انتخاب‌های چندگانهٔ هر دانش‌آموز: studentId → برچسب‌های انتخابی */
  const [violationSelections, setViolationSelections] = useState<Record<string, string[]>>({})
  /** studentId در حال ذخیره تخلف */
  const [savingViolation, setSavingViolation] = useState<string | null>(null)
  /** id تخلف در حال حذف */
  const [deletingViolation, setDeletingViolation] = useState<string | null>(null)

  // ── ثبت نمره (درخواست کاربر) — فقط نقش معلم ──
  const isTeacher = role === 'TEACHER'
  /** نمرات ثبت‌شدهٔ این جلسه (همهٔ درس‌ها) */
  const [grades, setGrades] = useState<GradeRow[]>([])
  /** درس‌های منتسب به معلم — گزینه‌های dropdown «درس» */
  const [teacherLessons, setTeacherLessons] = useState<LessonOption[] | null>(null)
  /** نمرهٔ در حال تایپ برای هر دانش‌آموز (ستون «نمره») */
  const [gradeDrafts, setGradeDrafts] = useState<Record<string, string>>({})
  /** فیلد اختیاری «عنوان نمره» (مثلاً: آزمون مهر ماه) */
  const [gradeTitle, setGradeTitle] = useState('')
  /** فیلد کشویی «درس» — فقط از درس‌های منتسب به معلم */
  const [gradeLessonId, setGradeLessonId] = useState('')
  /** خطای اجباری‌بودن عنوان نمره (درخواست کاربر — متن اخطار) */
  const [gradeTitleError, setGradeTitleError] = useState(false)
  /** خطای اجباری‌بودن درس (درخواست کاربر — انتخاب درس الزامی است) */
  const [gradeLessonError, setGradeLessonError] = useState(false)
  /** آیا معلم خودش چیزی تایپ/تغییر داده است؟ (پیش‌نویس‌های تایپ‌شده با تعویض درس از دست نمی‌روند) */
  const [gradeFormDirty, setGradeFormDirty] = useState(false)

  // درس‌های منتسب به معلم — فقط برای نقش معلم بارگذاری می‌شود
  useEffect(() => {
    if (!isTeacher) return
    let alive = true
    ;(async () => {
      try {
        const res = await fetch('/api/lessons', { cache: 'no-store' })
        if (res.ok && alive) {
          const d = await res.json()
          setTeacherLessons(d.lessons ?? [])
        } else if (alive) setTeacherLessons([])
      } catch {
        if (alive) setTeacherLessons([])
      }
    })()
    return () => {
      alive = false
    }
  }, [isTeacher])

  // انواع تخلف (درخواست کاربر) — فهرست کشویی چندانتخابی؛ مدیریت از پنل مدیر کل
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch('/api/attendance/violation-types', { cache: 'no-store' })
        if (res.ok && alive) {
          const d = await res.json()
          setViolationTypes(d.types ?? [])
        } else if (alive) setViolationTypes([])
      } catch {
        if (alive) setViolationTypes([])
      }
    })()
    return () => {
      alive = false
    }
  }, [])

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
      setViolations(d.violations ?? [])
      setGrades(d.grades ?? [])
      setEditing(false)
      // پیش‌پر کردن ستون نمره و فیلدهای عنوان/درس از آخرین مجموعهٔ نمرات ثبت‌شده
      const loadedGrades: GradeRow[] = d.grades ?? []
      if (loadedGrades.length > 0) {
        const latest = loadedGrades[0]
        const lessonId = latest.lessonId ?? ''
        setGradeLessonId(lessonId)
        setGradeTitle(latest.title ?? '')
        const drafts: Record<string, string> = {}
        for (const g of loadedGrades) {
          if ((g.lessonId ?? '') === lessonId) drafts[g.studentId] = g.score
        }
        setGradeDrafts(drafts)
      } else {
        setGradeLessonId('')
        setGradeTitle('')
        setGradeDrafts({})
      }
      setGradeTitleError(false)
      setGradeLessonError(false)
      setGradeFormDirty(false)
    } catch {
      setError('اتصال برقرار نشد')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
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

  /* ── ثبت نمره (درخواست کاربر) — ستون «نمره» کنار هر دانش‌آموز ── */
  const setGradeDraft = (studentId: string, score: string) => {
    setGradeDrafts((prev) => ({ ...prev, [studentId]: score.slice(0, 20) }))
    setGradeFormDirty(true)
    if (score.trim()) setGradeTitleError(false)
  }

  /** تغییر dropdown درس — پیش‌پر کردن مجدد ستون نمره از نمرات همان درس؛
 *  پیش‌نویس‌های تایپ‌شدهٔ معلم (dirty) حفظ می‌شوند تا از دست نروند */
  function changeGradeLesson(nextLessonId: string) {
    setGradeLessonId(nextLessonId)
    if (!gradeFormDirty) {
      // هنوز چیزی تایپ نشده — ستون نمره از نمرات ثبت‌شدهٔ همان درس پر می‌شود
      const drafts: Record<string, string> = {}
      let title = ''
      for (const g of grades) {
        if ((g.lessonId ?? '') === nextLessonId) {
          drafts[g.studentId] = g.score
          if (!title) title = g.title
        }
      }
      setGradeDrafts(drafts)
      if (title) setGradeTitle(title)
    }
    setGradeTitleError(false)
  }

  /** نمرهٔ ثبت‌شدهٔ دانش‌آموز در این جلسه (نمایش در حالت فقط-مشاهده) */
  const gradesOf = (studentId: string) => grades.filter((g) => g.studentId === studentId)

  /** آیا حداقل یک نمره تایپ شده است؟ (عنوان نمره را اجباری می‌کند) */
  const hasAnyGradeDraft = useMemo(
    () => Object.values(gradeDrafts).some((v) => v.trim() !== ''),
    [gradeDrafts],
  )

  /* ── ثبت تخلف (درخواست کاربر): آیکون منفی → فهرست چندانتخابی انواع تخلف → ثبت ── */
  const violationsOf = (studentId: string) =>
    violations.filter((v) => v.studentId === studentId)

  function openViolationForm(studentId: string) {
    setViolationOpenFor((prev) => (prev === studentId ? null : studentId))
  }

  /** انتخاب/لغو یک نوع تخلف برای دانش‌آموز (چندانتخابی) */
  function toggleViolationType(studentId: string, label: string) {
    setViolationSelections((prev) => {
      const current = prev[studentId] ?? []
      const next = current.includes(label)
        ? current.filter((l) => l !== label)
        : [...current, label]
      return { ...prev, [studentId]: next }
    })
  }

  /** انتخاب‌های فعلی دانش‌آموز */
  const selectedViolationsOf = (studentId: string) => violationSelections[studentId] ?? []

  async function saveViolations(studentId: string) {
    if (!session) return
    const texts = violationSelections[studentId] ?? []
    if (texts.length === 0) {
      sonnerToast.error('حداقل یک نوع تخلف انتخاب کنید')
      return
    }
    setSavingViolation(studentId)
    try {
      const res = await fetch('/api/attendance/violations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          studentId,
          classroomId: session.classroomId,
          dateKey: session.dateKey,
          sessionId: session.id,
          texts,
        }),
      })
      const d = await res.json()
      if (!res.ok) {
        sonnerToast.error(d.error ?? 'ثبت تخلف ناموفق بود')
        return
      }
      setViolations((prev) => [...(d.violations ?? []), ...prev])
      setViolationSelections((prev) => ({ ...prev, [studentId]: [] }))
      sonnerToast.success(
        `${faNum(d.violations?.length ?? texts.length)} تخلف ثبت شد — اعلان خصوصی برای دانش‌آموز ارسال شد`,
      )
    } catch {
      sonnerToast.error('اتصال برقرار نشد')
    } finally {
      setSavingViolation(null)
    }
  }

  async function deleteViolation(id: string) {
    setDeletingViolation(id)
    try {
      const res = await fetch(`/api/attendance/violations/${id}`, { method: 'DELETE' })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        sonnerToast.error(d.error ?? 'حذف تخلف ناموفق بود')
        return
      }
      setViolations((prev) => prev.filter((v) => v.id !== id))
      sonnerToast.success('تخلف حذف شد')
    } catch {
      sonnerToast.error('اتصال برقرار نشد')
    } finally {
      setDeletingViolation(null)
    }
  }

  const save = async (finalize: boolean) => {
    if (!session) return
    // اعتبارسنجی عنوان نمره (درخواست کاربر): با ثبت حداقل یک نمره، عنوان اجباری می‌شود
    if (isTeacher && hasAnyGradeDraft && !gradeTitle.trim()) {
      setGradeTitleError(true)
      sonnerToast.warning(GRADE_TITLE_REQUIRED_MSG)
      return
    }
    // اعتبارسنجی درس (درخواست کاربر): انتخاب درس اجباری است
    if (isTeacher && hasAnyGradeDraft && !gradeLessonId) {
      setGradeLessonError(true)
      sonnerToast.warning(GRADE_LESSON_REQUIRED_MSG)
      return
    }
    if (finalize) {
      const absent = students.filter((s) => s.status === 'ABSENT').length
      const unset = students.filter((s) => s.status === 'UNSET').length
      const gradeCount = isTeacher ? Object.values(gradeDrafts).filter((v) => v.trim() !== '').length : 0
      const ok = window.confirm(
        `حضور و غیاب نهایی شود؟\n${faNum(students.filter((s) => s.status === 'PRESENT').length)} حاضر، ${faNum(absent)} غایب` +
          (unset ? `، ${faNum(unset)} ثبت‌نشده` : '') +
          (gradeCount ? `، ${faNum(gradeCount)} نمره` : '') +
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
            .map((s) => ({ studentId: s.studentId, status: s.status })),
          // نمرات این روز (درخواست کاربر) — فقط نقش معلم ارسال می‌کند
          ...(isTeacher
            ? {
                grades: students.map((s) => ({
                  studentId: s.studentId,
                  score: gradeDrafts[s.studentId] ?? '',
                })),
                gradeTitle: gradeTitle.trim(),
                gradeLessonId: gradeLessonId || null,
              }
            : {}),
          ...(finalize ? { action: 'finalize' } : {}),
        }),
      })
      const d = await res.json()
      if (!res.ok) {
        // خطاهای اجباری‌بودن عنوان/درس نمره از سرور — همان پیام کاربر با حالت خطا
        if (d.error === GRADE_TITLE_REQUIRED_MSG) setGradeTitleError(true)
        if (d.error === GRADE_LESSON_REQUIRED_MSG) setGradeLessonError(true)
        sonnerToast.error(d.error ?? 'ذخیره انجام نشد')
        return
      }
      setSession((prev) => (prev ? { ...prev, status: d.session.status } : prev))
      setEditing(false)
      sonnerToast.success(
        finalize
          ? isTeacher && hasAnyGradeDraft
            ? 'جلسه و نمرات نهایی شد — اعلان خصوصی برای دانش‌آموزان ارسال شد'
            : 'جلسه نهایی شد — اعلان خصوصی برای دانش‌آموزان ارسال شد'
          : isTeacher && hasAnyGradeDraft
            ? 'پیش‌نویس و نمرات ذخیره شد — می‌توانید بعداً ادامه دهید و نهایی کنید'
            : 'پیش‌نویس ذخیره شد — می‌توانید بعداً ادامه دهید و نهایی کنید',
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
  // مالکیت جلسه (درخواست کاربر): معلم جلسهٔ معلم دیگر را فقط می‌بیند —
  // جلسهٔ خودش را از دیالوگ روز می‌سازد (ساخت خودکار)
  const isForeignTeacherSession =
    isTeacher && session.canManageRecords === false
  const canEdit = (!isFinalized || editing) && !isForeignTeacherSession
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
          {violations.length ? ` · ${faNum(violations.length)} تخلف` : ''}
          {grades.length ? ` · ${faNum(grades.length)} نمره` : ''}
        </span>
      </div>

      {isFinalized && !editing && !isForeignTeacherSession && (
        <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
          این جلسه نهایی شده است. برای اصلاح وضعیت‌ها دکمه «اصلاح وضعیت‌ها» را بزنید؛ هر تغییر با
          نام شما در سابقه اصلاحات ثبت می‌شود و اعلان اصلاح برای دانش‌آموز ارسال خواهد شد.
        </div>
      )}

      {isForeignTeacherSession && (
        <div
          className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-6"
          data-testid="foreign-session-notice"
          role="note"
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>
            این جلسه توسط «{session.creatorName ?? 'معلم دیگری'}» ایجاد شده است و فقط قابل مشاهده است.
            برای ثبت غیبت، نمره یا تخلفِ خودتان، جلسهٔ جدید بسازید — با باز کردن «ثبت غیبت/نمره/تخلف»
            در تقویم، جلسهٔ شما به‌صورت خودکار ساخته می‌شود.
          </span>
        </div>
      )}

      <div className="rounded-xl border divide-y">
        {/* سرستون‌ها برای معلم (درخواست کاربر — ستون «نمره») */}
        {isTeacher && students.length > 0 && (
          <div
            className="flex items-center gap-3 px-3 py-1.5 bg-muted/40 text-[11px] text-muted-foreground"
            data-testid="grade-column-header"
          >
            <span className="w-[18px] shrink-0" aria-hidden="true" />
            <span className="flex-1">دانش‌آموز و وضعیت حضور</span>
            <span className="w-20 sm:w-24 shrink-0 text-center font-medium">نمره</span>
            <span className="w-8 shrink-0" aria-hidden="true" />
          </div>
        )}
        {students.map((s) => {
          const studentViolations = violationsOf(s.studentId)
          const violationOpen = violationOpenFor === s.studentId
          // انتخاب‌های چندگانهٔ همین دانش‌آموز (فهرست انواع تخلف)
          const selectedViolations = selectedViolationsOf(s.studentId)
          const selectedCount = selectedViolations.length
          return (
            <div key={s.studentId} data-testid="att-student-row">
              <div className="flex items-center gap-3 px-3 py-2.5">
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
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-rose-500/15 text-rose-600 dark:text-rose-400">
                    غایب
                  </span>
                )}
                {/* ستون «نمره» (درخواست کاربر — فقط معلم) */}
                {isTeacher &&
                  (canEdit ? (
                    <Input
                      value={gradeDrafts[s.studentId] ?? ''}
                      onChange={(e) => setGradeDraft(s.studentId, e.target.value)}
                      placeholder="نمره"
                      className="h-8 w-20 sm:w-24 text-center text-xs shrink-0"
                      aria-label={`نمره ${s.fullName}`}
                      data-testid="grade-input"
                      maxLength={20}
                    />
                  ) : (
                    <span className="flex flex-wrap gap-1 justify-end shrink-0">
                      {gradesOf(s.studentId).map((g) => (
                        <Badge
                          key={g.id}
                          variant="secondary"
                          className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 text-[10px] gap-1"
                          title={`عنوان: ${g.title}${g.lessonName ? ` — درس: ${g.lessonName}` : ''}`}
                        >
                          <Award className="h-3 w-3" />
                          {g.lessonName ? `${g.lessonName}: ` : ''}
                          {g.score}
                        </Badge>
                      ))}
                    </span>
                  ))}
                {/* ثبت تخلف — آیکون منفی روبروی هر دانش‌آموز (مدیر/معاون/معلم) */}
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => openViolationForm(s.studentId)}
                  aria-expanded={violationOpen}
                  aria-label={`ثبت تخلف ${s.fullName}`}
                  title="ثبت تخلف"
                  data-testid="violation-toggle"
                  className={cn(
                    'relative h-8 w-8 shrink-0 text-muted-foreground',
                    violationOpen
                      ? 'bg-amber-500/15 text-amber-600 hover:text-amber-700 dark:text-amber-400'
                      : 'hover:text-amber-600 dark:hover:text-amber-400',
                    studentViolations.length > 0 && !violationOpen && 'text-amber-600 dark:text-amber-400',
                  )}
                >
                  <CircleMinus className="h-4.5 w-4.5" />
                  {studentViolations.length > 0 && (
                    <span
                      className="absolute -top-1 -left-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-bold text-white"
                      aria-label={`${faNum(studentViolations.length)} تخلف ثبت‌شده`}
                    >
                      {faNum(studentViolations.length)}
                    </span>
                  )}
                </Button>
              </div>
              {/* فیلد ثبت تخلف — فهرست چندانتخابی انواع تخلف (درخواست کاربر) */}
              {violationOpen && (
                <div
                  className="space-y-2 border-t border-dashed bg-amber-500/5 px-3 py-2.5"
                  data-testid="violation-form"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium">انواع تخلف برای {s.fullName}:</span>
                    {selectedCount > 0 && (
                      <Badge
                        variant="secondary"
                        className="bg-amber-500/15 text-amber-700 dark:text-amber-300 text-[10px]"
                      >
                        {faNum(selectedCount)} انتخاب
                      </Badge>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      className="ms-auto"
                      onClick={() => void saveViolations(s.studentId)}
                      disabled={savingViolation === s.studentId || selectedCount === 0}
                      data-testid="violation-save"
                    >
                      {savingViolation === s.studentId ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <CircleMinus className="h-4 w-4" />
                      )}
                      ثبت {selectedCount > 0 ? `(${faNum(selectedCount)})` : ''} تخلف
                    </Button>
                  </div>
                  {violationTypes === null ? (
                    <p className="text-[11px] text-muted-foreground">در حال بارگذاری انواع تخلف…</p>
                  ) : violationTypes.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">
                      هنوز نوع تخلفی تعریف نشده است — مدیر کل از پنل «مدیریت انواع تخلف» گزینه‌ها را تعریف می‌کند.
                    </p>
                  ) : (
                    <div
                      className="grid grid-cols-1 sm:grid-cols-2 gap-1.5"
                      role="group"
                      aria-label={`انتخاب انواع تخلف ${s.fullName}`}
                    >
                      {violationTypes.map((t) => {
                        const checked = selectedViolations.includes(t.label)
                        return (
                          <label
                            key={t.id}
                            className={cn(
                              'flex cursor-pointer select-none items-center gap-2 rounded-lg border p-2 text-xs transition-colors',
                              checked
                                ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                                : 'bg-card text-foreground hover:bg-accent',
                            )}
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={() => toggleViolationType(s.studentId, t.label)}
                              aria-label={t.label}
                              data-testid="violation-option"
                            />
                            <span className="min-w-0 flex-1 leading-5">{t.label}</span>
                          </label>
                        )
                      })}
                    </div>
                  )}
                  {studentViolations.length > 0 && (
                    <div className="space-y-1.5">
                      {studentViolations.map((v) => (
                        <div
                          key={v.id}
                          className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-card p-2 text-xs"
                          data-testid="violation-item"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="font-medium text-amber-700 dark:text-amber-300">
                              {v.text}
                            </span>
                            <span className="mt-0.5 block text-[10px] text-muted-foreground">
                              ثبت: {v.creatorName} · {faDateTime(v.createdAt)}
                            </span>
                          </span>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                            onClick={() => void deleteViolation(v.id)}
                            disabled={deletingViolation === v.id}
                            aria-label={`حذف تخلف ${s.fullName}`}
                            title="حذف تخلف"
                          >
                            {deletingViolation === v.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                  {studentViolations.length === 0 && (
                    <p className="text-[10px] text-muted-foreground">
                      تخلفی برای این دانش‌آموز در این روز ثبت نشده است — نوع تخلف را از فهرست انتخاب و «ثبت» را بزنید.
                    </p>
                  )}
                </div>
              )}
            </div>
          )
        })}
        {!students.length && (
          <div className="px-3 py-8 text-center text-sm text-muted-foreground">
            دانش‌آموزی در این کلاس ثبت‌نام نکرده است
          </div>
        )}
      </div>

      {/* ── فرم نمره (درخواست کاربر): فیلد «عنوان نمره» (اجباری با ثبت نمره) و «درس» (اجباری) ── */}
      {isTeacher && canEdit && students.length > 0 && (
        <div
          className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3 space-y-2"
          data-testid="grade-form"
        >
          <div className="flex items-center gap-2 text-sm font-bold">
            <GraduationCap className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            ثبت نمره این روز
            <Badge variant="secondary" className="text-[10px] font-normal text-muted-foreground">
              اختیاری
            </Badge>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`grade-title-${sessionId}`} className={cn(gradeTitleError && 'text-destructive')}>
                عنوان نمره {hasAnyGradeDraft ? '(اجباری — نمره ثبت کرده‌اید)' : '(اختیاری)'}
              </Label>
              <Input
                id={`grade-title-${sessionId}`}
                value={gradeTitle}
                onChange={(e) => {
                  setGradeTitle(e.target.value)
                  setGradeFormDirty(true)
                  if (e.target.value.trim()) setGradeTitleError(false)
                }}
                placeholder="مثلاً: آزمون مهر ماه"
                maxLength={120}
                data-testid="grade-title-input"
                className={cn(gradeTitleError && 'border-destructive focus-visible:ring-destructive')}
              />
              {gradeTitleError && (
                <p className="text-xs text-destructive" data-testid="grade-title-error" role="alert">
                  {GRADE_TITLE_REQUIRED_MSG}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label
                className={cn(
                  gradeLessonError && 'text-destructive',
                  (hasAnyGradeDraft || gradeLessonId) && 'font-bold',
                )}
              >
                درس {hasAnyGradeDraft ? '(اجباری — نمره ثبت کرده‌اید)' : '(اجباری)'}
              </Label>
              <Select
                value={gradeLessonId || undefined}
                onValueChange={(v) => {
                  setGradeLessonId(v)
                  changeGradeLesson(v)
                  if (v) setGradeLessonError(false)
                }}
              >
                <SelectTrigger
                  data-testid="grade-lesson-select"
                  aria-label="انتخاب درس"
                  className={cn(
                    gradeLessonError &&
                      'border-destructive focus-visible:ring-destructive',
                    !gradeLessonId && 'text-muted-foreground',
                  )}
                >
                  <SelectValue
                    placeholder={
                      teacherLessons === null
                        ? 'در حال بارگذاری درس‌ها…'
                        : teacherLessons.length === 0
                          ? 'درسی به شما منتسب نشده'
                          : 'انتخاب درس'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {(teacherLessons ?? []).map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {gradeLessonError && (
                <p className="text-xs text-destructive" data-testid="grade-lesson-error" role="alert">
                  {GRADE_LESSON_REQUIRED_MSG}
                </p>
              )}
              <p className="text-[11px] text-muted-foreground">
                انتخاب درس الزامی است — فهرست درس‌ها = درس‌های منتسب‌شده به شما از طرف مدیریت مدرسه
              </p>
            </div>
          </div>
        </div>
      )}

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

      {isFinalized && !editing && !isForeignTeacherSession && (
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
