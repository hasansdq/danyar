import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSuperAdminApi } from "@/lib/api-auth";
import {
  buildSettingsMap,
  formatSetting,
  getSettingDef,
  isKnownSettingKey,
  type SiteSettings,
  type SettingValueType,
} from "@/lib/site-settings";

/**
 * /api/superadmin/settings
 *
 * GET  — returns the raw settings map (superadmin-only).
 *        Response: { data: { lazyLoading, navigationProgress, aiWelcomeMessage,
 *                            aiSuggestedPrompts, aiAccessStats, …,
 *                            modules: { classChat, directChat, … } } }
 *
 * PATCH — upsert one or more SiteSetting rows.
 *         Body shape 1: { key: string, value: boolean | string | string[] }
 *         Body shape 2: { updates: [{ key, value }, ...] }
 *         `key` MUST be one of the known setting keys (validated).
 *         `value` MUST match the key's valueType:
 *           - boolean  → boolean
 *           - string   → string (e.g. the AI welcome message)
 *           - string[] → array of strings (e.g. the suggested prompts)
 *         Response: the refreshed full settings map.
 */

async function fetchAll(): Promise<SiteSettings> {
  const rows = await db.siteSetting.findMany({
    select: { key: true, value: true },
  });
  return buildSettingsMap(rows);
}

export async function GET() {
  const auth = await requireSuperAdminApi();
  if (auth.response) return auth.response;

  const data = await fetchAll();
  // SECURITY: mask the AI provider's API key in EVERY response (GET + PATCH)
  // so the network payload never leaks the full key. The AI assistant route
  // reads the full key directly from the DB; the SUPERADMIN UI only
  // needs to know whether a key is set (so it can show "●●●●●●●●" as a
  // placeholder + an "edit" affordance).
  if (data.aiProviderApiKey) {
    data.aiProviderApiKey = maskApiKey(data.aiProviderApiKey);
  }
  return NextResponse.json({ data });
}

/**
 * Mask an API key for safe display. Returns `***...last4` so the user
 * can verify which key is set without seeing the full value. If the key
 * is too short to safely mask, returns just `***`.
 */
function maskApiKey(key: string): string {
  if (key.length <= 8) return "***";
  return `${"*".repeat(Math.min(key.length - 4, 24))}${key.slice(-4)}`;
}

interface PatchItem {
  key: string;
  value: unknown;
}

function readPatchItems(body: unknown): PatchItem[] | { error: string } {
  if (!body || typeof body !== "object") {
    return { error: "بدنه درخواست نامعتبر است" };
  }
  const obj = body as Record<string, unknown>;
  let items: PatchItem[] = [];

  if (Array.isArray(obj.updates)) {
    items = obj.updates as unknown as PatchItem[];
  } else if ("key" in obj && "value" in obj) {
    items = [obj as unknown as PatchItem];
  } else {
    return { error: "بدنه باید شامل { key, value } یا { updates: [...] } باشد" };
  }

  for (const it of items) {
    if (!it || typeof it !== "object") {
      return { error: "آیتم تنظیمات نامعتبر است" };
    }
    const { key, value } = it as PatchItem;
    if (typeof key !== "string" || !isKnownSettingKey(key)) {
      return { error: `کلید تنظیمات نامعتبر: ${String(key)}` };
    }
    const def = getSettingDef(key)!;
    const err = validateValue(def.valueType, value, key);
    if (err) return { error: err };
  }
  return items;
}

/** Returns a Persian error message when `value` doesn't match `valueType`. */
function validateValue(
  valueType: SettingValueType,
  value: unknown,
  key: string,
): string | null {
  if (valueType === "boolean") {
    if (typeof value !== "boolean") {
      return `مقدار باید بولی باشد (کلید: ${key})`;
    }
    return null;
  }
  if (valueType === "string") {
    if (typeof value !== "string") {
      return `مقدار باید رشته‌ای باشد (کلید: ${key})`;
    }
    return null;
  }
  // string[]
  if (!Array.isArray(value)) {
    return `مقدار باید آرایه‌ای از رشته‌ها باشد (کلید: ${key})`;
  }
  for (const v of value) {
    if (typeof v !== "string") {
      return `مقدار باید آرایه‌ای از رشته‌ها باشد (کلید: ${key})`;
    }
  }
  return null;
}

export async function PATCH(request: Request) {
  const auth = await requireSuperAdminApi();
  if (auth.response) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "بدنه JSON نامعتبر است" },
      { status: 400 },
    );
  }

  const parsed = readPatchItems(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  // Upsert each setting. Booleans → "true"/"false"; strings → raw; string[] →
  // JSON.stringify. See `formatSetting` in site-settings.ts.
  await Promise.all(
    parsed.map((it) => {
      const def = getSettingDef(it.key)!;
      const storedValue = formatSetting(it.value, def.valueType);
      return db.siteSetting.upsert({
        where: { key: it.key },
        update: { value: storedValue },
        create: { key: it.key, value: storedValue },
        select: { key: true, value: true },
      });
    }),
  );

  const data = await fetchAll();
  // SECURITY: same masking as GET — the raw provider key must never
  // round-trip in the PATCH response.
  if (data.aiProviderApiKey) {
    data.aiProviderApiKey = maskApiKey(data.aiProviderApiKey);
  }
  return NextResponse.json({ data });
}
