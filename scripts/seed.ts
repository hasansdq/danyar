// Seed script — run automatically by docker-entrypoint.sh (marker-gated,
// restart-safe), or manually: bun run seed
//
// SECURITY (production / Docker):
//   - ADMIN_PASSWORD is REQUIRED in production — the seed FAILS FAST when
//     it is missing or violates the password policy. A password is NEVER
//     auto-generated and NEVER printed to the logs.
//   - SEED_DEMO_DATA=true is FORBIDDEN in production (demo users have known
//     passwords) — the seed fails fast.
//   - Demo data is created ONLY when SEED_DEMO_DATA=true AND dev/staging.
//
// IDEMPOTENCY (restart-safe):
//   - EVERY record is created via upsert or guarded findFirst-then-create,
//     so a crashed seed that is retried on container restart NEVER creates
//     duplicates.
//   - A `seed_completed` SiteSetting marker is written ONLY at the very end
//     of a fully successful run — docker-entrypoint.sh uses it to skip
//     re-seeding on subsequent boots.
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { checkPasswordPolicy } from "../src/lib/password-policy";

const prisma = new PrismaClient({
  log: ["error", "warn"],
});

const isProduction = process.env.NODE_ENV === "production";
const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || "admin").trim().toLowerCase();
const SEED_DEMO_DATA = (process.env.SEED_DEMO_DATA || "").toLowerCase() === "true";
const SEED_MARKER_KEY = "seed_completed";

function generateRandomPassword(length = 16): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const digits = "23456789";
  const all = upper + lower + digits;
  const pick = (chars: string, n: number) => {
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      const idx = globalThis.crypto.getRandomValues(new Uint32Array(1))[0] % chars.length;
      out.push(chars[idx]);
    }
    return out.join("");
  };
  return pick(upper, 3) + pick(lower, 3) + pick(digits, 3) + pick(all, Math.max(0, length - 9));
}

// ---------------------------------------------------------------------------
// Idempotent create helpers — "create only if an equivalent record does not
// already exist". Natural keys (title/content/reason + owners) identify the
// seeded demo records across re-runs.
// ---------------------------------------------------------------------------
async function ensureMessage(classId: string, senderId: string, content: string) {
  const existing = await prisma.message.findFirst({ where: { classId, senderId, content } });
  if (!existing) {
    await prisma.message.create({ data: { classId, senderId, content } });
  }
}

async function ensureAssignment(data: {
  classId: string;
  title: string;
  description: string;
  dueDate: Date;
  createdById: string;
}) {
  const existing = await prisma.assignment.findFirst({
    where: { classId: data.classId, title: data.title },
  });
  if (!existing) await prisma.assignment.create({ data });
}

async function ensureSampleQuestion(data: {
  classId: string;
  title: string;
  description: string;
  createdById: string;
}) {
  const existing = await prisma.sampleQuestion.findFirst({
    where: { classId: data.classId, title: data.title },
  });
  if (!existing) await prisma.sampleQuestion.create({ data });
}

async function ensureGrade(data: {
  classId: string;
  studentId: string;
  title: string;
  score: number;
  maxScore: number;
  createdById: string;
}) {
  const existing = await prisma.grade.findFirst({
    where: { classId: data.classId, studentId: data.studentId, title: data.title },
  });
  if (!existing) await prisma.grade.create({ data });
}

async function ensureBehaviorMark(data: {
  classId: string;
  studentId: string;
  type: "POSITIVE" | "NEGATIVE";
  reason: string;
  value: number;
  createdById: string;
}) {
  const existing = await prisma.behaviorMark.findFirst({
    where: { classId: data.classId, studentId: data.studentId, type: data.type, reason: data.reason },
  });
  if (!existing) await prisma.behaviorMark.create({ data });
}

async function main() {
  // ---- Production guards (fail-fast, defense in depth — the entrypoint
  // validates the same conditions BEFORE starting the app) ----
  if (isProduction && SEED_DEMO_DATA) {
    console.error(
      "FATAL: SEED_DEMO_DATA=true is forbidden in production (demo users have known passwords). Remove it and redeploy.",
    );
    process.exit(1);
  }

  const adminPasswordRaw = process.env.ADMIN_PASSWORD || "";
  if (isProduction && !adminPasswordRaw) {
    console.error(
      "FATAL: ADMIN_PASSWORD is required in production. Set it in .env — it is never generated or printed.",
    );
    process.exit(1);
  }

  const policy = checkPasswordPolicy(adminPasswordRaw, { username: ADMIN_USERNAME });
  if (!policy.ok) {
    if (isProduction) {
      // Misconfiguration: fail the deployment instead of silently swapping
      // the operator's password for a random one (which would never be
      // shown anyway — passwords are never printed).
      console.error(`FATAL: ADMIN_PASSWORD does not meet the password policy (${policy.reason}). Fix .env and redeploy.`);
      process.exit(1);
    }
    // Dev convenience: allow the weak password but warn.
    console.warn(`⚠️  ADMIN_PASSWORD weak (${policy.reason}) — allowed in dev only.`);
  }

  // ---- Admin (always created) ----
  // Dev-only fallback: when no ADMIN_PASSWORD is provided outside production,
  // generate a random one and print it ONCE to the console. This branch is
  // UNREACHABLE in Docker (containers run with NODE_ENV=production, where the
  // password is mandatory) — so no password is ever printed to Docker logs.
  let passwordRaw = adminPasswordRaw;
  let generated = false;
  if (!passwordRaw) {
    passwordRaw = generateRandomPassword(16);
    generated = true;
    console.log("\n========================================");
    console.log("⚠️  DEV ONLY — auto-generated admin password:");
    console.log(`    Username: ${ADMIN_USERNAME}`);
    console.log(`    Password: ${passwordRaw}`);
    console.log("(Docker/production REQUIRES ADMIN_PASSWORD and never prints it)");
    console.log("========================================\n");
  }

  const password = await bcrypt.hash(passwordRaw, 12);

  await prisma.user.upsert({
    where: { username: ADMIN_USERNAME },
    update: {}, // never overwrite an existing admin's password on re-runs
    create: {
      username: ADMIN_USERNAME,
      password,
      role: "ADMIN",
      fullName: "مدیر سیستم",
    },
  });
  console.log(`✓ Admin account ready: ${ADMIN_USERNAME} (password: ${generated ? "generated — dev console only" : "from ADMIN_PASSWORD"})`);

  // ---- Demo data (SEED_DEMO_DATA=true AND dev/staging ONLY) ----
  if (!SEED_DEMO_DATA) {
    console.log("✅ Seed completed (admin only — set SEED_DEMO_DATA=true for demo data)");
    await markSeedCompleted();
    return;
  }

  console.log("🧪 SEED_DEMO_DATA=true — creating demo users/classes…");

  // Demo teacher (FIXED demo credential — dev/staging only!)
  const teacher = await prisma.user.upsert({
    where: { username: "teacher1" },
    update: {},
    create: {
      username: "teacher1",
      password: await bcrypt.hash("Teacher123!", 10),
      role: "TEACHER",
      fullName: "استاد رضایی",
    },
  });

  // Demo students
  const studentData = [
    { username: "student1", fullName: "علی محمدی" },
    { username: "student2", fullName: "فاطمه حسینی" },
    { username: "student3", fullName: "حسین کریمی" },
    { username: "student4", fullName: "زهرا اکبری" },
    { username: "student5", fullName: "محمد موسوی" },
  ];
  const studentPass = await bcrypt.hash("Student123!", 10);
  const students: { id: string }[] = [];
  for (const s of studentData) {
    const u = await prisma.user.upsert({
      where: { username: s.username },
      update: {},
      create: { ...s, password: studentPass, role: "STUDENT" },
    });
    students.push(u);
  }

  // Demo classes
  const cls = await prisma.classRoom.upsert({
    where: { name: "کلاس دهم ریاضی" },
    update: {},
    create: {
      name: "کلاس دهم ریاضی",
      description: "کلاس ریاضی پایه دهم - گروه الف",
      gradeLevel: "دهم",
    },
  });

  const cls2 = await prisma.classRoom.upsert({
    where: { name: "کلاس یازدهم تجربی" },
    update: {},
    create: {
      name: "کلاس یازدهم تجربی",
      description: "کلاس علوم تجربی پایه یازدهم",
      gradeLevel: "یازدهم",
    },
  });

  await prisma.classMembership.upsert({
    where: { classId_userId: { classId: cls.id, userId: teacher.id } },
    update: {},
    create: { classId: cls.id, userId: teacher.id, role: "TEACHER" },
  });
  await prisma.classMembership.upsert({
    where: { classId_userId: { classId: cls2.id, userId: teacher.id } },
    update: {},
    create: { classId: cls2.id, userId: teacher.id, role: "TEACHER" },
  });

  for (const s of students) {
    await prisma.classMembership.upsert({
      where: { classId_userId: { classId: cls.id, userId: s.id } },
      update: {},
      create: { classId: cls.id, userId: s.id, role: "STUDENT" },
    });
  }

  // Idempotent content records (guarded creates — safe to re-run)
  await ensureMessage(cls.id, teacher.id, "سلام به همه دانش‌آموزان گرامی. به کلاس ریاضی خوش آمدید.");
  await ensureMessage(cls.id, students[0].id, "سلام استاد، ممنون.");

  await ensureAssignment({
    classId: cls.id,
    title: "تمرین فصل اول - معادلات درجه دوم",
    description: "حل تمرین‌های ۱ تا ۱۰ از صفحه ۴۵ کتاب درسی.",
    dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    createdById: teacher.id,
  });

  await ensureSampleQuestion({
    classId: cls.id,
    title: "نمونه سوال فصل اول",
    description: "نمونه سوالات امتحانی فصل اول با پاسخ تشریحی.",
    createdById: teacher.id,
  });

  await ensureGrade({
    classId: cls.id,
    studentId: students[0].id,
    title: "آزمون فصل اول",
    score: 17.5,
    maxScore: 20,
    createdById: teacher.id,
  });
  await ensureGrade({
    classId: cls.id,
    studentId: students[1].id,
    title: "آزمون فصل اول",
    score: 19,
    maxScore: 20,
    createdById: teacher.id,
  });

  await ensureBehaviorMark({
    classId: cls.id,
    studentId: students[0].id,
    type: "POSITIVE",
    reason: "شرکت فعال در کلاس",
    value: 2,
    createdById: teacher.id,
  });
  await ensureBehaviorMark({
    classId: cls.id,
    studentId: students[2].id,
    type: "NEGATIVE",
    reason: "تأخیر در حضور کلاس",
    value: -1,
    createdById: teacher.id,
  });

  console.log("✅ Seed completed");
  console.log("========================================");
  console.log(`Admin:    ${ADMIN_USERNAME} (password: ${generated ? "generated — dev console only" : "from ADMIN_PASSWORD"})`);
  console.log("  (demo) Teacher:  teacher1 / Teacher123!");
  console.log("  (demo) Student:  student1 / Student123!");
  console.log("========================================");

  await markSeedCompleted();
}

/** Write the completion marker — docker-entrypoint.sh skips seeding when present. */
async function markSeedCompleted() {
  await prisma.siteSetting.upsert({
    where: { key: SEED_MARKER_KEY },
    update: { value: "true" },
    create: { key: SEED_MARKER_KEY, value: "true" },
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
