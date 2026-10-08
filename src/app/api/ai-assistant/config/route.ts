import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import { apiHandler } from "@/lib/api-utils";
import { assertPermission } from "@/lib/permission-check";
import { assertModule } from "@/lib/module-check";
import { db } from "@/lib/db";
import {
  parseSettingBool,
  parseSettingString,
  parseSettingStringArray,
} from "@/lib/site-settings";

export const dynamic = "force-dynamic";

/**
 * GET /api/ai-assistant/config
 *
 * Auth: ADMIN or SUPERADMIN. The `ai_assistant` per-role permission AND the
 * global `ai_assistant` module must both be enabled (SUPERADMIN bypasses
 * both checks — the per-role assertPermission short-circuits for them, and
 * assertModule short-circuits for SUPERADMIN too).
 *
 * Returns the AI chat panel's display config:
 *   { data: {
 *       welcomeMessage: string,
 *       suggestedPrompts: string[],
 *       access: { stats: boolean, studentInfo: boolean, passwordChange: boolean }
 *   } }
 *
 * The frontend reads this to render the welcome message + quick-reply chips
 * + to know which capabilities the AI has (so it can hide the password-change
 * chip when the toggle is off, etc.).
 *
 * Missing SiteSetting rows default to the catalog defaults — see
 * `src/lib/site-settings.ts`.
 */
export const GET = apiHandler(async () => {
  const user = await requireAuth();
  if (user.role !== "ADMIN" && user.role !== "SUPERADMIN") {
    return NextResponse.json(
      { error: "این بخش فقط برای مدیر مدرسه در دسترس است" },
      { status: 403 },
    );
  }

  // Global module gate — SUPERADMIN bypasses.
  await assertModule(user.role, "ai_assistant");

  // Per-role gate — SUPERADMIN bypasses.
  await assertPermission(user.role, "ai_assistant");

  // Read all AI-related rows in one go.
  const rows = await db.siteSetting.findMany({
    where: {
      key: {
        in: [
          "ai_welcome_message",
          "ai_suggested_prompts",
          "ai_access_stats",
          "ai_access_student_info",
          "ai_access_password_change",
        ],
      },
    },
    select: { key: true, value: true },
  });
  const lookup = new Map(rows.map((r) => [r.key, r.value]));

  const welcomeMessage = parseSettingString(
    "ai_welcome_message",
    lookup.get("ai_welcome_message") ?? null,
  );
  const suggestedPrompts = parseSettingStringArray(
    "ai_suggested_prompts",
    lookup.get("ai_suggested_prompts") ?? null,
  );
  const access = {
    stats: parseSettingBool(
      "ai_access_stats",
      lookup.get("ai_access_stats") ?? null,
    ),
    studentInfo: parseSettingBool(
      "ai_access_student_info",
      lookup.get("ai_access_student_info") ?? null,
    ),
    passwordChange: parseSettingBool(
      "ai_access_password_change",
      lookup.get("ai_access_password_change") ?? null,
    ),
  };

  return NextResponse.json({
    data: {
      welcomeMessage,
      suggestedPrompts,
      access,
    },
  });
});
