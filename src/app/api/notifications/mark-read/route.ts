import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/session";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// POST — mark all (or specific) notifications as read
export async function POST(req: NextRequest) {
  const user = await requireAuth();
  const body = await req.json().catch(() => ({}));
  const { id } = body;

  if (id) {
    await db.notification.updateMany({
      where: { id, userId: user.id },
      data: { isRead: true },
    });
  } else {
    await db.notification.updateMany({
      where: { userId: user.id, isRead: false },
      data: { isRead: true },
    });
  }
  return NextResponse.json({ data: { marked: true } });
}
