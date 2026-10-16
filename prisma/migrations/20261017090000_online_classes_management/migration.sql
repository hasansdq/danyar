-- مدیریت کلاس‌های آنلاین (پنل مدیر کل) — سقف‌های اختصاصی هر مدرسه و گزارش پایان اجباری
-- تغییر غیرمخرب: فقط افزودن ستون‌های اختیاری/با پیش‌فرض — هیچ داده‌ای تغییر نمی‌کند.

-- سقف افراد هم‌زمان هر جلسه این مدرسه (معلم نیز جزو ظرفیت) — null = سقف جهانی LIVE_MAX_PARTICIPANTS
ALTER TABLE "School" ADD COLUMN "liveMaxParticipants" INTEGER;

-- حداکثر جلسات هم‌زمان این مدرسه — null = نامحدود
ALTER TABLE "School" ADD COLUMN "liveMaxConcurrent" INTEGER;

-- دلیل پایان اجباری جلسه توسط مدیر کل (گزارش مدیریتی) — null = پایان عادی
ALTER TABLE "LiveSession" ADD COLUMN "forceEndReason" TEXT;

-- شمارش قطع‌ووصل (اتصال مجدد سوکت) هر شرکت‌کننده در جلسه
ALTER TABLE "LiveParticipantLog" ADD COLUMN "reconnects" INTEGER NOT NULL DEFAULT 0;
