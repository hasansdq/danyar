import { db } from "@/lib/db";

/**
 * Global module toggles — backend enforcement layer.
 *
 * The SUPERADMIN can flip each module_* setting on/off via
 * PATCH /api/superadmin/settings. When a module is off, the corresponding
 * API endpoints refuse the action via `assertModule`. SUPERADMIN bypasses
 * every module check (they're the platform owner).
 *
 * This is the GLOBAL gate — orthogonal to the per-role `assertPermission`
 * gate. The per-role gate lets the SUPERADMIN say "STUDENT can't upload
 * files"; the module gate lets them say "nobody can upload files anywhere
 * right now" (e.g. during maintenance).
 *
 * Convention: missing SiteSetting row === enabled (default `true`).
 */

/** Thrown by `assertModule` when a module is globally disabled. */
export class ModuleDisabledError extends Error {
  constructor(module: string) {
    super(`ماژول «${module}» غیرفعال است`);
    this.name = "ModuleDisabledError";
  }
}

/**
 * Returns true if the module is enabled. Missing rows default to `true`
 * (everything enabled — opt-in to disable).
 *
 * `moduleKey` is the bare key WITHOUT the `module_` prefix — e.g.
 * `class_chat`, `direct_chat`, `ai_assistant`, `profile_avatar`, …
 */
export async function isModuleEnabled(
  moduleKey: string,
): Promise<boolean> {
  const row = await db.siteSetting.findUnique({
    where: { key: "module_" + moduleKey },
    select: { value: true },
  });
  if (!row) return true;
  const v = row.value.trim().toLowerCase();
  if (v === "false" || v === "0") return false;
  return true;
}

/**
 * Throws `ModuleDisabledError` if the module is off.
 * SUPERADMIN bypasses every module check.
 *
 * Usage in API handlers (after `await requireAuth()`):
 *   await assertModule(user.role, "class_chat");
 *
 * The thrown error is converted to a 403 response by `apiHandler` in
 * `src/lib/api-utils.ts`.
 */
export async function assertModule(
  role: string,
  moduleKey: string,
): Promise<void> {
  if (role === "SUPERADMIN") return;
  if (!(await isModuleEnabled(moduleKey))) {
    throw new ModuleDisabledError(moduleKey);
  }
}
