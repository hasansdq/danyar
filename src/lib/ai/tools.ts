/**
 * ابزارهای محدود دستیار برای نقش مدیر مدرسه.
 * قانون بنیادین امنیت: شناسه مدرسه همیشه از نشست کاربر سرچشمه می‌گیرد،
 * هرگز از خروجی مدل. هیچ ابزاری به کل دیتابیس یا تاریخچه گفتگوهای
 * دیگران دسترسی ندارد؛ شناسه‌های ارسالی مدل نیز قبل از اجرا به مدرسه
 * کاربر محدود می‌شوند.
 */

import { db } from '@/lib/db'
import {
  computeSubmissionStatus,
  SUBMISSION_STATUS_LABELS,
  FEEDBACK_STATUS_LABELS,
} from '@/lib/assignment-status'
import { effectiveGroupStudents } from '@/lib/assignment-access'
import {
  CLASS_EVENT_TYPES,
  CLASS_EVENT_TYPE_LABELS,
  isValidEventType,
  type ClassEventType,
} from '@/lib/calendar-events'
import { parseDateKey, todayDateKey, monthRange, formatJalaliDate, weekdayOfDateKey, JALALI_WEEKDAYS_FULL, dateKeyShiftDays, dateKeyToUtcDate, dateKeyOf } from '@/lib/jalali'
import { toJalaali } from 'jalaali-js'
import { scoreToNumber, avgOf, cmpDateKey } from '@/lib/performance'
import type { Prisma } from '@prisma/client'
import type { ToolDef } from './provider'

export interface AiRef {
  kind: 'assignment' | 'class' | 'group' | 'student' | 'event' | 'teacher' | 'sampleq'
  id: string
  title: string
}

export interface ToolExecResult {
  result: string
  refs: AiRef[]
}

const STATUS_FA = SUBMISSION_STATUS_LABELS
const FEEDBACK_FA = FEEDBACK_STATUS_LABELS

// ─── تعریف ابزارها (قالب JSON Schema مشترک OpenAI/Anthropic) ───

export const AI_TOOLS: ToolDef[] = [
  {
    name: 'school_overview',
    description:
      'نمای کلی مدرسه مدیر مدرسه‌ای که در حال گفتگو است: نام مدرسه، تعداد کلاس‌ها، گروه‌های درسی، دانش‌آموزان و معلمان و فهرست کلاس‌ها.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_classes',
    description: 'فهرست کلاس‌های مدرسه با گروه‌های درسی و تعداد دانش‌آموزان هر کلاس.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'assignment_status',
    description:
      'وضعیت تکالیف آموزشی مدرسه: آمار ارسال، دیرهنگام، بازخوردها و نمرات. می‌تواند به یک کلاس یا گروه درسی محدود شود.',
    parameters: {
      type: 'object',
      properties: {
        classId: { type: 'string', description: 'شناسه کلاس برای محدودکردن (اختیاری)' },
        groupId: { type: 'string', description: 'شناسه گروه درسی برای محدودکردن (اختیاری)' },
        limit: { type: 'integer', description: 'بیشینه تعداد تکالیف (۱ تا ۲۵، پیش‌فرض ۱۰)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_students',
    description:
      'فهرست دانش‌آموزان مدرسه (حداکثر ۳۰ نفر) با کلاس و گروه‌های درسی؛ قابل محدودکردن به یک کلاس یا جست‌وجوی نام.',
    parameters: {
      type: 'object',
      properties: {
        classId: { type: 'string', description: 'شناسه کلاس برای محدودکردن (اختیاری)' },
        query: { type: 'string', description: 'جست‌وجو در نام دانش‌آموز (اختیاری)' },
        limit: { type: 'integer', description: 'بیشینه تعداد (۱ تا ۳۰، پیش‌فرض ۲۰)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'student_detail',
    description:
      'اطلاعات کامل یک دانش‌آموز مدرسه: کلاس‌ها، گروه‌ها و وضعیت تکالیف و بازخوردهای او.',
    parameters: {
      type: 'object',
      properties: {
        studentId: { type: 'string', description: 'شناسه دانش‌آموز (الزامی)' },
      },
      required: ['studentId'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_teachers',
    description:
      'فهرست معلمان مدرسه با نام کاربری، فعال بودن و گروه‌های درسی/کلاس‌هایی که در آن‌ها تدریس می‌کنند؛ قابل جست‌وجوی نام.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'جست‌وجو در نام معلم (اختیاری)' },
        limit: { type: 'integer', description: 'بیشینه تعداد (۱ تا ۳۰، پیش‌فرض ۲۰)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'teacher_detail',
    description:
      'اطلاعات کامل یک معلم مدرسه: گروه‌ها و کلاس‌هایی که تدریس می‌کند، تکالیفی که ساخته و نمونه‌سؤال‌هایی که منتشر کرده است.',
    parameters: {
      type: 'object',
      properties: {
        teacherId: { type: 'string', description: 'شناسه معلم (الزامی) — از list_teachers' },
      },
      required: ['teacherId'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_sample_questions',
    description:
      'فهرست نمونه‌سؤال‌های مدرسه: عنوان، درس، موضوع، وضعیت انتشار، کلاس‌های هدف و تعداد فایل‌ها؛ قابل فیلتر بر اساس کلاس، درس، جست‌وجو یا وضعیت انتشار.',
    parameters: {
      type: 'object',
      properties: {
        classId: { type: 'string', description: 'شناسه کلاس برای محدودکردن (اختیاری)' },
        subject: { type: 'string', description: 'نام درس برای فیلتر (اختیاری)' },
        query: { type: 'string', description: 'جست‌وجو در عنوان/موضوع/توضیحات (اختیاری)' },
        publishedOnly: { type: 'boolean', description: 'true → فقط منتشرشده‌ها (پیش‌فرض همه)' },
        limit: { type: 'integer', description: 'بیشینه تعداد (۱ تا ۲۵، پیش‌فرض ۱۵)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'student_performance',
    description:
      'گزارش عملکرد دانش‌آموزان مدرسه: تعداد تخلفات، تعداد غیبت‌ها (فقط جلسات نهایی‌شده)، میانگین نمرات عددی، تعداد نمرات و آخرین نمرهٔ هر دانش‌آموز. مرتب‌سازی بر اساس معیار درخواستی — برای پرسش‌هایی مثل «دانش‌آموزان با بیشترین تخلف و غیبت».',
    parameters: {
      type: 'object',
      properties: {
        classId: { type: 'string', description: 'شناسه کلاس برای محدودکردن (اختیاری)' },
        metric: { type: 'string', description: 'معیار مرتب‌سازی نزولی: violations (تخلفات) | absences (غیبت‌ها) | combined (تخلف+غیبت) | grade (میانگین نمرات) — پیش‌فرض combined' },
        limit: { type: 'integer', description: 'بیشینه تعداد دانش‌آموز (۱ تا ۳۰، پیش‌فرض ۱۰)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'day_agenda',
    description:
      'برنامهٔ کامل یک روز مدرسه: رویدادهای تقویم آموزشی (امتحان، تعطیل، جشن و…)، تکالیف درسی واقعی که مهلت‌شان در آن روز است و جلسات حضور و غیاب همان روز. روز را با تاریخ جلالی صریح یا نسبت به امروز مشخص کن (0=امروز، 1=فردا، 2=پس‌فردا، -1=دیروز). برای پرسش‌هایی مثل «فردا چه تکلیفی دارند؟».',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'تاریخ جلالی با قالب 1404-07-21 (اختیاری؛ اگر داده نشود dayOffset ملاک است)' },
        dayOffset: { type: 'integer', description: 'فاصلهٔ روز از امروز: 0=امروز، 1=فردا، 2=پس‌فردا، -1=دیروز (اختیاری؛ پیش‌فرض 0)' },
        classId: { type: 'string', description: 'شناسه کلاس برای محدودکردن تکالیف و جلسات (اختیاری؛ رویدادهای کل‌مدرسه هم برمی‌گردند)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'live_sessions',
    description:
      'استریم‌های کلاس آنلاین مدرسه: جلسات در حال پخش (زنده) یا پایان‌یافته با کلاس، معلم برگزارکننده، عنوان، زمان شروع/پایان و تعداد شرکت‌کنندگان.',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'active → فقط جلسات زنده | ended → فقط پایان‌یافته | all → همه (پیش‌فرض active)' },
        limit: { type: 'integer', description: 'بیشینه تعداد (۱ تا ۲۰، پیش‌فرض ۱۰)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'grades_stats',
    description:
      'آمار نمرات ثبت‌شدهٔ مدرسه: تعداد کل نمرات، میانگین درس‌به‌درس (ریاضی، علوم و…)، میانگین کلاس‌به‌کلاس و آخرین نمرات با نام دانش‌آموز، درس، عنوان و تاریخ جلالی. نمرات عددی (از جمله ارقام فارسی) محاسبه می‌شوند؛ نمرات توصیفی در آمار عددی حساب نمی‌شوند.',
    parameters: {
      type: 'object',
      properties: {
        classId: { type: 'string', description: 'شناسه کلاس برای محدودکردن (اختیاری)' },
        limit: { type: 'integer', description: 'بیشینه تعداد نمرات اخیر (۱ تا ۲۵، پیش‌فرض ۱۰)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'draft_announcement',
    description:
      'تهیه پیش‌نویس ساختاریافته اطلاعیه مدرسه بر اساس درخواست مدیر: با نام مدرسه، تاریخ جلالی امروز، مخاطب و نکات کلیدی. این ابزار فقط پیش‌نویس متنی می‌سازد و چیزی برای کسی ارسال نمی‌کند؛ ارسال نهایی از صفحه «اطلاعیه‌ها» انجام می‌شود.',
    parameters: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'موضوع و هدف اطلاعیه (الزامی)' },
        audience: { type: 'string', description: 'مخاطبان؛ مثل «والدین و دانش‌آموزان هفتم» (پیش‌فرض: اعضای مدرسه)' },
        keyPoints: {
          type: 'array',
          items: { type: 'string' },
          description: 'نکات کلیدی که باید در متن بیاید (اختیاری، حداکثر ۸ مورد)',
        },
        tone: { type: 'string', description: 'لحن پیشنهادی: رسمی یا صمیمی (پیش‌فرض رسمی)' },
      },
      required: ['topic'],
      additionalProperties: false,
    },
  },
  {
    name: 'calendar_stats',
    description:
      'آمار کل تقویم آموزشی مدرسه: تعداد رویدادها به تفکیک نوع (تعطیل، امتحان، تکلیف، جشن، ورزشی، علمی، اردو، سفارشی)، رویدادهای کل‌مدرسه، تفکیک کلاس‌به‌کلاس، رویدادهای پیش‌رو و ماه جاری. تاریخ‌ها شمسی (جلالی) است.',
    parameters: {
      type: 'object',
      properties: {
        classId: { type: 'string', description: 'شناسه کلاس برای آمار فقط یک کلاس (اختیاری؛ رویدادهای کل‌مدرسه هم شمرده می‌شوند)' },
        month: { type: 'string', description: 'ماه جلالی با قالب 1404-07 برای محدودکردن آمار به یک ماه (اختیاری)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_calendar_events',
      description:
      'فهرست رویدادهای تقویم آموزشی مدرسه با تاریخ جلالی، نوع، کلاس، توضیحات و ثبت‌کننده؛ قابل فیلتر بر اساس کلاس، نوع، ماه یا بازه تاریخ.',
    parameters: {
      type: 'object',
      properties: {
        classId: { type: 'string', description: 'شناسه کلاس (اختیاری؛ رویدادهای کل‌مدرسه هم برمی‌گردند)' },
        type: { type: 'string', description: 'نوع رویداد: HOLIDAY یا EXAM یا HOMEWORK یا PARTY یا SPORTS یا ACADEMIC یا TRIP یا CUSTOM (اختیاری)' },
        month: { type: 'string', description: 'ماه جلالی با قالب 1404-07 (اختیاری)' },
        from: { type: 'string', description: 'از تاریخ جلالی 1404-07-01 (اختیاری)' },
        to: { type: 'string', description: 'تا تاریخ جلالی 1404-07-31 (اختیاری)' },
        limit: { type: 'integer', description: 'بیشینه تعداد (۱ تا ۵۰، پیش‌فرض ۲۰)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'create_calendar_event',
    description:
      'ثبت رویداد جدید در تقویم آموزشی برای یک کلاس یا کل مدرسه. انواع: HOLIDAY (تعطیل)، EXAM (امتحان)، HOMEWORK (تکلیف — فقط رویداد ساده؛ تکلیف درسی واقعی توسط معلم ثبت می‌شود)، PARTY (جشن)، SPORTS (ورزشی)، ACADEMIC (علمی)، TRIP (اردو)، CUSTOM (سفارشی — نیازمند title). تاریخ الزاماً جلالی با قالب 1404-07-21.',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'نوع رویداد (الزامی): HOLIDAY یا EXAM یا HOMEWORK یا PARTY یا SPORTS یا ACADEMIC یا TRIP یا CUSTOM' },
        date: { type: 'string', description: 'تاریخ جلالی (الزامی) با قالب 1404-07-21' },
        title: { type: 'string', description: 'نام رویداد — فقط برای نوع CUSTOM الزامی است (حداکثر ۸۰ کاراکتر)' },
        description: { type: 'string', description: 'توضیحات رویداد (اختیاری، حداکثر ۵۰۰ کاراکتر)' },
        classId: { type: 'string', description: 'شناسه کلاس؛ اگر داده نشود رویداد برای کل مدرسه ثبت می‌شود' },
      },
      required: ['type', 'date'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_calendar_event',
    description:
      'ویرایش رویداد موجود تقویم آموزشی مدرسه: تغییر تاریخ، نوع، نام (فقط سفارشی)، توضیحات یا دامنه (کلاس/کل مدرسه). رویداد متصل به تکلیف درسی قابل تغییر نوع نیست.',
    parameters: {
      type: 'object',
      properties: {
        eventId: { type: 'string', description: 'شناسه رویداد (الزامی) — از list_calendar_events' },
        date: { type: 'string', description: 'تاریخ جلالی جدید 1404-07-21 (اختیاری)' },
        type: { type: 'string', description: 'نوع جدید (اختیاری)' },
        title: { type: 'string', description: 'نام جدید — فقط برای نوع CUSTOM (اختیاری)' },
        description: { type: 'string', description: 'توضیحات جدید (اختیاری)' },
        classId: { type: 'string', description: 'شناسه کلاس جدید برای تغییر دامنه (اختیاری)' },
        schoolWide: { type: 'boolean', description: 'true → رویداد به کل مدرسه تعمیم داده می‌شود (اختیاری)' },
      },
      required: ['eventId'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_calendar_event',
    description:
      'حذف رویداد از تقویم آموزشی مدرسه. حذف رویداد متصل به تکلیف، خود تکلیف درسی را حذف نمی‌کند.',
    parameters: {
      type: 'object',
      properties: {
        eventId: { type: 'string', description: 'شناسه رویداد (الزامی) — از list_calendar_events' },
      },
      required: ['eventId'],
      additionalProperties: false,
    },
  },
]

export const TOOL_STATUS_LABEL: Record<string, string> = {
  school_overview: 'در حال دریافت نمای کلی مدرسه…',
  list_classes: 'در حال دریافت فهرست کلاس‌ها…',
  assignment_status: 'در حال بررسی وضعیت تکالیف…',
  list_students: 'در حال دریافت فهرست دانش‌آموزان…',
  student_detail: 'در حال دریافت اطلاعات دانش‌آموز…',
  list_teachers: 'در حال دریافت فهرست معلمان…',
  teacher_detail: 'در حال دریافت اطلاعات معلم…',
  list_sample_questions: 'در حال دریافت نمونه‌سؤال‌ها…',
  draft_announcement: 'در حال تهیه پیش‌نویس اطلاعیه…',
  calendar_stats: 'در حال محاسبه آمار تقویم آموزشی…',
  list_calendar_events: 'در حال دریافت رویدادهای تقویم…',
  create_calendar_event: 'در حال ثبت رویداد در تقویم…',
  update_calendar_event: 'در حال ویرایش رویداد تقویم…',
  delete_calendar_event: 'در حال حذف رویداد تقویم…',
  student_performance: 'در حال محاسبه گزارش عملکرد دانش‌آموزان…',
  day_agenda: 'در حال بررسی برنامهٔ روز…',
  live_sessions: 'در حال بررسی استریم‌های کلاس آنلاین…',
  grades_stats: 'در حال محاسبه آمار نمرات…',
}

/** تبدیل ارقام فارسی/عربی به لاتین برای پذیرش تاریخ از خروجی مدل */
function normalizeDigits(s: string): string {
  return s
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
}

/** اعتبارسنجی تاریخ جلالی ورودی مدل (با پذیرش ارقام فارسی و جداکننده / یا .) → کلید استاندارد یا null */
function parseEventDate(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const key = normalizeDigits(v.trim()).replace(/[/.\s]/g, '-')
  const p = parseDateKey(key)
  if (!p) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${p.jy}-${pad(p.jm)}-${pad(p.jd)}`
}

/** کلید جلالی از تاریخ UTC یک Date — مهلت تکالیف در این برنامه زمانِ محلیِ انتخابی
 *  معلم را بدون تبدیل منطقه‌ای ذخیره می‌کنند (۲۳:۵۹ روز مقصد = همان روز به وقت UTC)؛
 *  بنابراین «روزِ» مهلت با تاریخ UTC استخراج می‌شود تا با نیت معلم هم‌راستا بماند. */
function utcDateKeyOf(d: Date): string {
  const j = toJalaali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${j.jy}-${pad(j.jm)}-${pad(j.jd)}`
}

/** اعتبارسنجی ماه جلالی 1404-07 → بازه کلیدهای ماه یا null */
function parseEventMonth(v: unknown): { from: string; to: string } | null {
  if (typeof v !== 'string') return null
  const m = normalizeDigits(v.trim()).match(/^(\d{4})-(\d{1,2})$/)
  if (!m) return null
  const jy = Number(m[1])
  const jm = Number(m[2])
  if (jy < 1300 || jy > 1500 || jm < 1 || jm > 12) return null
  return monthRange(jy, jm)
}

/** عنوان نمایشی رویداد */
function eventDisplayTitle(type: string, customTitle: string | null): string {
  if (type === 'CUSTOM' && customTitle?.trim()) return customTitle.trim()
  return CLASS_EVENT_TYPE_LABELS[type as ClassEventType] ?? type
}

/** refs استاندارد یک رویداد */
function eventRefs(ev: {
  id: string
  type: string
  customTitle: string | null
  dateKey: string
  classroom: { id: string; name: string } | null
}): AiRef[] {
  const refs: AiRef[] = [
    { kind: 'event', id: ev.id, title: `${eventDisplayTitle(ev.type, ev.customTitle)} · ${formatJalaliDate(ev.dateKey)}` },
  ]
  if (ev.classroom) refs.push({ kind: 'class', id: ev.classroom.id, title: ev.classroom.name })
  return refs
}

/** یافتن رویداد متعلق به مدرسه کاربر؛ در غیر این صورت null */
async function ownEvent(schoolId: string, eventId: string) {
  if (!eventId) return null
  const ev = await db.classEvent.findUnique({
    where: { id: eventId },
    include: {
      classroom: { select: { id: true, name: true } },
      createdBy: { select: { fullName: true } },
    },
  })
  return ev && ev.schoolId === schoolId ? ev : null
}

const EVENT_TYPE_KEYS = CLASS_EVENT_TYPES

/** تجزیه و اعتبارسنجی نوع رویداد */
function parseEventType(v: unknown): ClassEventType | null {
  if (typeof v !== 'string') return null
  const t = v.trim().toUpperCase()
  return isValidEventType(t) ? t : null
}

function parseArgs(argsJson: string): Record<string, unknown> {
  try {
    const v = argsJson ? JSON.parse(argsJson) : {}
    return typeof v === 'object' && v !== null ? v : {}
  } catch {
    return {}
  }
}

function errorResult(message: string): ToolExecResult {
  return { result: JSON.stringify({ error: message }), refs: [] }
}

/** اعتبارسنجی اینکه کلاس متعلق به مدرسه کاربر است؛ در غیر این صورت null */
async function ownClass(schoolId: string, classId: string) {
  if (!classId) return null
  const c = await db.classroom.findUnique({ where: { id: classId }, select: { id: true, name: true, schoolId: true } })
  return c && c.schoolId === schoolId ? c : null
}

/** اعتبارسنجی اینکه گروه متعلق به مدرسه کاربر است (گروه درسی کلاس) */
async function ownGroup(schoolId: string, groupId: string) {
  if (!groupId) return null
  const g = await db.subjectGroup.findUnique({
    where: { id: groupId },
    select: { id: true, name: true, classroom: { select: { id: true, name: true, schoolId: true } } },
  })
  return g && g.classroom && g.classroom.schoolId === schoolId ? g : null
}

// ─── پیاده‌سازی ابزارها ───

async function toolSchoolOverview(schoolId: string): Promise<ToolExecResult> {
  const school = await db.school.findUnique({
    where: { id: schoolId },
    select: { id: true, name: true, isActive: true },
  })
  if (!school) return errorResult('مدرسه یافت نشد')

  const [classrooms, studentCount, teacherCount] = await Promise.all([
    db.classroom.findMany({
      where: { schoolId },
      select: {
        id: true,
        name: true,
        _count: { select: { enrollments: true, subjectGroups: true } },
        subjectGroups: { select: { id: true, name: true }, orderBy: { name: 'asc' } },
      },
      orderBy: { name: 'asc' },
    }),
    db.user.count({ where: { schoolId, role: 'STUDENT', isActive: true } }),
    db.user.count({ where: { schoolId, role: 'TEACHER', isActive: true } }),
  ])

  const refs: AiRef[] = classrooms.map((c) => ({ kind: 'class', id: c.id, title: c.name }))
  return {
    result: JSON.stringify({
      school: { id: school.id, name: school.name, isActive: school.isActive },
      counts: {
        classes: classrooms.length,
        subjectGroups: classrooms.reduce((s, c) => s + c.subjectGroups.length, 0),
        students: studentCount,
        teachers: teacherCount,
      },
      classes: classrooms.map((c) => ({
        id: c.id,
        name: c.name,
        studentCount: c._count.enrollments,
        groups: c.subjectGroups.map((g) => g.name),
      })),
    }),
    refs,
  }
}

async function toolListClasses(schoolId: string): Promise<ToolExecResult> {
  const classrooms = await db.classroom.findMany({
    where: { schoolId },
    select: {
      id: true,
      name: true,
      _count: { select: { enrollments: true } },
      subjectGroups: {
        select: {
          id: true,
          name: true,
          archivedAt: true,
          teachingAssignments: { select: { teacher: { select: { fullName: true } } } },
        },
        orderBy: { name: 'asc' },
      },
    },
    orderBy: { name: 'asc' },
  })
  const refs: AiRef[] = classrooms.map((c) => ({ kind: 'class', id: c.id, title: c.name }))
  return {
    result: JSON.stringify({
      classes: classrooms.map((c) => ({
        id: c.id,
        name: c.name,
        studentCount: c._count.enrollments,
        groups: c.subjectGroups.map((g) => ({
          id: g.id,
          name: g.name,
          archived: !!g.archivedAt,
          teachers: g.teachingAssignments.map((t) => t.teacher.fullName),
        })),
      })),
    }),
    refs,
  }
}

async function toolAssignmentStatus(schoolId: string, argsJson: string): Promise<ToolExecResult> {
  const args = parseArgs(argsJson)
  const refs: AiRef[] = []

  // محدودکردن دامنه فقط با شناسه‌های معتبرِ مدرسه خود کاربر
  let classroomFilter: { schoolId: string } | { id: string } = { schoolId }
  if (typeof args.classId === 'string' && args.classId) {
    const c = await ownClass(schoolId, args.classId)
    if (!c) return errorResult('کلاس موردنظر در مدرسه شما یافت نشد')
    classroomFilter = { id: c.id }
    refs.push({ kind: 'class', id: c.id, title: c.name })
  }
  let groupIdFilter: string | undefined
  if (typeof args.groupId === 'string' && args.groupId) {
    const g = await ownGroup(schoolId, args.groupId)
    if (!g) return errorResult('گروه درسی موردنظر در مدرسه شما یافت نشد')
    groupIdFilter = g.id
    refs.push({ kind: 'group', id: g.id, title: g.name })
  }

  const limitRaw = Number(args.limit ?? 10)
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? Math.trunc(limitRaw) : 10, 1), 25)

  const assignments = await db.assignment.findMany({
    where: {
      ...(groupIdFilter ? { subjectGroupId: groupIdFilter } : {}),
      subjectGroup: { classroom: classroomFilter },
    },
    include: {
      subjectGroup: {
        select: {
          id: true,
          name: true,
          archivedAt: true,
          classroom: { select: { id: true, name: true } },
        },
      },
      submissions: {
        select: {
          studentId: true,
          submittedAt: true,
          reviewedAt: true,
          feedbackStatus: true,
          grade: true,
          student: { select: { id: true, fullName: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  const items: Record<string, unknown>[] = []
  for (const a of assignments) {
    const cls = a.subjectGroup.classroom
    if (!cls) continue
    const students = await effectiveGroupStudents(a.subjectGroup.id, cls.id)
    const rows = students.map((s) => {
      const sub = a.submissions.find((x) => x.studentId === s.id)
      const status = sub
        ? computeSubmissionStatus(
            { submittedAt: sub.submittedAt.toISOString(), reviewedAt: sub.reviewedAt?.toISOString() ?? null },
            a.dueAt?.toISOString() ?? null,
          )
        : 'NOT_SUBMITTED'
      return { status, feedbackStatus: sub?.feedbackStatus ?? 'UNSEEN', grade: sub?.grade ?? null, name: s.fullName, id: s.id }
    })
    const submitted = rows.filter((r) => r.status !== 'NOT_SUBMITTED')
    const grades = submitted.map((r) => r.grade).filter((g): g is number => g !== null)
    const missing = rows.filter((r) => r.status === 'NOT_SUBMITTED').map((r) => r.name)

    refs.push({ kind: 'assignment', id: a.id, title: a.title })
    if (!refs.some((r) => r.kind === 'group' && r.id === a.subjectGroup.id))
      refs.push({ kind: 'group', id: a.subjectGroup.id, title: a.subjectGroup.name })
    if (!refs.some((r) => r.kind === 'class' && r.id === cls.id))
      refs.push({ kind: 'class', id: cls.id, title: cls.name })

    items.push({
      id: a.id,
      title: a.title,
      class: cls.name,
      group: a.subjectGroup.name,
      archived: !!a.subjectGroup.archivedAt,
      dueAt: a.dueAt?.toISOString() ?? null,
      maxGrade: a.maxGrade,
      stats: {
        totalStudents: students.length,
        submitted: submitted.length,
        late: rows.filter((r) => r.status === 'LATE').length,
        reviewed: rows.filter((r) => r.status === 'REVIEWED').length,
        feedback: {
          unseen: rows.filter((r) => r.status !== 'NOT_SUBMITTED' && r.feedbackStatus === 'UNSEEN').length,
          approved: rows.filter((r) => r.feedbackStatus === 'APPROVED').length,
          rejected: rows.filter((r) => r.feedbackStatus === 'REJECTED').length,
          incomplete: rows.filter((r) => r.feedbackStatus === 'INCOMPLETE').length,
        },
        averageGrade: grades.length
          ? Math.round((grades.reduce((s, g) => s + g, 0) / grades.length) * 10) / 10
          : null,
      },
      notSubmittedStudents: missing.slice(0, 8),
      notSubmittedCount: missing.length,
    })
  }

  return { result: JSON.stringify({ assignments: items }), refs: dedupeRefs(refs) }
}

async function toolListStudents(schoolId: string, argsJson: string): Promise<ToolExecResult> {
  const args = parseArgs(argsJson)
  const refs: AiRef[] = []

  let classroomId: string | undefined
  if (typeof args.classId === 'string' && args.classId) {
    const c = await ownClass(schoolId, args.classId)
    if (!c) return errorResult('کلاس موردنظر در مدرسه شما یافت نشد')
    classroomId = c.id
    refs.push({ kind: 'class', id: c.id, title: c.name })
  }
  const query = typeof args.query === 'string' ? args.query.trim().slice(0, 60) : ''
  const limitRaw = Number(args.limit ?? 20)
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? Math.trunc(limitRaw) : 20, 1), 30)

  const enrollments = await db.classroomEnrollment.findMany({
    where: { ...(classroomId ? { classroomId } : { classroom: { schoolId } }) },
    select: {
      student: {
        select: {
          id: true,
          fullName: true,
          username: true,
          isActive: true,
          enrollments: { select: { classroom: { select: { name: true } } } },
        },
      },
      classroom: { select: { id: true, name: true } },
    },
  })

  // گروه‌های مؤثر هر دانش‌آموز (ثبت‌نام کلاس − حذف + افزودن)
  const seen = new Map<string, (typeof enrollments)[number]['student'] & { classes: string[] }>()
  for (const e of enrollments) {
    if (!seen.has(e.student.id)) seen.set(e.student.id, { ...e.student, classes: [] })
  }
  const studentIds = [...seen.keys()]
  const overrides =
    studentIds.length
      ? await db.groupMemberOverride.findMany({
          where: { userId: { in: studentIds }, action: 'ADD', subjectGroup: { classroom: { schoolId } } },
          select: { userId: true, subjectGroup: { select: { name: true } } },
        })
      : []
  const addMap = new Map<string, string[]>()
  for (const o of overrides) {
    const arr = addMap.get(o.userId) ?? []
    arr.push(o.subjectGroup.name)
    addMap.set(o.userId, arr)
  }
  for (const e of enrollments) {
    const s = seen.get(e.student.id)
    if (s && !s.classes.includes(e.classroom.name)) s.classes.push(e.classroom.name)
  }

  let students = [...seen.values()].filter((s) => s.isActive)
  if (query) students = students.filter((s) => s.fullName.includes(query) || s.username.includes(query))
  students.sort((a, b) => a.fullName.localeCompare(b.fullName, 'fa'))
  students = students.slice(0, limit)

  for (const s of students) refs.push({ kind: 'student', id: s.id, title: s.fullName })

  return {
    result: JSON.stringify({
      count: students.length,
      truncated: students.length >= limit,
      students: students.map((s) => ({
        id: s.id,
        name: s.fullName,
        username: s.username,
        classes: s.classes,
        extraGroups: addMap.get(s.id) ?? [],
      })),
    }),
    refs: dedupeRefs(refs),
  }
}

async function toolStudentDetail(schoolId: string, argsJson: string): Promise<ToolExecResult> {
  const args = parseArgs(argsJson)
  const studentId = typeof args.studentId === 'string' ? args.studentId : ''
  if (!studentId) return errorResult('شناسه دانش‌آموز مشخص نشده است')

  const student = await db.user.findUnique({
    where: { id: studentId },
    select: { id: true, fullName: true, username: true, role: true, isActive: true, schoolId: true },
  })
  // جداسازی مدرسه: دانش‌آموز باید از همان مدرسه مدیر باشد
  if (!student || student.schoolId !== schoolId || student.role !== 'STUDENT') {
    return errorResult('دانش‌آموزی با این شناسه در مدرسه شما یافت نشد')
  }

  const enrollments = await db.classroomEnrollment.findMany({
    where: { studentId },
    select: { classroom: { select: { id: true, name: true, schoolId: true } } },
  })
  const classes = enrollments.map((e) => e.classroom)

  const refs: AiRef[] = [{ kind: 'student', id: student.id, title: student.fullName }]
  for (const c of classes) refs.push({ kind: 'class', id: c.id, title: c.name })

  // گروه‌های درسی که دانش‌آموز عضو مؤثر آن‌هاست (همان کلاس‌ها + افزودنی‌ها)
  const groups = await db.subjectGroup.findMany({
    where: { classroom: { schoolId, id: { in: classes.map((c) => c.id) } } },
    select: { id: true, name: true, classroom: { select: { name: true } } },
    orderBy: { name: 'asc' },
  })

  // تکالیف این گروه‌ها + وضعیت پاسخ این دانش‌آموز
  const assignments = await db.assignment.findMany({
    where: { subjectGroupId: { in: groups.map((g) => g.id) } },
    include: {
      subjectGroup: { select: { name: true, classroom: { select: { name: true } } } },
      submissions: { where: { studentId }, select: {
        submittedAt: true, reviewedAt: true, feedbackStatus: true, feedbackNote: true, grade: true,
      } },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })

  const items = assignments.map((a) => {
    const sub = a.submissions[0]
    const status = sub
      ? computeSubmissionStatus(
          { submittedAt: sub.submittedAt.toISOString(), reviewedAt: sub.reviewedAt?.toISOString() ?? null },
          a.dueAt?.toISOString() ?? null,
        )
      : 'NOT_SUBMITTED'
    refs.push({ kind: 'assignment', id: a.id, title: a.title })
    return {
      id: a.id,
      title: a.title,
      class: a.subjectGroup.classroom?.name ?? '',
      group: a.subjectGroup.name,
      dueAt: a.dueAt?.toISOString() ?? null,
      status: STATUS_FA[status],
      feedback: sub ? FEEDBACK_FA[sub.feedbackStatus] ?? sub.feedbackStatus : null,
      feedbackNote: sub?.feedbackNote ?? null,
      grade: sub?.grade ?? null,
    }
  })

  // ── عملکرد تحصیلی-انضباطی (درخواست کاربر — دستیار به نمرات/غیبت/تخلف هم دسترسی دارد) ──
  const [violationCount, absenceCount, perfGrades] = await Promise.all([
    db.studentViolation.count({ where: { studentId, classroom: { schoolId } } }),
    db.attendanceRecord.count({
      where: { studentId, status: 'ABSENT', session: { status: 'FINALIZED', classroom: { schoolId } } },
    }),
    db.studentGrade.findMany({
      where: {
        studentId,
        classroom: { schoolId },
        OR: [{ session: { status: 'FINALIZED' } }, { sessionId: null }],
      },
      select: {
        score: true,
        title: true,
        dateKey: true,
        lesson: { select: { name: true } },
        creator: { select: { fullName: true } },
      },
      orderBy: [{ dateKey: 'desc' }, { createdAt: 'desc' }],
      take: 50,
    }),
  ])
  const perfNums = perfGrades.map((g) => scoreToNumber(g.score)).filter((n): n is number => n !== null)
  const recentViolations = await db.studentViolation.findMany({
    where: { studentId, classroom: { schoolId } },
    select: { dateKey: true, text: true, creator: { select: { fullName: true } } },
    orderBy: [{ dateKey: 'desc' }, { createdAt: 'desc' }],
    take: 5,
  })

  return {
    result: JSON.stringify({
      student: { id: student.id, name: student.fullName, username: student.username, isActive: student.isActive },
      classes: classes.map((c) => c.name),
      groups: groups.map((g) => `${g.name} (${g.classroom?.name ?? ''})`),
      assignments: items,
      performance: {
        violationCount,
        absentCount: absenceCount,
        numericGradeCount: perfNums.length,
        avgScore: avgOf(perfNums),
        lastGrades: perfGrades.slice(0, 5).map((g) => ({
          score: g.score,
          title: g.title,
          lesson: g.lesson?.name ?? null,
          teacher: g.creator.fullName,
          dateKey: g.dateKey,
          dateFa: formatJalaliDate(g.dateKey),
        })),
        recentViolations: recentViolations.map((v) => ({
          text: v.text,
          dateKey: v.dateKey,
          dateFa: formatJalaliDate(v.dateKey),
          creator: v.creator.fullName,
        })),
      },
    }),
    refs: dedupeRefs(refs),
  }
}

// ─── ابزارهای عملکرد دانش‌آموزان، دستور روز، استریم و نمرات (درخواست کاربر) ───

/** گزارش عملکرد دانش‌آموزان — همان منطق گزارش عملکرد مدیر (تخلف/غیبت/میانگین/آخرین نمره) */
async function toolStudentPerformance(schoolId: string, argsJson: string): Promise<ToolExecResult> {
  const args = parseArgs(argsJson)
  const refs: AiRef[] = []

  let classroomId: string | undefined
  if (typeof args.classId === 'string' && args.classId) {
    const c = await ownClass(schoolId, args.classId)
    if (!c) return errorResult('کلاس موردنظر در مدرسه شما یافت نشد')
    classroomId = c.id
    refs.push({ kind: 'class', id: c.id, title: c.name })
  }
  const metric =
    args.metric === 'violations' || args.metric === 'absences' || args.metric === 'grade'
      ? args.metric
      : 'combined'
  const limitRaw = Number(args.limit ?? 10)
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? Math.trunc(limitRaw) : 10, 1), 30)

  const students = await db.user.findMany({
    where: {
      schoolId,
      role: 'STUDENT',
      ...(classroomId ? { enrollments: { some: { classroomId } } } : {}),
    },
    select: {
      id: true,
      fullName: true,
      username: true,
      isActive: true,
      enrollments: { select: { classroom: { select: { name: true } } } },
    },
    orderBy: { fullName: 'asc' },
  })
  if (!students.length) {
    return { result: JSON.stringify({ count: 0, students: [] }), refs: dedupeRefs(refs) }
  }
  const studentIds = students.map((s) => s.id)

  const [violationCounts, absenceCounts, grades] = await Promise.all([
    db.studentViolation.groupBy({
      by: ['studentId'],
      where: { studentId: { in: studentIds }, classroom: { schoolId } },
      _count: { _all: true },
    }),
    db.attendanceRecord.groupBy({
      by: ['studentId'],
      where: {
        studentId: { in: studentIds },
        status: 'ABSENT',
        session: { status: 'FINALIZED', classroom: { schoolId } },
      },
      _count: { _all: true },
    }),
    db.studentGrade.findMany({
      where: {
        studentId: { in: studentIds },
        classroom: { schoolId },
        OR: [{ session: { status: 'FINALIZED' } }, { sessionId: null }],
      },
      select: {
        studentId: true,
        score: true,
        title: true,
        dateKey: true,
        createdAt: true,
        lesson: { select: { name: true } },
      },
    }),
  ])
  const violationMap = new Map(violationCounts.map((v) => [v.studentId, v._count._all]))
  const absenceMap = new Map(absenceCounts.map((a) => [a.studentId, a._count._all]))

  const gradeAgg = new Map<
    string,
    {
      nums: number[]
      last: {
        score: string
        title: string
        lessonName: string | null
        dateKey: string
        createdAt: Date
      } | null
    }
  >()
  for (const g of grades) {
    const cur = gradeAgg.get(g.studentId) ?? { nums: [], last: null }
    const num = scoreToNumber(g.score)
    if (num !== null) cur.nums.push(num)
    // آخرین نمره: dateKey بزرگ‌تر؛ در تساوی، createdAt جدیدتر (همان منطق گزارش عملکرد مدیر)
    if (
      !cur.last ||
      cmpDateKey(g.dateKey, cur.last.dateKey) > 0 ||
      (g.dateKey === cur.last.dateKey && g.createdAt > cur.last.createdAt)
    ) {
      cur.last = {
        score: g.score,
        title: g.title,
        lessonName: g.lesson?.name ?? null,
        dateKey: g.dateKey,
        createdAt: g.createdAt,
      }
    }
    gradeAgg.set(g.studentId, cur)
  }

  const rows = students.map((s) => {
    const agg = gradeAgg.get(s.id)
    const violations = violationMap.get(s.id) ?? 0
    const absences = absenceMap.get(s.id) ?? 0
    return {
      id: s.id,
      name: s.fullName,
      username: s.username,
      isActive: s.isActive,
      classes: s.enrollments.map((e) => e.classroom.name),
      violationCount: violations,
      absentCount: absences,
      combined: violations + absences,
      avgScore: avgOf(agg?.nums ?? []),
      numericGradeCount: agg?.nums.length ?? 0,
      lastGrade: agg?.last ?? null,
    }
  })

  rows.sort((a, b) => {
    if (metric === 'violations') return b.violationCount - a.violationCount || a.name.localeCompare(b.name, 'fa')
    if (metric === 'absences') return b.absentCount - a.absentCount || a.name.localeCompare(b.name, 'fa')
    if (metric === 'grade') {
      const av = a.avgScore ?? -1
      const bv = b.avgScore ?? -1
      return bv - av || a.name.localeCompare(b.name, 'fa')
    }
    return b.combined - a.combined || a.name.localeCompare(b.name, 'fa')
  })
  const top = rows.slice(0, limit)
  for (const s of top) refs.push({ kind: 'student', id: s.id, title: s.name })

  return {
    result: JSON.stringify({
      count: top.length,
      totalStudents: rows.length,
      truncated: rows.length > top.length,
      metric,
      students: top.map((s) => ({
        id: s.id,
        name: s.name,
        classes: s.classes,
        violationCount: s.violationCount,
        absentCount: s.absentCount,
        avgScore: s.avgScore,
        numericGradeCount: s.numericGradeCount,
        lastGrade: s.lastGrade,
      })),
    }),
    refs: dedupeRefs(refs),
  }
}

/** دستور کامل یک روز: رویدادهای تقویم + تکالیف دارای مهلت همان روز + جلسات حضور و غیاب */
async function toolDayAgenda(schoolId: string, argsJson: string): Promise<ToolExecResult> {
  const args = parseArgs(argsJson)
  const refs: AiRef[] = []

  // تاریخ هدف: صریح جلالی یا نسبت به امروز (0=امروز، 1=فردا…)
  let dateKey: string
  if (typeof args.date === 'string' && args.date.trim()) {
    const parsed = parseEventDate(args.date)
    if (!parsed) return errorResult('تاریخ جلالی نامعتبر است؛ قالب صحیح: 1404-07-21')
    dateKey = parsed
  } else {
    const offsetRaw = Number(args.dayOffset ?? 0)
    const offset = Number.isFinite(offsetRaw) ? Math.min(Math.max(Math.trunc(offsetRaw), -30), 30) : 0
    const shifted = dateKeyShiftDays(todayDateKey(), offset)
    if (!shifted) return errorResult('محاسبه تاریخ ممکن نشد')
    dateKey = shifted
  }

  let classroomId: string | undefined
  if (typeof args.classId === 'string' && args.classId) {
    const c = await ownClass(schoolId, args.classId)
    if (!c) return errorResult('کلاس موردنظر در مدرسه شما یافت نشد')
    classroomId = c.id
    refs.push({ kind: 'class', id: c.id, title: c.name })
  }

  // رویدادهای تقویم همان روز (رویدادهای کل‌مدرسه هم شامل‌اند)
  const events = await db.classEvent.findMany({
    where: {
      schoolId,
      dateKey,
      ...(classroomId ? { OR: [{ classroomId }, { classroomId: null }] } : {}),
    },
    include: {
      classroom: { select: { id: true, name: true } },
      createdBy: { select: { fullName: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: 60,
  })
  for (const ev of events) refs.push(...eventRefs(ev))

  // تکالیف درسی واقعی که مهلت‌شان در همان روز است — پنجرهٔ ±۲ روز سپس تطبیق دقیق کلید جلالی
  const dayUtc = dateKeyToUtcDate(dateKey)
  if (dayUtc) {
    const winStart = new Date(dayUtc)
    winStart.setUTCDate(winStart.getUTCDate() - 2)
    const winEnd = new Date(dayUtc)
    winEnd.setUTCDate(winEnd.getUTCDate() + 2)
    const due = await db.assignment.findMany({
      where: {
        dueAt: { gte: winStart, lte: winEnd },
        subjectGroup: { classroom: classroomId ? { id: classroomId } : { schoolId } },
      },
      include: {
        subjectGroup: { select: { id: true, name: true, classroom: { select: { id: true, name: true } } } },
        createdBy: { select: { fullName: true } },
      },
    })
    for (const a of due) {
      if (!a.dueAt || utcDateKeyOf(a.dueAt) !== dateKey) continue
      refs.push({ kind: 'assignment', id: a.id, title: a.title })
      if (a.subjectGroup.classroom) refs.push({ kind: 'class', id: a.subjectGroup.classroom.id, title: a.subjectGroup.classroom.name })
      refs.push({ kind: 'group', id: a.subjectGroup.id, title: a.subjectGroup.name })
    }
    const homeworkDue = due
      .filter((a) => a.dueAt && utcDateKeyOf(a.dueAt) === dateKey)
      .map((a) => ({
        id: a.id,
        title: a.title,
        class: a.subjectGroup.classroom?.name ?? '',
        group: a.subjectGroup.name,
        teacher: a.createdBy.fullName,
        dueAt: a.dueAt!.toISOString(),
        answerMode: a.answerMode,
        maxGrade: a.maxGrade,
      }))

    // جلسات حضور و غیاب همان روز + شمار غایبان
    const sessions = await db.attendanceSession.findMany({
      where: { classroom: classroomId ? { id: classroomId } : { schoolId }, dateKey },
      include: {
        classroom: { select: { id: true, name: true } },
        records: { select: { status: true } },
      },
      orderBy: { createdAt: 'asc' },
    })

    return {
      result: JSON.stringify({
        dateKey,
        dateFa: formatJalaliDate(dateKey, { withWeekday: true }),
        weekday: JALALI_WEEKDAYS_FULL[weekdayOfDateKey(dateKey)],
        isToday: dateKey === todayDateKey(),
        events: events.map((ev) => ({
          id: ev.id,
          type: ev.type,
          typeLabel: CLASS_EVENT_TYPE_LABELS[ev.type as ClassEventType] ?? ev.type,
          title: eventDisplayTitle(ev.type, ev.customTitle),
          schoolWide: !ev.classroomId,
          class: ev.classroom?.name ?? null,
          description: ev.description || null,
          linkedAssignment: !!ev.assignmentId,
          createdBy: ev.createdBy.fullName,
        })),
        homeworkDue,
        attendanceSessions: sessions.map((s) => ({
          id: s.id,
          title: s.title,
          class: s.classroom.name,
          status: s.status === 'FINALIZED' ? 'نهایی‌شده' : 'پیش‌نویس',
          absents: s.records.filter((r) => r.status === 'ABSENT').length,
          presents: s.records.filter((r) => r.status === 'PRESENT').length,
        })),
      }),
      refs: dedupeRefs(refs),
    }
  }
  return errorResult('تاریخ نامعتبر است')
}

/** استریم‌های کلاس آنلاین مدرسه — زنده یا پایان‌یافته */
async function toolLiveSessions(schoolId: string, argsJson: string): Promise<ToolExecResult> {
  const args = parseArgs(argsJson)
  const status = args.status === 'ended' || args.status === 'all' ? args.status : 'active'
  const limitRaw = Number(args.limit ?? 10)
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? Math.trunc(limitRaw) : 10, 1), 20)

  const sessions = await db.liveSession.findMany({
    where: {
      classroom: { schoolId },
      ...(status !== 'all' ? { status: status === 'active' ? 'ACTIVE' : 'ENDED' } : {}),
    },
    include: {
      classroom: { select: { id: true, name: true } },
      host: { select: { id: true, fullName: true } },
      participantLogs: { select: { userId: true, role: true } },
    },
    orderBy: { startedAt: 'desc' },
    take: limit,
  })

  const refs: AiRef[] = []
  const rows = sessions.map((s) => {
    refs.push({ kind: 'class', id: s.classroom.id, title: s.classroom.name })
    refs.push({ kind: 'teacher', id: s.host.id, title: s.host.fullName })
    const studentCount = new Set(s.participantLogs.filter((p) => p.role === 'STUDENT').map((p) => p.userId)).size
    return {
      id: s.id,
      title: s.title,
      class: s.classroom.name,
      teacher: s.host.fullName,
      status: s.status === 'ACTIVE' ? 'زنده' : 'پایان‌یافته',
      startedAt: s.startedAt.toISOString(),
      endedAt: s.endedAt?.toISOString() ?? null,
      announced: !!s.announcedAt,
      studentParticipants: studentCount,
    }
  })

  return {
    result: JSON.stringify({ count: rows.length, status, sessions: rows }),
    refs: dedupeRefs(refs),
  }
}

/** آمار نمرات مدرسه — میانگین درس‌به‌درس و کلاس‌به‌کلاس + آخرین نمرات */
async function toolGradesStats(schoolId: string, argsJson: string): Promise<ToolExecResult> {
  const args = parseArgs(argsJson)
  const refs: AiRef[] = []

  let classroomId: string | undefined
  if (typeof args.classId === 'string' && args.classId) {
    const c = await ownClass(schoolId, args.classId)
    if (!c) return errorResult('کلاس موردنظر در مدرسه شما یافت نشد')
    classroomId = c.id
    refs.push({ kind: 'class', id: c.id, title: c.name })
  }
  const limitRaw = Number(args.limit ?? 10)
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? Math.trunc(limitRaw) : 10, 1), 25)

  const grades = await db.studentGrade.findMany({
    where: {
      classroom: classroomId ? { id: classroomId } : { schoolId },
      OR: [{ session: { status: 'FINALIZED' } }, { sessionId: null }],
    },
    include: {
      student: { select: { id: true, fullName: true } },
      lesson: { select: { id: true, name: true } },
      classroom: { select: { id: true, name: true } },
    },
    orderBy: [{ dateKey: 'desc' }, { createdAt: 'desc' }],
    take: 500,
  })

  const numeric = grades.map((g) => ({ g, n: scoreToNumber(g.score) }))
  const withNum = numeric.filter((x) => x.n !== null) as { g: (typeof grades)[number]; n: number }[]

  // میانگین درس‌به‌درس
  const lessonMap = new Map<string, { name: string; id: string | null; nums: number[] }>()
  for (const x of withNum) {
    const key = x.g.lesson?.id ?? ''
    const cur = lessonMap.get(key) ?? { name: x.g.lesson?.name ?? 'بدون درس', id: x.g.lesson?.id ?? null, nums: [] }
    cur.nums.push(x.n)
    lessonMap.set(key, cur)
  }
  // میانگین کلاس‌به‌کلاس
  const classMap = new Map<string, { name: string; id: string; nums: number[] }>()
  for (const x of withNum) {
    const cur = classMap.get(x.g.classroom.id) ?? { name: x.g.classroom.name, id: x.g.classroom.id, nums: [] }
    cur.nums.push(x.n)
    classMap.set(x.g.classroom.id, cur)
  }

  for (const c of classMap.values()) refs.push({ kind: 'class', id: c.id, title: c.name })

  const recent = numeric.slice(0, limit)
  for (const r of recent) refs.push({ kind: 'student', id: r.g.student.id, title: r.g.student.fullName })

  return {
    result: JSON.stringify({
      totalGrades: grades.length,
      numericGrades: withNum.length,
      averageAll: avgOf(withNum.map((x) => x.n)),
      perLesson: [...lessonMap.values()].map((l) => ({
        lesson: l.name,
        count: l.nums.length,
        avg: avgOf(l.nums),
      })),
      perClass: [...classMap.values()].map((c) => ({
        class: c.name,
        count: c.nums.length,
        avg: avgOf(c.nums),
      })),
      recentGrades: recent.map((r) => ({
        student: r.g.student.fullName,
        lesson: r.g.lesson?.name ?? 'بدون درس',
        title: r.g.title,
        score: r.g.score,
        dateKey: r.g.dateKey,
        dateFa: formatJalaliDate(r.g.dateKey),
      })),
    }),
    refs: dedupeRefs(refs),
  }
}

// ─── ابزارهای معلمان و نمونه‌سؤال‌ها ───

async function toolListTeachers(schoolId: string, argsJson: string): Promise<ToolExecResult> {
  const args = parseArgs(argsJson)
  const refs: AiRef[] = []
  const query = typeof args.query === 'string' ? args.query.trim().slice(0, 60) : ''
  const limitRaw = Number(args.limit ?? 20)
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? Math.trunc(limitRaw) : 20, 1), 30)

  const teachers = await db.user.findMany({
    where: {
      schoolId,
      role: 'TEACHER',
      ...(query ? { OR: [{ fullName: { contains: query } }, { username: { contains: query } }] } : {}),
    },
    select: {
      id: true,
      fullName: true,
      username: true,
      isActive: true,
      teachingAssignments: {
        select: {
          subjectGroup: {
            select: { name: true, classroom: { select: { name: true } } },
          },
        },
      },
    },
    orderBy: { fullName: 'asc' },
    take: limit,
  })

  for (const t of teachers) refs.push({ kind: 'teacher', id: t.id, title: t.fullName })

  return {
    result: JSON.stringify({
      count: teachers.length,
      truncated: teachers.length >= limit,
      teachers: teachers.map((t) => ({
        id: t.id,
        name: t.fullName,
        username: t.username,
        isActive: t.isActive,
        teaching: t.teachingAssignments.map((a) => `${a.subjectGroup.name} (${a.subjectGroup.classroom?.name ?? ''})`),
      })),
    }),
    refs: dedupeRefs(refs),
  }
}

async function toolTeacherDetail(schoolId: string, argsJson: string): Promise<ToolExecResult> {
  const args = parseArgs(argsJson)
  const teacherId = typeof args.teacherId === 'string' ? args.teacherId : ''
  if (!teacherId) return errorResult('شناسه معلم مشخص نشده است')

  const teacher = await db.user.findUnique({
    where: { id: teacherId },
    select: {
      id: true,
      fullName: true,
      username: true,
      role: true,
      isActive: true,
      schoolId: true,
      phone: true,
      createdAt: true,
    },
  })
  if (!teacher || teacher.schoolId !== schoolId || teacher.role !== 'TEACHER') {
    return errorResult('معلمی با این شناسه در مدرسه شما یافت نشد')
  }

  const refs: AiRef[] = [{ kind: 'teacher', id: teacher.id, title: teacher.fullName }]

  const assignments = await db.teachingAssignment.findMany({
    where: { teacherId },
    select: {
      subjectGroup: {
        select: {
          id: true,
          name: true,
          archivedAt: true,
          classroom: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  })
  const groups = assignments.map((a) => a.subjectGroup)
  for (const g of groups) {
    if (!g.classroom) continue
    refs.push({ kind: 'group', id: g.id, title: g.name })
    refs.push({ kind: 'class', id: g.classroom.id, title: g.classroom.name })
  }

  // تکالیفی که این معلم ساخته است (آخرین ۸ مورد) با خلاصه وضعیت ارسال
  const made = await db.assignment.findMany({
    where: { createdById: teacherId, subjectGroup: { classroom: { schoolId } } },
    include: {
      subjectGroup: { select: { name: true, classroom: { select: { name: true } } } },
      _count: { select: { submissions: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 8,
  })
  for (const a of made) refs.push({ kind: 'assignment', id: a.id, title: a.title })

  const sampleqCount = await db.sampleQuestion.count({
    where: { createdById: teacherId, schoolId },
  })

  return {
    result: JSON.stringify({
      teacher: {
        id: teacher.id,
        name: teacher.fullName,
        username: teacher.username,
        isActive: teacher.isActive,
        hasPhone: !!teacher.phone,
        joinedAt: teacher.createdAt.toISOString(),
      },
      teaching: groups
        .filter((g) => g.classroom)
        .map((g) => ({
          group: g.name,
          class: g.classroom!.name,
          archived: !!g.archivedAt,
        })),
      recentAssignments: made.map((a) => ({
        id: a.id,
        title: a.title,
        group: a.subjectGroup.name,
        class: a.subjectGroup.classroom?.name ?? '',
        dueAt: a.dueAt?.toISOString() ?? null,
        submissions: a._count.submissions,
      })),
      sampleQuestionsCount: sampleqCount,
    }),
    refs: dedupeRefs(refs),
  }
}

async function toolListSampleQuestions(schoolId: string, argsJson: string): Promise<ToolExecResult> {
  const args = parseArgs(argsJson)
  const refs: AiRef[] = []

  let classId: string | undefined
  if (typeof args.classId === 'string' && args.classId) {
    const c = await ownClass(schoolId, args.classId)
    if (!c) return errorResult('کلاس موردنظر در مدرسه شما یافت نشد')
    classId = c.id
    refs.push({ kind: 'class', id: c.id, title: c.name })
  }
  const subject = typeof args.subject === 'string' ? args.subject.trim().slice(0, 40) : ''
  const query = typeof args.query === 'string' ? args.query.trim().slice(0, 60) : ''
  const publishedOnly = args.publishedOnly === true
  const limitRaw = Number(args.limit ?? 15)
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? Math.trunc(limitRaw) : 15, 1), 25)

  const questions = await db.sampleQuestion.findMany({
    where: {
      schoolId,
      ...(subject ? { subject: { contains: subject } } : {}),
      ...(query
        ? {
            OR: [
              { title: { contains: query } },
              { topic: { contains: query } },
              { description: { contains: query } },
            ],
          }
        : {}),
      ...(publishedOnly ? { status: 'PUBLISHED' } : {}),
      ...(classId ? { classes: { some: { classroomId: classId } } } : {}),
    },
    select: {
      id: true,
      title: true,
      subject: true,
      topic: true,
      status: true,
      showAnswer: true,
      createdAt: true,
      classes: { select: { classroom: { select: { id: true, name: true } } } },
      _count: { select: { files: true } },
      createdBy: { select: { fullName: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  for (const q of questions) {
    refs.push({ kind: 'sampleq', id: q.id, title: q.title })
    for (const c of q.classes) refs.push({ kind: 'class', id: c.classroom.id, title: c.classroom.name })
  }

  return {
    result: JSON.stringify({
      count: questions.length,
      truncated: questions.length >= limit,
      questions: questions.map((q) => ({
        id: q.id,
        title: q.title,
        subject: q.subject,
        topic: q.topic ?? null,
        published: q.status === 'PUBLISHED',
        showAnswer: q.showAnswer,
        classes: q.classes.map((c) => c.classroom.name),
        filesCount: q._count.files,
        createdBy: q.createdBy.fullName,
        createdAt: q.createdAt.toISOString(),
      })),
    }),
    refs: dedupeRefs(refs),
  }
}

async function toolDraftAnnouncement(schoolId: string, argsJson: string): Promise<ToolExecResult> {
  const args = parseArgs(argsJson)
  const topic = typeof args.topic === 'string' ? args.topic.trim().slice(0, 200) : ''
  if (!topic) return errorResult('موضوع اطلاعیه (topic) الزامی است')

  const audience =
    typeof args.audience === 'string' && args.audience.trim()
      ? args.audience.trim().slice(0, 120)
      : 'والدین و دانش‌آموزان عزیز'
  const tone = typeof args.tone === 'string' && args.tone.trim() ? args.tone.trim().slice(0, 30) : 'رسمی'
  const keyPoints = Array.isArray(args.keyPoints)
    ? args.keyPoints.filter((k): k is string => typeof k === 'string' && k.trim().length > 0).slice(0, 8)
    : []

  const school = await db.school.findUnique({
    where: { id: schoolId },
    select: { name: true },
  })
  const schoolName = school?.name ?? 'مدرسه'
  const todayFa = formatJalaliDate(todayDateKey(), { withWeekday: true })

  const bodyLines = keyPoints.length
    ? keyPoints.map((k) => `• ${k}`).join('\n')
    : `• ${topic}`

  const draft = [
    `📢 اطلاعیه — ${schoolName}`,
    `📅 ${todayFa}`,
    '',
    `${audience} گرامی،`,
    '',
    `با سلام و احترام؛`,
    `موضوع: ${topic}`,
    '',
    bodyLines,
    '',
    tone === 'صمیمی'
      ? 'از همراهی صمیمانه شما سپاسگزاریم. 🌸'
      : 'از همکاری و توجه شما سپاسگزاریم.',
    '',
    `مدیریت ${schoolName}`,
  ].join('\n')

  return {
    result: JSON.stringify({
      draft,
      meta: {
        schoolName,
        todayFa,
        topic,
        audience,
        tone,
        keyPointsCount: keyPoints.length,
      },
      notes: [
        'این فقط پیش‌نویس متنی است؛ چیزی برای هیچ‌کس ارسال نشده است.',
        'ارسال نهایی اطلاعیه توسط مدیر از صفحه «اطلاعیه‌ها» در پنل مدیریت انجام می‌شود.',
      ],
    }),
    refs: [],
  }
}

function dedupeRefs(refs: AiRef[]): AiRef[] {
  const map = new Map<string, AiRef>()
  for (const r of refs) map.set(`${r.kind}:${r.id}`, r)
  return [...map.values()]
}

// ─── ابزارهای تقویم آموزشی ───

/** where مشترک دامنه تقویم: مدرسه کاربر + فیلتر اختیاری کلاس (همراه رویدادهای کل‌مدرسه) + بازه تاریخ */
async function calendarWhere(
  schoolId: string,
  argsJson: string,
): Promise<
  | { error: ToolExecResult; refs: AiRef[]; args: Record<string, unknown> }
  | { error: null; refs: AiRef[]; args: Record<string, unknown>; where: Prisma.ClassEventWhereInput }
> {
  const args = parseArgs(argsJson)
  const refs: AiRef[] = []

  let classroomId: string | undefined
  if (typeof args.classId === 'string' && args.classId) {
    const c = await ownClass(schoolId, args.classId)
    if (!c) return { error: errorResult('کلاس موردنظر در مدرسه شما یافت نشد'), refs, args }
    classroomId = c.id
    refs.push({ kind: 'class', id: c.id, title: c.name })
  }

  let dateKeyFilter: { gte?: string; lte?: string } | undefined
  const month = parseEventMonth(args.month)
  if (args.month !== undefined && args.month !== '' && !month) {
    return { error: errorResult('ماه جلالی نامعتبر است؛ قالب صحیح: 1404-07'), refs, args }
  }
  if (month) dateKeyFilter = { gte: month.from, lte: month.to }

  const from = parseEventDate(args.from)
  const to = parseEventDate(args.to)
  if ((args.from !== undefined && args.from !== '' && !from) || (args.to !== undefined && args.to !== '' && !to)) {
    return { error: errorResult('بازه تاریخ نامعتبر است؛ قالب صحیح: 1404-07-01'), refs, args }
  }
  if (from || to) {
    dateKeyFilter = { ...(dateKeyFilter ?? {}), ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) }
  }

  const where: Prisma.ClassEventWhereInput = {
    schoolId,
    ...(classroomId ? { OR: [{ classroomId }, { classroomId: null }] } : {}),
    ...(dateKeyFilter ? { dateKey: dateKeyFilter } : {}),
  }
  return { error: null, refs, args, where }
}

async function toolCalendarStats(schoolId: string, argsJson: string): Promise<ToolExecResult> {
  const cw = await calendarWhere(schoolId, argsJson)
  if (cw.error) return cw.error
  const refs = [...cw.refs]

  const events = await db.classEvent.findMany({
    where: cw.where,
    select: {
      id: true,
      type: true,
      customTitle: true,
      dateKey: true,
      classroomId: true,
      assignmentId: true,
      classroom: { select: { id: true, name: true } },
    },
    orderBy: { dateKey: 'asc' },
  })

  const today = todayDateKey()
  const byType: Record<string, number> = {}
  for (const t of EVENT_TYPE_KEYS) byType[t] = 0
  const perClassMap = new Map<string, { id: string; name: string; count: number }>()
  let schoolWide = 0
  let assignmentLinked = 0
  let upcoming = 0
  let past = 0

  for (const ev of events) {
    byType[ev.type] = (byType[ev.type] ?? 0) + 1
    if (!ev.classroomId) schoolWide++
    else {
      const key = ev.classroom?.id ?? ev.classroomId
      const cur = perClassMap.get(key)
      if (cur) cur.count++
      else perClassMap.set(key, { id: key, name: ev.classroom?.name ?? 'کلاس', count: 1 })
    }
    if (ev.assignmentId) assignmentLinked++
    if (ev.dateKey >= today) upcoming++
    else past++
  }

  const upcomingPreview = events
    .filter((e) => e.dateKey >= today)
    .slice(0, 6)
    .map((e) => ({
      id: e.id,
      dateKey: e.dateKey,
      dateFa: formatJalaliDate(e.dateKey, { withWeekday: true }),
      type: e.type,
      typeLabel: CLASS_EVENT_TYPE_LABELS[e.type as ClassEventType] ?? e.type,
      title: eventDisplayTitle(e.type, e.customTitle),
      schoolWide: !e.classroomId,
      class: e.classroom?.name ?? null,
    }))

  for (const u of upcomingPreview) refs.push({ kind: 'event', id: u.id, title: `${u.title} · ${u.dateFa}` })

  return {
    result: JSON.stringify({
      today: today,
      todayFa: formatJalaliDate(today, { withWeekday: true }),
      total: events.length,
      byType: Object.fromEntries(
        Object.entries(byType).map(([k, v]) => [k, { label: CLASS_EVENT_TYPE_LABELS[k as ClassEventType] ?? k, count: v }]),
      ),
      schoolWideEvents: schoolWide,
      classEvents: events.length - schoolWide,
      assignmentLinkedEvents: assignmentLinked,
      upcoming: upcoming,
      past: past,
      perClass: [...perClassMap.values()].sort((a, b) => b.count - a.count),
      upcomingPreview,
    }),
    refs: dedupeRefs(refs),
  }
}

async function toolListCalendarEvents(schoolId: string, argsJson: string): Promise<ToolExecResult> {
  const cw = await calendarWhere(schoolId, argsJson)
  if (cw.error) return cw.error
  const refs = [...cw.refs]
  const args = cw.args

  const type = args.type !== undefined && args.type !== '' ? parseEventType(args.type) : undefined
  if (args.type !== undefined && args.type !== '' && !type) {
    return errorResult('نوع رویداد نامعتبر است؛ انواع مجاز: HOLIDAY، EXAM، HOMEWORK، PARTY، SPORTS، ACADEMIC، TRIP، CUSTOM')
  }

  const limitRaw = Number(args.limit ?? 20)
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? Math.trunc(limitRaw) : 20, 1), 50)

  const events = await db.classEvent.findMany({
    where: { ...cw.where, ...(type ? { type } : {}) },
    include: {
      classroom: { select: { id: true, name: true } },
      createdBy: { select: { fullName: true } },
    },
    orderBy: { dateKey: 'asc' },
    take: limit,
  })

  for (const ev of events) refs.push(...eventRefs(ev))

  return {
    result: JSON.stringify({
      count: events.length,
      truncated: events.length >= limit,
      events: events.map((ev) => ({
        id: ev.id,
        dateKey: ev.dateKey,
        dateFa: formatJalaliDate(ev.dateKey, { withWeekday: true }),
        weekday: JALALI_WEEKDAYS_FULL[weekdayOfDateKey(ev.dateKey)],
        type: ev.type,
        typeLabel: CLASS_EVENT_TYPE_LABELS[ev.type as ClassEventType] ?? ev.type,
        title: eventDisplayTitle(ev.type, ev.customTitle),
        schoolWide: !ev.classroomId,
        class: ev.classroom?.name ?? null,
        description: ev.description || null,
        hasAssignmentLink: !!ev.assignmentId,
        createdBy: ev.createdBy.fullName,
      })),
    }),
    refs: dedupeRefs(refs),
  }
}

async function toolCreateCalendarEvent(schoolId: string, userId: string, argsJson: string): Promise<ToolExecResult> {
  const args = parseArgs(argsJson)

  const type = parseEventType(args.type)
  if (!type) {
    return errorResult('نوع رویداد الزامی و باید یکی از این‌ها باشد: HOLIDAY، EXAM، HOMEWORK، PARTY، SPORTS، ACADEMIC، TRIP، CUSTOM')
  }
  const dateKey = parseEventDate(args.date)
  if (!dateKey) {
    return errorResult('تاریخ جلالی الزامی است؛ قالب صحیح: 1404-07-21 (سال-ماه-روز شمسی)')
  }

  let classroomId: string | null = null
  const refs: AiRef[] = []
  if (typeof args.classId === 'string' && args.classId) {
    const c = await ownClass(schoolId, args.classId)
    if (!c) return errorResult('کلاس موردنظر در مدرسه شما یافت نشد')
    classroomId = c.id
    refs.push({ kind: 'class', id: c.id, title: c.name })
  }

  const title = typeof args.title === 'string' ? args.title.trim().slice(0, 80) : ''
  if (type === 'CUSTOM' && !title) {
    return errorResult('رویداد سفارشی (CUSTOM) به نام رویداد نیاز دارد؛ پارامتر title را بفرست')
  }
  if (title && type !== 'CUSTOM') {
    return errorResult(`نام اختصاصی فقط برای نوع CUSTOM است؛ برای نوع «${CLASS_EVENT_TYPE_LABELS[type]}» پارامتر title را حذف کن یا توضیحات را در description بنویس`)
  }
  const description = typeof args.description === 'string' ? args.description.trim().slice(0, 500) : ''

  const created = await db.classEvent.create({
    data: {
      schoolId,
      classroomId,
      dateKey,
      type,
      customTitle: type === 'CUSTOM' ? title : null,
      description,
      createdById: userId,
    },
    include: { classroom: { select: { id: true, name: true } } },
  })
  refs.push(...eventRefs(created))

  const notes: string[] = []
  if (type === 'HOMEWORK') {
    notes.push('این رویداد «تکلیف» به‌صورت ساده در تقویم ثبت شد؛ ثبت تکلیف درسی واقعی (با مهلت و دریافت پاسخ دانش‌آموزان) توسط معلمان از درون تقویم آموزشی انجام می‌شود.')
  }
  if (!classroomId) notes.push('این رویداد برای کل مدرسه ثبت شد و در تقویم همه کلاس‌ها نمایش داده می‌شود.')

  return {
    result: JSON.stringify({
      ok: true,
      event: {
        id: created.id,
        type: created.type,
        typeLabel: CLASS_EVENT_TYPE_LABELS[created.type as ClassEventType] ?? created.type,
        title: eventDisplayTitle(created.type, created.customTitle),
        dateKey: created.dateKey,
        dateFa: formatJalaliDate(created.dateKey, { withWeekday: true }),
        schoolWide: !created.classroomId,
        class: created.classroom?.name ?? null,
        description: created.description || null,
      },
      ...(notes.length ? { notes } : {}),
    }),
    refs: dedupeRefs(refs),
  }
}

async function toolUpdateCalendarEvent(schoolId: string, argsJson: string): Promise<ToolExecResult> {
  const args = parseArgs(argsJson)
  const eventId = typeof args.eventId === 'string' ? args.eventId.trim() : ''
  if (!eventId) return errorResult('شناسه رویداد (eventId) الزامی است')

  const existing = await ownEvent(schoolId, eventId)
  if (!existing) return errorResult('رویدادی با این شناسه در تقویم مدرسه شما یافت نشد')

  const data: {
    dateKey?: string
    type?: string
    customTitle?: string | null
    description?: string
    classroomId?: string | null
  } = {}

  if (args.date !== undefined && args.date !== '') {
    const dateKey = parseEventDate(args.date)
    if (!dateKey) return errorResult('تاریخ جلالی نامعتبر است؛ قالب صحیح: 1404-07-21')
    data.dateKey = dateKey
  }

  if (args.type !== undefined && args.type !== '') {
    const type = parseEventType(args.type)
    if (!type) return errorResult('نوع رویداد نامعتبر است')
    if (existing.assignmentId && existing.type === 'HOMEWORK' && type !== 'HOMEWORK') {
      return errorResult('این رویداد به یک تکلیف درسی واقعی متصل است و قابل تغییر نوع نیست؛ در صورت نیاز رویداد را حذف و رویداد ساده جدید ثبت کن')
    }
    data.type = type
  }

  const effectiveType = data.type ?? existing.type

  if (args.title !== undefined && args.title !== '') {
    const title = String(args.title).trim().slice(0, 80)
    if (effectiveType !== 'CUSTOM') {
      return errorResult(`نام اختصاصی فقط برای نوع CUSTOM است؛ رویداد «${CLASS_EVENT_TYPE_LABELS[effectiveType as ClassEventType] ?? effectiveType}» نام اختصاصی نمی‌پذیرد`)
    }
    data.customTitle = title
  }
  if (args.description !== undefined && typeof args.description === 'string') {
    data.description = args.description.trim().slice(0, 500)
  }

  if (args.schoolWide === true) {
    data.classroomId = null
  } else if (typeof args.classId === 'string' && args.classId) {
    const c = await ownClass(schoolId, args.classId)
    if (!c) return errorResult('کلاس موردنظر در مدرسه شما یافت نشد')
    data.classroomId = c.id
  }

  if (effectiveType === 'CUSTOM' && !(data.customTitle ?? existing.customTitle)?.trim()) {
    return errorResult('رویداد سفارشی (CUSTOM) باید نام داشته باشد؛ پارامتر title را بفرست')
  }

  const updated = await db.classEvent.update({
    where: { id: existing.id },
    data,
    include: { classroom: { select: { id: true, name: true } } },
  })

  const refs = eventRefs(updated)
  return {
    result: JSON.stringify({
      ok: true,
      event: {
        id: updated.id,
        type: updated.type,
        typeLabel: CLASS_EVENT_TYPE_LABELS[updated.type as ClassEventType] ?? updated.type,
        title: eventDisplayTitle(updated.type, updated.customTitle),
        dateKey: updated.dateKey,
        dateFa: formatJalaliDate(updated.dateKey, { withWeekday: true }),
        schoolWide: !updated.classroomId,
        class: updated.classroom?.name ?? null,
        description: updated.description || null,
      },
    }),
    refs: dedupeRefs(refs),
  }
}

async function toolDeleteCalendarEvent(schoolId: string, argsJson: string): Promise<ToolExecResult> {
  const args = parseArgs(argsJson)
  const eventId = typeof args.eventId === 'string' ? args.eventId.trim() : ''
  if (!eventId) return errorResult('شناسه رویداد (eventId) الزامی است')

  const existing = await ownEvent(schoolId, eventId)
  if (!existing) return errorResult('رویدادی با این شناسه در تقویم مدرسه شما یافت نشد')

  await db.classEvent.delete({ where: { id: existing.id } })

  const refs = eventRefs(existing)
  return {
    result: JSON.stringify({
      ok: true,
      deleted: {
        id: existing.id,
        title: eventDisplayTitle(existing.type, existing.customTitle),
        dateKey: existing.dateKey,
        dateFa: formatJalaliDate(existing.dateKey, { withWeekday: true }),
      },
      ...(existing.assignmentId
        ? { notes: ['رویداد تقویم حذف شد؛ خود تکلیف درسی مرتبط بدون تغییر باقی ماند.'] }
        : {}),
    }),
    refs: dedupeRefs(refs),
  }
}

/** اجرای ابزار با کنترل مجوز سمت سرور — schoolId و userId از نشست، نه از مدل */
export async function executeAiTool(
  name: string,
  argsJson: string,
  ctx: { schoolId: string; userId: string },
): Promise<ToolExecResult> {
  switch (name) {
    case 'school_overview':
      return toolSchoolOverview(ctx.schoolId)
    case 'list_classes':
      return toolListClasses(ctx.schoolId)
    case 'assignment_status':
      return toolAssignmentStatus(ctx.schoolId, argsJson)
    case 'list_students':
      return toolListStudents(ctx.schoolId, argsJson)
    case 'student_detail':
      return toolStudentDetail(ctx.schoolId, argsJson)
    case 'list_teachers':
      return toolListTeachers(ctx.schoolId, argsJson)
    case 'teacher_detail':
      return toolTeacherDetail(ctx.schoolId, argsJson)
    case 'list_sample_questions':
      return toolListSampleQuestions(ctx.schoolId, argsJson)
    case 'student_performance':
      return toolStudentPerformance(ctx.schoolId, argsJson)
    case 'day_agenda':
      return toolDayAgenda(ctx.schoolId, argsJson)
    case 'live_sessions':
      return toolLiveSessions(ctx.schoolId, argsJson)
    case 'grades_stats':
      return toolGradesStats(ctx.schoolId, argsJson)
    case 'draft_announcement':
      return toolDraftAnnouncement(ctx.schoolId, argsJson)
    case 'calendar_stats':
      return toolCalendarStats(ctx.schoolId, argsJson)
    case 'list_calendar_events':
      return toolListCalendarEvents(ctx.schoolId, argsJson)
    case 'create_calendar_event':
      return toolCreateCalendarEvent(ctx.schoolId, ctx.userId, argsJson)
    case 'update_calendar_event':
      return toolUpdateCalendarEvent(ctx.schoolId, argsJson)
    case 'delete_calendar_event':
      return toolDeleteCalendarEvent(ctx.schoolId, argsJson)
    default:
      return errorResult('ابزار نامشخص')
  }
}
