/**
 * کاتالوگ بخش‌های «بکاپ گیری و ایمپورت» پنل مدیر کل (درخواست کاربر):
 * هر بخش به‌صورت انتخابی و جداگانه قابل بکاپ/ایمپورت است — به‌علاوهٔ «کل سایت».
 *
 * ⚠ ترتیب آرایه‌ها مهم است: ایمپورت به همین ترتیب اجرا می‌شود تا وابستگی‌های
 * FK (مدرسه → کاربر → کلاس → گروه → پیام) برقرار باشند؛ حذف در حالت «جایگزینی»
 * دقیقاً برعکس همین ترتیب است.
 */

export interface BackupSectionDef {
  key: string
  label: string
  hint: string
  /** کلیدهای مدل Prisma (db.<model>) به ترتیب وابستگی */
  models: string[]
  /** فایل‌های فیزیکی uploads/ هم داخل بکاپ می‌آیند */
  files?: boolean
}

export const BACKUP_SECTIONS: BackupSectionDef[] = [
  {
    key: 'users',
    label: 'کاربران و مدارس',
    hint: 'مدارس، همهٔ کاربران (با رمز هش‌شده)، دسترسی‌های معاون‌ها',
    models: ['school', 'user', 'vicePermission'],
  },
  {
    key: 'classes',
    label: 'کلاس‌ها و گروه‌ها',
    hint: 'کلاس‌ها، ثبت‌نام دانش‌آموزان، گروه‌های درسی/مدرسه‌ای، انتساب معلمان',
    models: ['classroom', 'classroomEnrollment', 'subjectGroup', 'teachingAssignment', 'groupMemberOverride'],
  },
  {
    key: 'media',
    label: 'رسانه‌ها',
    hint: 'فهرست فایل‌های آپلودشده + خود فایل‌ها (تصویر/صوت/ویدئو/سند)',
    models: ['upload'],
    files: true,
  },
  {
    key: 'conversations',
    label: 'گفتگوها و پیام‌ها',
    hint: 'همهٔ پیام‌های گروهی و خصوصی، وضعیت خواندن، بی‌صدایی‌ها',
    models: ['message', 'groupReadState', 'mutedChat'],
  },
  {
    key: 'attendance',
    label: 'حضور و غیاب و تخلفات',
    hint: 'جلسات حضور و غیاب، رکوردها، تخلفات دانش‌آموزان، رویدادهای تقویم',
    models: ['attendanceSession', 'attendanceRecord', 'attendanceEditLog', 'studentViolation', 'classEvent'],
  },
  {
    key: 'assignments',
    label: 'تکالیف',
    hint: 'تکالیف کلاس‌ها و پاسخ‌های دانش‌آموزان',
    models: ['assignment', 'assignmentSubmission'],
  },
  {
    key: 'notifications',
    label: 'اعلان‌ها',
    hint: 'اعلان‌های ثبت‌شده و تنظیمات اعلان کاربران',
    models: ['notification', 'notificationPref'],
  },
  {
    key: 'sampleq',
    label: 'نمونه‌سؤالات',
    hint: 'بانک نمونه‌سؤال معلمان، فایل‌ها و نشان‌گذاری‌ها',
    models: ['sampleQuestion', 'sampleQuestionClass', 'sampleQuestionFile', 'sampleQuestionBookmark'],
  },
  {
    key: 'ai',
    label: 'دستیار هوش مصنوعی',
    hint: 'تنظیمات AI، گفتگوهای دستیار و پیام‌های آن',
    models: ['aiConfig', 'aiSchoolSetting', 'aiConversation', 'aiMessage'],
  },
  {
    key: 'live',
    label: 'کلاس‌های آنلاین',
    hint: 'جلسات زندهٔ برگزارشده، گفتگوی متنی و گزارش حضور آن‌ها',
    models: ['liveSession', 'liveChatMessage', 'liveParticipantLog'],
  },
  {
    key: 'logs',
    label: 'گزارش‌های سیستم',
    hint: 'گزارش پیامک/پوش/ارسال انبوه/جعل هویت/مصرف AI',
    models: ['smsSendLog', 'pushSubscription', 'pushDelivery', 'impersonationLog', 'bulkSendLog', 'aiUsageLog', 'infraEventLog'],
  },
  {
    key: 'settings',
    label: 'تنظیمات پلتفرم',
    hint: 'برندینگ/اسپلش، سیاست رسانه، پیامک، پوش، تنظیمات زیرساخت',
    models: ['platformSetting', 'mediaSetting', 'smsConfig', 'pushConfig', 'infraSetting'],
  },
]

/** نام فیلد شناسهٔ یکتا (پیش‌فرض id؛ Upload → key) */
export const ID_FIELDS: Record<string, string> = {
  upload: 'key',
}

/** «کل سایت» = همهٔ بخش‌ها */
export const FULL_BACKUP_SECTIONS = [
  'users', 'classes', 'media', 'conversations', 'attendance', 'assignments',
  'notifications', 'sampleq', 'ai', 'live', 'logs', 'settings',
]

export const BACKUP_FORMAT = 'daniar-backup'
export const BACKUP_VERSION = 1

/** ترتیب ایمپورت امن (وابستگی‌ها) — کاربر هر زیرمجموعه‌ای را انتخاب کند رعایت می‌شود */
export function orderedSelectedSections(selected: string[]): BackupSectionDef[] {
  return BACKUP_SECTIONS.filter((s) => selected.includes(s.key))
}

/** ترتیب حذف در حالت جایگزینی — دقیقاً برعکس ترتیب ایمپورت */
export function reverseSections(sections: BackupSectionDef[]): BackupSectionDef[] {
  return [...sections]
    .reverse()
    .map((s) => ({ ...s, models: [...s.models].reverse() }))
}
