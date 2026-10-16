/** کمک‌تابع‌های نمایش رسانه — خالص کلاینت */

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '۰'
  if (bytes >= 1024 ** 3) return `${Intl.NumberFormat('fa-IR').format(Number((bytes / 1024 ** 3).toFixed(2)))} گیگابایت`
  if (bytes >= 1024 ** 2) return `${Intl.NumberFormat('fa-IR').format(Number((bytes / 1024 ** 2).toFixed(1)))} مگابایت`
  if (bytes >= 1024) return `${Intl.NumberFormat('fa-IR').format(Number((bytes / 1024).toFixed(0)))} کیلوبایت`
  return `${Intl.NumberFormat('fa-IR').format(bytes)} بایت`
}

export const MEDIA_TYPE_BADGE: Record<string, { label: string; cls: string }> = {
  IMAGE: { label: 'تصویر', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
  AUDIO: { label: 'صوت', cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-400' },
  VIDEO: { label: 'ویدئو', cls: 'bg-violet-500/10 text-violet-700 dark:text-violet-400' },
  FILE: { label: 'فایل', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-400' },
}
