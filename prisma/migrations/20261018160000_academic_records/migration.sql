-- CreateTable
CREATE TABLE "StudentViolation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "dateKey" TEXT NOT NULL,
    "sessionId" TEXT,
    "text" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StudentViolation_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StudentViolation_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StudentViolation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AttendanceSession" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StudentViolation_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Lesson" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Lesson_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TeacherLesson" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teacherId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TeacherLesson_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TeacherLesson_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StudentGrade" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "dateKey" TEXT NOT NULL,
    "sessionId" TEXT,
    "title" TEXT NOT NULL,
    "lessonId" TEXT,
    "score" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StudentGrade_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StudentGrade_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StudentGrade_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AttendanceSession" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StudentGrade_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StudentGrade_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VicePermission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "viceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VicePermission_viceId_fkey" FOREIGN KEY ("viceId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ViolationType" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "StudentViolation_studentId_dateKey_idx" ON "StudentViolation"("studentId", "dateKey");

-- CreateIndex
CREATE INDEX "StudentViolation_classroomId_dateKey_idx" ON "StudentViolation"("classroomId", "dateKey");

-- CreateIndex
CREATE INDEX "StudentViolation_sessionId_idx" ON "StudentViolation"("sessionId");

-- CreateIndex
CREATE INDEX "Lesson_schoolId_idx" ON "Lesson"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "Lesson_schoolId_name_key" ON "Lesson"("schoolId", "name");

-- CreateIndex
CREATE INDEX "TeacherLesson_lessonId_idx" ON "TeacherLesson"("lessonId");

-- CreateIndex
CREATE UNIQUE INDEX "TeacherLesson_teacherId_lessonId_key" ON "TeacherLesson"("teacherId", "lessonId");

-- CreateIndex
CREATE INDEX "StudentGrade_studentId_dateKey_idx" ON "StudentGrade"("studentId", "dateKey");

-- CreateIndex
CREATE INDEX "StudentGrade_classroomId_dateKey_idx" ON "StudentGrade"("classroomId", "dateKey");

-- CreateIndex
CREATE INDEX "StudentGrade_sessionId_idx" ON "StudentGrade"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "VicePermission_viceId_key_key" ON "VicePermission"("viceId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ViolationType_label_key" ON "ViolationType"("label");

