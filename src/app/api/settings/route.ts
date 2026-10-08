import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getApiUser } from "@/lib/api-auth";
import { buildSettingsMap } from "@/lib/site-settings";

/**
 * GET /api/settings
 *
 * Public site settings. Any logged-in user can read these — they're needed by
 * every page (the Skeleton wrapper + the NavigationProgress bar both read
 * this, plus the AI assistant welcome message + the module flags that gate
 * which feature panes are visible to which roles).
 *
 * Response shape:
 *   { data: {
 *       // UI toggles
 *       lazyLoading: boolean,
 *       navigationProgress: boolean,
 *       // AI assistant
 *       aiWelcomeMessage: string,
 *       aiSuggestedPrompts: string[],
 *       aiAccessStats: boolean,
 *       aiAccessStudentInfo: boolean,
 *       aiAccessPasswordChange: boolean,
 *       // Global module toggles
 *       modules: {
 *         classChat, directChat, assignments, sampleQuestions, grades,
 *         polls, fileUpload, bulkChat, aiAssistant, profileAvatar, darkMode
 *       }
 *   } }
 *
 * Missing SiteSetting rows default to `true` (everything enabled) — see
 * `buildSettingsMap` in `src/lib/site-settings.ts`.
 */
export async function GET() {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db.siteSetting.findMany({
    select: { key: true, value: true },
  });
  const data = buildSettingsMap(rows);

  // Phase 34 — STRIP the AI provider config from the public response.
  // The API key + base URL + model name are SUPERADMIN-only secrets —
  // leaking them to ordinary teachers/students would be a security
  // issue. The AI assistant route reads the full config directly from
  // the DB; the public client doesn't need any of it.
  delete (data as unknown as Record<string, unknown>).aiProviderType;
  delete (data as unknown as Record<string, unknown>).aiProviderApiKey;
  delete (data as unknown as Record<string, unknown>).aiProviderBaseUrl;
  delete (data as unknown as Record<string, unknown>).aiProviderModel;

  // Phase 37 — the SMS provider config no longer exists in this catalog at
  // all (it moved to the dedicated «مدیریت OTP» module whose credentials are
  // write-only). Nothing SMS-related is part of the public response.

  // Phase 36m — override WebRTC config with env vars (for Docker).
  // Env vars take precedence over DB settings (so Docker deployments
  // can configure STUN/TURN without the superadmin panel).
  const envStun = process.env.STUN_SERVERS;
  const envTurn = process.env.TURN_SERVER;
  const envTurnUser = process.env.TURN_USERNAME;
  const envTurnPass = process.env.TURN_CREDENTIAL;
  if (envStun) (data as unknown as Record<string, unknown>).webrtcStunServers = envStun;
  if (envTurn) (data as unknown as Record<string, unknown>).webrtcTurnServer = envTurn;
  if (envTurnUser) (data as unknown as Record<string, unknown>).webrtcTurnUsername = envTurnUser;
  if (envTurnPass) (data as unknown as Record<string, unknown>).webrtcTurnCredential = envTurnPass;

  // Provide defaults when neither env nor DB has STUN servers.
  if (!(data as unknown as Record<string, unknown>).webrtcStunServers) {
    (data as unknown as Record<string, unknown>).webrtcStunServers = "stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302";
  }

  return NextResponse.json({ data });
}
