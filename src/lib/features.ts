/** پرچم‌های امکانات قابل تنظیم برای هر مدرسه */
export interface SchoolFeatures {
  chat: boolean // گروه‌های درسی و پیام‌رسانی گروهی
  dm: boolean // پیام خصوصی
  assignments: boolean // تکالیف
  onlineClass: boolean // کلاس آنلاین
  attendance: boolean // حضور و غیاب تقویم‌محور
  sampleq: boolean // کتابخانه نمونه‌سؤالات
  push: boolean // پوش نوتیفیکیشن مرورگر برای این مدرسه
}

export const DEFAULT_FEATURES: SchoolFeatures = {
  chat: true,
  dm: true,
  assignments: true,
  onlineClass: true,
  attendance: true,
  sampleq: true,
  push: true,
}

/** پیام رسمی غیرفعال‌بودن ماژول استریم مدرسه — یک منبع حقیقت برای همه لایه‌ها */
export const ONLINE_CLASS_DISABLED_MSG =
  'قابلیت کلاس آنلاین ویدیویی برای مدرسه شما غیر فعال است!'
export const ONLINE_CLASS_DISABLED_HINT = 'لطفاً با پشتیبانی دانیار تماس بگیرید.'

/** برچسب فارسی امکانات + آینده بودن آن */
export const FEATURE_LABELS: {
  key: keyof SchoolFeatures
  label: string
  description: string
  upcoming?: boolean
}[] = [
  {
    key: 'chat',
    label: 'پیام‌رسانی گروهی',
    description: 'گروه‌های درسی و گفتگوی گروهی معلمان و دانش‌آموزان',
  },
  {
    key: 'dm',
    label: 'پیام خصوصی',
    description: 'گفتگوی خصوصی بین کاربران همان مدرسه',
  },
  {
    key: 'assignments',
    label: 'تکالیف',
    description: 'تعریف تکالیف گروه درسی، دریافت پاسخ، بازخورد و نمره',
  },
  {
    key: 'onlineClass',
    label: 'کلاس آنلاین ویدیویی (استریم)',
    description:
      'ماژول استریم زنده کلاس — جلسه صوتی و تصویری با SFU؛ در صورت خاموشی، ورود اعضای مدرسه با پیام خطا مسدود می‌شود',
  },
  {
    key: 'attendance',
    label: 'حضور و غیاب',
    description: 'ثبت حضور و غیاب تقویم‌محور (جلالی) هر کلاس، گزارش و آمار',
  },
  {
    key: 'sampleq',
    label: 'نمونه‌سؤالات',
    description:
      'کتابخانه انتشار و دریافت نمونه‌سؤال با فایل و پاسخ‌نامه اختیاری',
  },
]

/** خواندن امن features از رشته JSON دیتابیس؛ در صورت خرابی مقدار پیش‌فرض */
export function parseFeatures(raw: string | null | undefined): SchoolFeatures {
  if (!raw) return { ...DEFAULT_FEATURES }
  try {
    const obj = JSON.parse(raw)
    return {
      chat: obj?.chat === true,
      dm: obj?.dm === true,
      assignments: obj?.assignments === true,
      onlineClass: obj?.onlineClass === true,
      // کلید قدیمی‌ها ندارند → پیش‌فرض فعال (مگر صریحاً خاموش شده باشد)
      attendance: obj?.attendance !== false,
      sampleq: obj?.sampleq !== false,
      // پوش: پیش‌فرض فعال مگر صریحاً خاموش شده باشد
      push: obj?.push !== false,
    }
  } catch {
    return { ...DEFAULT_FEATURES }
  }
}

/** اعتبارسنجی ورودی features از سمت کلاینت */
export function sanitizeFeatures(input: unknown): SchoolFeatures | null {
  if (typeof input !== 'object' || input === null) return null
  const obj = input as Record<string, unknown>
  const bool = (v: unknown) => v === true || v === false
  if (!bool(obj.chat) || !bool(obj.dm) || !bool(obj.assignments) || !bool(obj.onlineClass)) {
    return null
  }
  return {
    chat: obj.chat as boolean,
    dm: obj.dm as boolean,
    assignments: obj.assignments as boolean,
    onlineClass: obj.onlineClass as boolean,
    // کلید attendance و sampleq و push اختیاری است (سازگاری با کلاینت‌های قدیمی) —
    // وقتی کلاینت قدیمی کلید را نفرستاده، مقدار فعلی پایگاه داده حفظ می‌شود
    // (در مسیر PATCH با merge ترکیب می‌شود)؛ اینجا undefined برمی‌گردد
    attendance: obj.attendance === undefined ? undefined : (obj.attendance === true),
    sampleq: obj.sampleq === undefined ? undefined : (obj.sampleq === true),
    push: obj.push === undefined ? undefined : obj.push === true,
  } as SchoolFeatures
}
