import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import { apiHandler } from "@/lib/api-utils";
import { loadPermissionsForRole } from "@/lib/permission-check";

export const dynamic = "force-dynamic";

/**
 * GET /api/permissions/me
 *
 * Returns { role, permissions } for the calling user's role. SUPERADMIN
 * returns all features enabled.
 */
export const GET = apiHandler(async () => {
  const user = await requireAuth();
  const permissions = await loadPermissionsForRole(user.role);
  return NextResponse.json({ data: { role: user.role, permissions } });
});
