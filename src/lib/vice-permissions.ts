import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import type { SessionPayload } from '@/lib/session'

/**
 * موتور دسترسی‌های معاون مدرسه (درخواست کاربر):
 * - معاون به‌طور پیش‌فرض «همهٔ» دسترسی‌های مدیر مدرسه را دارد.
 * - مدیر مدرسه می‌تواند هر مجوز را جداگانه برای هر معاون خاموش/روشن کند (سوییچ).
 * - نبودِ ردیف در VicePermission = مجوز فعال (پیش‌فرض روشن).
 * همهٔ بررسی‌ها سمت سرور انجام می‌شود؛ رابط کاربری فقط بازتاب همین منبع حقیقت است.
 */

/** کلیدهای مجوز معاون — برچسب فارسی + توضیح برای پنل مدیر مدرسه */
export const VICE_PERMISSIONS = [
  {
    key: 'classes',
    label: 'مدیریت کلاس‌ها',
    hint: 'ایجاد/ویرایش/حذف کلاس و ثبت‌نام دانش‌آموز در کلاس',
  },
  {
    key: 'groups',
    label: 'مدیریت گروه‌ها',
    hint: 'ایجاد/ویرایش گروه‌ها، قفل گروه و انتساب معلم',
  },
  {
    key: 'lessons',
    label: 'مدیریت درس‌ها',
    hint: 'افزودن/ویرایش/حذف درس‌های مدرسه و انتساب درس به معلم',
  },
  {
    key: 'announcements',
    label: 'ارسال اطلاعیه',
    hint: 'ثبت و انتشار اطلاعیه‌های مدرسه',
  },
  {
    key: 'push_notifications',
    label: 'ارسال اعلان (پوش)',
    hint: 'ارسال اعلان به کلاس‌ها و گروه‌های مدرسه',
  },
  {
    key: 'live',
    label: 'ورود به استریم (کلاس آنلاین)',
    hint: 'ورود به جلسات کلاس آنلاین و پایان دادن به آن‌ها',
  },
  {
    key: 'register_teachers',
    label: 'ثبت‌نام معلم',
    hint: 'افزودن معلم جدید (تکی/گروهی/اکسل)',
  },
  {
    key: 'register_students',
    label: 'ثبت‌نام دانش‌آموز',
    hint: 'افزودن دانش‌آموز جدید (تکی/گروهی/اکسل)',
  },
  {
    key: 'edit_users',
    label: 'تغییر اطلاعات کاربران',
    hint: 'ویرایش نام/شماره/رمز/کلاس و گروه کاربران',
  },
  {
    key: 'delete_users',
    label: 'حذف کاربران',
    hint: 'حذف حساب کاربران مدرسه',
  },
  {
    key: 'ai_assistant',
    label: 'دستیار هوشمند',
    hint: 'دسترسی به گفتگوی دستیار هوش مصنوعی',
  },
  {
    key: 'attendance',
    label: 'مدیریت حضور و غیاب',
    hint: 'ایجاد/ویرایش/نهایی‌سازی جلسات حضور و غیاب و ثبت تخلف',
  },
  {
    key: 'calendar_events',
    label: 'ثبت رویداد تقویم آموزشی',
    hint: 'ثبت رویداد/تکلیف/امتحان در تقویم آموزشی',
  },
] as const

export type VicePermissionKey = (typeof VICE_PERMISSIONS)[number]['key']

const VALID_KEYS = new Set<string>(VICE_PERMISSIONS.map((p) => p.key))

export function isVicePermissionKey(key: string): boolean {
  return VALID_KEYS.has(key)
}

/** پیام خطای واحد برای همهٔ نقاط انطباق — معاون محدود شده است */
export const VICE_DENIED_MESSAGE = 'این دسترسی برای شما توسط مدیر مدرسه محدود شده است'

/**
 * نقشهٔ کامل مجوزهای یک معاون (نبود ردیف = true).
 * خروجی: { classes: true, groups: false, ... } برای همهٔ کلیدهای کاتالوگ
 */
export async function vicePermissionMap(viceId: string): Promise<Record<string, boolean>> {
  const rows = await db.vicePermission.findMany({
    where: { viceId },
    select: { key: true, enabled: true },
  })
  const map: Record<string, boolean> = {}
  for (const p of VICE_PERMISSIONS) map[p.key] = true
  for (const r of rows) {
    if (r.key in map) map[r.key] = r.enabled
  }
  return map
}

/**
 * آیا این معاون مجوز موردنظر را دارد؟
 * — مدیر مدرسه همیشه دارد؛ معاون بر اساس ردیف VicePermission (پیش‌فرض روشن).
 */
export async function viceHasPermission(
  session: SessionPayload,
  key: VicePermissionKey,
): Promise<boolean> {
  if (session.role === 'SCHOOL_ADMIN') return true
  if (session.role !== 'SCHOOL_VICE') return false
  const row = await db.vicePermission.findUnique({
    where: { viceId_key: { viceId: session.uid, key } },
    select: { enabled: true },
  })
  return row ? row.enabled : true
}

/**
 * پاسخ خطا فقط وقتی «معاونِ محدودشده» باشد (سوییچ خاموش)؛
 * سایر نقش‌ها null می‌گیرند — بررسی نقش‌ها جداگانه و در محل خودشان انجام می‌شود.
 * null = مجاز؛ در غیر این صورت NextResponse.json آمادهٔ return
 */
export async function vicePermissionDenied(
  session: SessionPayload,
  key: VicePermissionKey,
): Promise<NextResponse | null> {
  if (session.role !== 'SCHOOL_VICE') return null
  const ok = await viceHasPermission(session, key)
  if (ok) return null
  return NextResponse.json({ error: VICE_DENIED_MESSAGE }, { status: 403 })
}
