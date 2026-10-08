import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSuperAdminApi } from "@/lib/api-auth";
import { audit, AuditActions } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * POST /api/superadmin/permissions/reset
 *
 * Deletes all RolePermission rows, reverting to the default-everything-on
 * state. Returns { data: { reset: true } }.
 */
export async function POST(_req: NextRequest) {
  const auth = await requireSuperAdminApi();
  if (auth.response) return auth.response;

  await db.rolePermission.deleteMany({});
  // AUDIT: permission reset is a platform-wide sensitive operation.
  await audit({
    actor: { id: auth.user.id, username: auth.user.username, role: auth.user.role, schoolId: auth.user.schoolId ?? null },
    action: AuditActions.PERMISSION_RESET,
  });

  return NextResponse.json({ data: { reset: true } });
}
