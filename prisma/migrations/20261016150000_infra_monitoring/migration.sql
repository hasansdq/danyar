-- پایش زیرساخت (پنل مدیر کل): آستانه‌های هشدار + رویدادهای پایش با سیاست پاک‌سازی
-- جدول‌ها افزوده‌اند؛ هیچ جدول/ستون موجودی تغییر نمی‌کند (پیام‌رسان/استریم/اعلان دست‌نخورده).

CREATE TABLE "InfraSetting" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'global',
    "cpuThreshold" INTEGER NOT NULL DEFAULT 85,
    "ramThreshold" INTEGER NOT NULL DEFAULT 85,
    "diskThreshold" INTEGER NOT NULL DEFAULT 90,
    "sustainedCount" INTEGER NOT NULL DEFAULT 3,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "InfraEventLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "InfraEventLog_createdAt_idx" ON "InfraEventLog"("createdAt");
