-- گروه‌های عمومی مدرسه + پایه تحصیلی کلاس
-- ۱) Classroom.grade — پایه کلاس (بازسازی غیرمخرب + backfill از پیشوند نام کلاس)
-- ۲) SubjectGroup — classroomId اختیاری می‌شود + schoolId/scope/grade برای گروه‌های عمومی
-- همه داده‌های موجود کامل حفظ می‌شود (کپی ردیف‌به‌ردیف).

-- ─── Classroom: افزودن ستون پایه ───
ALTER TABLE "Classroom" ADD COLUMN "grade" TEXT;

-- backfill پایه از الگوی نام «پایه + شعبه» (مثلاً «هفتم ۷۰۳» یا «هفتم۱» — با/بدون فاصله)
UPDATE "Classroom" SET "grade" = CASE
    WHEN "name" = 'دوازدهم' OR "name" LIKE 'دوازدهم%' THEN 'دوازدهم'
    WHEN "name" = 'یازدهم' OR "name" LIKE 'یازدهم%' THEN 'یازدهم'
    WHEN "name" = 'دهم' OR "name" LIKE 'دهم%' THEN 'دهم'
    WHEN "name" = 'نهم' OR "name" LIKE 'نهم%' THEN 'نهم'
    WHEN "name" = 'هشتم' OR "name" LIKE 'هشتم%' THEN 'هشتم'
    WHEN "name" = 'هفتم' OR "name" LIKE 'هفتم%' THEN 'هفتم'
    WHEN "name" = 'ششم' OR "name" LIKE 'ششم%' THEN 'ششم'
    WHEN "name" = 'پنجم' OR "name" LIKE 'پنجم%' THEN 'پنجم'
    WHEN "name" = 'چهارم' OR "name" LIKE 'چهارم%' THEN 'چهارم'
    WHEN "name" = 'سوم' OR "name" LIKE 'سوم%' THEN 'سوم'
    WHEN "name" = 'دوم' OR "name" LIKE 'دوم%' THEN 'دوم'
    WHEN "name" = 'اول' OR "name" LIKE 'اول%' THEN 'اول'
    ELSE NULL
END
WHERE "grade" IS NULL;

-- ─── SubjectGroup: بازسازی با classroomId اختیاری + ستون‌های گروه عمومی ───
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SubjectGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "classroomId" TEXT,
    "schoolId" TEXT,
    "scope" TEXT NOT NULL DEFAULT 'CLASS',
    "grade" TEXT,
    "archivedAt" DATETIME,
    "messagePolicy" TEXT NOT NULL DEFAULT 'ALL',
    "avatarKey" TEXT,
    "avatarMime" TEXT,
    "avatarUpdatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SubjectGroup_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SubjectGroup_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- کپی کامل همه گروه‌های درسی موجود با scope=CLASS
INSERT INTO "new_SubjectGroup" ("id", "name", "classroomId", "scope", "grade", "archivedAt", "messagePolicy", "avatarKey", "avatarMime", "avatarUpdatedAt", "createdAt", "updatedAt")
SELECT "id", "name", "classroomId", 'CLASS', NULL, "archivedAt", "messagePolicy", "avatarKey", "avatarMime", "avatarUpdatedAt", "createdAt", "updatedAt" FROM "SubjectGroup";
DROP TABLE "SubjectGroup";
ALTER TABLE "new_SubjectGroup" RENAME TO "SubjectGroup";
CREATE UNIQUE INDEX "SubjectGroup_classroomId_name_key" ON "SubjectGroup"("classroomId", "name");
CREATE INDEX "SubjectGroup_schoolId_idx" ON "SubjectGroup"("schoolId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
