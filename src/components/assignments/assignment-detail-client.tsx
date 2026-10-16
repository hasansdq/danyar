'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
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
import { useToast } from '@/hooks/use-toast'
import { getSocket } from '@/components/messenger/socket-client'
import {
  ArrowRight,
  Clock,
  Download,
  FileText,
  Loader2,
  Pencil,
  Paperclip,
  Trash2,
  User,
  Ban,
  SendHorizonal,
} from 'lucide-react'
import { faNum, faDateTime } from '@/lib/format'
import {
  SUBMISSION_STATUSES,
  SUBMISSION_STATUS_LABELS,
  SUBMISSION_STATUS_BADGE,
  FEEDBACK_STATUSES,
  FEEDBACK_STATUS_LABELS,
  FEEDBACK_STATUS_BADGE,
  ANSWER_MODE_LABELS,
  type SubmissionStatus,
  type FeedbackStatus,
  type AnswerMode,
} from '@/lib/assignment-status'
import {
  faBytes,
  isOverdue,
  uploadAssignmentFile,
  type AssignmentRow,
  type StagedFile,
} from './shared'
import { AssignmentFormDialog } from './assignment-form-dialog'
import { cn } from '@/lib/utils'

interface Attachment {
  url: string
  name: string
  mime: string
  size: number
}

interface AssignmentDetail {
  id: string
  title: string
  description: string
  answerMode: string
  allowEdit: boolean
  maxGrade: number | null
  dueAt: string | null
  createdAt: string
  subjectGroupId: string
  groupName: string
  classroomName: string
  archived: boolean
  teacherName: string
  attachment: Attachment | null
}

interface MySubmission {
  id: string
  text: string
  file: { url: string; name: string; size: number } | null
  submittedAt: string
  editedAt: string | null
  feedbackStatus: string
  feedbackNote: string | null
  grade: number | null
  reviewedAt: string | null
  status: SubmissionStatus
}

interface RosterRow {
  studentId: string
  fullName: string
  isActive: boolean
  submission: (MySubmission & { studentName: string }) | null
}

type DetailResponse = {
  access: 'MANAGE' | 'VIEW'
  role: string
  assignment: AssignmentDetail
  stats?: {
    total: number
    submitted: number
    late: number
    notSubmitted: number
    reviewed: number
    awaitingReview: number
  }
  mySubmission?: MySubmission | null
}

export function AssignmentDetailClient({ id, role }: { id: string; role: string }) {
  const router = useRouter()
  const { toast } = useToast()
  const [data, setData] = useState<DetailResponse | null>(null)
  const [roster, setRoster] = useState<RosterRow[] | null>(null)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState<'ALL' | SubmissionStatus>('ALL')
  const [editOpen, setEditOpen] = useState(false)
  const [feedbackTarget, setFeedbackTarget] = useState<RosterRow | null>(null)
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; count: number; message: string }>({
    open: false,
    count: 0,
    message: '',
  })
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/assignments/${id}`, { cache: 'no-store' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        setError(d.error ?? 'خطا در دریافت تکلیف')
        setData(null)
        return
      }
      setError('')
      setData(d)
      if (d.access && d.role !== 'STUDENT') {
        loadRoster()
      }
    } catch {
      setError('ارتباط با سرور ناموفق بود')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const loadRoster = useCallback(async () => {
    try {
      const r = await fetch(`/api/assignments/${id}/submissions`, { cache: 'no-store' })
      if (!r.ok) return
      const d = await r.json()
      setRoster(d.roster ?? [])
    } catch {
      /* ignore */
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  // به‌روزرسانی بلادرنگ
  useEffect(() => {
    const socket = getSocket()
    const onUpdate = (e: { assignmentId?: string; action?: string } | undefined) => {
      if (e?.assignmentId && e.assignmentId !== id) return
      if (reloadTimer.current) clearTimeout(reloadTimer.current)
      reloadTimer.current = setTimeout(() => {
        load()
      }, 600)
    }
    socket.on('assignments:update', onUpdate)
    return () => {
      socket.off('assignments:update', onUpdate)
    }
  }, [id, load])

  if (error) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-8">
        <Button variant="ghost" onClick={() => router.back()} className="mb-4">
          <ArrowRight className="h-4 w-4" />
          بازگشت
        </Button>
        <div className="flex flex-col items-center gap-3 rounded-xl border bg-card py-14 text-center">
          <Ban className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-3 px-4 py-5">
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    )
  }

  const a = data.assignment
  const isStudent = data.role === 'STUDENT'
  const canManage = data.access === 'MANAGE' && data.role === 'TEACHER'

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-5">
      <div className="mb-4 flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link href={isStudent ? '/assignments/my' : '/assignments'} className="flex items-center gap-1 hover:text-foreground">
          <ArrowRight className="h-4 w-4" />
          {isStudent ? 'تکالیف من' : 'تکالیف'}
        </Link>
      </div>

      {/* مشخصات تکلیف */}
      <div className="rounded-xl border bg-card p-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FileText className="h-5.5 w-5.5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-bold">{a.title}</h1>
              {a.archived && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                  گروه بایگانی‌شده
                </span>
              )}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
                {a.groupName}
              </span>
              <span>{a.classroomName}</span>
              <span className="flex items-center gap-1">
                <User className="h-3.5 w-3.5" />
                {a.teacherName}
              </span>
              {a.dueAt && (
                <span
                  className={cn(
                    'flex items-center gap-1',
                    isOverdue(a.dueAt) && 'font-medium text-amber-600 dark:text-amber-400',
                  )}
                >
                  <Clock className="h-3.5 w-3.5" />
                  مهلت: {faDateTime(a.dueAt)}
                  {isOverdue(a.dueAt) && ' (گذشته)'}
                </span>
              )}
              <span>نحوه ارسال: {ANSWER_MODE_LABELS[a.answerMode as AnswerMode] ?? a.answerMode}</span>
              {!isStudent && (
                <span>
                  اصلاح پاسخ: {a.allowEdit ? 'مجاز' : 'غیرمجاز'}
                </span>
              )}
              {a.maxGrade != null && <span>نمره بیشینه: {faNum(a.maxGrade)}</span>}
            </div>
          </div>
          {canManage && !a.archived && (
            <div className="flex shrink-0 gap-1.5">
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                <Pencil className="h-4 w-4" />
                ویرایش
              </Button>
              <DeleteButton
                id={a.id}
                dialog={deleteDialog}
                setDialog={setDeleteDialog}
                onDeleted={() => router.push('/assignments')}
              />
            </div>
          )}
        </div>

        {a.description && (
          <p className="mt-3 whitespace-pre-wrap border-t pt-3 text-sm leading-7 text-foreground/90">
            {a.description}
          </p>
        )}

        {a.attachment && (
          <a
            href={a.attachment.url}
            target="_blank"
            rel="noreferrer"
            className="mt-3 flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm transition-colors hover:bg-accent"
          >
            <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate font-medium">{a.attachment.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{faBytes(a.attachment.size)}</span>
            <Download className="h-4 w-4 shrink-0 text-muted-foreground" />
          </a>
        )}
      </div>

      {isStudent ? (
        <StudentPanel assignment={a} submission={data.mySubmission ?? null} onChanged={load} />
      ) : (
        <TeacherPanel
          assignment={a}
          access={data.access}
          stats={data.stats}
          roster={roster}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          onFeedback={(row) => setFeedbackTarget(row)}
        />
      )}

      {/* ویرایش تکلیف */}
      {canManage && (
        <AssignmentFormDialog
          groups={[
            { id: a.subjectGroupId, name: a.groupName, classroomName: a.classroomName },
          ]}
          open={editOpen}
          onOpenChange={setEditOpen}
          initial={a as unknown as AssignmentRow}
          onSaved={load}
        />
      )}

      {/* ثبت بازخورد */}
      {feedbackTarget && (
        <FeedbackDialog
          assignment={a}
          row={feedbackTarget}
          onClose={() => setFeedbackTarget(null)}
          onSaved={() => {
            setFeedbackTarget(null)
            load()
          }}
        />
      )}
    </div>
  )
}

/* ─── دکمه حذف تکلیف (دو مرحله‌ای در صورت وجود پاسخ) ─── */
function DeleteButton({
  id,
  dialog,
  setDialog,
  onDeleted,
}: {
  id: string
  dialog: { open: boolean; count: number; message: string }
  setDialog: (d: { open: boolean; count: number; message: string }) => void
  onDeleted: () => void
}) {
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)

  const requestDelete = async () => {
    setBusy(true)
    try {
      const r = await fetch(`/api/assignments/${id}`, { method: 'DELETE' })
      const d = await r.json().catch(() => ({}))
      if (r.status === 409) {
        setDialog({
          open: true,
          count: d.submissions ?? 0,
          message:
            d.error ??
            'این تکلیف پاسخ ثبت‌شده دارد و با حذف آن همه پاسخ‌ها و بازخوردها پاک می‌شوند',
        })
        return
      }
      if (!r.ok) {
        toast({ title: 'خطا', description: d.error ?? 'حذف ناموفق بود', variant: 'destructive' })
        return
      }
      toast({ title: 'تکلیف حذف شد' })
      onDeleted()
    } finally {
      setBusy(false)
    }
  }

  const confirmDelete = async () => {
    setBusy(true)
    try {
      const r = await fetch(`/api/assignments/${id}?confirm=true`, { method: 'DELETE' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast({ title: 'خطا', description: d.error ?? 'حذف ناموفق بود', variant: 'destructive' })
        return
      }
      toast({ title: 'تکلیف و همه پاسخ‌های آن حذف شد' })
      setDialog({ open: false, count: 0, message: '' })
      onDeleted()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="text-red-600 hover:bg-red-500/10 hover:text-red-600 dark:text-red-400"
        onClick={requestDelete}
        disabled={busy}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        حذف
      </Button>

      <AlertDialog
        open={dialog.open}
        onOpenChange={(v) => setDialog({ open: v, count: dialog.count, message: dialog.message })}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف تکلیف</AlertDialogTitle>
            <AlertDialogDescription>
              {dialog.message}
              {dialog.count > 0 && (
                <span className="mt-2 block font-medium text-foreground">
                  تعداد پاسخ‌های ثبت‌شده: {faNum(dialog.count)}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>انصراف</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              حذف قطعی
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/* ─── پنل دانش‌آموز: ارسال/ویرایش پاسخ + مشاهده بازخورد و نمره ─── */
function StudentPanel({
  assignment,
  submission,
  onChanged,
}: {
  assignment: AssignmentDetail
  submission: MySubmission | null
  onChanged: () => void
}) {
  const { toast } = useToast()
  const mode = assignment.answerMode as AnswerMode
  const reviewed = !!submission?.reviewedAt
  const editLocked = !!submission && !assignment.allowEdit
  const archived = assignment.archived
  const readOnly = reviewed || editLocked || archived

  const [text, setText] = useState(submission?.text ?? '')
  const [file, setFile] = useState<StagedFile | null>(null)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  // همگام‌سازی پس از بارگذاری پاسخ
  useEffect(() => {
    setText(submission?.text ?? '')
    setFile(null)
  }, [submission?.id, submission?.text])

  const pickFile = async (f: File | null) => {
    if (!f) return
    setUploading(true)
    setErr('')
    try {
      const staged = await uploadAssignmentFile(f)
      setFile(staged)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'آپلود ناموفق بود')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const submit = async () => {
    setErr('')
    const hasFile = !!file || !!submission?.file
    if (mode === 'TEXT' && !text.trim()) return setErr('متن پاسخ را وارد کنید')
    if (mode === 'FILE' && !hasFile) return setErr('فایل پاسخ را انتخاب کنید')
    if (mode === 'BOTH' && !text.trim() && !hasFile) return setErr('متن یا فایل پاسخ را ارسال کنید')

    setSaving(true)
    try {
      const payload: Record<string, unknown> = { text: text.trim() }
      if (file) payload.attachment = file
      const r = await fetch(`/api/assignments/${assignment.id}/submission`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        setErr(d.error ?? 'ثبت پاسخ ناموفق بود')
        return
      }
      toast({ title: submission ? 'پاسخ شما به‌روزرسانی شد' : 'پاسخ شما ثبت شد' })
      setFile(null)
      onChanged()
    } catch {
      setErr('ارتباط با سرور ناموفق بود')
    } finally {
      setSaving(false)
    }
  }

  const status = submission?.status ?? 'NOT_SUBMITTED'

  return (
    <div className="mt-4 space-y-4">
      {/* وضعیت ارسال */}
      <div className="rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="text-sm font-bold">وضعیت شما</h2>
          <span
            className={cn('rounded-full px-2.5 py-1 text-xs font-bold', SUBMISSION_STATUS_BADGE[status])}
          >
            {SUBMISSION_STATUS_LABELS[status]}
          </span>
          {submission && (
            <span className="text-xs text-muted-foreground">
              ارسال: {faDateTime(submission.submittedAt)}
              {submission.editedAt && ` — آخرین ویرایش: ${faDateTime(submission.editedAt)}`}
            </span>
          )}
        </div>

        {submission && (
          <div className="mt-3 space-y-2 border-t pt-3 text-sm">
            {submission.text && (
              <p className="whitespace-pre-wrap leading-7 text-foreground/90">{submission.text}</p>
            )}
            {submission.file && (
              <a
                href={submission.file.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm transition-colors hover:bg-accent"
              >
                <Paperclip className="h-4 w-4 text-muted-foreground" />
                <span className="max-w-64 truncate">{submission.file.name}</span>
                <Download className="h-4 w-4 text-muted-foreground" />
              </a>
            )}
          </div>
        )}
      </div>

      {/* بازخورد معلم */}
      {submission && submission.feedbackStatus !== 'UNSEEN' && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
          <h2 className="mb-2.5 text-sm font-bold">بازخورد معلم</h2>
          <div className="flex flex-wrap items-center gap-2.5 text-sm">
            <span
              className={cn(
                'rounded-full px-2.5 py-1 text-xs font-bold',
                FEEDBACK_STATUS_BADGE[submission.feedbackStatus as FeedbackStatus],
              )}
            >
              {FEEDBACK_STATUS_LABELS[submission.feedbackStatus as FeedbackStatus]}
            </span>
            {submission.grade != null && (
              <span className="font-bold text-emerald-700 dark:text-emerald-400">
                نمره: {faNum(submission.grade)}
                {assignment.maxGrade != null && ` از ${faNum(assignment.maxGrade)}`}
              </span>
            )}
          </div>
          {submission.feedbackNote && (
            <p className="mt-2.5 whitespace-pre-wrap border-t border-emerald-500/20 pt-2.5 text-sm leading-7">
              {submission.feedbackNote}
            </p>
          )}
        </div>
      )}

      {/* فرم ارسال/ویرایش پاسخ */}
      <div className="rounded-xl border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-bold">
            {submission ? 'ویرایش پاسخ' : 'ارسال پاسخ'}
          </h2>
          <span className="text-xs text-muted-foreground">
            ({ANSWER_MODE_LABELS[mode]})
          </span>
        </div>

        {readOnly ? (
          <div className="rounded-lg bg-muted/60 px-3 py-2.5 text-sm text-muted-foreground">
            {reviewed
              ? 'پاسخ شما بررسی شده است و امکان تغییر آن وجود ندارد.'
              : editLocked
                ? 'بر اساس قوانین این تکلیف، امکان اصلاح پاسخ پس از ارسال وجود ندارد.'
                : 'گروه این تکلیف بایگانی شده است.'}
          </div>
        ) : (
          <>
            {(mode === 'TEXT' || mode === 'BOTH') && (
              <div className="space-y-1.5">
                <Label htmlFor="s-text">متن پاسخ</Label>
                <Textarea
                  id="s-text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="پاسخ خود را بنویسید..."
                  rows={5}
                  maxLength={8000}
                />
              </div>
            )}

            {(mode === 'FILE' || mode === 'BOTH') && (
              <div className="space-y-1.5">
                <Label>فایل پاسخ</Label>
                {file || submission?.file ? (
                  <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                    <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">
                      {file ? file.name : submission?.file?.name}
                    </span>
                    {file ? (
                      <span className="shrink-0 text-xs font-medium text-primary">فایل جدید</span>
                    ) : submission?.file ? (
                      <a
                        href={submission.file.url}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 text-xs text-primary hover:underline"
                      >
                        دانلود
                      </a>
                    ) : null}
                    {file && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => {
                          setFile(null)
                          if (fileRef.current) fileRef.current.value = ''
                        }}
                        aria-label="حذف فایل انتخابی"
                      >
                        ×
                      </Button>
                    )}
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
                      {uploading ? 'در حال آپلود...' : 'انتخاب فایل پاسخ'}
                    </Button>
                  </div>
                )}
                {submission?.file && (
                  <p className="text-xs text-muted-foreground">
                    فایل قبلی تا زمان ثبت پاسخ جدید حفظ می‌شود
                  </p>
                )}
              </div>
            )}

            {err && (
              <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
                {err}
              </p>
            )}

            <div className="mt-3 flex items-center gap-2">
              <Button onClick={submit} disabled={saving || uploading}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizonal className="h-4 w-4" />}
                {submission ? 'به‌روزرسانی پاسخ' : 'ثبت پاسخ'}
              </Button>
              {assignment.dueAt && isOverdue(assignment.dueAt) && !submission && (
                <span className="text-xs text-amber-600 dark:text-amber-400">
                  مهلت گذشته است؛ پاسخ شما «دیرهنگام» ثبت می‌شود
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/* ─── پنل معلم/مدیر: فهرست وضعیت دانش‌آموزان ─── */
function TeacherPanel({
  assignment,
  access,
  stats,
  roster,
  statusFilter,
  setStatusFilter,
  onFeedback,
}: {
  assignment: AssignmentDetail
  access: 'MANAGE' | 'VIEW'
  stats?: DetailResponse['stats']
  roster: RosterRow[] | null
  statusFilter: 'ALL' | SubmissionStatus
  setStatusFilter: (s: 'ALL' | SubmissionStatus) => void
  onFeedback: (row: RosterRow) => void
}) {
  const filtered =
    roster?.filter((r) => {
      const st = r.submission?.status ?? 'NOT_SUBMITTED'
      return statusFilter === 'ALL' ? true : st === statusFilter
    }) ?? []

  return (
    <div className="mt-4 space-y-3">
      {/* آمار */}
      {stats && (
        <div className="flex flex-wrap gap-1.5 text-xs">
          <span className="rounded-full bg-muted px-2.5 py-1">
            کل: {faNum(stats.total)}
          </span>
          <span className="rounded-full bg-blue-500/10 px-2.5 py-1 text-blue-600 dark:text-blue-400">
            ارسال‌شده: {faNum(stats.submitted)}
          </span>
          <span className="rounded-full bg-muted px-2.5 py-1 text-muted-foreground">
            ارسال‌نشده: {faNum(stats.notSubmitted)}
          </span>
          {stats.late > 0 && (
            <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-amber-600 dark:text-amber-400">
              دیرهنگام: {faNum(stats.late)}
            </span>
          )}
          <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-emerald-600 dark:text-emerald-400">
            بررسی‌شده: {faNum(stats.reviewed)}
          </span>
          {stats.awaitingReview > 0 && (
            <span className="rounded-full bg-red-500/10 px-2.5 py-1 text-red-600 dark:text-red-400">
              در انتظار بازخورد: {faNum(stats.awaitingReview)}
            </span>
          )}
        </div>
      )}

      {/* فیلتر وضعیت */}
      <div className="flex flex-wrap gap-1.5">
        {(['ALL', ...SUBMISSION_STATUSES] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={cn(
              'rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
              statusFilter === s
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-accent',
            )}
          >
            {s === 'ALL' ? 'همه' : SUBMISSION_STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      {/* فهرست دانش‌آموزان */}
      {roster === null ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border bg-card py-10 text-center text-sm text-muted-foreground">
          {roster.length === 0
            ? 'هنوز دانش‌آموزی عضو این گروه نیست'
            : 'در این وضعیت دانش‌آموزی وجود ندارد'}
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((row) => {
            const st = row.submission?.status ?? 'NOT_SUBMITTED'
            const fb = row.submission?.feedbackStatus ?? 'UNSEEN'
            return (
              <li key={row.studentId} className="rounded-xl border bg-card p-3.5">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                    {row.fullName.trim().charAt(0)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-bold">{row.fullName}</span>
                      {!row.isActive && (
                        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          غیرفعال
                        </span>
                      )}
                    </div>
                    {row.submission ? (
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        ارسال: {faDateTime(row.submission.submittedAt)}
                        {row.submission.editedAt && ' — ویرایش‌شده'}
                      </div>
                    ) : (
                      <div className="mt-0.5 text-xs text-muted-foreground">پاسخی ارسال نشده است</div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={cn(
                        'rounded-full px-2.5 py-1 text-[11px] font-bold',
                        SUBMISSION_STATUS_BADGE[st],
                      )}
                    >
                      {SUBMISSION_STATUS_LABELS[st]}
                    </span>
                    <span
                      className={cn(
                        'rounded-full px-2.5 py-1 text-[11px] font-medium',
                        FEEDBACK_STATUS_BADGE[fb as FeedbackStatus],
                      )}
                    >
                      {FEEDBACK_STATUS_LABELS[fb as FeedbackStatus]}
                    </span>
                    {row.submission?.grade != null && (
                      <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                        نمره: {faNum(row.submission.grade)}
                      </span>
                    )}
                    {access === 'MANAGE' && row.submission && !assignment.archived && (
                      <Button variant="outline" size="sm" onClick={() => onFeedback(row)}>
                        بازخورد
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/* ─── دیالوگ ثبت بازخورد و نمره ─── */
function FeedbackDialog({
  assignment,
  row,
  onClose,
  onSaved,
}: {
  assignment: AssignmentDetail
  row: RosterRow
  onClose: () => void
  onSaved: () => void
}) {
  const { toast } = useToast()
  const sub = row.submission
  const [status, setStatus] = useState<FeedbackStatus>((sub?.feedbackStatus as FeedbackStatus) ?? 'UNSEEN')
  const [grade, setGrade] = useState(sub?.grade != null ? String(sub.grade) : '')
  const [note, setNote] = useState(sub?.feedbackNote ?? '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const save = async () => {
    setErr('')
    setSaving(true)
    try {
      const r = await fetch(`/api/assignments/${assignment.id}/feedback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          studentId: row.studentId,
          feedbackStatus: status,
          grade: grade === '' ? null : Number(grade),
          note: note.trim() || null,
        }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        setErr(d.error ?? 'ثبت بازخورد ناموفق بود')
        return
      }
      toast({ title: 'بازخورد ثبت شد', description: 'اعلان برای دانش‌آموز ارسال شد' })
      onSaved()
    } catch {
      setErr('ارتباط با سرور ناموفق بود')
    } finally {
      setSaving(false)
    }
  }

  const maxGrade = assignment.maxGrade ?? 100

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>بازخورد تکلیف</DialogTitle>
          <DialogDescription>
            {row.fullName} — {assignment.title}
          </DialogDescription>
        </DialogHeader>

        {sub && (
          <div className="space-y-3 rounded-lg border bg-muted/30 p-3 text-sm">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 font-bold',
                  SUBMISSION_STATUS_BADGE[sub.status],
                )}
              >
                {SUBMISSION_STATUS_LABELS[sub.status]}
              </span>
              <span>ارسال: {faDateTime(sub.submittedAt)}</span>
            </div>
            {sub.text && <p className="whitespace-pre-wrap leading-7">{sub.text}</p>}
            {sub.file && (
              <a
                href={sub.file.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm transition-colors hover:bg-accent"
              >
                <Paperclip className="h-4 w-4 text-muted-foreground" />
                <span className="max-w-56 truncate">{sub.file.name}</span>
                <Download className="h-4 w-4 text-muted-foreground" />
              </a>
            )}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>وضعیت بازخورد</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as FeedbackStatus)}>
              <SelectTrigger dir="rtl" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FEEDBACK_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {FEEDBACK_STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fb-grade">
              نمره {assignment.maxGrade != null ? `(از ${faNum(maxGrade)})` : '(اختیاری)'}
            </Label>
            <Input
              id="fb-grade"
              type="number"
              min={0}
              max={maxGrade}
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              placeholder={`۰ تا ${faNum(maxGrade)}`}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="fb-note">توضیح بازخورد (اختیاری)</Label>
          <Textarea
            id="fb-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder="نکات تکمیلی برای دانش‌آموز..."
          />
        </div>

        {err && (
          <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
            {err}
          </p>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            انصراف
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            ثبت بازخورد
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
