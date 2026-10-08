-- OtpCode + SmsDeliveryLog: provider-based SMS OTP (Phase 37, PostgreSQL dialect).
-- OtpCode stores ONLY the HMAC-SHA-256 hash of the code (never plaintext).
-- SmsDeliveryLog stores masked phones + sanitized errors (never the code/secrets).
CREATE TABLE "OtpCode" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL DEFAULT '',
    "purpose" TEXT NOT NULL DEFAULT 'login',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "providerId" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsDeliveryLog" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "phoneMasked" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "messageId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "latencyMs" INTEGER,
    "purpose" TEXT NOT NULL DEFAULT 'otp',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmsDeliveryLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OtpCode_phone_purpose_key" ON "OtpCode"("phone", "purpose");

-- CreateIndex
CREATE INDEX "OtpCode_expiresAt_idx" ON "OtpCode"("expiresAt");

-- CreateIndex
CREATE INDEX "OtpCode_createdAt_idx" ON "OtpCode"("createdAt");

-- CreateIndex
CREATE INDEX "SmsDeliveryLog_createdAt_idx" ON "SmsDeliveryLog"("createdAt");

-- CreateIndex
CREATE INDEX "SmsDeliveryLog_provider_createdAt_idx" ON "SmsDeliveryLog"("provider", "createdAt");
