-- پس‌زمینه چت موبایل جداگانه برای حالت تیره
-- (افزودنی و غیرمخرب — ستون جدید nullable؛ داده‌های موجود دست نمی‌خورند)
ALTER TABLE "PlatformSetting" ADD COLUMN "chatBgDarkKey" TEXT;
