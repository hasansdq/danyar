-- ظرفیت کلاس آنلاین هر کلاس — قابل تعیین از پنل مدیر کل
-- ستون اختیاری؛ null = سقف سراسری LIVE_MAX_PARTICIPANTS (پیش‌فرض ۳۲).
-- تغییر غیرمخرب: فقط افزودن ستون — هیچ داده‌ای تغییر نمی‌کند.

ALTER TABLE "Classroom" ADD COLUMN "capacity" INTEGER;
