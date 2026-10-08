import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/session";
import { apiHandler, badRequest, notFound } from "@/lib/api-utils";
import { verifyMembership } from "@/lib/membership";
import { assertClassSchoolScope } from "@/lib/authz";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * POST /api/polls/[id]/vote
 *
 * Body JSON:
 *  - single-choice:  { optionIndex: number }
 *  - multiple-choice: { optionIndexes: number[] }
 *
 * Verify membership of the poll's class.
 *
 *  - If the poll is closed (closedAt != null), return 403.
 *  - single-choice: if the user already voted on ANY option, return 409
 *    "شما قبلاً رای داده‌اید" UNLESS multipleChoice is true. Upsert
 *    PollVote on the unique [pollId, userId, optionIndex].
 *  - multiple-choice: replace the user's votes with the new set (delete
 *    existing, insert new) inside a transaction.
 *
 * Returns { data: { pollId, voted: true } }.
 */
export const POST = apiHandler<{ id: string }>(
  async (req: NextRequest, ctx) => {
    const user = await requireAuth();
    const { id } = await ctx.params;
    if (!id) return notFound();

    const poll = await db.poll.findUnique({ where: { id } });
    if (!poll) {
      return notFound("نظرسنجی یافت نشد");
    }

    // Verify membership of the poll's class.
    const membership = await verifyMembership(user.id, poll.classId);
    if (!membership && user.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // SECURITY (school scoping): an ADMIN (principal) without membership may
    // only vote in polls of classes in their OWN school.
    if (!membership && user.role === "ADMIN") {
      const scopeError = await assertClassSchoolScope(user, poll.classId);
      if (scopeError) return scopeError;
    }

    if (poll.closedAt) {
      return NextResponse.json(
        { error: "این نظرسنجی بسته شده است" },
        { status: 403 },
      );
    }

    // Decode options to validate option indexes.
    let options: string[] = [];
    try {
      const parsed = JSON.parse(poll.options);
      if (Array.isArray(parsed)) options = parsed.map((o: unknown) => String(o));
    } catch {
      options = [];
    }
    if (options.length === 0) {
      return NextResponse.json(
        { error: "Invalid poll options" },
        { status: 500 },
      );
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return badRequest("Invalid JSON body");
    }

    if (poll.multipleChoice) {
      // Multiple-choice path: optionIndexes (array).
      const optionIndexesRaw = body?.optionIndexes;
      if (!Array.isArray(optionIndexesRaw) || optionIndexesRaw.length === 0) {
        return badRequest("optionIndexes must be a non-empty array");
      }
      const optionIndexes: number[] = [];
      const seen = new Set<number>();
      for (const raw of optionIndexesRaw) {
        const n = Number(raw);
        if (Number.isNaN(n) || !Number.isInteger(n)) {
          return badRequest("optionIndexes must be integers");
        }
        if (n < 0 || n >= options.length) {
          return badRequest("optionIndex out of range");
        }
        if (seen.has(n)) continue; // ignore duplicates silently
        seen.add(n);
        optionIndexes.push(n);
      }

      // Replace the user's votes: delete all existing, insert new (transaction).
      await db.$transaction([
        db.pollVote.deleteMany({
          where: { pollId: id, userId: user.id },
        }),
        ...optionIndexes.map((optionIndex) =>
          db.pollVote.create({
            data: { pollId: id, userId: user.id, optionIndex },
          }),
        ),
      ]);

      return NextResponse.json({
        data: { pollId: id, voted: true },
      });
    }

    // Single-choice path: optionIndex (number).
    const optionIndexRaw = body?.optionIndex;
    const optionIndex = Number(optionIndexRaw);
    if (Number.isNaN(optionIndex) || !Number.isInteger(optionIndex)) {
      return badRequest("optionIndex must be an integer");
    }
    if (optionIndex < 0 || optionIndex >= options.length) {
      return badRequest("optionIndex out of range");
    }

    // If user already voted on this poll (any option), reject.
    const existing = await db.pollVote.findFirst({
      where: { pollId: id, userId: user.id },
    });
    if (existing) {
      return NextResponse.json(
        { error: "شما قبلاً رای داده‌اید" },
        { status: 409 },
      );
    }

    await db.pollVote.create({
      data: { pollId: id, userId: user.id, optionIndex },
    });

    return NextResponse.json({
      data: { pollId: id, voted: true },
    });
  },
);
