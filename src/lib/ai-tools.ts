import { db } from "@/lib/db";
import bcrypt from "bcryptjs";
import { toJalaali } from "jalaali-js";
import { checkPasswordPolicy } from "@/lib/password-policy";

/**
 * AI assistant tools — query/manage the principal's school.
 *
 * Every function is scoped to a `schoolId` (the principal's school). No tool
 * ever returns data for users/classes outside that school.
 */

/**
 * Returns a compact snapshot of the school's overall stats + recent activity.
 * Used when the principal asks "آمار مدرسه"، "گزارش"، "چند دانش‌آموز داریم؟" etc.
 */
export async function getSchoolStats(schoolId: string) {
  const [
    school,
    totalStudents,
    totalTeachers,
    totalAdmins,
    totalClasses,
    totalMessages,
    totalDirectMessages,
    totalAssignments,
    totalSampleQuestions,
    totalGrades,
    totalPolls,
    totalDirectChats,
    recentUsers,
    recentMessages,
    recentClasses,
  ] = await Promise.all([
    db.school.findUnique({
      where: { id: schoolId },
      select: { id: true, name: true, address: true },
    }),
    db.user.count({ where: { schoolId, role: "STUDENT" } }),
    db.user.count({ where: { schoolId, role: "TEACHER" } }),
    db.user.count({ where: { schoolId, role: "ADMIN" } }),
    db.classRoom.count({ where: { schoolId } }),
    db.message.count({
      where: { class: { schoolId } },
    }),
    db.directMessage.count({
      where: { chat: { schoolId } },
    }),
    db.assignment.count({
      where: { class: { schoolId } },
    }),
    db.sampleQuestion.count({
      where: { class: { schoolId } },
    }),
    db.grade.count({
      where: { class: { schoolId } },
    }),
    db.poll.count({
      where: { class: { schoolId } },
    }),
    db.directChat.count({ where: { schoolId } }),
    db.user.findMany({
      where: { schoolId },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        username: true,
        fullName: true,
        role: true,
        createdAt: true,
      },
    }),
    db.message.findMany({
      where: { class: { schoolId }, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        content: true,
        createdAt: true,
        sender: { select: { id: true, fullName: true, username: true, role: true } },
        class: { select: { id: true, name: true } },
      },
    }),
    db.classRoom.findMany({
      where: { schoolId },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        name: true,
        gradeLevel: true,
        section: true,
        createdAt: true,
        chatClosed: true,
        _count: { select: { memberships: true, messages: true } },
      },
    }),
  ]);

  return {
    school: school
      ? { name: school.name, address: school.address }
      : null,
    totals: {
      students: totalStudents,
      teachers: totalTeachers,
      admins: totalAdmins,
      classes: totalClasses,
      classMessages: totalMessages,
      directMessages: totalDirectMessages,
      assignments: totalAssignments,
      sampleQuestions: totalSampleQuestions,
      grades: totalGrades,
      polls: totalPolls,
      directChats: totalDirectChats,
    },
    recentUsers: recentUsers.map((u) => ({
      fullName: u.fullName,
      username: u.username,
      role: u.role,
      createdAt: u.createdAt,
    })),
    recentMessages: recentMessages.map((m) => ({
      sender: m.sender.fullName,
      senderRole: m.sender.role,
      className: m.class.name,
      preview: m.content?.slice(0, 80) ?? "",
      createdAt: m.createdAt,
    })),
    recentClasses: recentClasses.map((c) => ({
      name: c.name,
      gradeLevel: c.gradeLevel,
      section: c.section,
      memberCount: c._count.memberships,
      messageCount: c._count.messages,
      chatClosed: c.chatClosed,
      createdAt: c.createdAt,
    })),
  };
}

/**
 * Search students by `fullName` or `username` within the school.
 * Returns up to 5 matches, each with their grades + assignment submissions +
 * class memberships (with class name).
 */
export async function getStudentInfo(schoolId: string, query: string) {
  const trimmed = (query ?? "").trim();
  if (!trimmed) return { students: [] };

  // `query` might be "@username" or a free-text name. Normalize.
  const q = trimmed.replace(/^@/, "").toLowerCase();

  const students = await db.user.findMany({
    where: {
      schoolId,
      role: "STUDENT",
      OR: [
        { fullName: { contains: q } },
        { username: { contains: q } },
      ],
    },
    take: 5,
    orderBy: { fullName: "asc" },
    select: {
      id: true,
      fullName: true,
      username: true,
      phone: true,
      createdAt: true,
      memberships: {
        select: {
          role: true,
          class: { select: { id: true, name: true } },
        },
      },
      gradesReceived: {
        take: 10,
        orderBy: { createdAt: "desc" },
        select: {
          title: true,
          score: true,
          maxScore: true,
          createdAt: true,
          class: { select: { name: true } },
        },
      },
      assignmentSubmissions: {
        take: 10,
        orderBy: { updatedAt: "desc" },
        select: {
          status: true,
          updatedAt: true,
          assignment: { select: { id: true, title: true, class: { select: { name: true } } } },
        },
      },
    },
  });

  return {
    students: students.map((s) => ({
      fullName: s.fullName,
      username: s.username,
      phone: s.phone,
      createdAt: s.createdAt,
      classes: s.memberships.map((m) => ({
        className: m.class.name,
        role: m.role,
      })),
      grades: s.gradesReceived.map((g) => ({
        title: g.title,
        score: g.score,
        maxScore: g.maxScore,
        className: g.class.name,
        createdAt: g.createdAt,
      })),
      assignmentSubmissions: s.assignmentSubmissions.map((a) => ({
        title: a.assignment.title,
        className: a.assignment.class.name,
        status: a.status,
        updatedAt: a.updatedAt,
      })),
    })),
  };
}

/**
 * Search ALL users (students + teachers + admins) by name/username within
 * the school. Returns up to 10 matches. Used when the principal mentions a
 * teacher's name or a username without explicitly asking for "student info".
 */
export async function searchUsers(schoolId: string, query: string) {
  const trimmed = (query ?? "").trim();
  if (!trimmed) return { users: [] };

  const q = trimmed.replace(/^@/, "").toLowerCase();

  const users = await db.user.findMany({
    where: {
      schoolId,
      OR: [
        { fullName: { contains: q } },
        { username: { contains: q } },
      ],
    },
    take: 10,
    orderBy: { fullName: "asc" },
    select: {
      id: true,
      fullName: true,
      username: true,
      role: true,
      phone: true,
      createdAt: true,
    },
  });

  return {
    users: users.map((u) => ({
      fullName: u.fullName,
      username: u.username,
      role: u.role,
      phone: u.phone,
      createdAt: u.createdAt,
    })),
  };
}

/**
 * Change a user's password.
 *
 * Scoping:
 *  - The target user MUST belong to the same `schoolId`.
 *  - The target user's role MUST be STUDENT or TEACHER — principals cannot
 *    reset another principal's (or SUPERADMIN's) password through this tool.
 *
 * Validation:
 *  - newPassword >= 4 chars.
 *
 * Returns `{ success, username, fullName }` on success.
 * Throws a typed error (`AiToolError`) on failure so the route can convert
 * it into a 400 response.
 */
export class AiToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiToolError";
  }
}

export async function changeUserPassword(
  schoolId: string,
  username: string,
  newPassword: string,
) {
  const uname = (username ?? "").trim().toLowerCase().replace(/^@/, "");
  const pwd = (newPassword ?? "").toString();

  if (!uname) throw new AiToolError("نام کاربری مشخص نیست");
  // SECURITY: server-side password policy (see src/lib/password-policy.ts).
  const policy = checkPasswordPolicy(pwd, { username: uname });
  if (!policy.ok) {
    throw new AiToolError(policy.reason ?? "رمز جدید ضعیف است");
  }

  const user = await db.user.findUnique({
    where: { username: uname },
    select: { id: true, username: true, fullName: true, role: true, schoolId: true },
  });

  if (!user) throw new AiToolError("کاربری با این نام کاربری یافت نشد");
  if (user.schoolId !== schoolId) {
    throw new AiToolError("این کاربر در مدرسه شما نیست");
  }
  if (user.role !== "STUDENT" && user.role !== "TEACHER") {
    throw new AiToolError(
      "تنها می‌توانید رمز دانش‌آموز یا معلم را تغییر دهید",
    );
  }

  const hashed = await bcrypt.hash(pwd, 10);
  await db.user.update({
    where: { id: user.id },
    data: { password: hashed },
  });

  return { success: true, username: user.username, fullName: user.fullName };
}

/**
 * Create a top-level class (parentClassId=null) in the principal's school.
 * The ClassRoom.name is globally unique — throws AiToolError on conflict.
 */
export async function createClass(schoolId: string, name: string) {
  const trimmed = (name ?? "").toString().trim();
  if (!trimmed) throw new AiToolError("نام کلاس مشخص نیست");

  const existing = await db.classRoom.findUnique({
    where: { name: trimmed },
    select: { id: true },
  });
  if (existing) {
    throw new AiToolError(`کلاسی با نام «${trimmed}» از قبل وجود دارد`);
  }

  const cls = await db.classRoom.create({
    data: {
      name: trimmed,
      schoolId,
      parentClassId: null,
    },
    select: { id: true, name: true },
  });
  return { id: cls.id, name: cls.name };
}

/**
 * Create a "group" (chat) inside a parent class.
 *
 *  - `parentClassName` must match a top-level ClassRoom.name in this school.
 *  - The group's stored `name` is prefixed with the parent's name
 *    ("parentName — groupName") to keep the global `name @unique` constraint
 *    satisfied across multiple parent classes that may want the same group
 *    name.
 *  - The school's principal (`School.principalId`) is auto-enrolled as a
 *    TEACHER member of the new group so they can manage it.
 *
 * Throws AiToolError when:
 *  - parent class not found in this school.
 *  - the prefixed group name already exists globally.
 */
export async function createGroup(
  schoolId: string,
  parentClassName: string,
  groupName: string,
) {
  const parentName = (parentClassName ?? "").toString().trim();
  const gName = (groupName ?? "").toString().trim();
  if (!parentName) throw new AiToolError("نام کلاس والد مشخص نیست");
  if (!gName) throw new AiToolError("نام گروه مشخص نیست");

  // Find the parent class by name within the school. Only top-level classes
  // (parentClassId=null) qualify — a group can't have sub-groups.
  const parent = await db.classRoom.findFirst({
    where: { schoolId, name: parentName, parentClassId: null },
    select: { id: true, name: true, schoolId: true },
  });
  if (!parent) {
    throw new AiToolError(
      `کلاسی با نام «${parentName}» در این مدرسه یافت نشد`,
    );
  }

  const fullName = `${parent.name} — ${gName}`;
  const existing = await db.classRoom.findUnique({
    where: { name: fullName },
    select: { id: true },
  });
  if (existing) {
    throw new AiToolError(`گروهی با نام «${fullName}» از قبل وجود دارد`);
  }

  // Look up the school's principal to auto-enroll as TEACHER.
  const school = await db.school.findUnique({
    where: { id: schoolId },
    select: { principalId: true },
  });

  const group = await db.classRoom.create({
    data: {
      name: fullName,
      schoolId: parent.schoolId ?? schoolId,
      parentClassId: parent.id,
    },
    select: { id: true, name: true, parentClassId: true, schoolId: true },
  });

  if (school?.principalId) {
    await db.classMembership.upsert({
      where: {
        classId_userId: { classId: group.id, userId: school.principalId },
      },
      update: { role: "TEACHER" },
      create: {
        classId: group.id,
        userId: school.principalId,
        role: "TEACHER",
      },
    });
  }

  return {
    id: group.id,
    name: group.name,
    parentClassName: parent.name,
  };
}

/**
 * Close the chat for EVERY ClassRoom in the school (both top-level classes
 * and groups). `principalId` is recorded as the closer. Returns the count of
 * classes whose chat was closed.
 */
export async function closeAllGroups(
  schoolId: string,
  principalId: string,
) {
  const now = new Date();
  const result = await db.classRoom.updateMany({
    where: { schoolId },
    data: {
      chatClosed: true,
      chatClosedAt: now,
      chatClosedById: principalId,
    },
  });
  return { count: result.count };
}

/**
 * Find a class by name within the school and list every STUDENT member's
 * {fullName, username}. Used when the principal asks "لیست دانش‌آموزان کلاس X".
 */
export async function listClassStudents(
  schoolId: string,
  className: string,
) {
  const trimmed = (className ?? "").toString().trim();
  if (!trimmed) throw new AiToolError("نام کلاس مشخص نیست");

  const cls = await db.classRoom.findFirst({
    where: { schoolId, name: trimmed },
    select: { id: true, name: true },
  });
  if (!cls) {
    throw new AiToolError(
      `کلاسی با نام «${trimmed}» در این مدرسه یافت نشد`,
    );
  }

  const memberships = await db.classMembership.findMany({
    where: { classId: cls.id, role: "STUDENT" },
    select: { user: { select: { fullName: true, username: true } } },
    orderBy: { user: { fullName: "asc" } },
  });

  return {
    className: cls.name,
    students: memberships.map((m) => ({
      fullName: m.user.fullName,
      username: m.user.username,
    })),
  };
}

/**
 * Create a STUDENT user in the principal's school. Password is hashed with
 * bcrypt (10 rounds). Throws AiToolError on username conflict or when the
 * password is shorter than 4 characters.
 */
export async function createStudent(
  schoolId: string,
  fullName: string,
  username: string,
  password: string,
) {
  return createUserInSchool(schoolId, fullName, username, password, "STUDENT");
}

/**
 * Create a TEACHER user in the principal's school. Same shape as
 * `createStudent` — just a different role.
 */
export async function createTeacher(
  schoolId: string,
  fullName: string,
  username: string,
  password: string,
) {
  return createUserInSchool(schoolId, fullName, username, password, "TEACHER");
}

async function createUserInSchool(
  schoolId: string,
  fullName: string,
  username: string,
  password: string,
  role: "STUDENT" | "TEACHER",
) {
  const uname = (username ?? "").toString().trim().toLowerCase().replace(/^@/, "");
  const fname = (fullName ?? "").toString().trim();
  const pwd = (password ?? "").toString();

  if (!uname) throw new AiToolError("نام کاربری مشخص نیست");
  if (!fname) throw new AiToolError("نام کامل مشخص نیست");
  // SECURITY: server-side password policy (see src/lib/password-policy.ts).
  const policy = checkPasswordPolicy(pwd, { username: uname });
  if (!policy.ok) {
    throw new AiToolError(policy.reason ?? "رمز عبور ضعیف است");
  }
  if (fname.length > 200) throw new AiToolError("نام کامل طولانی است");

  const existing = await db.user.findUnique({
    where: { username: uname },
    select: { id: true },
  });
  if (existing) {
    throw new AiToolError(`نام کاربری «${uname}» قبلاً ثبت شده است`);
  }

  const hashed = await bcrypt.hash(pwd, 10);
  const user = await db.user.create({
    data: {
      username: uname,
      password: hashed,
      fullName: fname,
      role,
      schoolId,
    },
    select: { id: true, username: true, fullName: true },
  });

  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
  };
}

// ---------------------------------------------------------------------------
// Phase 28 — read-only tools for attendance, violations, content, polls, etc.
// All functions are ADMIN-scoped to the school, return JSON-serializable
// values (never null — empty arrays/objects on no data or error), and wrap
// their bodies in try/catch so a single broken query doesn't crash the AI
// assistant route.
// ---------------------------------------------------------------------------

/**
 * Returns the Jalali "YYYY-MM-DD" string for `date` (defaults to the current
 * local date). Used by the attendance helpers to compute "today" / "yesterday".
 */
function toJalaliDateString(date: Date): string {
  const j = toJalaali(date);
  return `${j.jy}-${String(j.jm).padStart(2, "0")}-${String(j.jd).padStart(2, "0")}`;
}

/**
 * Returns the Jalali date string for "yesterday" (24h ago in local time).
 */
function yesterdayJalali(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return toJalaliDateString(d);
}

/**
 * 1. getAbsentStudents — returns list of absent students for a given Jalali
 *    date (default: yesterday). Each row carries the student's fullName +
 *    username, the class name, the date, and the period.
 *
 * Returns `[]` on error or empty.
 */
export async function getAbsentStudents(schoolId: string, dateStr?: string) {
  try {
    const date = (dateStr ?? "").toString().trim() || yesterdayJalali();
    const rows = await db.attendance.findMany({
      where: {
        present: false,
        date,
        class: { schoolId },
      },
      select: {
        userId: true,
        date: true,
        period: true,
        user: { select: { fullName: true, username: true } },
        class: { select: { name: true } },
      },
      orderBy: [{ user: { fullName: "asc" } }, { period: "asc" }],
    });
    return rows.map((r) => ({
      userId: r.userId,
      fullName: r.user.fullName,
      username: r.user.username,
      className: r.class.name,
      date: r.date,
      period: r.period,
    }));
  } catch (err) {
    console.error("[ai-tools] getAbsentStudents error:", err);
    return [];
  }
}

/**
 * 2. getTopViolations — returns the top N students with the most violation
 *    records. A "violation record" is an Attendance row whose `violations`
 *    column is non-null (and non-empty after JSON parse). We aggregate on the
 *    application side because SQLite can't natively count JSON array entries.
 *
 * Each result row carries: userId, fullName, username, violationCount (number
 * of attendance rows with violations) + recentViolations (latest 5 records'
 * {date, period, violations[]}).
 *
 * Returns `[]` on error or empty.
 */
export async function getTopViolations(schoolId: string, limit = 5) {
  try {
    const take = Math.max(1, Math.min(50, Number(limit) || 5));
    // Pull every Attendance row with a non-null `violations` for this school.
    // For a typical school this is a few hundred rows at most — fine.
    const rows = await db.attendance.findMany({
      where: {
        NOT: [{ violations: null }],
        class: { schoolId },
      },
      select: {
        userId: true,
        date: true,
        period: true,
        violations: true,
        createdAt: true,
        user: { select: { fullName: true, username: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    // Group by userId + count violations per student.
    const byUser = new Map<
      string,
      {
        userId: string;
        fullName: string;
        username: string;
        violationCount: number;
        recentViolations: Array<{ date: string; period: number; violations: string[] }>;
      }
    >();

    for (const r of rows) {
      // Skip rows whose violations column is a literal "[]" string —
      // those aren't real violations.
      let parsed: string[] = [];
      try {
        const v = r.violations ? JSON.parse(r.violations) : null;
        if (Array.isArray(v) && v.length > 0) parsed = v as string[];
      } catch {
        parsed = [];
      }
      if (parsed.length === 0) continue;

      let entry = byUser.get(r.userId);
      if (!entry) {
        entry = {
          userId: r.userId,
          fullName: r.user.fullName,
          username: r.user.username,
          violationCount: 0,
          recentViolations: [],
        };
        byUser.set(r.userId, entry);
      }
      entry.violationCount += 1;
      if (entry.recentViolations.length < 5) {
        entry.recentViolations.push({
          date: r.date,
          period: r.period,
          violations: parsed,
        });
      }
    }

    return Array.from(byUser.values())
      .sort((a, b) => b.violationCount - a.violationCount)
      .slice(0, take);
  } catch (err) {
    console.error("[ai-tools] getTopViolations error:", err);
    return [];
  }
}

/**
 * 3. getAttendanceStats — returns attendance summary for a date (default:
 *    yesterday). Returns counts + the absent + violation lists in a single
 *    payload so the LLM can produce a single combined answer.
 *
 * Returns an object with `{ totalStudents, presentCount, absentCount,
 * violationCount, absentStudents, violationStudents }`. Never returns null.
 */
export async function getAttendanceStats(schoolId: string, dateStr?: string) {
  const empty = {
    totalStudents: 0,
    presentCount: 0,
    absentCount: 0,
    violationCount: 0,
    absentStudents: [],
    violationStudents: [],
  };
  try {
    const date = (dateStr ?? "").toString().trim() || yesterdayJalali();

    const totalStudents = await db.user.count({
      where: { schoolId, role: "STUDENT" },
    });

    const rows = await db.attendance.findMany({
      where: { date, class: { schoolId } },
      select: {
        present: true,
        violations: true,
        period: true,
        user: { select: { fullName: true, username: true } },
        class: { select: { name: true } },
      },
      orderBy: [{ user: { fullName: "asc" } }, { period: "asc" }],
    });

    const absentStudents: Array<{
      fullName: string;
      username: string;
      className: string;
      period: number;
    }> = [];
    const violationStudents: Array<{
      fullName: string;
      username: string;
      className: string;
      period: number;
      violations: string[];
    }> = [];
    let presentCount = 0;
    let absentCount = 0;

    for (const r of rows) {
      if (r.present) {
        presentCount += 1;
        // Violations only count when the student was present.
        let parsed: string[] = [];
        if (r.violations) {
          try {
            const v = JSON.parse(r.violations);
            if (Array.isArray(v) && v.length > 0) parsed = v as string[];
          } catch {
            parsed = [];
          }
        }
        if (parsed.length > 0) {
          violationStudents.push({
            fullName: r.user.fullName,
            username: r.user.username,
            className: r.class.name,
            period: r.period,
            violations: parsed,
          });
        }
      } else {
        absentCount += 1;
        absentStudents.push({
          fullName: r.user.fullName,
          username: r.user.username,
          className: r.class.name,
          period: r.period,
        });
      }
    }

    return {
      totalStudents,
      presentCount,
      absentCount,
      violationCount: violationStudents.length,
      absentStudents,
      violationStudents,
    };
  } catch (err) {
    console.error("[ai-tools] getAttendanceStats error:", err);
    return empty;
  }
}

/**
 * 4. getAssignments — returns assignments for the school (optionally filtered
 *    by teacher). Newest first.
 */
export async function getAssignments(schoolId: string, teacherId?: string) {
  try {
    const where: {
      class: { schoolId: string };
      createdById?: string;
    } = { class: { schoolId } };
    if (teacherId) where.createdById = teacherId;

    const rows = await db.assignment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        title: true,
        dueDate: true,
        createdAt: true,
        class: { select: { name: true } },
        createdBy: { select: { fullName: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      className: r.class.name,
      teacherName: r.createdBy.fullName,
      dueDate: r.dueDate,
      createdAt: r.createdAt,
    }));
  } catch (err) {
    console.error("[ai-tools] getAssignments error:", err);
    return [];
  }
}

/**
 * 5. getSampleQuestions — returns sample questions for the school (optionally
 *    filtered by teacher). Newest first.
 */
export async function getSampleQuestions(schoolId: string, teacherId?: string) {
  try {
    const where: {
      class: { schoolId: string };
      createdById?: string;
    } = { class: { schoolId } };
    if (teacherId) where.createdById = teacherId;

    const rows = await db.sampleQuestion.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        title: true,
        fileUrl: true,
        createdAt: true,
        class: { select: { name: true } },
        createdBy: { select: { fullName: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      className: r.class.name,
      teacherName: r.createdBy.fullName,
      fileUrl: r.fileUrl,
      createdAt: r.createdAt,
    }));
  } catch (err) {
    console.error("[ai-tools] getSampleQuestions error:", err);
    return [];
  }
}

/**
 * 6. getRecentAnnouncements — returns recent announcement messages
 *    (Message.isAnnouncement=true) across the school's classes.
 */
export async function getRecentAnnouncements(schoolId: string, limit = 10) {
  try {
    const take = Math.max(1, Math.min(50, Number(limit) || 10));
    const rows = await db.message.findMany({
      where: {
        isAnnouncement: true,
        deletedAt: null,
        class: { schoolId },
      },
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        content: true,
        createdAt: true,
        sender: { select: { fullName: true } },
        class: { select: { name: true } },
      },
    });
    return rows.map((m) => ({
      id: m.id,
      content: m.content,
      senderName: m.sender.fullName,
      className: m.class.name,
      createdAt: m.createdAt,
    }));
  } catch (err) {
    console.error("[ai-tools] getRecentAnnouncements error:", err);
    return [];
  }
}

/**
 * 7. getClassMessages — returns recent messages from classes in the school
 *    (optionally filtered by classId). Skips soft-deleted messages.
 */
export async function getClassMessages(
  schoolId: string,
  classId?: string,
  limit = 20,
) {
  try {
    const take = Math.max(1, Math.min(100, Number(limit) || 20));
    const where: {
      deletedAt: null;
      class: { schoolId: string; id?: string };
    } = { deletedAt: null, class: { schoolId } };
    if (classId) where.class.id = classId;

    const rows = await db.message.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        content: true,
        createdAt: true,
        sender: { select: { fullName: true, role: true } },
        class: { select: { name: true } },
      },
    });
    return rows.map((m) => ({
      id: m.id,
      content: m.content,
      senderName: m.sender.fullName,
      senderRole: m.sender.role,
      className: m.class.name,
      createdAt: m.createdAt,
    }));
  } catch (err) {
    console.error("[ai-tools] getClassMessages error:", err);
    return [];
  }
}

/**
 * 8. getPolls — returns recent polls in the school's classes. Each row
 *    carries the parsed `options` array + the total vote count.
 */
export async function getPolls(schoolId: string, limit = 10) {
  try {
    const take = Math.max(1, Math.min(50, Number(limit) || 10));
    const rows = await db.poll.findMany({
      where: { class: { schoolId } },
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        question: true,
        options: true,
        createdAt: true,
        class: { select: { name: true } },
        _count: { select: { votes: true } },
      },
    });
    return rows.map((p) => {
      let options: string[] = [];
      try {
        const v = p.options ? JSON.parse(p.options) : null;
        if (Array.isArray(v)) options = v as string[];
      } catch {
        options = [];
      }
      return {
        id: p.id,
        question: p.question,
        options,
        totalVotes: p._count.votes,
        className: p.class.name,
        createdAt: p.createdAt,
      };
    });
  } catch (err) {
    console.error("[ai-tools] getPolls error:", err);
    return [];
  }
}

/**
 * 9. getAllClasses — returns all top-level classes + their subject groups with
 *    member counts + chatClosed flag. Used when the principal asks for the
 *    full structure of their school.
 */
export async function getAllClasses(schoolId: string) {
  try {
    const classes = await db.classRoom.findMany({
      where: { schoolId, parentClassId: null },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        chatClosed: true,
        groups: {
          orderBy: { name: "asc" },
          select: {
            id: true,
            name: true,
            chatClosed: true,
            _count: { select: { memberships: true } },
          },
        },
        _count: { select: { memberships: true } },
      },
    });
    return classes.map((c) => ({
      id: c.id,
      name: c.name,
      memberCount: c._count.memberships,
      chatClosed: c.chatClosed,
      groups: c.groups.map((g) => ({
        id: g.id,
        name: g.name,
        memberCount: g._count.memberships,
        chatClosed: g.chatClosed,
      })),
    }));
  } catch (err) {
    console.error("[ai-tools] getAllClasses error:", err);
    return [];
  }
}
