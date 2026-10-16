-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "role" TEXT NOT NULL,
    "phone" TEXT,
    "schoolId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "avatarKey" TEXT,
    "avatarMime" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Upload" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "uploaderId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Upload_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "School" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "features" TEXT NOT NULL DEFAULT '{"chat":true,"dm":true,"assignments":true,"onlineClass":true,"attendance":true,"sampleq":true}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Classroom" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "allowStudentDm" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Classroom_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SubjectGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "archivedAt" DATETIME,
    "messagePolicy" TEXT NOT NULL DEFAULT 'ALL',
    "avatarKey" TEXT,
    "avatarMime" TEXT,
    "avatarUpdatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SubjectGroup_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClassroomEnrollment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClassroomEnrollment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ClassroomEnrollment_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TeachingAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teacherId" TEXT NOT NULL,
    "subjectGroupId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TeachingAssignment_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TeachingAssignment_subjectGroupId_fkey" FOREIGN KEY ("subjectGroupId") REFERENCES "SubjectGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GroupMemberOverride" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subjectGroupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GroupMemberOverride_subjectGroupId_fkey" FOREIGN KEY ("subjectGroupId") REFERENCES "SubjectGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GroupMemberOverride_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GroupReadState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "subjectGroupId" TEXT NOT NULL,
    "lastReadAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GroupReadState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GroupReadState_subjectGroupId_fkey" FOREIGN KEY ("subjectGroupId") REFERENCES "SubjectGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "subjectGroupId" TEXT,
    "senderId" TEXT NOT NULL,
    "recipientId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'TEXT',
    "body" TEXT NOT NULL DEFAULT '',
    "attachmentName" TEXT,
    "attachmentKey" TEXT,
    "attachmentMime" TEXT,
    "attachmentSize" INTEGER,
    "attachmentMeta" TEXT,
    "replyToId" TEXT,
    "clientId" TEXT,
    "isAnnouncement" BOOLEAN NOT NULL DEFAULT false,
    "assignmentId" TEXT,
    "liveSessionId" TEXT,
    "sampleQuestionId" TEXT,
    "isForwarded" BOOLEAN NOT NULL DEFAULT false,
    "forwardedFromName" TEXT,
    "pinnedAt" DATETIME,
    "pinnedById" TEXT,
    "editedAt" DATETIME,
    "deletedAt" DATETIME,
    "readAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_subjectGroupId_fkey" FOREIGN KEY ("subjectGroupId") REFERENCES "SubjectGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Message_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Message_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "Message" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Message_pinnedById_fkey" FOREIGN KEY ("pinnedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LiveSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "classroomId" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "notifyGroupId" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "announcedAt" DATETIME,
    "endedAt" DATETIME,
    "enderId" TEXT,
    CONSTRAINT "LiveSession_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LiveSession_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LiveSession_notifyGroupId_fkey" FOREIGN KEY ("notifyGroupId") REFERENCES "SubjectGroup" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LiveSession_enderId_fkey" FOREIGN KEY ("enderId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LiveChatMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LiveChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LiveSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LiveChatMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LiveParticipantLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" DATETIME,
    "kicked" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "LiveParticipantLog_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LiveSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LiveParticipantLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subjectGroupId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "answerMode" TEXT NOT NULL DEFAULT 'BOTH',
    "allowEdit" BOOLEAN NOT NULL DEFAULT true,
    "maxGrade" INTEGER,
    "dueAt" DATETIME,
    "attachmentName" TEXT,
    "attachmentKey" TEXT,
    "attachmentMime" TEXT,
    "attachmentSize" INTEGER,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Assignment_subjectGroupId_fkey" FOREIGN KEY ("subjectGroupId") REFERENCES "SubjectGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Assignment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssignmentSubmission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assignmentId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "fileName" TEXT,
    "fileKey" TEXT,
    "fileMime" TEXT,
    "fileSize" INTEGER,
    "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" DATETIME,
    "feedbackStatus" TEXT NOT NULL DEFAULT 'UNSEEN',
    "feedbackNote" TEXT,
    "grade" INTEGER,
    "reviewedAt" DATETIME,
    CONSTRAINT "AssignmentSubmission_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssignmentSubmission_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "link" TEXT,
    "dedupeKey" TEXT,
    "readAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NotificationPref" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "browserEnabled" BOOLEAN NOT NULL DEFAULT false,
    "previewEnabled" BOOLEAN NOT NULL DEFAULT false,
    "pushEventTypes" TEXT NOT NULL DEFAULT '[]',
    "soundEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "NotificationPref_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MutedChat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "chatType" TEXT NOT NULL,
    "chatKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MutedChat_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OtpCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "phoneHmac" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" DATETIME,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SmsConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "passwordLoginEnabled" BOOLEAN NOT NULL DEFAULT true,
    "smsLoginEnabled" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "credentials" TEXT NOT NULL DEFAULT '{}',
    "codeTtlSeconds" INTEGER NOT NULL DEFAULT 120,
    "resendCooldownSeconds" INTEGER NOT NULL DEFAULT 60,
    "maxAttemptsPerCode" INTEGER NOT NULL DEFAULT 5,
    "maxRequestsPerHour" INTEGER NOT NULL DEFAULT 5,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SmsSendLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "provider" TEXT NOT NULL,
    "maskedPhone" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'OTP',
    "ok" BOOLEAN NOT NULL,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AiConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "provider" TEXT NOT NULL DEFAULT 'openai',
    "baseUrl" TEXT NOT NULL DEFAULT '',
    "model" TEXT NOT NULL DEFAULT '',
    "apiKey" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "generalInstruction" TEXT NOT NULL DEFAULT '',
    "managerInstruction" TEXT NOT NULL DEFAULT '',
    "maxToolCalls" INTEGER NOT NULL DEFAULT 4,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AiSchoolSetting" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "schoolId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "managerEnabled" BOOLEAN NOT NULL DEFAULT true,
    "dailyMessageLimit" INTEGER,
    CONSTRAINT "AiSchoolSetting_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiConversation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'دستیار دانیار',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AiConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiMessage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "conversationId" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "refs" JSONB,
    "stopped" BOOLEAN NOT NULL DEFAULT false,
    "clientId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AttendanceSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "classroomId" TEXT NOT NULL,
    "dateKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "finalizedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AttendanceSession_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AttendanceSession_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AttendanceRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PRESENT',
    "note" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AttendanceRecord_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AttendanceSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AttendanceRecord_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AttendanceEditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "oldStatus" TEXT NOT NULL,
    "newStatus" TEXT NOT NULL,
    "oldNote" TEXT,
    "newNote" TEXT,
    "editorId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AttendanceEditLog_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AttendanceSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AttendanceEditLog_editorId_fkey" FOREIGN KEY ("editorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiUsageLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" TEXT NOT NULL,
    "schoolId" TEXT,
    "ok" BOOLEAN NOT NULL,
    "errorType" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "latencyMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiUsageLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SampleQuestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "topic" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "showAnswer" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "publishedAt" DATETIME,
    "createdById" TEXT NOT NULL,
    "clientId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SampleQuestion_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SampleQuestion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SampleQuestionClass" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "questionId" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    CONSTRAINT "SampleQuestionClass_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "SampleQuestion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SampleQuestionClass_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SampleQuestionFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "questionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SampleQuestionFile_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "SampleQuestion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SampleQuestionBookmark" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "questionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SampleQuestionBookmark_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "SampleQuestion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SampleQuestionBookmark_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClassEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "classroomId" TEXT,
    "dateKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "customTitle" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "assignmentId" TEXT,
    CONSTRAINT "ClassEvent_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ClassEvent_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ClassEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ClassEvent_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "deviceId" TEXT,
    "label" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PushDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subscriptionId" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" DATETIME,
    CONSTRAINT "PushDelivery_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "PushSubscription" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PushDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PushConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "platformEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ImpersonationLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "adminId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    CONSTRAINT "ImpersonationLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ImpersonationLog_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BulkSendLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "senderId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "schoolId" TEXT,
    "classroomId" TEXT,
    "roles" TEXT NOT NULL DEFAULT '[]',
    "text" TEXT NOT NULL DEFAULT '',
    "total" INTEGER NOT NULL DEFAULT 0,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "ok" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BulkSendLog_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "Classroom_schoolId_name_key" ON "Classroom"("schoolId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "SubjectGroup_classroomId_name_key" ON "SubjectGroup"("classroomId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ClassroomEnrollment_studentId_classroomId_key" ON "ClassroomEnrollment"("studentId", "classroomId");

-- CreateIndex
CREATE UNIQUE INDEX "TeachingAssignment_teacherId_subjectGroupId_key" ON "TeachingAssignment"("teacherId", "subjectGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupMemberOverride_subjectGroupId_userId_key" ON "GroupMemberOverride"("subjectGroupId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupReadState_userId_subjectGroupId_key" ON "GroupReadState"("userId", "subjectGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "Message_clientId_key" ON "Message"("clientId");

-- CreateIndex
CREATE INDEX "Message_subjectGroupId_createdAt_idx" ON "Message"("subjectGroupId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_senderId_recipientId_createdAt_idx" ON "Message"("senderId", "recipientId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_recipientId_readAt_idx" ON "Message"("recipientId", "readAt");

-- CreateIndex
CREATE INDEX "Message_assignmentId_idx" ON "Message"("assignmentId");

-- CreateIndex
CREATE INDEX "Message_liveSessionId_idx" ON "Message"("liveSessionId");

-- CreateIndex
CREATE INDEX "Message_sampleQuestionId_idx" ON "Message"("sampleQuestionId");

-- CreateIndex
CREATE INDEX "Message_subjectGroupId_pinnedAt_idx" ON "Message"("subjectGroupId", "pinnedAt");

-- CreateIndex
CREATE INDEX "LiveSession_classroomId_status_idx" ON "LiveSession"("classroomId", "status");

-- CreateIndex
CREATE INDEX "LiveChatMessage_sessionId_createdAt_idx" ON "LiveChatMessage"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "LiveParticipantLog_sessionId_userId_idx" ON "LiveParticipantLog"("sessionId", "userId");

-- CreateIndex
CREATE INDEX "Assignment_subjectGroupId_createdAt_idx" ON "Assignment"("subjectGroupId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentSubmission_assignmentId_studentId_key" ON "AssignmentSubmission"("assignmentId", "studentId");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key" ON "Notification"("userId", "dedupeKey");

-- CreateIndex
CREATE INDEX "MutedChat_userId_idx" ON "MutedChat"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MutedChat_userId_chatType_chatKey_key" ON "MutedChat"("userId", "chatType", "chatKey");

-- CreateIndex
CREATE INDEX "OtpCode_phoneHmac_createdAt_idx" ON "OtpCode"("phoneHmac", "createdAt");

-- CreateIndex
CREATE INDEX "SmsSendLog_createdAt_idx" ON "SmsSendLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiSchoolSetting_schoolId_key" ON "AiSchoolSetting"("schoolId");

-- CreateIndex
CREATE INDEX "AiConversation_userId_updatedAt_idx" ON "AiConversation"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiMessage_clientId_key" ON "AiMessage"("clientId");

-- CreateIndex
CREATE INDEX "AiMessage_conversationId_createdAt_idx" ON "AiMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "AttendanceSession_classroomId_dateKey_idx" ON "AttendanceSession"("classroomId", "dateKey");

-- CreateIndex
CREATE INDEX "AttendanceSession_status_idx" ON "AttendanceSession"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceSession_classroomId_dateKey_title_key" ON "AttendanceSession"("classroomId", "dateKey", "title");

-- CreateIndex
CREATE INDEX "AttendanceRecord_studentId_status_idx" ON "AttendanceRecord"("studentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceRecord_sessionId_studentId_key" ON "AttendanceRecord"("sessionId", "studentId");

-- CreateIndex
CREATE INDEX "AttendanceEditLog_sessionId_studentId_idx" ON "AttendanceEditLog"("sessionId", "studentId");

-- CreateIndex
CREATE INDEX "AiUsageLog_schoolId_createdAt_idx" ON "AiUsageLog"("schoolId", "createdAt");

-- CreateIndex
CREATE INDEX "AiUsageLog_userId_createdAt_idx" ON "AiUsageLog"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SampleQuestion_clientId_key" ON "SampleQuestion"("clientId");

-- CreateIndex
CREATE INDEX "SampleQuestion_schoolId_status_createdAt_idx" ON "SampleQuestion"("schoolId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "SampleQuestion_schoolId_subject_idx" ON "SampleQuestion"("schoolId", "subject");

-- CreateIndex
CREATE INDEX "SampleQuestion_createdById_idx" ON "SampleQuestion"("createdById");

-- CreateIndex
CREATE INDEX "SampleQuestionClass_classroomId_idx" ON "SampleQuestionClass"("classroomId");

-- CreateIndex
CREATE UNIQUE INDEX "SampleQuestionClass_questionId_classroomId_key" ON "SampleQuestionClass"("questionId", "classroomId");

-- CreateIndex
CREATE UNIQUE INDEX "SampleQuestionFile_key_key" ON "SampleQuestionFile"("key");

-- CreateIndex
CREATE INDEX "SampleQuestionFile_questionId_role_idx" ON "SampleQuestionFile"("questionId", "role");

-- CreateIndex
CREATE INDEX "SampleQuestionBookmark_userId_idx" ON "SampleQuestionBookmark"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SampleQuestionBookmark_questionId_userId_key" ON "SampleQuestionBookmark"("questionId", "userId");

-- CreateIndex
CREATE INDEX "ClassEvent_schoolId_dateKey_idx" ON "ClassEvent"("schoolId", "dateKey");

-- CreateIndex
CREATE INDEX "ClassEvent_classroomId_dateKey_idx" ON "ClassEvent"("classroomId", "dateKey");

-- CreateIndex
CREATE INDEX "ClassEvent_createdById_idx" ON "ClassEvent"("createdById");

-- CreateIndex
CREATE INDEX "ClassEvent_assignmentId_idx" ON "ClassEvent"("assignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- CreateIndex
CREATE INDEX "PushSubscription_deviceId_idx" ON "PushSubscription"("deviceId");

-- CreateIndex
CREATE INDEX "PushDelivery_status_nextAttemptAt_idx" ON "PushDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "PushDelivery_type_status_createdAt_idx" ON "PushDelivery"("type", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PushDelivery_subscriptionId_notificationId_key" ON "PushDelivery"("subscriptionId", "notificationId");

-- CreateIndex
CREATE INDEX "ImpersonationLog_adminId_startedAt_idx" ON "ImpersonationLog"("adminId", "startedAt");

-- CreateIndex
CREATE INDEX "BulkSendLog_createdAt_idx" ON "BulkSendLog"("createdAt");

