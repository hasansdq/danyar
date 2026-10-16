/**
 * تقویم جلالی (شمسی) — هسته مشترک حضور و غیاب
 * تبدیل دقیق میلادی↔جلالی با jalaali-js + قالب کلید تاریخ «1404-07-19»
 */
import {
  toJalaali,
  toGregorian,
  jalaaliMonthLength,
  isValidJalaaliDate,
} from 'jalaali-js'

export const JALALI_MONTHS = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
]

/** روزهای هفته از شنبه (ستون اول تقویم ایرانی) — index 0 = شنبه */
export const JALALI_WEEKDAYS = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج']
export const JALALI_WEEKDAYS_FULL = [
  'شنبه',
  'یکشنبه',
  'دوشنبه',
  'سه‌شنبه',
  'چهارشنبه',
  'پنجشنبه',
  'جمعه',
]

const pad2 = (n: number) => String(n).padStart(2, '0')

/** امروز به وقت تهران → کلید جلالی */
export function todayDateKey(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const [gy, gm, gd] = fmt.format(new Date()).split('-').map(Number)
  const j = toJalaali(gy, gm, gd)
  return `${j.jy}-${pad2(j.jm)}-${pad2(j.jd)}`
}

/** کلید جلالی از شیء Date (به وقت تهران) */
export function dateKeyOf(date: Date): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const [gy, gm, gd] = fmt.format(date).split('-').map(Number)
  const j = toJalaali(gy, gm, gd)
  return `${j.jy}-${pad2(j.jm)}-${pad2(j.jd)}`
}

/** تجزیه و اعتبارسنجی کلید تاریخ — خروجی عددی یا null */
export function parseDateKey(key: unknown): { jy: number; jm: number; jd: number } | null {
  if (typeof key !== 'string') return null
  const m = key.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const jy = Number(m[1])
  const jm = Number(m[2])
  const jd = Number(m[3])
  if (jy < 1300 || jy > 1500 || jm < 1 || jm > 12 || jd < 1 || jd > 31) return null
  if (!isValidJalaaliDate(jy, jm, jd)) return null
  return { jy, jm, jd }
}

/** کلید معتبر؟ */
export function isValidDateKey(key: unknown): boolean {
  return parseDateKey(key) !== null
}

/** شماره روز هفته (0=شنبه … 6=جمعه) برای کلید جلالی */
export function weekdayOfDateKey(key: string): number {
  const p = parseDateKey(key)
  if (!p) return 0
  const g = toGregorian(p.jy, p.jm, p.jd)
  // getDay: 0=یکشنبه … 6=شنبه → +1 mod 7 → 0=شنبه
  return (new Date(g.gy, g.gm - 1, g.gd).getDay() + 1) % 7
}

/** شماره روز هفته از Date (0=شنبه) */
export function weekdayOfDate(date: Date): number {
  return (date.getDay() + 1) % 7
}

/** طول ماه جلالی */
export function jalaliMonthLength(jy: number, jm: number): number {
  return jalaaliMonthLength(jy, jm)
}

/** بازه کلیدهای ماه جلالی (برای کوئری رشته‌ای مرتب) */
export function monthRange(jy: number, jm: number): { from: string; to: string } {
  return {
    from: `${jy}-${pad2(jm)}-01`,
    to: `${jy}-${pad2(jm)}-${pad2(jalaliMonthLength(jy, jm))}`,
  }
}

/** «۱۹ مهر ۱۴۰۴» — با ارقام فارسی */
export function formatJalaliDate(key: string, opts?: { withWeekday?: boolean }): string {
  const p = parseDateKey(key)
  if (!p) return key
  const fa = (n: number) => new Intl.NumberFormat('fa-IR').format(n)
  const base = `${fa(p.jd)} ${JALALI_MONTHS[p.jm - 1]} ${fa(p.jy)}`
  if (opts?.withWeekday) return `${JALALI_WEEKDAYS_FULL[weekdayOfDateKey(key)]}، ${base}`
  return base
}

/** تبدیل کلید جلالی به Date میلادی (نیم‌روز UTC برای پایداری) */
export function dateKeyToUtcDate(key: string): Date | null {
  const p = parseDateKey(key)
  if (!p) return null
  const g = toGregorian(p.jy, p.jm, p.jd)
  return new Date(Date.UTC(g.gy, g.gm - 1, g.gd, 12, 0, 0))
}

/** شبکه ماه: آرایه سلول‌ها با جابه‌جایی ابتدای هفته (شنبه) */
export function jalaliMonthGrid(jy: number, jm: number): (number | null)[] {
  const len = jalaaliMonthLength(jy, jm)
  const first = toGregorian(jy, jm, 1)
  const firstWeekday = (new Date(first.gy, first.gm - 1, first.gd).getDay() + 1) % 7 // 0=شنبه
  const cells: (number | null)[] = []
  for (let i = 0; i < firstWeekday; i++) cells.push(null)
  for (let d = 1; d <= len; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

/** مقایسه دو کلید تاریخ (مرتب‌سازی صعودی) — کلیدها استاندارد و صفرپر هستند */
export function compareDateKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** امروز + n روز (کلید جلالی) */
export function dateKeyShiftDays(key: string, days: number): string | null {
  const d = dateKeyToUtcDate(key)
  if (!d) return null
  d.setUTCDate(d.getUTCDate() + days)
  return dateKeyOf(d)
}
