export const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'مدیر کل',
  SCHOOL_ADMIN: 'مدیر مدرسه',
  SCHOOL_VICE: 'معاون مدرسه',
  TEACHER: 'معلم',
  STUDENT: 'دانش‌آموز',
}

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role
}

/** تاریخ و ساعت فارسی */
export function faDateTime(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  return new Intl.DateTimeFormat('fa-IR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(d)
}

/** فقط تاریخ فارسی */
export function faDate(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  return new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium' }).format(d)
}

/** نمایش نسبی زمان پیام (امروز/دیروز/تاریخ) */
export function chatTime(iso: string | Date): string {
  if (!iso) return ''
  const d = typeof iso === 'string' ? new Date(iso) : iso
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diffDays = Math.round((today.getTime() - msgDay.getTime()) / 86400000)
  const time = new Intl.DateTimeFormat('fa-IR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
  if (diffDays === 0) return time
  if (diffDays === 1) return `دیروز ${time}`
  return new Intl.DateTimeFormat('fa-IR', { dateStyle: 'short' }).format(d) + ` ${time}`
}

/** اعداد فارسی */
export function faNum(n: number | string): string {
  return new Intl.NumberFormat('fa-IR').format(Number(n))
}

/** اعداد فارسی بدون جداکنندهٔ سه‌رقمی — برای سال و اعداد شناسه‌ای (مثل ۱۴۰۵) */
export function faNumPlain(n: number | string): string {
  return new Intl.NumberFormat('fa-IR', { useGrouping: false }).format(Number(n))
}
