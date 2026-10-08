import webpush from "web-push";
import { db } from "@/lib/db";

// Configure web-push with VAPID keys from environment.
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || "";
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || "";
const vapidSubject = process.env.VAPID_SUBJECT || "mailto:admin@danyar.app";

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
}

export function getVapidPublicKey(): string {
  return vapidPublicKey;
}

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  icon?: string;
  badge?: string;
  tag?: string;
};

/**
 * Send a push notification to ALL of a user's subscribed devices.
 * Also creates an in-app Notification record.
 */
export async function sendNotificationToUser(
  userId: string,
  payload: PushPayload,
): Promise<{ sent: number; failed: number }> {
  // 1. Create in-app notification record.
  await db.notification.create({
    data: {
      userId,
      type: payload.tag || "message",
      title: payload.title,
      body: payload.body,
      url: payload.url,
    },
  });

  // 2. Send push to all subscribed devices.
  const subs = await db.pushSubscription.findMany({
    where: { userId },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });

  if (subs.length === 0) return { sent: 0, failed: 0 };

  const pushPayload = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url || "/",
    icon: payload.icon || "/logo.svg",
    badge: payload.badge || "/logo.svg",
    tag: payload.tag || "default",
  });

  let sent = 0;
  let failed = 0;

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        pushPayload,
      );
      sent++;
    } catch (err: any) {
      // If the subscription is expired/gone, delete it.
      if (err.statusCode === 404 || err.statusCode === 410) {
        await db.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
      }
      failed++;
    }
  }

  return { sent, failed };
}

/**
 * Broadcast a notification to MULTIPLE users (e.g., announcement to a class).
 */
export async function broadcastNotification(
  userIds: string[],
  payload: PushPayload,
): Promise<{ totalSent: number; totalFailed: number }> {
  let totalSent = 0;
  let totalFailed = 0;
  // Deduplicate user IDs.
  const uniqueIds = [...new Set(userIds)];
  for (const userId of uniqueIds) {
    const { sent, failed } = await sendNotificationToUser(userId, payload);
    totalSent += sent;
    totalFailed += failed;
  }
  return { totalSent, totalFailed };
}
