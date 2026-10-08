import { NextResponse, type NextRequest } from "next/server";
import { requireSuperAdminApi } from "@/lib/api-auth";
import { audit, AuditActions } from "@/lib/audit";
import { db } from "@/lib/db";
import { sendNotificationToUser, type PushPayload } from "@/lib/push-notifications";

export const dynamic = "force-dynamic";

// POST — superadmin sends a push notification to a specific user or all users of a role/school
export async function POST(req: NextRequest) {
  const auth = await requireSuperAdminApi();
  if (auth.response) return auth.response;

  const body = await req.json();
  const { title, body: message, url, target, userId, role, schoolId } = body;

  if (!title || !message) {
    return NextResponse.json({ error: "title و body الزامی است" }, { status: 400 });
  }

  const payload: PushPayload = {
    title,
    body: message,
    url: url || "/",
    tag: "admin_broadcast",
  };

  let userIds: string[] = [];

  if (target === "user" && userId) {
    userIds = [userId];
  } else if (target === "role" && role) {
    const users = await db.user.findMany({
      where: { role },
      select: { id: true },
    });
    userIds = users.map((u) => u.id);
  } else if (target === "school" && schoolId) {
    const users = await db.user.findMany({
      where: { schoolId },
      select: { id: true },
    });
    userIds = users.map((u) => u.id);
  } else if (target === "all") {
    const users = await db.user.findMany({ select: { id: true } });
    userIds = users.map((u) => u.id);
  } else {
    return NextResponse.json({ error: "هدف ارسال نامعتبر است" }, { status: 400 });
  }

  let totalSent = 0;
  let totalFailed = 0;
  for (const uid of userIds) {
    const { sent, failed } = await sendNotificationToUser(uid, payload);
    totalSent += sent;
    totalFailed += failed;
  }

  // AUDIT: platform-wide push broadcast.
  await audit({
    actor: { id: auth.user.id, username: auth.user.username, role: auth.user.role, schoolId: auth.user.schoolId ?? null },
    action: AuditActions.PUSH_BROADCAST,
    req,
    meta: { target, totalUsers: userIds.length, totalSent, totalFailed },
  });

  return NextResponse.json({
    data: {
      totalUsers: userIds.length,
      totalSent,
      totalFailed,
    },
  });
}
