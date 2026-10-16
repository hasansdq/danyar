/**
 * انواع رویدادهای دارای پوش — ماژول مشترک بدون وابستگی سرور
 * (هم کلاینت و هم سرور import می‌کنند)
 */

/** دسته‌بندی رویدادهای پوش — انتخاب کاربر در تنظیمات */
export const PUSH_EVENT_CATEGORIES = [
  'PRIVATE_MESSAGE',
  'GROUP_MESSAGE',
  'ASSIGNMENT_NEW',
  'FEEDBACK_POSTED',
  'LIVE_SESSION_NEW',
  'SAMPLEQ_NEW',
  'SCHOOL_ANNOUNCEMENT',
  'ATTENDANCE',
  'ADMIN_BROADCAST',
] as const

export type PushEventCategory = (typeof PUSH_EVENT_CATEGORIES)[number]

export const PUSH_EVENT_LABELS: Record<PushEventCategory, string> = {
  PRIVATE_MESSAGE: 'پیام خصوصی جدید',
  GROUP_MESSAGE: 'پیام جدید در گروه‌های عضو',
  ASSIGNMENT_NEW: 'انتشار تکلیف',
  FEEDBACK_POSTED: 'ثبت یا تغییر بازخورد تکلیف',
  LIVE_SESSION_NEW: 'دعوت یا شروع کلاس آنلاین',
  SAMPLEQ_NEW: 'انتشار نمونه‌سؤال',
  SCHOOL_ANNOUNCEMENT: 'اطلاعیه مدیر مدرسه',
  ATTENDANCE: 'ثبت یا تغییر وضعیت حضور و غیاب',
  ADMIN_BROADCAST: 'اطلاع‌رسانی مدیر پلتفرم',
}

/** نگاشت نوع اعلان درون‌برنامه‌ای → دسته رویداد پوش */
export function categoryOfNotificationType(type: string): PushEventCategory | null {
  switch (type) {
    case 'PRIVATE_MESSAGE':
      return 'PRIVATE_MESSAGE'
    case 'GROUP_MESSAGE':
      return 'GROUP_MESSAGE'
    case 'ASSIGNMENT_NEW':
      return 'ASSIGNMENT_NEW'
    case 'FEEDBACK_POSTED':
      return 'FEEDBACK_POSTED'
    case 'LIVE_SESSION_NEW':
      return 'LIVE_SESSION_NEW'
    case 'SAMPLEQ_NEW':
      return 'SAMPLEQ_NEW'
    case 'SCHOOL_ANNOUNCEMENT':
      return 'SCHOOL_ANNOUNCEMENT'
    case 'ADMIN_BROADCAST':
      return 'ADMIN_BROADCAST'
    case 'ATTENDANCE_FINALIZED':
    case 'ATTENDANCE_CORRECTION':
      return 'ATTENDANCE'
    default:
      return null // انواع دیگر (مثل آزمایشی) پوش رویدادی ندارند
  }
}

/** بازیابی امن دسته‌های انتخابی کاربر؛ آرایه خالی = همه انواع */
export function parsePushEventTypes(raw: string | null | undefined): Set<PushEventCategory> {
  try {
    const arr = raw ? JSON.parse(raw) : []
    if (!Array.isArray(arr) || arr.length === 0) {
      return new Set(PUSH_EVENT_CATEGORIES as readonly PushEventCategory[])
    }
    const valid = (arr as unknown[]).filter(
      (v): v is PushEventCategory =>
        typeof v === 'string' &&
        (PUSH_EVENT_CATEGORIES as readonly string[]).includes(v),
    )
    return valid.length ? new Set(valid) : new Set(PUSH_EVENT_CATEGORIES as readonly PushEventCategory[])
  } catch {
    return new Set(PUSH_EVENT_CATEGORIES as readonly PushEventCategory[])
  }
}
