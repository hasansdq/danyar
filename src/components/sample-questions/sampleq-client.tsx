'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  BookOpen,
  Search,
  Star,
  Loader2,
  Plus,
  FileText,
  FileCheck2,
  Users,
  MoreVertical,
  Pencil,
  Rocket,
  RocketIcon,
  Trash2,
  ClipboardList,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import { cn } from '@/lib/utils'
import { faDate } from '@/lib/format'
import {
  SampleQFormDialog,
  type SampleQMeta,
  type SampleQFormData,
} from './sampleq-form-dialog'

interface SampleQRow {
  id: string
  title: string
  subject: string
  topic: string | null
  description: string
  showAnswer: boolean
  status: string
  publishedAt: string | null
  createdAt: string
  teacherName: string
  canManage: boolean
  classes: { id: string; name: string }[]
  questionFileCount: number
  answerFileCount: number
  bookmarked: boolean
}

type Role = 'SCHOOL_ADMIN' | 'SCHOOL_VICE' | 'TEACHER' | 'STUDENT'

/**
 * کتابخانه نمونه‌سؤالات — کارت‌های منظم با جست‌وجو، فیلتر، صفحه‌بندی تدریجی،
 * نشان‌گذاری دانش‌آموز و مدیریت معلم/مدیر مدرسه
 */
export function SampleQClient({ role }: { role: Role }) {
  const [items, setItems] = useState<SampleQRow[] | null>(null)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [total, setTotal] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [meta, setMeta] = useState<SampleQMeta | null>(null)
  const [teachers, setTeachers] = useState<{ id: string; fullName: string }[]>([])

  const [q, setQ] = useState('')
  const [subject, setSubject] = useState('')
  const [classId, setClassId] = useState('')
  const [teacherId, setTeacherId] = useState('')
  const [status, setStatus] = useState('')
  const [bookmarkedOnly, setBookmarkedOnly] = useState(false)
  const [availableSubjects, setAvailableSubjects] = useState<string[]>([])

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<SampleQRow | null>(null)
  const [editingForm, setEditingForm] = useState<SampleQFormData | null>(null)
  const [deleting, setDeleting] = useState<SampleQRow | null>(null)
  const [busyAction, setBusyAction] = useState(false)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isStaff = role !== 'STUDENT'

  const buildQuery = useCallback(
    (p: number) => {
      const sp = new URLSearchParams()
      sp.set('page', String(p))
      sp.set('pageSize', '20')
      if (q.trim()) sp.set('q', q.trim())
      if (subject) sp.set('subject', subject)
      if (classId) sp.set('classId', classId)
      if (teacherId) sp.set('teacherId', teacherId)
      if (status) sp.set('status', status)
      if (bookmarkedOnly) sp.set('bookmarked', '1')
      return sp.toString()
    },
    [q, subject, classId, teacherId, status, bookmarkedOnly],
  )

  const loadMeta = useCallback(async () => {
    if (!isStaff) return
    try {
      const r = await fetch('/api/sample-questions/classes', { cache: 'no-store' })
      if (r.ok) setMeta(await r.json())
    } catch {
      /* ignore */
    }
  }, [isStaff])

  const loadPage = useCallback(
    async (p: number, append: boolean) => {
      if (append) setLoadingMore(true)
      try {
        const r = await fetch(`/api/sample-questions?${buildQuery(p)}`, {
          cache: 'no-store',
        })
        if (!r.ok) {
          if (!append) setItems([])
          return
        }
        const d = await r.json()
        setAvailableSubjects(d.subjects ?? [])
        setTeachers(d.teachers ?? [])
        setTotal(d.total ?? 0)
        setHasMore(!!d.hasMore)
        setPage(p)
        setItems((prev) =>
          append ? [...(prev ?? []), ...(d.questions ?? [])] : (d.questions ?? []),
        )
      } catch {
        if (!append) setItems([])
      } finally {
        setLoadingMore(false)
      }
    },
    [buildQuery],
  )

  // بارگذاری اولیه + با تغییر فیلترها (جست‌وجو با تاخیر)
  useEffect(() => {
    loadMeta()
  }, [loadMeta])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => loadPage(1, false), q ? 350 : 0)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, subject, classId, teacherId, status, bookmarkedOnly])

  async function toggleBookmark(row: SampleQRow) {
    const next = !row.bookmarked
    setItems((prev) =>
      (prev ?? []).map((x) => (x.id === row.id ? { ...x, bookmarked: next } : x)),
    )
    try {
      const r = await fetch(`/api/sample-questions/${row.id}/bookmark`, {
        method: next ? 'POST' : 'DELETE',
      })
      if (!r.ok) throw new Error()
    } catch {
      setItems((prev) =>
        (prev ?? []).map((x) => (x.id === row.id ? { ...x, bookmarked: !next } : x)),
      )
    }
  }

  async function togglePublish(row: SampleQRow) {
    setBusyAction(true)
    try {
      const nextStatus = row.status === 'PUBLISHED' ? 'UNPUBLISHED' : 'PUBLISHED'
      const r = await fetch(`/api/sample-questions/${row.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      })
      if (r.ok) {
        setItems((prev) =>
          (prev ?? []).map((x) => (x.id === row.id ? { ...x, status: nextStatus } : x)),
        )
      }
    } finally {
      setBusyAction(false)
    }
  }

  async function confirmDelete() {
    if (!deleting) return
    setBusyAction(true)
    try {
      const r = await fetch(`/api/sample-questions/${deleting.id}`, { method: 'DELETE' })
      if (r.ok) {
        setItems((prev) => (prev ?? []).filter((x) => x.id !== deleting.id))
        setTotal((t) => Math.max(0, t - 1))
      }
    } finally {
      setBusyAction(false)
      setDeleting(null)
    }
  }

  /** باز کردن ویرایش — جزئیات فایل‌های موجود از سرور بارگذاری می‌شود تا در ویرایش حفظ شوند */
  async function openEdit(row: SampleQRow) {
    setEditing(row)
    setFormOpen(true)
    const base: SampleQFormData = {
      id: row.id,
      title: row.title,
      subject: row.subject,
      topic: row.topic ?? '',
      description: row.description,
      classIds: row.classes.map((c) => c.id),
      showAnswer: row.showAnswer,
      published: row.status === 'PUBLISHED',
      keepQuestionFileIds: [],
      keepAnswerFileIds: [],
      questionFiles: [],
      answerFiles: [],
    }
    try {
      const r = await fetch(`/api/sample-questions/${row.id}`, { cache: 'no-store' })
      if (r.ok) {
        const d = await r.json()
        setEditingForm({
          ...base,
          title: d.title,
          subject: d.subject,
          topic: d.topic ?? '',
          description: d.description,
          classIds: d.classes.map((c: { id: string }) => c.id),
          showAnswer: d.showAnswer,
          published: d.status === 'PUBLISHED',
          keepQuestionFileIds: d.questionFiles.map((f: { id: string }) => f.id),
          keepAnswerFileIds: d.answerFiles.map((f: { id: string }) => f.id),
          questionFiles: d.questionFiles.map((f: { id: string; name: string; mime: string; size: number }) => ({
            id: f.id, name: f.name, mime: f.mime, size: f.size,
          })),
          answerFiles: d.answerFiles.map((f: { id: string; name: string; mime: string; size: number }) => ({
            id: f.id, name: f.name, mime: f.mime, size: f.size,
          })),
        })
        return
      }
    } catch {
      /* fallback */
    }
    setEditingForm(base)
  }

  return (
    <div className="mx-auto w-full max-w-4xl p-4 lg:p-6 space-y-4">
      {/* سربرگ */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg lg:text-xl font-bold flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" />
            نمونه‌سؤالات
          </h1>
          <p className="text-xs lg:text-sm text-muted-foreground mt-0.5">
            {role === 'STUDENT'
              ? 'نمونه‌سؤالات منتشرشده برای کلاس شما'
              : role === 'TEACHER'
                ? 'ایجاد و انتشار نمونه‌سؤال برای کلاس‌های شما'
                : 'همه نمونه‌سؤالات مدرسه شما'}
          </p>
        </div>
        {role === 'TEACHER' && (
          <Button
            onClick={() => {
              setEditing(null)
              setFormOpen(true)
            }}
            className="shrink-0"
          >
            <Plus className="h-4 w-4" />
            نمونه‌سؤال جدید
          </Button>
        )}
      </div>

      {/* جست‌وجو و فیلترها */}
      <div className="space-y-2.5">
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="جست‌وجوی عنوان، درس یا موضوع…"
            className="pr-9"
            aria-label="جست‌وجوی نمونه‌سؤال"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {availableSubjects.length > 0 && (
            <Select
              value={subject || 'all'}
              onValueChange={(v) => setSubject(v === 'all' ? '' : v)}
            >
              <SelectTrigger className="h-9 w-[150px] text-xs" aria-label="فیلتر درس">
                <SelectValue placeholder="همه درس‌ها" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">همه درس‌ها</SelectItem>
                {availableSubjects.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {role === 'SCHOOL_ADMIN' && (
            <>
              <Select
                value={classId || 'all'}
                onValueChange={(v) => setClassId(v === 'all' ? '' : v)}
              >
                <SelectTrigger className="h-9 w-[140px] text-xs" aria-label="فیلتر کلاس">
                  <SelectValue placeholder="همه کلاس‌ها" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">همه کلاس‌ها</SelectItem>
                  {(meta?.classrooms ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {teachers.length > 0 && (
                <Select
                  value={teacherId || 'all'}
                  onValueChange={(v) => setTeacherId(v === 'all' ? '' : v)}
                >
                  <SelectTrigger className="h-9 w-[150px] text-xs" aria-label="فیلتر معلم">
                    <SelectValue placeholder="همه معلمان" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">همه معلمان</SelectItem>
                    {teachers.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.fullName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </>
          )}

          {role === 'TEACHER' && (meta?.classrooms.length ?? 0) > 1 && (
            <Select
              value={classId || 'all'}
              onValueChange={(v) => setClassId(v === 'all' ? '' : v)}
            >
              <SelectTrigger className="h-9 w-[140px] text-xs" aria-label="فیلتر کلاس">
                <SelectValue placeholder="همه کلاس‌ها" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">همه کلاس‌ها</SelectItem>
                {(meta?.classrooms ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {isStaff && (
            <Select
              value={status || 'all'}
              onValueChange={(v) => setStatus(v === 'all' ? '' : v)}
            >
              <SelectTrigger className="h-9 w-[130px] text-xs" aria-label="فیلتر وضعیت انتشار">
                <SelectValue placeholder="همه وضعیت‌ها" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">همه وضعیت‌ها</SelectItem>
                <SelectItem value="PUBLISHED">منتشرشده</SelectItem>
                <SelectItem value="UNPUBLISHED">پیش‌نویس</SelectItem>
              </SelectContent>
            </Select>
          )}

          {role === 'STUDENT' && (
            <label className="flex items-center gap-2 rounded-lg border px-3 h-9 text-xs cursor-pointer hover:bg-accent">
              <Checkbox
                checked={bookmarkedOnly}
                onCheckedChange={(v) => setBookmarkedOnly(v === true)}
                aria-label="فقط نشان‌دارها"
              />
              <Star className="h-3.5 w-3.5 text-amber-500" />
              فقط نشان‌دارها
            </label>
          )}
        </div>
      </div>

      {/* فهرست کارت‌ها */}
      {items === null ? (
        <div className="space-y-2.5">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <BookOpen className="mx-auto h-10 w-10 text-muted-foreground/40" />
          <p className="mt-3 text-sm font-medium">نمونه‌سؤالی یافت نشد</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {role === 'STUDENT'
              ? bookmarkedOnly
                ? 'هنوز نمونه‌سؤالی نشان نکرده‌اید'
                : 'فعلاً نمونه‌سؤالی برای کلاس شما منتشر نشده است'
              : q || subject || classId || status
                ? 'با این فیلترها موردی یافت نشد'
                : 'اولین نمونه‌سؤال خود را ایجاد کنید'}
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {items.map((row) => (
            <SampleQCard
              key={row.id}
              row={row}
              role={role}
              onBookmark={() => toggleBookmark(row)}
              onEdit={() => openEdit(row)}
              onTogglePublish={() => togglePublish(row)}
              onDelete={() => setDeleting(row)}
              busy={busyAction}
            />
          ))}

          {hasMore && (
            <Button
              variant="outline"
              className="w-full"
              disabled={loadingMore}
              onClick={() => loadPage(page + 1, true)}
            >
              {loadingMore ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'بارگذاری بیشتر'
              )}
            </Button>
          )}

          <p className="text-center text-[11px] text-muted-foreground">
            {total} نمونه‌سؤال
          </p>
        </div>
      )}

      {/* فرم ایجاد/ویرایش */}
      {isStaff && (
        <SampleQFormDialog
          open={formOpen}
          onOpenChange={(open) => {
            setFormOpen(open)
            if (!open) {
              setEditing(null)
              setEditingForm(null)
            }
          }}
          mode={editing ? 'edit' : 'create'}
          initial={editing ? editingForm : null}
          meta={meta}
          onSaved={() => loadPage(1, false)}
        />
      )}

      {/* حذف با تأیید */}
      <AlertDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف نمونه‌سؤال</AlertDialogTitle>
            <AlertDialogDescription>
              «{deleting?.title}» و فایل‌های آن برای همیشه حذف می‌شود. این عمل بازگشت‌پذیر
              نیست.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyAction}>انصراف</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                confirmDelete()
              }}
              disabled={busyAction}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busyAction ? <Loader2 className="h-4 w-4 animate-spin" /> : 'حذف'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function SampleQCard({
  row,
  role,
  onBookmark,
  onEdit,
  onTogglePublish,
  onDelete,
  busy,
}: {
  row: SampleQRow
  role: Role
  onBookmark: () => void
  onEdit: () => void
  onTogglePublish: () => void
  onDelete: () => void
  busy: boolean
}) {
  return (
    <div className="group relative rounded-xl border bg-card p-3.5 transition-colors hover:border-primary/40">
      <div className="flex items-start gap-3">
        <Link
          href={`/sample-questions/${row.id}`}
          className="min-w-0 flex-1 space-y-2"
          aria-label={`نمایش نمونه‌سؤال ${row.title}`}
        >
          <div className="flex items-start gap-2">
            <h3 className="text-sm font-bold leading-6 flex-1 min-w-0 break-words">
              {row.title}
            </h3>
            {role === 'STUDENT' && (
              <button
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onBookmark()
                }}
                aria-label={row.bookmarked ? 'حذف نشان' : 'نشان‌گذاری برای دسترسی سریع'}
                className={cn(
                  'shrink-0 p-1 rounded-full transition-colors',
                  row.bookmarked
                    ? 'text-amber-500'
                    : 'text-muted-foreground/40 hover:text-amber-500',
                )}
              >
                <Star className={cn('h-4.5 w-4.5', row.bookmarked && 'fill-amber-400')} />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary" className="bg-sky-500/10 text-sky-700 dark:text-sky-400 text-[10.5px]">
              {row.subject}
            </Badge>
            {row.topic && (
              <Badge variant="outline" className="text-[10.5px]">
                {row.topic}
              </Badge>
            )}
            {row.questionFileCount > 0 && (
              <span className="inline-flex items-center gap-1 text-[10.5px] text-muted-foreground">
                <FileText className="h-3 w-3" />
                سؤال
              </span>
            )}
            {row.answerFileCount > 0 && (
              <span
                className={cn(
                  'inline-flex items-center gap-1 text-[10.5px]',
                  row.showAnswer
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-muted-foreground/60',
                )}
                title={row.showAnswer ? 'پاسخ‌نامه قابل مشاهده است' : 'پاسخ‌نامه غیرفعال است'}
              >
                <FileCheck2 className="h-3 w-3" />
                پاسخ‌نامه
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Users className="h-3 w-3" />
              {row.teacherName}
            </span>
            {role !== 'STUDENT' ? (
              <>
                <span className="truncate max-w-48">
                  {row.classes.map((c) => c.name).join('، ')}
                </span>
                <span
                  className={cn(
                    'font-medium',
                    row.status === 'PUBLISHED'
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-amber-600 dark:text-amber-400',
                  )}
                >
                  {row.status === 'PUBLISHED' ? 'منتشرشده' : 'پیش‌نویس'}
                </span>
              </>
            ) : (
              <span>{faDate(row.publishedAt ?? row.createdAt)}</span>
            )}
          </div>
        </Link>

        {/* عملیات معلم/مدیر */}
        {role !== 'STUDENT' && (row.canManage || role === 'SCHOOL_ADMIN') && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                aria-label="عملیات نمونه‌سؤال"
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {row.canManage && (
                <DropdownMenuItem onClick={onEdit}>
                  <Pencil className="h-4 w-4 ml-2" />
                  ویرایش
                </DropdownMenuItem>
              )}
              {row.canManage && (
                <DropdownMenuItem onClick={onTogglePublish} disabled={busy}>
                  {row.status === 'PUBLISHED' ? (
                    <>
                      <ClipboardList className="h-4 w-4 ml-2" />
                      لغو انتشار
                    </>
                  ) : (
                    <>
                      <Rocket className="h-4 w-4 ml-2" />
                      انتشار
                    </>
                  )}
                </DropdownMenuItem>
              )}
              {role === 'SCHOOL_ADMIN' && !row.canManage && (
                <DropdownMenuItem onClick={onTogglePublish} disabled={busy}>
                  <RocketIcon className="h-4 w-4 ml-2" />
                  لغو انتشار
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={onDelete}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-4 w-4 ml-2" />
                حذف
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  )
}
