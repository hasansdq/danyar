'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ArrowRight,
  BookOpen,
  FileText,
  FileCheck2,
  Download,
  Eye,
  Star,
  Users,
  CalendarDays,
  Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { faDate, faDateTime } from '@/lib/format'
import { formatSize } from '@/components/messenger/types'

interface SampleQFile {
  id: string
  role: string
  name: string
  mime: string
  size: number
  url: string
}

interface SampleQDetailData {
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
  canModerate: boolean
  classes: { id: string; name: string }[]
  questionFiles: SampleQFile[]
  answerFiles: SampleQFile[]
  answerHidden: boolean
  audiences: {
    id: string
    name: string
    studentCount: number
    students: { id: string; fullName: string }[]
  }[]
  bookmarked: boolean
}

type Role = 'SCHOOL_ADMIN' | 'SCHOOL_VICE' | 'TEACHER' | 'STUDENT'

function fileKind(mime: string): 'image' | 'pdf' | 'other' {
  if (mime.startsWith('image/')) return 'image'
  if (mime === 'application/pdf') return 'pdf'
  return 'other'
}

function FileRow({
  file,
  onPreview,
}: {
  file: SampleQFile
  onPreview: (f: SampleQFile) => void
}) {
  const kind = fileKind(file.mime)
  return (
    <div className="flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2.5">
      <span className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
        <FileText className="h-4.5 w-4.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium truncate">{file.name}</span>
        <span className="block text-[11px] text-muted-foreground">
          {formatSize(file.size)}
        </span>
      </span>
      {kind !== 'other' && (
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          onClick={() => onPreview(file)}
        >
          <Eye className="h-3.5 w-3.5" />
          نمایش
        </Button>
      )}
      <a
        href={file.url}
        download={file.name}
        className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 h-8 text-xs font-medium hover:bg-accent"
        aria-label={`دانلود ${file.name}`}
      >
        <Download className="h-3.5 w-3.5" />
        دانلود
      </a>
    </div>
  )
}

/**
 * جزئیات نمونه‌سؤال — پیش‌نمایش PDF و تصویر، دانلود مجاز، پاسخ‌نامه گیت‌شده
 * و نشان‌گذاری دانش‌آموز؛ همه دانلودها با احراز هویت و کنترل دسترسی سمت سرور
 */
export function SampleQDetail({ id, role }: { id: string; role: Role }) {
  const [data, setData] = useState<SampleQDetailData | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [preview, setPreview] = useState<SampleQFile | null>(null)
  const [bookmarked, setBookmarked] = useState(false)
  const [bookmarkBusy, setBookmarkBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/sample-questions/${id}`, { cache: 'no-store' })
      if (r.status === 404) {
        setNotFound(true)
        return
      }
      if (!r.ok) return
      const d = await r.json()
      setData(d)
      setBookmarked(!!d.bookmarked)
    } catch {
      setNotFound(true)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  async function toggleBookmark() {
    if (!data) return
    setBookmarkBusy(true)
    const next = !bookmarked
    setBookmarked(next)
    try {
      const r = await fetch(`/api/sample-questions/${data.id}/bookmark`, {
        method: next ? 'POST' : 'DELETE',
      })
      if (!r.ok) throw new Error()
    } catch {
      setBookmarked(!next)
    } finally {
      setBookmarkBusy(false)
    }
  }

  if (notFound) {
    return (
      <div className="mx-auto max-w-2xl p-6 text-center space-y-3">
        <BookOpen className="mx-auto h-12 w-12 text-muted-foreground/40" />
        <p className="font-bold">نمونه‌سؤال یافت نشد</p>
        <p className="text-xs text-muted-foreground">
          ممکن است حذف شده باشد یا دسترسی به آن نداشته باشید
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href="/sample-questions">
            <ArrowRight className="h-4 w-4" />
            بازگشت به نمونه‌سؤالات
          </Link>
        </Button>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-3xl p-4 lg:p-6 space-y-3">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    )
  }

  const isStaff = role !== 'STUDENT'

  return (
    <div className="mx-auto w-full max-w-3xl p-4 lg:p-6 space-y-4">
      {/* بازگشت */}
      <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
        <Link href="/sample-questions">
          <ArrowRight className="h-4 w-4" />
          بازگشت به نمونه‌سؤالات
        </Link>
      </Button>

      <div className="rounded-xl border bg-card p-4 lg:p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-lg lg:text-xl font-bold leading-8 break-words">{data.title}</h1>
          {role === 'STUDENT' && (
            <button
              onClick={toggleBookmark}
              disabled={bookmarkBusy}
              aria-label={bookmarked ? 'حذف نشان' : 'نشان‌گذاری برای دسترسی سریع'}
              className={cn(
                'shrink-0 p-1.5 rounded-full transition-colors',
                bookmarked ? 'text-amber-500' : 'text-muted-foreground/40 hover:text-amber-500',
              )}
            >
              <Star className={cn('h-5 w-5', bookmarked && 'fill-amber-400')} />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary" className="bg-sky-500/10 text-sky-700 dark:text-sky-400">
            {data.subject}
          </Badge>
          {data.topic && <Badge variant="outline">{data.topic}</Badge>}
          {isStaff && (
            <Badge
              variant="secondary"
              className={cn(
                data.status === 'PUBLISHED'
                  ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                  : 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
              )}
            >
              {data.status === 'PUBLISHED' ? 'منتشرشده' : 'پیش‌نویس'}
            </Badge>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" />
            {data.teacherName}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5" />
            {data.publishedAt
              ? `تاریخ انتشار: ${faDate(data.publishedAt)}`
              : `ایجاد: ${faDateTime(data.createdAt)}`}
          </span>
        </div>

        {isStaff && data.classes.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span className="font-medium">کلاس‌های مخاطب:</span>
            {data.classes.map((c) => (
              <Badge key={c.id} variant="outline" className="text-[10.5px]">
                {c.name}
              </Badge>
            ))}
          </div>
        )}

        {data.description && (
          <p className="text-sm leading-7 whitespace-pre-wrap break-words border-r-2 border-primary/30 pr-3">
            {data.description}
          </p>
        )}
      </div>

      {/* فایل‌های نمونه‌سؤال */}
      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-bold">
          <FileText className="h-4 w-4 text-primary" />
          فایل‌های نمونه‌سؤال
          <span className="text-xs font-normal text-muted-foreground">
            ({data.questionFiles.length})
          </span>
        </h2>
        {data.questionFiles.length ? (
          <div className="space-y-2">
            {data.questionFiles.map((f) => (
              <FileRow key={f.id} file={f} onPreview={setPreview} />
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
            فایلی برای این نمونه‌سؤال ثبت نشده است
          </p>
        )}
      </section>

      {/* پاسخ‌نامه */}
      {(isStaff || data.showAnswer || data.answerHidden) && (
        <section className="space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <FileCheck2
              className={cn(
                'h-4 w-4',
                data.showAnswer || isStaff ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground',
              )}
            />
            پاسخ‌نامه
            <Badge
              variant="secondary"
              className={cn(
                'text-[10.5px]',
                data.showAnswer || isStaff
                  ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              {isStaff
                ? data.showAnswer
                  ? 'نمایش برای دانش‌آموزان فعال است'
                  : 'نمایش برای دانش‌آموزان غیرفعال است'
                : data.showAnswer
                  ? 'قابل مشاهده'
                  : 'غیرفعال'}
            </Badge>
          </h2>
          {isStaff || data.showAnswer ? (
            data.answerFiles.length ? (
              <div className="space-y-2">
                {data.answerFiles.map((f) => (
                  <FileRow key={f.id} file={f} onPreview={setPreview} />
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                فایلی برای پاسخ‌نامه ثبت نشده است
              </p>
            )
          ) : (
            <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
              پاسخ‌نامه توسط معلم فعال نشده است
            </p>
          )}
        </section>
      )}

      {/* مخاطبان — معلم سازنده و مدیر مدرسه */}
      {data.audiences.length > 0 && (
        <section className="space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <Users className="h-4 w-4 text-primary" />
            مخاطبان
          </h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {data.audiences.map((a) => (
              <details
                key={a.id}
                className="rounded-lg border bg-card px-3 py-2.5 text-xs"
              >
                <summary className="cursor-pointer font-medium select-none">
                  {a.name}
                  <span className="text-muted-foreground"> — {a.studentCount} دانش‌آموز</span>
                </summary>
                <ul className="mt-2 space-y-1 border-t pt-2">
                  {a.students.map((s) => (
                    <li key={s.id} className="text-muted-foreground">
                      {s.fullName}
                    </li>
                  ))}
                  {!a.students.length && (
                    <li className="text-muted-foreground">دانش‌آموز فعالی ثبت‌نام نکرده است</li>
                  )}
                </ul>
              </details>
            ))}
          </div>
        </section>
      )}

      {/* پیش‌نمایش فایل */}
      <Dialog open={!!preview} onOpenChange={(v) => !v && setPreview(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="text-sm truncate">{preview?.name}</DialogTitle>
          </DialogHeader>
          {preview && fileKind(preview.mime) === 'image' && (
            <img
              src={preview.url}
              alt={preview.name}
              className="max-h-[70vh] w-auto mx-auto rounded-lg"
            />
          )}
          {preview && fileKind(preview.mime) === 'pdf' && (
            <iframe
              src={preview.url}
              title={`پیش‌نمایش ${preview.name}`}
              className="w-full h-[70vh] rounded-lg border"
            />
          )}
          {preview && (
            <a
              href={preview.url}
              download={preview.name}
              className="flex items-center gap-1.5 text-sm text-primary hover:underline justify-center"
            >
              <Download className="h-4 w-4" />
              دانلود
            </a>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
