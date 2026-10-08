import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSuperAdminApi } from "@/lib/api-auth";
import { loadPermissions } from "@/lib/permission-check";
import {
  MANAGED_ROLES,
  featuresForRole,
  type Role,
} from "@/lib/permissions";

export const dynamic = "force-dynamic";

/**
 * GET /api/superadmin/permissions
 * Returns the full permissions map (same as /api/permissions but superadmin-only).
 */
export async function GET(_req: NextRequest) {
  const auth = await requireSuperAdminApi();
  if (auth.response) return auth.response;

  const data = await loadPermissions();
  return NextResponse.json({ data });
}

type PermissionUpdate = {
  role: string;
  featureKey: string;
  enabled: boolean;
};

/**
 * PATCH /api/superadmin/permissions
 *
 * Body (one of):
 *   { role, featureKey, enabled }                       — single update
 *   { updates: [{ role, featureKey, enabled }...] }     — batch
 *
 * Validates:
 *   - role ∈ MANAGED_ROLES (STUDENT | TEACHER | ADMIN)
 *   - featureKey is a valid feature for that role
 *
 * Upserts the RolePermission row(s) and returns the full updated map.
 */
export async function PATCH(req: NextRequest) {
  const auth = await requireSuperAdminApi();
  if (auth.response) return auth.response;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let updates: PermissionUpdate[];
  if (Array.isArray(body?.updates)) {
    updates = body.updates;
  } else if (
    body &&
    typeof body.role === "string" &&
    typeof body.featureKey === "string" &&
    typeof body.enabled === "boolean"
  ) {
    updates = [
      {
        role: body.role,
        featureKey: body.featureKey,
        enabled: body.enabled,
      },
    ];
  } else {
    return NextResponse.json(
      {
        error:
          'Body must be { role, featureKey, enabled } or { updates: [...] }',
      },
      { status: 400 },
    );
  }

  if (updates.length === 0) {
    return NextResponse.json(
      { error: "updates must be a non-empty array" },
      { status: 400 },
    );
  }

  // Validate each update.
  for (let i = 0; i < updates.length; i++) {
    const u = updates[i];
    if (!u || typeof u !== "object") {
      return NextResponse.json(
        { error: `updates[${i}] must be an object` },
        { status: 400 },
      );
    }
    if (typeof u.role !== "string") {
      return NextResponse.json(
        { error: `updates[${i}].role must be a string` },
        { status: 400 },
      );
    }
    if (typeof u.featureKey !== "string") {
      return NextResponse.json(
        { error: `updates[${i}].featureKey must be a string` },
        { status: 400 },
      );
    }
    if (typeof u.enabled !== "boolean") {
      return NextResponse.json(
        { error: `updates[${i}].enabled must be a boolean` },
        { status: 400 },
      );
    }
    if (!MANAGED_ROLES.includes(u.role as Role)) {
      return NextResponse.json(
        {
          error: `updates[${i}].role must be one of ${MANAGED_ROLES.join(", ")}`,
        },
        { status: 400 },
      );
    }
    const validKeys = new Set(featuresForRole(u.role).map((f) => f.key));
    if (!validKeys.has(u.featureKey)) {
      return NextResponse.json(
        {
          error: `updates[${i}].featureKey "${u.featureKey}" is not valid for role ${u.role}`,
        },
        { status: 400 },
      );
    }
  }

  // Apply upserts in a transaction.
  await db.$transaction(async (tx) => {
    for (const u of updates) {
      await tx.rolePermission.upsert({
        where: {
          role_featureKey: {
            role: u.role,
            featureKey: u.featureKey,
          },
        },
        create: {
          role: u.role,
          featureKey: u.featureKey,
          enabled: u.enabled,
        },
        update: { enabled: u.enabled },
      });
    }
  });

  const data = await loadPermissions();
  return NextResponse.json({ data });
}
