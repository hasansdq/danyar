-- CreateTable
CREATE TABLE "OtpCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL DEFAULT '',
    "purpose" TEXT NOT NULL DEFAULT 'login',
    "expiresAt" DATETIME NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" DATETIME,
    "providerId" TEXT,
    "requestId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SmsDeliveryLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "phoneMasked" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "messageId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "latencyMs" INTEGER,
    "purpose" TEXT NOT NULL DEFAULT 'otp',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "OtpCode_expiresAt_idx" ON "OtpCode"("expiresAt");

-- CreateIndex
CREATE INDEX "OtpCode_createdAt_idx" ON "OtpCode"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OtpCode_phone_purpose_key" ON "OtpCode"("phone", "purpose");

-- CreateIndex
CREATE INDEX "SmsDeliveryLog_createdAt_idx" ON "SmsDeliveryLog"("createdAt");

-- CreateIndex
CREATE INDEX "SmsDeliveryLog_provider_createdAt_idx" ON "SmsDeliveryLog"("provider", "createdAt");

