-- CreateTable
CREATE TABLE "PlatformSetting" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'global',
    "appName" TEXT NOT NULL DEFAULT 'دانیار',
    "logoKey" TEXT,
    "fontPreset" TEXT NOT NULL DEFAULT 'vazirmatn',
    "fontCustomKey" TEXT,
    "chatBgKey" TEXT,
    "splashEnabled" BOOLEAN NOT NULL DEFAULT true,
    "splashDurationMs" INTEGER NOT NULL DEFAULT 2200,
    "splashShowAppName" BOOLEAN NOT NULL DEFAULT true,
    "splashShowDisplayName" BOOLEAN NOT NULL DEFAULT true,
    "splashBgKey" TEXT,
    "splashAppNameFont" TEXT NOT NULL DEFAULT '',
    "splashAppNameColor" TEXT NOT NULL DEFAULT '#0f766e',
    "splashAppNameSize" INTEGER NOT NULL DEFAULT 56,
    "splashDisplayNameFont" TEXT NOT NULL DEFAULT '',
    "splashDisplayNameColor" TEXT NOT NULL DEFAULT '#475569',
    "splashDisplayNameSize" INTEGER NOT NULL DEFAULT 16,
    "updatedAt" DATETIME NOT NULL
);

