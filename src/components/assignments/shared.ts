import type { SubmissionStatus } from '@/lib/assignment-status'

/** آمار پیگیری تکلیف برای معلم/مدیر */
export interface AssignmentStats {
  total: number
  submitted: number
  late: number
  notSubmitted: number
  reviewed: number
  awaitingReview: number
}

/** ردیف فهرست تکالیف (شکل API بر اساس نقش) */
export interface AssignmentRow {
  id: string
  title: string
  description: string
  subjectGroupId: string
  groupName: string
  classroomName: string
  answerMode: string
  allowEdit: boolean
  maxGrade: number | null
  dueAt: string | null
  hasAttachment: boolean
  createdAt: string
  stats?: AssignmentStats
  myStatus?: SubmissionStatus
  myFeedbackStatus?: string | null
  myGrade?: number | null
}

export interface GroupMeta {
  id: string
  name: string
  /** شناسه کلاس مالک گروه — برای فیلترکردن گروه‌های یک کلاس در تقویم آموزشی */
  classroomId?: string
  classroomName: string
}

export interface StagedFile {
  key: string
  name: string
  mime: string
  size: number
}

/** آپلود فایل برای تکالیف (گیت امکانات assignments) */
export async function uploadAssignmentFile(file: File): Promise<StagedFile> {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('purpose', 'assignment')
  const r = await fetch('/api/uploads', { method: 'POST', body: fd })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error ?? 'آپلود فایل ناموفق بود')
  return d as StagedFile
}

export function faBytes(n: number): string {
  if (n < 1024) return `${new Intl.NumberFormat('fa-IR').format(n)} بایت`
  if (n < 1024 * 1024)
    return `${new Intl.NumberFormat('fa-IR').format(Math.round(n / 1024))} کیلوبایت`
  return `${new Intl.NumberFormat('fa-IR').format(Math.round(n / (1024 * 1024)))} مگابایت`
}

/** مقدار مناسب input datetime-local از تاریخ ISO */
export function toLocalInputValue(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** آیا مهلت گذشته است؟ */
export function isOverdue(dueAt: string | null): boolean {
  if (!dueAt) return false
  return new Date(dueAt).getTime() < Date.now()
}
