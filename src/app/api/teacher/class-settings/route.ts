import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/session";
import { apiHandler, badRequest } from "@/lib/api-utils";
import { isTeacherOf } from "@/lib/membership";
import { assertClassSchoolScope } from "@/lib/authz";
import {
  isValidAllowedFileTypes,
  parseAllowedFileTypes,
  type AllowedFileTypes,
} from "@/lib/file-settings";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/teacher/class-settings
 *
 * Body JSON: { classId, fileUploadEnabled?, maxFileSizeMb?, allowedFileTypes? }
 *
 * Updates per-class file-upload settings. Only a TEACHER of the class OR an
 * ADMIN may call this route.
 *
 * - fileUploadEnabled: boolean
 * - maxFileSizeMb: integer >= 0 (0 = no limit)
 * - allowedFileTypes: array of strings from ["image","pdf","video","file"];
 *                    null/empty → null (all types allowed)
 *
 * Returns the updated settings with `allowedFileTypes` parsed back to an array.
 */
export const PATCH = apiHandler(async (req: NextRequest) => {
  const user = await requireAuth();

  let body: any;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const classId: string | undefined = body?.classId;
  if (!classId) return badRequest("classId is required");

  // Authorization: teacher of the class OR admin.
  const teacherOf = await isTeacherOf(user.id, classId);
  if (!teacherOf && user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // SECURITY (school scoping): an ADMIN (principal) may only change settings
  // of classes in their OWN school.
  if (!teacherOf && user.role === "ADMIN") {
    const scopeError = await assertClassSchoolScope(user, classId);
    if (scopeError) return scopeError;
  }

  const cls = await db.classRoom.findUnique({
    where: { id: classId },
    select: {
      id: true,
      fileUploadEnabled: true,
      maxFileSizeMb: true,
      allowedFileTypes: true,
    },
  });
  if (!cls) {
    return NextResponse.json(
      { error: "Class not found" },
      { status: 404 },
    );
  }

  const data: {
    fileUploadEnabled?: boolean;
    maxFileSizeMb?: number;
    allowedFileTypes?: string | null;
  } = {};

  if (body?.fileUploadEnabled !== undefined) {
    if (typeof body.fileUploadEnabled !== "boolean") {
      return badRequest("fileUploadEnabled must be a boolean");
    }
    data.fileUploadEnabled = body.fileUploadEnabled;
  }

  if (body?.maxFileSizeMb !== undefined) {
    const raw = body.maxFileSizeMb;
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) {
      return badRequest(
        "maxFileSizeMb must be a non-negative integer (megabytes, 0 = no limit)",
      );
    }
    data.maxFileSizeMb = raw;
  }

  if (body?.allowedFileTypes !== undefined) {
    const value = body.allowedFileTypes as AllowedFileTypes;
    if (value === null) {
      data.allowedFileTypes = null;
    } else if (Array.isArray(value)) {
      if (!isValidAllowedFileTypes(value)) {
        return badRequest(
          "allowedFileTypes must be an array of strings from [\"image\",\"pdf\",\"video\",\"file\"] (or null)",
        );
      }
      // Empty array means "no types allowed" → store as null = all allowed,
      // matching the spec: "If null/empty, set to null (all allowed)."
      data.allowedFileTypes =
        value.length === 0 ? null : JSON.stringify(value);
    } else {
      return badRequest(
        "allowedFileTypes must be an array of strings or null",
      );
    }
  }

  // If nothing to update, return current values.
  if (Object.keys(data).length > 0) {
    await db.classRoom.update({ where: { id: classId }, data });
  }

  const updated = await db.classRoom.findUnique({
    where: { id: classId },
    select: {
      fileUploadEnabled: true,
      maxFileSizeMb: true,
      allowedFileTypes: true,
    },
  });

  return NextResponse.json({
    data: {
      classId,
      fileUploadEnabled: updated?.fileUploadEnabled ?? true,
      maxFileSizeMb: updated?.maxFileSizeMb ?? 10,
      allowedFileTypes: parseAllowedFileTypes(updated?.allowedFileTypes ?? null),
    },
  });
});
