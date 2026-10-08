import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireAuthOrRedirect } from "@/lib/session";
import { db } from "@/lib/db";
import { MessengerApp } from "@/components/messenger/messenger-app";
import type { Role } from "@/components/messenger/types";

export const dynamic = "force-dynamic";

/**
 * Main messenger page (server component).
 *
 * - If not authenticated: redirect to /login (handled by `requireAuthOrRedirect`).
 * - If role === "SUPERADMIN": redirect to /superadmin (superadmin panel).
 * - Otherwise (STUDENT / TEACHER / ADMIN): render the messenger client app.
 *
 * ADMIN (school principal) accesses BOTH the /admin principal panel AND
 * this messenger at /. The "مدیریت گفتگوها" section in /admin/bulk-chat
 * deep-links into a class chat via `/?classId=<id>` so the principal can
 * read/send messages in any of their school's classes without first being
 * enrolled as a TEACHER/STUDENT member there.
 *
 * MessengerApp uses `useSearchParams` (to read the `classId` deep-link
 * param) which forces us to wrap it in a <Suspense> boundary per Next.js 16
 * requirements.
 */
export default async function Home() {
  const user = await requireAuthOrRedirect();

  if (user.role === "SUPERADMIN") {
    redirect("/superadmin");
  }

  // Pull the user's avatarColor + avatar + schoolId from the DB (the
  // NextAuth session currently carries schoolId but not avatarColor / the
  // uploaded-avatar URL). Falls back to null when unset.
  const dbUser = await db.user.findUnique({
    where: { id: user.id },
    select: { avatarColor: true, avatar: true, schoolId: true },
  });

  // Fetch the school name for the "دانیار <school name>" branding.
  let schoolName: string | null = null;
  if (dbUser?.schoolId) {
    const school = await db.school.findUnique({
      where: { id: dbUser.schoolId },
      select: { name: true },
    });
    schoolName = school?.name ?? null;
  }

  // Pass only the serializable subset the client needs.
  const clientUser = {
    id: user.id,
    username: user.username,
    name: user.name ?? user.username,
    role: user.role as Role,
    avatarColor: dbUser?.avatarColor ?? null,
    avatar: dbUser?.avatar ?? null,
    schoolId: dbUser?.schoolId ?? null,
    schoolName,
  };

  return (
    <Suspense
      fallback={
        <div className="flex h-dvh items-center justify-center text-sm text-muted-foreground">
          در حال بارگذاری پیام‌رسان...
        </div>
      }
    >
      <MessengerApp user={clientUser} />
    </Suspense>
  );
}
