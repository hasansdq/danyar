import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import { apiHandler } from "@/lib/api-utils";
import { assertPermission } from "@/lib/permission-check";
import { assertModule } from "@/lib/module-check";
import { db } from "@/lib/db";
import { parseSettingBool } from "@/lib/site-settings";
import { toJalaali } from "jalaali-js";
// Phase 34 — pluggable AI provider. The SUPERADMIN can configure a
// custom provider (OpenAI-compatible or Anthropic) via
// /superadmin/ai-settings; the helper falls back to the default
// z-ai-web-dev-sdk when no custom config is set.
import { callLLM } from "@/lib/ai-provider";
import {
  getSchoolStats,
  getStudentInfo,
  searchUsers,
  listClassStudents,
  getAbsentStudents,
  getTopViolations,
  getAttendanceStats,
  getAssignments,
  getSampleQuestions,
  getRecentAnnouncements,
  getClassMessages,
  getPolls,
  getAllClasses,
  AiToolError,
} from "@/lib/ai-tools";

export const dynamic = "force-dynamic";

type HistoryItem = { role: "user" | "assistant"; content: string };

type Body = {
  message?: string;
  history?: HistoryItem[];
  schoolId?: string; // SUPERADMIN-only — pick which school to scope to.
};

// ---- AI access flags loaded from SiteSettings -----------------------------

type AiAccess = {
  stats: boolean;
  studentInfo: boolean;
  passwordChange: boolean;
};

async function loadAiAccess(): Promise<AiAccess> {
  const rows = await db.siteSetting.findMany({
    where: {
      key: {
        in: [
          "ai_access_stats",
          "ai_access_student_info",
          "ai_access_password_change",
        ],
      },
    },
    select: { key: true, value: true },
  });
  const lookup = new Map(rows.map((r) => [r.key, r.value]));
  return {
    stats: parseSettingBool("ai_access_stats", lookup.get("ai_access_stats") ?? null),
    studentInfo: parseSettingBool(
      "ai_access_student_info",
      lookup.get("ai_access_student_info") ?? null,
    ),
    passwordChange: parseSettingBool(
      "ai_access_password_change",
      lookup.get("ai_access_password_change") ?? null,
    ),
  };
}

// ---- Intent detection -----------------------------------------------------

// ZWNJ (U+200C) is the zero-width non-joiner Persian uses inside compound
// words like "دانش‌آموز". Normalize it to a plain space so keyword matching
// works regardless of whether the user typed the ZWNJ or a regular space.
const ZWNJ = "\u200c";
function normalizeFa(s: string): string {
  return s.replace(new RegExp(ZWNJ, "g"), " ").toLowerCase();
}

const STATS_KEYWORDS = [
  "آمار",
  "گزارش",
  "وضعیت مدرسه",
  "چند",
  "تعداد",
  "نمای کلی",
  "آمار کلی",
  "چقدر",
];

const PASSWORD_KEYWORDS = [
  "رمز",
  "گذرواژه",
  "password",
  "تغییر",
  "تغییر رمز",
  "بازنشانی",
];

const CREATE_KEYWORDS = ["ایجاد", "ساخت", "create", "اضافه", "افزودن", "ثبت"];
const CLOSE_KEYWORDS = ["ببند", "بستن", "close", "قفل"];
const ALL_KEYWORDS = ["همه", "all", "همه گروه", "همه کلاس"];
const GROUP_KEYWORDS = ["گروه"];
const CLASS_KEYWORDS = ["کلاس"];
const STUDENT_KEYWORDS = ["دانش آموز", "دانش اموز"];
const TEACHER_KEYWORDS = ["معلم", "آموزگار", "استاد"];
const LIST_KEYWORDS = ["لیست", "نام", "فهرست", "list"];

// Phase 28 — new content keyword sets (intent detection).
const ATTENDANCE_KEYWORDS = ["حضور", "غیاب", "غایب", "حاضر", "نبودن"];
const VIOLATIONS_KEYWORDS = ["تخلف", "تخلفات"];
const ASSIGNMENTS_KEYWORDS = ["تکلیف", "تکالیف"];
const SAMPLE_QUESTIONS_KEYWORDS = [
  "نمونه سوال",
  "نمونه‌سوال",
  "سوال",
];
const ANNOUNCEMENTS_KEYWORDS = ["اطلاعیه", "اطلاعیه‌ها"];
const CLASS_CONTENT_KEYWORDS = ["محتوا", "پیام‌های", "گفتگو"];
const POLLS_KEYWORDS = ["نظرسنجی", "نظر سنجی"];
const ALL_CLASSES_KEYWORDS = ["همه کلاس", "لیست کلاس", "فهرست کلاس"];

// Persian name pattern — at least two Persian/Arabic words separated by
// space (e.g. "علی رضایی"). Tolerates single names with 3+ Persian letters.
const PERSIAN_NAME_RE = /[\u0600-\u06FF]{2,}(?:\s+[\u0600-\u06FF]{2,})?/;
const USERNAME_RE = /@([a-z0-9_.]+)/i;

// Matches a Jalali date in "YYYY-MM-DD" or "YYYY/MM/DD" (single or double digit
// month/day) — used by the attendance intent to parse a specific date.
const JALALI_DATE_RE = /(\d{4})[\-\/](\d{1,2})[\-\/](\d{1,2})/;

type Intent =
  | { kind: "stats" }
  | { kind: "password" }
  | { kind: "student"; query: string }
  | { kind: "close_all_groups" }
  | { kind: "create_group" }
  | { kind: "create_class" }
  | { kind: "create_student" }
  | { kind: "create_teacher" }
  | { kind: "list_class_students" }
  // Phase 28 — new read-only intents.
  | { kind: "attendance"; dateStr?: string }
  | { kind: "violations"; most: boolean }
  | { kind: "assignments" }
  | { kind: "sample_questions" }
  | { kind: "announcements" }
  | { kind: "class_content" }
  | { kind: "polls" }
  | { kind: "all_classes" }
  | { kind: "general" };

function hasAnyKeyword(normalized: string, list: string[]): boolean {
  return list.some((k) => normalized.includes(normalizeFa(k)));
}

function detectIntent(message: string): Intent {
  const n = normalizeFa(message);

  // Password-change intent has priority — even when the message also mentions
  // a name (the manager is asking to reset that user's password).
  if (hasAnyKeyword(n, PASSWORD_KEYWORDS)) {
    return { kind: "password" };
  }

  // Close-all-groups: requires BOTH a close keyword AND an "all" keyword.
  if (hasAnyKeyword(n, CLOSE_KEYWORDS) && hasAnyKeyword(n, ALL_KEYWORDS)) {
    return { kind: "close_all_groups" };
  }

  // Phase 28 — new content intents. Order matters: more specific intents are
  // checked BEFORE generic ones (stats, student lookup) so e.g. a message
  // about violations doesn't accidentally get routed to the stats intent.
  // violations before attendance before all_classes before sample_questions /
  // assignments / announcements / class_content / polls.
  if (hasAnyKeyword(n, VIOLATIONS_KEYWORDS)) {
    const most = /بیش\s*ترین|بیشترین/.test(n);
    return { kind: "violations", most };
  }
  if (hasAnyKeyword(n, ATTENDANCE_KEYWORDS)) {
    return { kind: "attendance", dateStr: extractJalaliDate(message) };
  }
  if (hasAnyKeyword(n, ALL_CLASSES_KEYWORDS)) {
    return { kind: "all_classes" };
  }
  if (hasAnyKeyword(n, SAMPLE_QUESTIONS_KEYWORDS)) {
    return { kind: "sample_questions" };
  }
  if (hasAnyKeyword(n, ASSIGNMENTS_KEYWORDS)) {
    return { kind: "assignments" };
  }
  if (hasAnyKeyword(n, ANNOUNCEMENTS_KEYWORDS)) {
    return { kind: "announcements" };
  }
  if (hasAnyKeyword(n, CLASS_CONTENT_KEYWORDS)) {
    return { kind: "class_content" };
  }
  if (hasAnyKeyword(n, POLLS_KEYWORDS)) {
    return { kind: "polls" };
  }

  const wantsCreate = hasAnyKeyword(n, CREATE_KEYWORDS);
  const wantsList = hasAnyKeyword(n, LIST_KEYWORDS);

  // Create-group / create-class / create-student / create-teacher.
  // Note: "create group in a class" should match create_group (not create_class)
  // — so check group before class.
  if (wantsCreate && hasAnyKeyword(n, GROUP_KEYWORDS)) {
    return { kind: "create_group" };
  }
  if (wantsCreate && hasAnyKeyword(n, STUDENT_KEYWORDS)) {
    return { kind: "create_student" };
  }
  if (wantsCreate && hasAnyKeyword(n, TEACHER_KEYWORDS)) {
    return { kind: "create_teacher" };
  }
  if (wantsCreate && hasAnyKeyword(n, CLASS_KEYWORDS)) {
    return { kind: "create_class" };
  }

  // List-class-students: "list students of class X".
  if (wantsList && hasAnyKeyword(n, STUDENT_KEYWORDS)) {
    return { kind: "list_class_students" };
  }

  // Stats intent.
  if (
    STATS_KEYWORDS.some((kw) => message.includes(kw)) ||
    STATS_KEYWORDS.some((kw) => n.includes(normalizeFa(kw)))
  ) {
    return { kind: "stats" };
  }

  // Username mention — student lookup.
  const usernameMatch = message.match(USERNAME_RE);
  if (usernameMatch) {
    return { kind: "student", query: usernameMatch[1] };
  }

  // Persian name — student lookup.
  const nameMatch = message.match(PERSIAN_NAME_RE);
  if (nameMatch && nameMatch[0].length >= 3) {
    return { kind: "student", query: nameMatch[0] };
  }

  return { kind: "general" };
}

// Extracts a candidate new password from the user's message. Used to know
// what password to include in the `<ACTION:change_password|...>` reply.
// Looks for patterns like "رمز جدید: 12345" or "به 12345abc" or a quoted string.
function extractNewPassword(message: string): string | null {
  // "رمز جدید: xxx" / "گذرواژه: xxx" / "به xxx تغییر"
  const colonRe =
    /(?:رمز|گذرواژه|password)\s*(?:جدید|نو)?\s*[:：]\s*([^\s،,.\n]+)/i;
  const m1 = message.match(colonRe);
  if (m1) return m1[1];

  // "به xxx تغییر بده"
  const beRe = /به\s+([^\s،,.\n]+)\s*(?:تغییر|بده)/;
  const m2 = message.match(beRe);
  if (m2) return m2[1];

  // Quoted string.
  const quoteRe = /["'«"]([^"'»"»]{4,})["'»"»]/;
  const m3 = message.match(quoteRe);
  if (m3) return m3[1];

  return null;
}

// Phase 28 — extracts a Jalali "YYYY-MM-DD" date from the user's message.
// Returns `null` when no explicit date is present. Used by the attendance
// intent to decide which date's records to pull.
function extractJalaliDate(message: string): string | undefined {
  // "دیروز" / "روز گذشته" → caller passes through; we return `undefined`
  // which the tool function interprets as "yesterday" (its own default).
  // This branch is intentional — letting the tool compute "yesterday" once
  // keeps the date math in a single place.
  const n = normalizeFa(message);
  if (/\bدیروز\b/.test(n) || /روز\s*گذشته/.test(n)) {
    return undefined;
  }
  // "امروز" / "همین امروز" → today's Jalali date.
  if (/\bامروز\b/.test(n)) {
    const j = toJalaali(new Date());
    return `${j.jy}-${String(j.jm).padStart(2, "0")}-${String(j.jd).padStart(2, "0")}`;
  }
  // Explicit "YYYY-MM-DD" or "YYYY/MM/DD".
  const m = message.match(JALALI_DATE_RE);
  if (m) {
    const [, y, mo, d] = m;
    const yi = Number(y);
    const mi = Number(mo);
    const di = Number(d);
    if (yi >= 1300 && yi <= 1500 && mi >= 1 && mi <= 12 && di >= 1 && di <= 31) {
      return `${yi}-${String(mi).padStart(2, "0")}-${String(di).padStart(2, "0")}`;
    }
  }
  // No explicit date — caller falls back to its own default (yesterday).
  return undefined;
}

// ---- Pre-fetch context for a given intent ---------------------------------

// Returns a compact list of class names in the school (top-level only — groups
// are skipped) so the LLM can match a parent-class name in a "create group" or
// "list students" request.
async function listTopLevelClasses(schoolId: string): Promise<string[]> {
  const rows = await db.classRoom.findMany({
    where: { schoolId, parentClassId: null },
    select: { name: true },
    orderBy: { name: "asc" },
  });
  return rows.map((r) => r.name);
}

async function buildContext(
  schoolId: string,
  message: string,
  access: AiAccess,
): Promise<string> {
  const intent = detectIntent(message);

  switch (intent.kind) {
    case "stats": {
      if (!access.stats) {
        return "دسترسی به آمار مدرسه برای دستیار غیرفعال است.";
      }
      const stats = await getSchoolStats(schoolId);
      return `اطلاعات آماری مدرسه (JSON):
${JSON.stringify(stats, null, 2)}`;
    }

    case "password": {
      if (!access.passwordChange) {
        return "تغییر رمز عبور برای دستیار غیرفعال است. از مدیر کل بخواهید این امکان را فعال کند.";
      }
      // We need the username + the new password. Try to find both.
      const usernameMatch = message.match(USERNAME_RE);
      const nameMatch = message.match(PERSIAN_NAME_RE);
      const query = usernameMatch
        ? usernameMatch[1]
        : nameMatch
        ? nameMatch[0]
        : "";

      const newPassword = extractNewPassword(message);

      let usersBlock = "";
      if (query) {
        const users = await searchUsers(schoolId, query);
        usersBlock = `کاربران منطبق در این مدرسه:
${JSON.stringify(users, null, 2)}`;
      } else {
        usersBlock =
          "نام کاربری در پیام پیدا نشد — از مدیر بخواهید نام کاربری (با @) یا نام کامل را مشخص کند.";
      }

      const pwdNote = newPassword
        ? `رمز جدیدی که مدیر پیشنهاد کرده: «${newPassword}»`
        : "رمز جدید در پیام پیدا نشد — از مدیر بپرسید رمز جدید چیست.";

      return `درخواست تغییر رمز.
${usersBlock}

${pwdNote}

برای اجرا، پاسخ نهایی خود را به این شکل بنویسید (یک خط، بدون فاصله اضافه):
<ACTION:change_password|username|newPassword>
که username = نام کاربری واقعی (از فهرست بالا) و newPassword = رمز جدید است.
اگر کاربر یافت نشد یا رمز جدید مشخص نیست، به مدیر بگویید چه چیزی کم است.`;
    }

    case "student": {
      if (!access.studentInfo) {
        return "دسترسی به اطلاعات دانش‌آموز برای دستیار غیرفعال است.";
      }
      const info = await getStudentInfo(schoolId, intent.query);
      return `اطلاعات دانش‌آموزان منطبق (JSON):
${JSON.stringify(info, null, 2)}`;
    }

    case "close_all_groups": {
      return `درخواست بستن همه گفتگوهای مدرسه.
برای اجرا، پاسخ نهایی خود را به این شکل بنویسید (یک خط):
<ACTION:close_all_groups>
اگر مدیر قصد دیگری دارد، توضیح دهید.`;
    }

    case "create_class": {
      // Try to extract a class name from the message. Common patterns:
      // "کلاس X را بساز" / "ایجاد کلاس X" — extract the quoted or trailing
      // phrase after the keyword.
      const nameMatch = message.match(
        /["'«"]([^"'»"»]{2,})["'»"»]/,
      );
      const classNameCandidate = nameMatch
        ? nameMatch[1].trim()
        : (() => {
            // After "کلاس" — take the rest of the line until end or comma.
            const m = message.match(/کلاس\s+([^،,\n.!?]+)/);
            return m ? m[1].trim() : "";
          })();
      return `درخواست ایجاد کلاس جدید در این مدرسه.
${classNameCandidate ? `نام پیشنهادی کلاس: «${classNameCandidate}»` : "نام کلاس در پیام مشخص نیست — از مدیر بپرسید."}

برای اجرا، پاسخ نهایی خود را به این شکل بنویسید:
<ACTION:create_class|className>
اگر نام مشخص نیست یا کلاسی با همان نام وجود دارد، به مدیر بگویید.`;
    }

    case "create_group": {
      // For "create group X in class Y" we need both the parent class name
      // and the group name. Pre-fetch the school's class list so the LLM can
      // pick the right parent.
      const classes = await listTopLevelClasses(schoolId);
      // Try to extract the group name + parent class name from the message.
      const groupNameMatch = message.match(
        /گروه\s+["'«"]?([^"'»"»،,\n.!?]+)["'»»]?/u,
      );
      const parentMatch = message.match(
        /کلاس\s+["'«"]?([^"'»"»،,\n.!?]+)["'»»]?/u,
      );
      const groupName = groupNameMatch ? groupNameMatch[1].trim() : "";
      const parentName = parentMatch ? parentMatch[1].trim() : "";
      return `درخواست ایجاد گروه (گفتگو) در یک کلاس.
کلاس‌های موجود در این مدرسه:
${JSON.stringify(classes, null, 2)}

${parentName ? `کلاس والد پیشنهادی: «${parentName}»` : "کلاس والد در پیام مشخص نیست — از مدیر بپرسید."}
${groupName ? `نام گروه پیشنهادی: «${groupName}»` : "نام گروه در پیام مشخص نیست — از مدیر بپرسید."}

برای اجرا، پاسخ نهایی خود را به این شکل بنویسید:
<ACTION:create_group|parentClassName|groupName>
اگر کلاس والد یافت نشد یا نام گروه مشخص نیست، به مدیر بگویید.`;
    }

    case "create_student": {
      // Extract a fullName + username + password. Common pattern:
      // "دانش‌آموز علی رضایی با نام کاربری ali و رمز 1234 را بساز"
      const quotedName = message.match(
        /["'«"]([^"'»"»]{2,})["'»"»]/u,
      );
      const usernameMatch = message.match(USERNAME_RE);
      // "نام کاربری X" / "username X"
      const explicitUsername = message.match(
        /(?:نام کاربری|username|یوزرنیم)\s*[:：]?\s*([a-z0-9_.]+)/i,
      );
      const passwordMatch = message.match(
        /(?:رمز|گذرواژه|password)\s*(?:جدید|نو)?\s*[:：]?\s*([^\s،,.\n]+)/i,
      );
      const fullName = quotedName ? quotedName[1].trim() : "";
      const username = usernameMatch
        ? usernameMatch[1]
        : explicitUsername
        ? explicitUsername[1]
        : "";
      const password = passwordMatch ? passwordMatch[1] : "";
      return `درخواست ایجاد دانش‌آموز جدید در این مدرسه.
${fullName ? `نام کامل پیشنهادی: «${fullName}»` : "نام کامل در پیام مشخص نیست — از مدیر بپرسید."}
${username ? `نام کاربری پیشنهادی: «${username}»` : "نام کاربری در پیام مشخص نیست."}
${password ? `رمز پیشنهادی: «${password}»` : "رمز در پیام مشخص نیست."}

برای اجرا، پاسخ نهایی خود را به این شکل بنویسید:
<ACTION:create_student|fullName|username|password>
اگر یکی از فیلدها غایب است، از مدیر بپرسید.`;
    }

    case "create_teacher": {
      const quotedName = message.match(
        /["'«"]([^"'»"»]{2,})["'»"»]/u,
      );
      const usernameMatch = message.match(USERNAME_RE);
      const explicitUsername = message.match(
        /(?:نام کاربری|username|یوزرنیم)\s*[:：]?\s*([a-z0-9_.]+)/i,
      );
      const passwordMatch = message.match(
        /(?:رمز|گذرواژه|password)\s*(?:جدید|نو)?\s*[:：]?\s*([^\s،,.\n]+)/i,
      );
      const fullName = quotedName ? quotedName[1].trim() : "";
      const username = usernameMatch
        ? usernameMatch[1]
        : explicitUsername
        ? explicitUsername[1]
        : "";
      const password = passwordMatch ? passwordMatch[1] : "";
      return `درخواست ایجاد معلم جدید در این مدرسه.
${fullName ? `نام کامل پیشنهادی: «${fullName}»` : "نام کامل در پیام مشخص نیست — از مدیر بپرسید."}
${username ? `نام کاربری پیشنهادی: «${username}»` : "نام کاربری در پیام مشخص نیست."}
${password ? `رمز پیشنهادی: «${password}»` : "رمز در پیام مشخص نیست."}

برای اجرا، پاسخ نهایی خود را به این شکل بنویسید:
<ACTION:create_teacher|fullName|username|password>
اگر یکی از فیلدها غایب است، از مدیر بپرسید.`;
    }

    case "list_class_students": {
      const classes = await listTopLevelClasses(schoolId);
      // Try to extract a class name from the message.
      const m = message.match(/کلاس\s+["'«"]?([^"'»"»،,\n.!?]+)/u);
      const className = m ? m[1].trim() : "";
      return `درخواست فهرست دانش‌آموزان یک کلاس.
کلاس‌های موجود در این مدرسه:
${JSON.stringify(classes, null, 2)}

${className ? `کلاس موردنظر: «${className}»` : "نام کلاس در پیام مشخص نیست — از مدیر بپرسید."}

برای اجرا، پاسخ نهایی خود را به این شکل بنویسید:
<ACTION:list_class_students|className>
این یک عملیات فقط خواندنی است و بلافاصله اجرا می‌شود (نیازی به تأیید ندارد).`;
    }

    // ---- Phase 28 — new read-only content intents -------------------------

    case "attendance": {
      if (!access.stats) {
        return "دسترسی به آمار مدرسه برای دستیار غیرفعال است.";
      }
      const dateStr = intent.dateStr;
      const stats = await getAttendanceStats(schoolId, dateStr);
      const absents = await getAbsentStudents(schoolId, dateStr);
      return `گزارش حضور و غیاب مدرسه (JSON):
${JSON.stringify(stats, null, 2)}

فهرست دانش‌آموزان غایب در همان تاریخ (JSON):
${JSON.stringify(absents, null, 2)}

راهنما:
- اگر لیست غایبین خالی است، یعنی برای آن تاریخ هیچ غیبتی ثبت نشده (یا تاریخ اشتباه است).
- تاریخ‌ها به فرمت جلالی «YYYY-MM-DD» هستند. اگر مدیر تاریخ خاصی خواست، آن را با همین فرمت بگویید.`;
    }

    case "violations": {
      if (!access.stats) {
        return "دسترسی به آمار مدرسه برای دستیار غیرفعال است.";
      }
      // "بیشترین" (most) → top 5 students by violation count.
      // Otherwise → overall attendance stats (which include violations list).
      if (intent.most) {
        const top = await getTopViolations(schoolId, 5);
        return `فهرست دانش‌آموزان با بیشترین تخلف در مدرسه (JSON):
${JSON.stringify(top, null, 2)}

راهنما:
- هر رکورد شامل تعداد تخلف‌ها + ۵ تخلف اخیر آن دانش‌آموز است.
- اگر لیست خالی است، یعنی هیچ تخلفی ثبت نشده است.`;
      }
      const stats = await getAttendanceStats(schoolId);
      return `گزارش آماری حضور و غیاب + تخلفات (JSON):
${JSON.stringify(stats, null, 2)}

راهنما:
- فیلد violationStudents شامل دانش‌آموزانی است که در همان تاریخ تخلف داشته‌اند.
- اگر مدیر می‌خواهد «بیشترین تخلف‌ها» را ببیند، پاسخ بدهید که عبارت «بیشترین» را در درخواست خود قید کند.`;
    }

    case "assignments": {
      if (!access.stats) {
        return "دسترسی به آمار مدرسه برای دستیار غیرفعال است.";
      }
      const items = await getAssignments(schoolId);
      return `فهرست تکالیف اخیر این مدرسه (JSON):
${JSON.stringify(items, null, 2)}

راهنما:
- هر تکلیف شامل عنوان، نام کلاس، نام معلم و تاریخ سررسید است.
- اگر خالی است، یعنی هنوز تکلیفی ثبت نشده است.`;
    }

    case "sample_questions": {
      if (!access.stats) {
        return "دسترسی به آمار مدرسه برای دستیار غیرفعال است.";
      }
      const items = await getSampleQuestions(schoolId);
      return `فهرست نمونه سوالات اخیر این مدرسه (JSON):
${JSON.stringify(items, null, 2)}

راهنما:
- هر نمونه سوال شامل عنوان، نام کلاس، نام معلم و (در صورت وجود) لینک فایل است.
- اگر خالی است، یعنی هنوز نمونه‌سوالی ثبت نشده است.`;
    }

    case "announcements": {
      if (!access.stats) {
        return "دسترسی به آمار مدرسه برای دستیار غیرفعال است.";
      }
      const items = await getRecentAnnouncements(schoolId, 10);
      return `فهرست اطلاعیه‌های اخیر این مدرسه (JSON):
${JSON.stringify(items, null, 2)}

راهنما:
- اطلاعیه‌ها پیام‌هایی هستند که مدیر برای همه کلاس‌ها ارسال کرده است.
- اگر خالی است، یعنی هنوز اطلاعیه‌ای ثبت نشده است.`;
    }

    case "class_content": {
      if (!access.stats) {
        return "دسترسی به آمار مدرسه برای دستیار غیرفعال است.";
      }
      const items = await getClassMessages(schoolId, undefined, 20);
      return `فهرست پیام‌های اخیر کلاس‌های این مدرسه (JSON):
${JSON.stringify(items, null, 2)}

راهنما:
- شامل آخرین ۲۰ پیام از همه کلاس‌های این مدرسه است.
- هر پیام شامل متن، نام فرستنده، نقش فرستنده و نام کلاس است.`;
    }

    case "polls": {
      if (!access.stats) {
        return "دسترسی به آمار مدرسه برای دستیار غیرفعال است.";
      }
      const items = await getPolls(schoolId, 10);
      return `فهرست نظرسنجی‌های اخیر این مدرسه (JSON):
${JSON.stringify(items, null, 2)}

راهنما:
- هر نظرسنجی شامل سوال، گزینه‌ها، تعداد کل آرا و نام کلاس است.
- اگر خالی است، یعنی هنوز نظرسنجی‌ای ثبت نشده است.`;
    }

    case "all_classes": {
      if (!access.stats) {
        return "دسترسی به آمار مدرسه برای دستیار غیرفعال است.";
      }
      const items = await getAllClasses(schoolId);
      return `ساختار همه کلاس‌ها و گروه‌های این مدرسه (JSON):
${JSON.stringify(items, null, 2)}

راهنما:
- هر کلاس شامل فهرست گروه‌هایش + تعداد اعضای هر گروه است.
- chatClosed=true یعنی گفتگوی آن کلاس بسته شده است.`;
    }

    default:
      // For "general" intents, give the LLM a minimal school stats summary
      // so it can answer broad questions about the school. If stats are
      // disabled, fall back to a generic context.
      if (!access.stats) {
        return "اطلاعات تکمیلی برای این درخواست در دسترس نیست.";
      }
      const stats = await getSchoolStats(schoolId);
      return `اطلاعات کلی مدرسه (خلاصه):
${JSON.stringify(stats, null, 2)}`;
  }
}

// ---- Parse the LLM reply for an embedded action ---------------------------

// Generic ACTION token: `<ACTION:type|param1|param2|...>` or `<ACTION:type>`.
const ACTION_RE = /<ACTION:([a-z_]+)((?:\|[^>]*)?)>/;

type ParsedAction = { type: string; params: string[] };

function parseAction(reply: string): ParsedAction | null {
  const m = reply.match(ACTION_RE);
  if (!m) return null;
  const type = m[1];
  const paramsPart = m[2] ?? "";
  const params = paramsPart
    ? paramsPart
        .slice(1) // strip leading "|"
        .split("|")
        .map((p) => p.trim())
        .filter((p) => p.length > 0)
    : [];
  if (!type) return null;
  return { type, params };
}

function stripActionToken(reply: string): string {
  return reply.replace(ACTION_RE, "").trim();
}

// Build the Persian confirmation card text for a write action.
function buildConfirmationMessage(type: string, params: string[]): string {
  switch (type) {
    case "change_password":
      if (params.length >= 2) {
        return `آیا مطمئن هستید که رمز کاربر «${params[0]}» به «${params[1]}» تغییر کند؟`;
      }
      return "تأیید تغییر رمز — پارامترها کامل نیست.";
    case "create_class":
      if (params.length >= 1) {
        return `ایجاد کلاس جدید با نام «${params[0]}»؟`;
      }
      return "تأیید ایجاد کلاس — نام مشخص نیست.";
    case "create_group":
      if (params.length >= 2) {
        return `ایجاد گروه «${params[1]}» در کلاس «${params[0]}»؟`;
      }
      return "تأیید ایجاد گروه — پارامترها کامل نیست.";
    case "create_student":
      if (params.length >= 3) {
        return `ایجاد دانش‌آموز «${params[0]}» با نام کاربری «${params[1]}» و رمز «${params[2]}»؟`;
      }
      return "تأیید ایجاد دانش‌آموز — پارامترها کامل نیست.";
    case "create_teacher":
      if (params.length >= 3) {
        return `ایجاد معلم «${params[0]}» با نام کاربری «${params[1]}» و رمز «${params[2]}»؟`;
      }
      return "تأیید ایجاد معلم — پارامترها کامل نیست.";
    case "close_all_groups":
      return "بستن همه گفتگوهای این مدرسه؟ (همه کلاس‌ها و گروه‌ها)";
    default:
      return "تأیید عملیات.";
  }
}

// All recognized WRITE action types — these require user confirmation before
// the action endpoint runs the side effect.
const WRITE_ACTION_TYPES = new Set([
  "change_password",
  "create_class",
  "create_group",
  "create_student",
  "create_teacher",
  "close_all_groups",
]);

// ---- Route handler --------------------------------------------------------

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

  // Load AI access flags (default true for missing rows).
  const access = await loadAiAccess();

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json(
      { error: "بدنه درخواست نامعتبر است" },
      { status: 400 },
    );
  }

  // School scoping. ADMIN: their schoolId. SUPERADMIN: optional schoolId in
  // the body (the frontend may pick one).
  let schoolId: string | null = null;
  if (user.role === "ADMIN") {
    schoolId = user.schoolId ?? null;
  } else if (typeof body.schoolId === "string" && body.schoolId.trim()) {
    schoolId = body.schoolId.trim();
  }

  if (!schoolId) {
    return NextResponse.json(
      { error: "لطفاً یک مدرسه انتخاب کنید" },
      { status: 400 },
    );
  }

  const message = (body.message ?? "").toString().trim();
  if (!message) {
    return NextResponse.json(
      { error: "پیام خالی است" },
      { status: 400 },
    );
  }

  // Phase 21 — if the caller didn't supply a `history` array, hydrate it
  // from the persisted AIConversation table (most recent 20 turns). The
  // frontend now also keeps a local copy, but when the page first opens
  // the panel fetches the persisted history itself; either path works.
  let history: HistoryItem[] = Array.isArray(body.history)
    ? body.history
    : [];
  if (history.length === 0) {
    const recent = await db.aIConversation.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { role: true, content: true },
    });
    // Reverse to chronological (oldest-first) order for the LLM context.
    history = recent
      .reverse()
      .filter(
        (r): r is { role: "user" | "assistant"; content: string } =>
          (r.role === "user" || r.role === "assistant") &&
          typeof r.content === "string",
      )
      .map((r) => ({ role: r.role, content: r.content }));
  }

  // 1. Build context (pre-fetch data based on intent + access flags).
  let contextBlock: string;
  try {
    contextBlock = await buildContext(schoolId, message, access);
  } catch (err) {
    console.error("[ai-assistant] buildContext error:", err);
    contextBlock = "اطلاعات مربوط به این درخواست در حال حاضر بارگذاری نشد.";
  }

  // 2. Compose the system prompt reflecting the available access + the full
  //    catalogue of supported actions.
  const accessLines: string[] = [];
  if (access.stats) {
    accessLines.push("شما به آمار مدرسه دسترسی دارید.");
  } else {
    accessLines.push("شما به آمار مدرسه دسترسی ندارید.");
  }
  if (access.studentInfo) {
    accessLines.push("شما می‌توانید اطلاعات دانش‌آموزان را ببینید.");
  } else {
    accessLines.push("شما به اطلاعات دانش‌آموزان دسترسی ندارید.");
  }
  if (access.passwordChange) {
    accessLines.push(
      "شما می‌توانید رمز عبور کاربران (دانش‌آموز/معلم) را تغییر دهید.",
    );
  } else {
    accessLines.push("تغییر رمز عبور برای شما غیرفعال است.");
  }

  const passwordInstruction = access.passwordChange
    ? `اگر مدیر درخواست تغییر رمز کرده و رمز جدید مشخص است، پاسخ را به این شکل بدهید:
<ACTION:change_password|username|newPassword>`
    : "تغییر رمز عبور برای شما غیرفعال است؛ اگر مدیر چنین درخواستی کرد، به او بگویید این امکان فعال نیست.";

  const actionsCatalogue = `عملیات پشتیبانی‌شده (هرکدام را که مدیر درخواست کرد، پس از جمع‌آوری اطلاعات لازم، نشانه مربوطه را در پاسخ خود قرار دهید):

1. تغییر رمز کاربر: <ACTION:change_password|username|newPassword> (نیازمند تأیید مدیر)
2. ایجاد کلاس جدید: <ACTION:create_class|className> (نیازمند تأیید مدیر)
3. ایجاد گروه در یک کلاس: <ACTION:create_group|parentClassName|groupName> (نیازمند تأیید مدیر)
4. ایجاد دانش‌آموز جدید: <ACTION:create_student|fullName|username|password> (نیازمند تأیید مدیر)
5. ایجاد معلم جدید: <ACTION:create_teacher|fullName|username|password> (نیازمند تأیید مدیر)
6. بستن همه گفتگوها: <ACTION:close_all_groups> (نیازمند تأیید مدیر)
7. فهرست دانش‌آموزان یک کلاس: <ACTION:list_class_students|className> (فقط خواندنی — بلافاصله اجرا می‌شود، نیازی به تأیید ندارد)

پرسش‌های فقط-خواندنی که می‌توانید مستقیماً از داده‌های بارگذاری‌شده پاسخ دهید (بدون نیاز به نشانه عملیات):
- حضور و غیاب (دیروز/امروز/تاریخ خاص) و فهرست غایبین
- تخلفات (یا «بیشترین تخلف‌ها» برای فهرست دانش‌آموزان پرتخلف)
- فهرست تکالیف + فهرست نمونه سوالات
- اطلاعیه‌های اخیر
- پیام‌های اخیر کلاس‌ها (محتوای کلاس)
- نظرسنجی‌های اخیر
- ساختار همه کلاس‌ها و گروه‌های مدرسه (با تعداد اعضا)`;

  const systemPrompt = `شما دستیار هوشمند مدیر مدرسه هستید و به اطلاعات زیر دسترسی دارید: آمار مدرسه، اطلاعات دانش‌آموزان، حضور و غیاب و تخلفات، تکالیف، نمونه سوالات، اطلاعیه‌ها، محتوای کلاس‌ها و گروه‌ها، نظرسنجی‌ها.
به زبان فارسی پاسخ می‌دهید. می‌توانید به سوالات درباره غیبت‌ها، تخلفات، آمار، محتوا و ... پاسخ دقیق دهید.

شما با اطلاعات زیر به سؤالات مدیر پاسخ می‌دهید:

${contextBlock}

سطح دسترسی شما:
- ${accessLines.join("\n- ")}

${actionsCatalogue}

${passwordInstruction}

قوانین مهم:
- پاسخ خود را کوتاه و مفید نگه دارید.
- اگر اطلاعات کافی نیست، از مدیر جزئیات بیشتری بخواهید.
- برای عملیات فقط-خواندنی (فهرست دانش‌آموزان کلاس) نیازی به تأیید نیست — نشانه را در پاسخ قرار دهید و سیستم آن را اجرا می‌کند.
- برای عملیات نوشتنی (ساخت/بستن/تغییر رمز) نشانه را در پاسخ قرار دهید؛ سیستم قبل از اجرا از مدیر تأیید می‌گیرد.
- برای پرسش‌های حضور و غیاب + تخلفات + تکالیف + اطلاعیه‌ها + محتوا + نظرسنجی‌ها + ساختار کلاس‌ها، داده‌ها در بلوک بالا آماده است — فقط آن‌ها را به صورت خوانا خلاصه کنید و نشانه عملیات لازم نیست.
- تاریخ‌ها در سیستم به فرمت جلالی «YYYY-MM-DD» هستند. اگر مدیر عبارت «دیروز» یا «امروز» به کار برد، گزارش همان تاریخ را بیاورید.`;

  // 3. Call the LLM. Wrap in try/catch — never crash the UI on failure.
  // Phase 34 — the LLM call now goes through the pluggable provider in
  // `src/lib/ai-provider.ts`. The SUPERADMIN can configure a custom
  // provider (OpenAI-compatible or Anthropic) via /superadmin/ai-settings;
  // when no custom config is set, the helper falls back to the default
  // z-ai-web-dev-sdk (the original behavior).
  let replyText: string;
  try {
    replyText = await callLLM([
      { role: "system", content: systemPrompt },
      ...history.map((h) => ({
        role: h.role as "user" | "assistant",
        content: h.content,
      })),
      { role: "user", content: message },
    ]);
  } catch (err) {
    console.error("[ai-assistant] LLM error:", err);
    return NextResponse.json({
      data: {
        reply:
          "متأسفم، در حال حاضر نمی‌توانم پاسخ دهم. لطفاً دوباره تلاش کنید.",
      },
    });
  }

  // 4. Parse the reply for an embedded action token.
  const actionToken = parseAction(replyText);

  // Computed final response (reply / action / requiresConfirmation) —
  // Phase 21 we persist BOTH the user message + the assistant reply to the
  // AIConversation table before returning, so the principal can close the
  // panel and resume the conversation later.
  let finalReply: string;
  let finalAction: Record<string, unknown> | null = null;
  let finalRequiresConfirmation = false;

  if (actionToken) {
    const { type, params } = actionToken;

    // READ action: list_class_students — execute immediately and return the
    // result inline (no confirmation required).
    if (type === "list_class_students") {
      const className = params[0] ?? "";
      try {
        const result = await listClassStudents(schoolId, className);
        const list =
          result.students.length === 0
            ? "هیچ دانش‌آموزی در این کلاس ثبت نشده است."
            : result.students
                .map((s, i) => `${i + 1}. ${s.fullName} (@${s.username})`)
                .join("\n");
        finalReply = `دانش‌آموزان کلاس «${result.className}»:\n${list}`;
      } catch (err) {
        if (err instanceof AiToolError) {
          finalReply = err.message;
        } else {
          console.error("[ai-assistant] list_class_students error:", err);
          finalReply =
            "متأسفم، در بارگذاری فهرست دانش‌آموزان خطایی رخ داد. لطفاً دوباره تلاش کنید.";
        }
      }
    } else if (WRITE_ACTION_TYPES.has(type)) {
      // change_password is gated by the access flag — if it's off, strip
      // the token and discard it (the LLM shouldn't have emitted it).
      if (type === "change_password" && !access.passwordChange) {
        finalReply = stripActionToken(replyText);
      } else {
        const actionPayload = buildActionPayload(type, params);
        if (actionPayload) {
          finalReply = buildConfirmationMessage(type, params);
          finalAction = actionPayload;
          finalRequiresConfirmation = true;
        } else {
          // Params didn't match — strip and ignore.
          finalReply = stripActionToken(replyText);
        }
      }
    } else {
      // Unknown action type — strip and ignore.
      finalReply = stripActionToken(replyText);
    }
  } else {
    finalReply = stripActionToken(replyText);
  }

  // Phase 21 — persist the user message + the assistant reply to the
  // AIConversation table. We do this AFTER computing the final reply so
  // the stored assistant message matches exactly what the principal saw
  // (including the dynamically-built confirmation cards + executed-list
  // results). Errors during persistence are logged but never surface to
  // the caller — a history-write failure shouldn't break the chat.
  try {
    await db.aIConversation.create({
      data: { userId: user.id, role: "user", content: message },
    });
    await db.aIConversation.create({
      data: {
        userId: user.id,
        role: "assistant",
        content: finalReply,
        actionJson:
          finalAction && finalRequiresConfirmation
            ? JSON.stringify(finalAction)
            : null,
      },
    });
  } catch (persistErr) {
    console.error(
      "[ai-assistant] failed to persist conversation:",
      persistErr,
    );
  }

  return NextResponse.json({
    data: {
      reply: finalReply,
      ...(finalAction && finalRequiresConfirmation
        ? { action: finalAction, requiresConfirmation: true }
        : {}),
    },
  });
});

// Build the action payload object the frontend expects (matches the shape
// consumed by POST /api/ai-assistant/action). Returns null when the params
// don't match the action's expected arity.
function buildActionPayload(
  type: string,
  params: string[],
): Record<string, unknown> | null {
  switch (type) {
    case "change_password":
      if (params.length < 2) return null;
      return {
        type,
        username: params[0],
        newPassword: params[1],
      };
    case "create_class":
      if (params.length < 1) return null;
      return { type, name: params[0] };
    case "create_group":
      if (params.length < 2) return null;
      return {
        type,
        parentClassName: params[0],
        groupName: params[1],
      };
    case "create_student":
    case "create_teacher":
      if (params.length < 3) return null;
      return {
        type,
        fullName: params[0],
        username: params[1],
        password: params[2],
      };
    case "close_all_groups":
      return { type };
    default:
      return null;
  }
}
