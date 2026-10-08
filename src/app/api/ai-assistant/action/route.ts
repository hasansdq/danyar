import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/session";
import { apiHandler } from "@/lib/api-utils";
import { assertPermission } from "@/lib/permission-check";
import { assertModule } from "@/lib/module-check";
import { parseSettingBool } from "@/lib/site-settings";
import { audit, AuditActions } from "@/lib/audit";
import {
  changeUserPassword,
  createClass,
  createGroup,
  createStudent,
  createTeacher,
  closeAllGroups,
  listClassStudents,
  AiToolError,
} from "@/lib/ai-tools";

export const dynamic = "force-dynamic";

type Body = {
  action?: string;
  // change_password
  username?: string;
  newPassword?: string;
  // create_class
  name?: string;
  // create_group
  parentClassName?: string;
  groupName?: string;
  // create_student / create_teacher
  fullName?: string;
  password?: string;
  // list_class_students
  className?: string;
  // SUPERADMIN-only — pick which school to act on.
  schoolId?: string;
};

// POST /api/ai-assistant/action
//
// Executes a confirmed AI-suggested action. The principal confirmed via the
// chat UI (the chat panel renders a "تأیید و اجرا" button next to the AI's
// reply when `requiresConfirmation === true`).
//
// Supported actions:
//  - change_password      — change a STUDENT/TEACHER user's password.
//  - create_class         — create a top-level ClassRoom in the school.
//  - create_group         — create a group inside a parent class + auto-
//                            enroll the school principal as TEACHER.
//  - create_student       — create a STUDENT user in the school.
//  - create_teacher       — create a TEACHER user in the school.
//  - close_all_groups     — close chat for every ClassRoom in the school.
//  - list_class_students  — READ; list STUDENT members of a class.
//
// Auth: ADMIN (principal) or SUPERADMIN. ai_assistant permission required.
// Scope: ADMIN must act on their own schoolId. SUPERADMIN must pass a
// `schoolId` in the body (otherwise 400 "لطفاً یک مدرسه انتخاب کنید").
//
// Returns `{ data: { success: true, message: "..." } }` on success.
export const POST = apiHandler(async (req: NextRequest) => {
  const user = await requireAuth();
  if (user.role !== "ADMIN" && user.role !== "SUPERADMIN") {
    return NextResponse.json(
      { error: "این بخش فقط برای مدیر مدرسه در دسترس است" },
      { status: 403 },
    );
  }

  // Global module gate — SUPERADMIN bypasses.
  await assertModule(user.role, "ai_assistant");
  await assertPermission(user.role, "ai_assistant");

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json(
      { error: "بدنه درخواست نامعتبر است" },
      { status: 400 },
    );
  }

  const actionType = (body.action ?? "").toString().trim();
  const knownActions = new Set([
    "change_password",
    "create_class",
    "create_group",
    "create_student",
    "create_teacher",
    "close_all_groups",
    "list_class_students",
  ]);
  if (!knownActions.has(actionType)) {
    return NextResponse.json(
      { error: "نوع اکشن نامعتبر است" },
      { status: 400 },
    );
  }

  // School scoping — ADMIN uses their own, SUPERADMIN must pass one.
  let schoolId: string | null = null;
  if (user.role === "ADMIN") {
    schoolId = user.schoolId ?? null;
  } else {
    const sid = (body.schoolId ?? "").toString().trim();
    if (sid) schoolId = sid;
  }

  if (!schoolId) {
    return NextResponse.json(
      { error: "لطفاً یک مدرسه انتخاب کنید" },
      { status: 400 },
    );
  }

  try {
    switch (actionType) {
      case "change_password": {
        const username = (body.username ?? "").toString().trim();
        const newPassword = (body.newPassword ?? "").toString();
        if (!username || !newPassword) {
          return NextResponse.json(
            { error: "نام کاربری و رمز جدید الزامی است" },
            { status: 400 },
          );
        }
        // SECURITY: the change_password capability must ALSO be honored here
        // (not only in the chat route) — otherwise an ADMIN could bypass a
        // SUPERADMIN-disabled password-change capability by calling this
        // endpoint directly.
        const flagRow = await db.siteSetting.findUnique({
          where: { key: "ai_access_password_change" },
          select: { value: true },
        });
        const passwordChangeAllowed = parseSettingBool(
          "ai_access_password_change",
          flagRow?.value ?? null,
        );
        if (!passwordChangeAllowed) {
          return NextResponse.json(
            { error: "قابلیت تغییر رمز عبور توسط دستیار هوش مصنوعی غیرفعال است" },
            { status: 403 },
          );
        }

        const result = await changeUserPassword(
          schoolId,
          username,
          newPassword,
        );
        // AUDIT: sensitive operation executed via the AI assistant.
        await audit({
          actor: { id: user.id, username: user.username, role: user.role, schoolId: user.schoolId ?? null },
          action: AuditActions.PASSWORD_CHANGE,
          targetType: "user",
          req,
          meta: { via: "ai-assistant", targetUsername: result.username },
        });
        return NextResponse.json({
          data: {
            success: true,
            message: `رمز کاربر «${result.fullName}» (@${result.username}) تغییر کرد`,
            username: result.username,
            fullName: result.fullName,
          },
        });
      }

      case "create_class": {
        const name = (body.name ?? "").toString().trim();
        if (!name) {
          return NextResponse.json(
            { error: "نام کلاس الزامی است" },
            { status: 400 },
          );
        }
        const result = await createClass(schoolId, name);
        return NextResponse.json({
          data: {
            success: true,
            message: `کلاس «${result.name}» ایجاد شد`,
            id: result.id,
            name: result.name,
          },
        });
      }

      case "create_group": {
        const parentClassName = (body.parentClassName ?? "").toString().trim();
        const groupName = (body.groupName ?? "").toString().trim();
        if (!parentClassName || !groupName) {
          return NextResponse.json(
            { error: "نام کلاس والد و نام گروه الزامی است" },
            { status: 400 },
          );
        }
        const result = await createGroup(
          schoolId,
          parentClassName,
          groupName,
        );
        return NextResponse.json({
          data: {
            success: true,
            message: `گروه «${groupName}» در کلاس «${result.parentClassName}» ایجاد شد`,
            id: result.id,
            name: result.name,
            parentClassName: result.parentClassName,
          },
        });
      }

      case "create_student":
      case "create_teacher": {
        const fullName = (body.fullName ?? "").toString().trim();
        const username = (body.username ?? "").toString().trim();
        const password = (body.password ?? "").toString();
        if (!fullName || !username || !password) {
          return NextResponse.json(
            { error: "نام کامل، نام کاربری و رمز الزامی است" },
            { status: 400 },
          );
        }
        const result =
          actionType === "create_student"
            ? await createStudent(schoolId, fullName, username, password)
            : await createTeacher(schoolId, fullName, username, password);
        // AUDIT: sensitive operation executed via the AI assistant.
        await audit({
          actor: { id: user.id, username: user.username, role: user.role, schoolId: user.schoolId ?? null },
          action: actionType === "create_student" ? AuditActions.USER_CREATE : AuditActions.USER_CREATE,
          targetType: "user",
          targetId: result.id,
          req,
          meta: { via: "ai-assistant", createdUsername: result.username, createdRole: actionType === "create_student" ? "STUDENT" : "TEACHER" },
        });
        const roleLabel = actionType === "create_student" ? "دانش‌آموز" : "معلم";
        return NextResponse.json({
          data: {
            success: true,
            message: `${roleLabel} «${result.fullName}» (@${result.username}) ایجاد شد`,
            id: result.id,
            username: result.username,
            fullName: result.fullName,
          },
        });
      }

      case "close_all_groups": {
        const result = await closeAllGroups(schoolId, user.id);
        return NextResponse.json({
          data: {
            success: true,
            message: `گفتگوی ${result.count} کلاس/گروه بسته شد`,
            count: result.count,
          },
        });
      }

      case "list_class_students": {
        const className = (body.className ?? "").toString().trim();
        if (!className) {
          return NextResponse.json(
            { error: "نام کلاس الزامی است" },
            { status: 400 },
          );
        }
        const result = await listClassStudents(schoolId, className);
        const list =
          result.students.length === 0
            ? "هیچ دانش‌آموزی در این کلاس ثبت نشده است."
            : result.students
                .map((s, i) => `${i + 1}. ${s.fullName} (@${s.username})`)
                .join("\n");
        return NextResponse.json({
          data: {
            success: true,
            message: `دانش‌آموزان کلاس «${result.className}»:\n${list}`,
            className: result.className,
            students: result.students,
          },
        });
      }

      default:
        return NextResponse.json(
          { error: "نوع اکشن نامعتبر است" },
          { status: 400 },
        );
    }
  } catch (err) {
    if (err instanceof AiToolError) {
      return NextResponse.json(
        { error: err.message },
        { status: 400 },
      );
    }
    console.error("[ai-assistant/action] internal error:", err);
    return NextResponse.json(
      { error: "خطای داخلی سرور" },
      { status: 500 },
    );
  }
});
