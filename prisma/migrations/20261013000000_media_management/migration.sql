-- CreateTable
CREATE TABLE "MediaSetting" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'global',
    "formats" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_School" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "features" TEXT NOT NULL DEFAULT '{"chat":true,"dm":true,"assignments":true,"onlineClass":true,"attendance":true,"sampleq":true}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "mediaQuotaGB" REAL NOT NULL DEFAULT 0
);
INSERT INTO "new_School" ("createdAt", "features", "id", "isActive", "name", "updatedAt") SELECT "createdAt", "features", "id", "isActive", "name", "updatedAt" FROM "School";
DROP TABLE "School";
ALTER TABLE "new_School" RENAME TO "School";
CREATE TABLE "new_Upload" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "uploaderId" TEXT NOT NULL,
    "schoolId" TEXT,
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Upload_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Upload_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
-- backfill مدرسهٔ هر رسانه از مدرسهٔ آپلودکننده (غیرمخرب)
INSERT INTO "new_Upload" ("createdAt", "key", "mime", "name", "size", "type", "uploaderId", "schoolId")
SELECT u."createdAt", u."key", u."mime", u."name", u."size", u."type", u."uploaderId",
       (SELECT "schoolId" FROM "User" WHERE "User"."id" = u."uploaderId")
FROM "Upload" u;
DROP TABLE "Upload";
ALTER TABLE "new_Upload" RENAME TO "Upload";
CREATE INDEX "Upload_schoolId_idx" ON "Upload"("schoolId");
CREATE INDEX "Upload_createdAt_idx" ON "Upload"("createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
