import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/session";
import { apiHandler, badRequest } from "@/lib/api-utils";
import { isTeacherOf, verifyMembership } from "@/lib/membership";
import { assertPermission } from "@/lib/permission-check";
import { assertModule } from "@/lib/module-check";
import { assertClassSchoolScope } from "@/lib/authz";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Helper: builds the API shape for a single poll, including decoded
 * options array, per-option vote counts, totalVotes, myVote, and closed.
 *
 *  - single-choice poll: myVote is `number | null`
 *  - multiple-choice poll: myVote is `number[]` (empty array if none)
 */
function buildPollShape(
  poll: {
    id: string;
    classId: string;
    question: string;
    options: string;
    multipleChoice: boolean;
    createdAt: Date;
    createdById: string;
    closedAt: Date | null;
    createdBy: { id: string; fullName: string } | null;
  },
  votesByOption: Map<number, number>,
  totalVotes: number,
  myVoteIndexes: number[],
) {
  let options: string[] = [];
  try {
    const parsed = JSON.parse(poll.options);
    if (Array.isArray(parsed)) options = parsed.map((o) => String(o));
  } catch {
    options = [];
  }
  const optionVotes = options.map((_, idx) => ({
    optionIndex: idx,
    count: votesByOption.get(idx) ?? 0,
  }));

  let myVote: number | number[] | null;
  if (poll.multipleChoice) {
    myVote = myVoteIndexes;
  } else {
    myVote = myVoteIndexes.length > 0 ? myVoteIndexes[0] : null;
  }

  return {
    id: poll.id,
    classId: poll.classId,
    question: poll.question,
    options,
    multipleChoice: poll.multipleChoice,
    createdAt: poll.createdAt.toISOString(),
    createdById: poll.createdById,
    createdBy: poll.createdBy,
    closed: poll.closedAt != null,
    closedAt: poll.closedAt ? poll.closedAt.toISOString() : null,
    optionVotes,
    totalVotes,
    myVote,
  };
}

/**
 * GET /api/polls?classId=<id>
 * Returns all polls of the class (newest first) with vote tallies + myVote.
 * Requires the requester to be a member of the class.
 */
export const GET = apiHandler(async (req: NextRequest) => {
  const user = await requireAuth();

  const classId = req.nextUrl.searchParams.get("classId");
  if (!classId) return badRequest("classId is required");

  const membership = await verifyMembership(user.id, classId);
  if (!membership && user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // SECURITY (school scoping): an ADMIN (principal) without membership may
  // only read polls of classes in their OWN school.
  if (!membership && user.role === "ADMIN") {
    const scopeError = await assertClassSchoolScope(user, classId);
    if (scopeError) return scopeError;
  }

  const polls = await db.poll.findMany({
    where: { classId },
    orderBy: { createdAt: "desc" },
    include: {
      createdBy: {
        select: { id: true, fullName: true },
      },
    },
  });

  if (polls.length === 0) {
    return NextResponse.json({ data: [] });
  }

  const pollIds = polls.map((p) => p.id);

  // All votes on these polls (needed for tallies).
  const allVotes = await db.pollVote.findMany({
    where: { pollId: { in: pollIds } },
    select: { pollId: true, userId: true, optionIndex: true },
  });

  // Group by pollId → optionIndex → count.
  const votesByPoll = new Map<
    string,
    { byOption: Map<number, number>; total: number }
  >();
  for (const v of allVotes) {
    let entry = votesByPoll.get(v.pollId);
    if (!entry) {
      entry = { byOption: new Map(), total: 0 };
      votesByPoll.set(v.pollId, entry);
    }
    entry.byOption.set(v.optionIndex, (entry.byOption.get(v.optionIndex) ?? 0) + 1);
    entry.total += 1;
  }

  // Current user's votes per poll.
  const myVotesByPoll = new Map<string, number[]>();
  for (const v of allVotes) {
    if (v.userId === user.id) {
      const arr = myVotesByPoll.get(v.pollId) ?? [];
      arr.push(v.optionIndex);
      myVotesByPoll.set(v.pollId, arr);
    }
  }

  const data = polls.map((p) => {
    const entry = votesByPoll.get(p.id);
    const byOption = entry?.byOption ?? new Map<number, number>();
    const total = entry?.total ?? 0;
    const myVoteIndexes = myVotesByPoll.get(p.id) ?? [];
    return buildPollShape(p, byOption, total, myVoteIndexes);
  });

  return NextResponse.json({ data });
});

/**
 * POST /api/polls
 * Body JSON: { classId, question, options: string[], multipleChoice? }
 *
 * Creates a poll. Restricted to TEACHER of the class (or ADMIN).
 * `options` is stored as JSON.stringify of the array (SQLite has no list type).
 */
export const POST = apiHandler(async (req: NextRequest) => {
  const user = await requireAuth();

  // Global module gate — SUPERADMIN bypasses.
  await assertModule(user.role, "polls");

  await assertPermission(user.role, "create_poll");

  let body: any;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const classId: string | undefined = body?.classId;
  const question: string | undefined = body?.question;
  const optionsRaw: unknown = body?.options;
  const multipleChoice: boolean = !!body?.multipleChoice;

  if (!classId) return badRequest("classId is required");
  if (typeof question !== "string" || question.trim().length === 0) {
    return badRequest("question is required");
  }
  if (!Array.isArray(optionsRaw)) {
    return badRequest("options must be an array");
  }
  const options = optionsRaw
    .map((o) => (typeof o === "string" ? o.trim() : ""))
    .filter((o) => o.length > 0);
  if (options.length < 2 || options.length > 10) {
    return badRequest("options must contain between 2 and 10 non-empty strings");
  }

  // Authorization: teacher of the class OR admin.
  const teacherOf = await isTeacherOf(user.id, classId);
  if (!teacherOf && user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Verify class exists (avoid dangling FK).
  const cls = await db.classRoom.findUnique({ where: { id: classId } });
  if (!cls) {
    return NextResponse.json({ error: "Class not found" }, { status: 404 });
  }
  // SECURITY (school scoping): an ADMIN (principal) may only create polls
  // in classes of their OWN school.
  if (!teacherOf && user.role === "ADMIN") {
    if (!user.schoolId || cls.schoolId !== user.schoolId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const poll = await db.poll.create({
    data: {
      classId,
      question: question.trim(),
      options: JSON.stringify(options),
      multipleChoice,
      createdById: user.id,
    },
    include: {
      createdBy: {
        select: { id: true, fullName: true },
      },
    },
  });

  return NextResponse.json(
    {
      data: buildPollShape(poll, new Map(), 0, []),
    },
    { status: 201 },
  );
});
