import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/session";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// POST — subscribe to push notifications
export async function POST(req: NextRequest) {
  const user = await requireAuth();
  const body = await req.json();
  const { endpoint, p256dh, auth, userAgent } = body;

  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: "Missing subscription fields" }, { status: 400 });
  }

  // SECURITY (subscription hijack): the upsert below is keyed on the
  // client-supplied `endpoint` and would silently re-assign an existing
  // subscription (and its keys) to a different user — reject when the
  // endpoint is already owned by someone else.
  const existingSub = await db.pushSubscription.findUnique({
    where: { endpoint },
  });
  if (existingSub && existingSub.userId !== user.id) {
    return NextResponse.json(
      { error: "این اشتراک متعلق به کاربر دیگری است" },
      { status: 409 },
    );
  }

  await db.pushSubscription.upsert({
    where: { endpoint },
    update: { userId: user.id, p256dh, auth, userAgent },
    create: { userId: user.id, endpoint, p256dh, auth, userAgent },
  });

  return NextResponse.json({ data: { subscribed: true } });
}

// DELETE — unsubscribe
export async function DELETE() {
  const user = await requireAuth();
  await db.pushSubscription.deleteMany({ where: { userId: user.id } });
  return NextResponse.json({ data: { subscribed: false } });
}
