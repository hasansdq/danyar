import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import { apiHandler } from "@/lib/api-utils";
import { loadPermissions } from "@/lib/permission-check";

export const dynamic = "force-dynamic";

/**
 * GET /api/permissions
 *
 * Returns the full permissions map: { role: { featureKey: bool } }.
 * Auth required (any role). Useful for the UI to show/hide features.
 */
export const GET = apiHandler(async () => {
  await requireAuth();
  const data = await loadPermissions();
  return NextResponse.json({ data });
});
