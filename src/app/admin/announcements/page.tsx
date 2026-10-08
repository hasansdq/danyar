import { requireRoleOrRedirect } from "@/lib/session";
import { redirect } from "next/navigation";
import { AnnouncementsManager } from "@/components/admin/announcements-manager";
import type { Role } from "@/components/messenger/types";

export const dynamic = "force-dynamic";

export default async function AdminAnnouncementsPage() {
  const user = await requireRoleOrRedirect("ADMIN").catch(() => {
    redirect("/login");
  });
  if (!user) redirect("/login");

  const clientUser = {
    id: user.id,
    username: user.username,
    name: user.name ?? user.username,
    role: user.role as Role,
    schoolId: (user as { schoolId?: string | null }).schoolId ?? null,
  };

  return <AnnouncementsManager user={clientUser} />;
}
