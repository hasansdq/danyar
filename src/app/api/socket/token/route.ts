import { NextResponse } from "next/server";
import { getApiUser } from "@/lib/api-auth";
import { signSocketToken } from "@/lib/socket-token";

export const dynamic = "force-dynamic";

/**
 * GET /api/socket/token
 *
 * Issues a short-lived (5 min) HS256 JWT that the socket.io mini-services
 * (chat-service :3003, classroom-service :3004) verify with the shared
 * SOCKET_AUTH_SECRET. Only users with a valid NextAuth session receive a
 * token — this is what makes socket.io identity spoofing impossible
 * (the old scheme trusted a client-provided userId).
 *
 * SECURITY: the token itself is never logged; it expires in 5 minutes; it is
 * only usable over the socket handshake (aud=daniyar-socket).
 */
export async function GET() {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { token, expiresIn } = signSocketToken({
    id: user.id,
    role: user.role,
    username: user.username,
    schoolId: user.schoolId ?? null,
  });

  const res = NextResponse.json({ token, expiresIn });
  // Never cache the token in shared caches.
  res.headers.set("Cache-Control", "no-store");
  return res;
}
