import { db } from "@/lib/db";

/**
 * Thrown by `assertDmPermission` when the calling user is not allowed to
 * send a direct message to the target user (cross-school, or one of the
 * school's DM-permission toggles is off).
 *
 * The `apiHandler` wrapper converts this to a 403 JSON response.
 */
export class DmPermissionDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DmPermissionDeniedError";
  }
}

type Role = "STUDENT" | "TEACHER" | "ADMIN" | "SUPERADMIN";

/**
 * Check whether user A (role `aRole`, school `aSchoolId`) is allowed to
 * direct-message user B (role `bRole`, school `bSchoolId`).
 *
 * Rules:
 *  - SUPERADMIN can DM anyone. (Also: anyone can DM a SUPERADMIN.)
 *  - Both users must belong to the same school.
 *  - principal↔teacher is ALWAYS allowed (no toggle).
 *  - principal↔student requires `school.dmPrincipalStudent`.
 *  - teacher↔student requires `school.dmTeacherStudent`.
 *  - student↔student requires `school.dmStudentStudent`.
 *  - same-role pairs (principal↔principal, teacher↔teacher, student↔student)
 *    fall through to the student-student rule above. principal↔principal is
 *    allowed by default.
 *
 * Returns the shared `schoolId` (string) when allowed, or `null` when the
 * pair involves a SUPERADMIN (no shared school). Throws
 * `DmPermissionDeniedError` when not allowed.
 */
export async function assertDmPermission(
  aRole: string,
  aSchoolId: string | null | undefined,
  bRole: string,
  bSchoolId: string | null | undefined,
): Promise<string | null> {
  // SUPERADMIN bypasses entirely (either side).
  if (aRole === "SUPERADMIN" || bRole === "SUPERADMIN") return null;

  // Same school required.
  if (!aSchoolId || !bSchoolId || aSchoolId !== bSchoolId) {
    throw new DmPermissionDeniedError(
      "چت خصوصی فقط بین کاربران یک مدرسه مجاز است",
    );
  }

  const school = await db.school.findUnique({
    where: { id: aSchoolId },
    select: {
      dmTeacherStudent: true,
      dmStudentStudent: true,
      dmPrincipalStudent: true,
    },
  });
  if (!school) {
    throw new DmPermissionDeniedError("مدرسه یافت نشد");
  }

  const roles = new Set<Role>([aRole as Role, bRole as Role]);
  const isPrincipal = roles.has("ADMIN");
  const isTeacher = roles.has("TEACHER");
  const isStudent = roles.has("STUDENT");

  // principal↔teacher — always allowed.
  if (isPrincipal && isTeacher) return aSchoolId;
  // principal↔student — toggle-gated.
  if (isPrincipal && isStudent) {
    if (!school.dmPrincipalStudent) {
      throw new DmPermissionDeniedError(
        "چت خصوصی مدیر با دانش‌آموز غیرفعال است",
      );
    }
    return aSchoolId;
  }
  // teacher↔student — toggle-gated.
  if (isTeacher && isStudent) {
    if (!school.dmTeacherStudent) {
      throw new DmPermissionDeniedError(
        "چت خصوصی معلم با دانش‌آموز غیرفعال است",
      );
    }
    return aSchoolId;
  }
  // student↔student — toggle-gated.
  if (isStudent && isStudent) {
    if (!school.dmStudentStudent) {
      throw new DmPermissionDeniedError(
        "چت خصوصی دانش‌آموز با دانش‌آموز غیرفعال است",
      );
    }
    return aSchoolId;
  }

  // Same-role principal↔principal or teacher↔teacher — allow by default.
  return aSchoolId;
}
