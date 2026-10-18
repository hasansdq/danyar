/**
 * «گزارش عملکرد دانش‌آموزان» (درخواست کاربر) — هستهٔ مشترک بین API و کلاینت:
 * - تبدیل نمرهٔ رشته‌ای (ارقام فارسی/عربی، ممیز «٫» یا «.») به عدد برای میانگین‌گیری
 * - سبدبندی ماهانهٔ جلالی برای نمودارها
 * - تایپ‌های مشترک پاسخ API فهرست و جزئیات
 */
import { JALALI_MONTHS } from '@/lib/jalali'

/** تبدیل ارقام فارسی/عربی به لاتین */
const FA_TO_EN: Record<string, string> = {
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
}

/** تبدیل ارقام لاتین به فارسی (سال‌های تقویمی) */
const EN_TO_FA = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹']

/**
 * نمرهٔ رشته‌ای → عدد — «۱۸٫۵»/«18.5» → 18.5
 * نمرات توصیفی (مثل «خیلی خوب») null برمی‌گردانند و در میانگین‌ها حساب نمی‌شوند.
 */
export function scoreToNumber(raw: string): number | null {
  if (!raw) return null
  const normalized = raw
    .replace(/[۰-۹٠-٩]/g, (d) => FA_TO_EN[d] ?? d)
    .replace(/[٫،,]/g, '.')
    .trim()
  // «.5» → «0.5»
  const fixed = normalized.startsWith('.') ? `0${normalized}` : normalized
  if (!/^\d+(\.\d+)?$/.test(fixed)) return null
  const n = Number(fixed)
  return Number.isFinite(n) ? n : null
}

/** میانگین یک‌رقمی گرد‌شده — لیست خالی → null */
export function avgOf(nums: number[]): number | null {
  if (!nums.length) return null
  return Math.round((nums.reduce((s, n) => s + n, 0) / nums.length) * 10) / 10
}

/** کلید ماه جلالی از کلید تاریخ — «1405-07-26» → «1405-07» */
export function monthKeyOf(dateKey: string): string {
  return dateKey.slice(0, 7)
}

/** برچسب فارسی ماه — «1405-07» → «مهر ۱۴۰۵» (برای محور نمودار) */
export function monthLabelOf(monthKey: string): string {
  const [ys, ms] = monthKey.split('-')
  const mi = Number(ms)
  if (!ys || !mi || mi < 1 || mi > 12) return monthKey
  // سال با ارقام فارسی (بدون جداکنندهٔ سه‌رقمی)
  const faYear = ys.replace(/\d/g, (d) => EN_TO_FA[Number(d)])
  return `${JALALI_MONTHS[mi - 1]} ${faYear}`
}

/** مقایسهٔ کلید تاریخ برای مرتب‌سازی صعودی/نزولی */
export function cmpDateKey(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

// ─── تایپ‌های مشترک پاسخ API ───────────────────────────────────────────────

/** ردیف دانش‌آموز در فهرست عملکرد (هاب مدیریت مدرسه) */
export interface PerformanceRow {
  id: string
  fullName: string
  username: string
  isActive: boolean
  classroomNames: string[]
  /** تعداد تخلفات ثبت‌شده */
  violationCount: number
  /** میانگین نمرات عددی — null یعنی نمرهٔ عددی ثبت نشده */
  avgScore: number | null
  /** تعداد نمرات عددی دخیل در میانگین */
  numericGradeCount: number
  /** آخرین نمره (تازگی‌ترین بر اساس تاریخ جلالی) */
  lastGrade: {
    score: string
    title: string
    lessonName: string | null
    dateKey: string
  } | null
  /** تعداد غیبت‌ها (جلسات نهایی‌شده) */
  absentCount: number
}

/** تجمیع ماهانه برای نمودار غیبت/تخلف/میانگین */
export interface MonthlyBucket {
  monthKey: string
  label: string
  absences: number
  violations: number
  avgScore: number | null
  gradeCount: number
}

/** نقطهٔ روند نمره برای نمودار خطی */
export interface GradeTrendPoint {
  dateKey: string
  label: string
  score: number
  title: string
  lessonName: string | null
}

/** میانگین نمرات هر درس */
export interface LessonAvg {
  lessonName: string
  avgScore: number
  count: number
}

/** رکورد حضور/غیاب در جزئیات */
export interface PerfRecord {
  sessionId: string
  dateKey: string
  title: string
  classroomName: string
  status: string
  note: string | null
  creatorName: string
}

/** تخلف در جزئیات */
export interface PerfViolation {
  id: string
  dateKey: string
  classroomName: string
  text: string
  creatorName: string
  createdAt: string
}

/** نمره در جزئیات */
export interface PerfGrade {
  id: string
  dateKey: string
  classroomName: string
  title: string
  lessonName: string | null
  score: string
  teacherName: string
  createdAt: string
}
