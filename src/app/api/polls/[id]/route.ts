import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/session";
import { apiHandler, notFound } from "@/lib/api-utils";
import { verifyMembership } from "@/lib/membership";
import { assertClassSchoolScope } from "@/lib/authz";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/polls/[id]
 *
 * Returns a single poll with vote tallies + myVote (verify membership of
 * the poll's class).
 *
 * Response shape mirrors the GET /api/polls list item:
 *  - options: string[]
 *  - optionVotes: [{ optionIndex, count }]
 *  - totalVotes: number
 *  - myVote: number | number[] | null (depending on multipleChoice)
 *  - closed: boolean
 */
export const GET = apiHandler<{ id: string }>(
  async (_req: NextRequest, ctx) => {
    const user = await requireAuth();
    const { id } = await ctx.params;
    if (!id) return notFound();

    const poll = await db.poll.findUnique({
      where: { id },
      include: {
        createdBy: {
          select: { id: true, fullName: true },
        },
      },
    });

    if (!poll) {
      return notFound("نظرسنجی یافت نشد");
    }

    // Verify the requester is a member of the poll's class.
    const membership = await verifyMembership(user.id, poll.classId);
    if (!membership && user.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // SECURITY (school scoping): an ADMIN (principal) without membership may
    // only read polls of classes in their OWN school.
    if (!membership && user.role === "ADMIN") {
      const scopeError = await assertClassSchoolScope(user, poll.classId);
      if (scopeError) return scopeError;
    }

    // Fetch all votes for this poll.
    const votes = await db.pollVote.findMany({
      where: { pollId: id },
      select: { userId: true, optionIndex: true },
    });

    const byOption = new Map<number, number>();
    let total = 0;
    const myVoteIndexes: number[] = [];
    for (const v of votes) {
      byOption.set(v.optionIndex, (byOption.get(v.optionIndex) ?? 0) + 1);
      total += 1;
      if (v.userId === user.id) {
        myVoteIndexes.push(v.optionIndex);
      }
    }

    let options: string[] = [];
    try {
      const parsed = JSON.parse(poll.options);
      if (Array.isArray(parsed)) options = parsed.map((o: unknown) => String(o));
    } catch {
      options = [];
    }
    const optionVotes = options.map((_, idx) => ({
      optionIndex: idx,
      count: byOption.get(idx) ?? 0,
    }));

    let myVote: number | number[] | null;
    if (poll.multipleChoice) {
      myVote = myVoteIndexes;
    } else {
      myVote = myVoteIndexes.length > 0 ? myVoteIndexes[0] : null;
    }

    return NextResponse.json({
      data: {
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
        totalVotes: total,
        myVote,
      },
    });
  },
);
