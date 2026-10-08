import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireSuperAdminApi } from "@/lib/api-auth";
import { apiHandler } from "@/lib/api-utils";
import { readdirSync, existsSync } from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";

/**
 * GET /api/superadmin/notification-sound
 *
 * SUPERADMIN-only. Returns the current notification sound setting +
 * a list of uploaded sound files (from /public/uploads/ that match
 * audio extensions).
 *
 * Response: { data: { current: string, uploaded: Array<{ url, name }> } }
 */
export const GET = apiHandler(async () => {
  const auth = await requireSuperAdminApi();
  if (auth.response) return auth.response;

  // Read the current sound setting from SiteSetting.
  const row = await db.siteSetting.findUnique({
    where: { key: "notification_sound" },
    select: { value: true },
  });
  const current = row?.value ?? "";

  // List uploaded sound files from /public/uploads/.
  const uploadsDir = join(process.cwd(), "public", "uploads");
  let uploaded: Array<{ url: string; name: string }> = [];
  if (existsSync(uploadsDir)) {
    try {
      const files = readdirSync(uploadsDir);
      uploaded = files
        .filter((f) => /\.(mp3|wav|ogg|aac)$/i.test(f))
        .map((f) => ({
          url: `/uploads/${f}`,
          name: f,
        }));
    } catch {
      // ignore — empty list
    }
  }

  return NextResponse.json({
    data: { current, uploaded },
  });
});

/**
 * PATCH /api/superadmin/notification-sound
 *
 * SUPERADMIN-only. Updates the notification sound setting.
 * Body: { sound: string } — the URL path of the sound file.
 * Empty string = default browser sound.
 */
export const PATCH = apiHandler(async (req: NextRequest) => {
  const auth = await requireSuperAdminApi();
  if (auth.response) return auth.response;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const sound = (body?.sound || "").toString().trim();

  await db.siteSetting.upsert({
    where: { key: "notification_sound" },
    update: { value: sound },
    create: { key: "notification_sound", value: sound },
  });

  return NextResponse.json({ data: { sound } });
});
