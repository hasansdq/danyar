import { db } from "@/lib/db";
import { defaultPermissions, type Permissions } from "@/lib/permissions";

/**
 * Load ALL role permissions as a { role: { featureKey: bool } } map.
 * Missing rows default to true (everything enabled).
 */
export async function loadPermissions(): Promise<Permissions> {
  const rows = await db.rolePermission.findMany();
  const out = defaultPermissions();
  for (const r of rows) {
    if (!out[r.role]) out[r.role] = {};
    out[r.role][r.featureKey] = r.enabled;
  }
  return out;
}

/**
 * Returns the feature->bool map for ONE user's role.
 * SUPERADMIN => all true (unlimited).
 */
export async function loadPermissionsForRole(role: string): Promise<Record<string, boolean>> {
  if (role === "SUPERADMIN") {
    return Object.fromEntries(
      [
        "chat","assignments","sample_questions","grades","file_upload",
        "create_assignment","create_sample_question","set_grades",
        "create_poll","close_chat","delete_message","bulk_chat_management",
        "manage_users","manage_classes","manage_enrollment","manage_content",
      ].map((k) => [k, true])
    );
  }
  const all = await loadPermissions();
  return all[role] ?? {};
}

export class PermissionDeniedError extends Error {
  constructor(feature: string) {
    super(`دسترسی به «${feature}» برای نقش شما غیرفعال است`);
    this.name = "PermissionDeniedError";
  }
}

/**
 * Call in API handlers: `await assertPermission(user.role, "chat")`.
 * Throws PermissionDeniedError if the feature is disabled for the role.
 * SUPERADMIN always passes.
 *
 * SECURITY: unknown feature keys DEFAULT-DENY (`?? false`) — a typo'd or
 * not-yet-cataloged key must never silently grant access.
 */
export async function assertPermission(role: string, featureKey: string): Promise<void> {
  if (role === "SUPERADMIN") return;
  const perms = await loadPermissionsForRole(role);
  if (!(perms[featureKey] ?? false)) throw new PermissionDeniedError(featureKey);
}
