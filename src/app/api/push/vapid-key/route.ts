import { NextResponse } from "next/server";
import { getVapidPublicKey } from "@/lib/push-notifications";

export const dynamic = "force-dynamic";

// GET — public VAPID key for the browser to subscribe
export async function GET() {
  const key = getVapidPublicKey();
  if (!key) return NextResponse.json({ error: "VAPID not configured" }, { status: 500 });
  return NextResponse.json({ data: { publicKey: key } });
}
