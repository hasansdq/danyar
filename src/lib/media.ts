import { db } from '@/lib/db'

/**
 * موتور مدیریت رسانه‌ها — سیاست سراسری آپلود (فرمت‌های مجاز و سقف حجم هر فرمت)
 * و سهمیه آپلود هر مدرسه بر حسب گیگابایت (۰ = نامحدود).
 * تنظیمات در رکورد یکتای MediaSetting نگهداری می‌شود؛ نبود رکورد = پیش‌فرض‌ها.
 */

export type MediaFormatKey = 'IMAGE' | 'AUDIO' | 'VIDEO' | 'FILE'

export const MEDIA_FORMAT_KEYS: MediaFormatKey[] = ['IMAGE', 'AUDIO', 'VIDEO', 'FILE']

export const MEDIA_FORMAT_LABELS: Record<MediaFormatKey, string> = {
  IMAGE: 'تصویر',
  AUDIO: 'صوت',
  VIDEO: 'ویدئو',
  FILE: 'فایل',
}

export interface MediaFormatSetting {
  format: MediaFormatKey
  enabled: boolean
  maxMB: number
  extensions: string[]
}

/** پیش‌فرض‌ها — همان سیاست سابق پلتفرم، حالا قابل تنظیم از پنل مدیر کل */
export const DEFAULT_MEDIA_FORMATS: MediaFormatSetting[] = [
  { format: 'IMAGE', enabled: true, maxMB: 8, extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] },
  { format: 'AUDIO', enabled: true, maxMB: 20, extensions: ['mp3', 'ogg', 'wav', 'm4a', 'webm', 'aac'] },
  { format: 'VIDEO', enabled: true, maxMB: 50, extensions: ['mp4', 'webm', 'mov'] },
  {
    format: 'FILE',
    enabled: true,
    maxMB: 20,
    extensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'txt', 'csv'],
  },
]

export const GB_BYTES = 1024 * 1024 * 1024

/** سقف منطقی برای جلوگیری از ورودی‌های بی‌معنا */
export const MAX_FORMAT_MB = 2048
export const MAX_QUOTA_GB = 4096

function normExt(e: unknown): string {
  return String(e ?? '')
    .trim()
    .toLowerCase()
    .replace(/^\./, '')
    .replace(/[^a-z0-9]/g, '')
}

/** اعتبارسنجی ورودی فرمت‌ها از پنل — خروجی تمیز یا null برای ورودی نامعتبر */
export function sanitizeMediaFormats(input: unknown): MediaFormatSetting[] | null {
  if (!Array.isArray(input)) return null
  const byKey = new Map<MediaFormatKey, MediaFormatSetting>()
  for (const item of input) {
    if (typeof item !== 'object' || item === null) return null
    const obj = item as Record<string, unknown>
    const format = obj.format as MediaFormatKey
    if (!MEDIA_FORMAT_KEYS.includes(format) || byKey.has(format)) return null
    const enabled = obj.enabled === true
    const maxMB = Number(obj.maxMB)
    if (!Number.isFinite(maxMB) || maxMB < 1 || maxMB > MAX_FORMAT_MB) return null
    if (!Array.isArray(obj.extensions) || obj.extensions.length === 0) return null
    const extensions = [...new Set(obj.extensions.map(normExt))].filter(Boolean)
    if (!extensions.length || extensions.length > 40) return null
    byKey.set(format, { format, enabled, maxMB: Math.round(maxMB), extensions })
  }
  // هر ۴ فرمت باید در ورودی باشند (پنل همیشه هر چهار ردیف را می‌فرستد)
  if (byKey.size !== MEDIA_FORMAT_KEYS.length) return null
  return MEDIA_FORMAT_KEYS.map((k) => byKey.get(k)!)
}

/** خواندن امن JSON فرمت‌ها — ردیف ناقص/خراب با پیش‌فرض همان فرمت جایگزین می‌شود */
export function parseMediaFormats(raw: string | null | undefined): MediaFormatSetting[] {
  const fallback = () => DEFAULT_MEDIA_FORMATS.map((f) => ({ ...f, extensions: [...f.extensions] }))
  if (!raw) return fallback()
  try {
    const arr = JSON.parse(raw)
    const clean = sanitizeMediaFormats(arr)
    return clean ?? fallback()
  } catch {
    return fallback()
  }
}

/** خواندن تنظیمات — رکورد یکتا؛ در نبودش با پیش‌فرض ساخته می‌شود */
export async function getMediaFormats(): Promise<MediaFormatSetting[]> {
  const row = await db.mediaSetting.findUnique({ where: { id: 'global' } })
  if (row) return parseMediaFormats(row.formats)
  const created = await db.mediaSetting
    .create({
      data: { id: 'global', formats: JSON.stringify(DEFAULT_MEDIA_FORMATS) },
    })
    .catch(() => null)
  return parseMediaFormats(created?.formats)
}

/** ذخیره تنظیمات فرمت‌ها (ورودی از پیش اعتبارسنجی‌شده) */
export async function saveMediaFormats(formats: MediaFormatSetting[]): Promise<void> {
  const value = JSON.stringify(formats)
  await db.mediaSetting.upsert({
    where: { id: 'global' },
    update: { formats: value },
    create: { id: 'global', formats: value },
  })
}

/** سهمیه آپلود مدرسه بر حسب گیگابایت — 0 یعنی نامحدود */
export async function schoolQuotaGB(schoolId: string | null | undefined): Promise<number> {
  if (!schoolId) return 0
  const school = await db.school.findUnique({
    where: { id: schoolId },
    select: { mediaQuotaGB: true },
  })
  return school?.mediaQuotaGB ?? 0
}

/** مجموع حجم رسانه‌های ثبت‌شده یک مدرسه (بایت) */
export async function schoolUsageBytes(schoolId: string | null | undefined): Promise<number> {
  if (!schoolId) return 0
  const agg = await db.upload.aggregate({
    where: { schoolId },
    _sum: { size: true },
  })
  return agg._sum?.size ?? 0
}

export interface Classification {
  type: MediaFormatKey | null
  /** فرمت با سیاست فعلی فعال است؟ (type=null یعنی اصلاً مجاز شناخته نشد) */
  allowed: boolean
  maxMB?: number
}

/**
 * طبقه‌بندی فایل بر اساس mime + پسوند و سیاست فعلی:
 * - تصویر/صوت/ویدئو: پیشوند mime باید با دسته بخواند و پسوند در فهرست مجاز باشد
 * - فایل: فقط پسوند تعیین‌کننده است
 * - وقتی دسته در تنظیمات خاموش شده، allowed=false
 */
export function classifyWithSettings(
  mime: string,
  ext: string,
  formats: MediaFormatSetting[],
): Classification {
  const find = (k: MediaFormatKey) => formats.find((f) => f.format === k)
  const hasExt = (f: MediaFormatSetting | undefined) => !!f && f.extensions.includes(ext)

  const image = find('IMAGE')
  if (mime.startsWith('image/') && hasExt(image)) {
    return { type: 'IMAGE', allowed: image!.enabled, maxMB: image!.maxMB }
  }
  const audio = find('AUDIO')
  if (mime.startsWith('audio/') && hasExt(audio)) {
    return { type: 'AUDIO', allowed: audio!.enabled, maxMB: audio!.maxMB }
  }
  const video = find('VIDEO')
  if (mime.startsWith('video/') && hasExt(video)) {
    return { type: 'VIDEO', allowed: video!.enabled, maxMB: video!.maxMB }
  }
  const file = find('FILE')
  if (hasExt(file)) {
    return { type: 'FILE', allowed: file!.enabled, maxMB: file!.maxMB }
  }
  return { type: null, allowed: false }
}

/** پیام خطای فرمت غیرمجاز با نام فارسی دسته در صورت تشخیص */
export function formatRejectMessage(type: MediaFormatKey | null): string {
  if (type) {
    return `آپلود ${MEDIA_FORMAT_LABELS[type]} توسط مدیر پلتفرم غیرفعال شده است`
  }
  return 'نوع فایل مجاز نیست'
}
