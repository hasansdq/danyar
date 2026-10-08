import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET — list user's notifications (unread first, then recent read)
export async function GET() {
  const user = await requireAuth();
  const notifications = await db.notification.findMany({
    where: { userId: user.id },
    orderBy: [{ isRead: "asc" }, { createdAt: "desc" }],
    take: 50,
  });
  return NextResponse.json({ data: notifications });
}
