/**
 * وضعیت‌ها و برچسب‌های تکالیف — مشترک بین سرور و کلاینت (بدون وابستگی به دیتابیس)
 */

/** وضعیت ارسال دانش‌آموز نسبت به یک تکلیف */
export type SubmissionStatus =
  | 'NOT_SUBMITTED' // ارسال‌نشده
  | 'SUBMITTED' // ارسال‌شده
  | 'LATE' // دیرهنگام
  | 'REVIEWED' // بررسی‌شده

export const SUBMISSION_STATUSES: SubmissionStatus[] = [
  'NOT_SUBMITTED',
  'SUBMITTED',
  'LATE',
  'REVIEWED',
]

export const SUBMISSION_STATUS_LABELS: Record<SubmissionStatus, string> = {
  NOT_SUBMITTED: 'ارسال‌نشده',
  SUBMITTED: 'ارسال‌شده',
  LATE: 'دیرهنگام',
  REVIEWED: 'بررسی‌شده',
}

/** رنگ بج وضعیت (کلاس تیلویند) */
export const SUBMISSION_STATUS_BADGE: Record<SubmissionStatus, string> = {
  NOT_SUBMITTED: 'bg-muted text-muted-foreground',
  SUBMITTED: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  LATE: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  REVIEWED: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
}

/** وضعیت بازخورد معلم */
export type FeedbackStatus = 'UNSEEN' | 'APPROVED' | 'REJECTED' | 'INCOMPLETE'

export const FEEDBACK_STATUSES: FeedbackStatus[] = [
  'UNSEEN',
  'APPROVED',
  'REJECTED',
  'INCOMPLETE',
]

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  UNSEEN: 'مشاهده نشده',
  APPROVED: 'تایید شده',
  REJECTED: 'تایید نشده',
  INCOMPLETE: 'ناقص',
}

export const FEEDBACK_STATUS_BADGE: Record<FeedbackStatus, string> = {
  UNSEEN: 'bg-muted text-muted-foreground',
  APPROVED: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  REJECTED: 'bg-red-500/15 text-red-600 dark:text-red-400',
  INCOMPLETE: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
}

/** نحوه ارسال پاسخ */
export type AnswerMode = 'TEXT' | 'FILE' | 'BOTH'

export const ANSWER_MODES: AnswerMode[] = ['TEXT', 'FILE', 'BOTH']

export const ANSWER_MODE_LABELS: Record<AnswerMode, string> = {
  TEXT: 'فقط متنی',
  FILE: 'فقط فایل',
  BOTH: 'متنی یا فایل',
}

/**
 * محاسبه وضعیت ارسال:
 * بدون پاسخ → ارسال‌نشده؛ دارای بازخورد ثبت‌شده → بررسی‌شده؛
 * پاسخ پس از مهلت → دیرهنگام؛ در غیر این صورت → ارسال‌شده
 */
export function computeSubmissionStatus(
  sub: { submittedAt: string; reviewedAt: string | null } | null,
  dueAt: string | null,
): SubmissionStatus {
  if (!sub) return 'NOT_SUBMITTED'
  if (sub.reviewedAt) return 'REVIEWED'
  if (dueAt && new Date(sub.submittedAt).getTime() > new Date(dueAt).getTime()) {
    return 'LATE'
  }
  return 'SUBMITTED'
}
