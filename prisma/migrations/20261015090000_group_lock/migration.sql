-- RedefineTables
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
    "lockedForStudents" BOOLEAN NOT NULL DEFAULT false,
    "messagePolicy" TEXT NOT NULL DEFAULT 'ALL',
    "avatarKey" TEXT,
    "avatarMime" TEXT,
    "avatarUpdatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SubjectGroup_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SubjectGroup_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SubjectGroup" ("archivedAt", "avatarKey", "avatarMime", "avatarUpdatedAt", "classroomId", "createdAt", "grade", "id", "messagePolicy", "name", "schoolId", "scope", "updatedAt") SELECT "archivedAt", "avatarKey", "avatarMime", "avatarUpdatedAt", "classroomId", "createdAt", "grade", "id", "messagePolicy", "name", "schoolId", "scope", "updatedAt" FROM "SubjectGroup";
DROP TABLE "SubjectGroup";
ALTER TABLE "new_SubjectGroup" RENAME TO "SubjectGroup";
CREATE INDEX "SubjectGroup_schoolId_idx" ON "SubjectGroup"("schoolId");
CREATE UNIQUE INDEX "SubjectGroup_classroomId_name_key" ON "SubjectGroup"("classroomId", "name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

