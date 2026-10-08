import { requireRoleOrRedirect } from "@/lib/session";
import { redirect } from "next/navigation";
import { BulkChatManager } from "@/components/admin/bulk-chat-manager";
import type { Role } from "@/components/messenger/types";

export const dynamic = "force-dynamic";

/**
 * Admin "Bulk Chat Management" page (server component).
 *
 * - Enforces ADMIN role (redirects to /login or / if not admin).
 * - Passes a serializable client-safe user object to the client component.
 */
export default async function AdminBulkChatPage() {
  const user = await requireRoleOrRedirect("ADMIN").catch(() => {
    // requireRoleOrRedirect already redirects on failure; defensive fallback.
    redirect("/login");
  });

  if (!user) {
    redirect("/login");
  }

  const clientUser = {
    id: user.id,
    username: user.username,
    name: user.name ?? user.username,
    role: user.role as Role,
    schoolId: (user as { schoolId?: string | null }).schoolId ?? null,
  };

  return <BulkChatManager user={clientUser} />;
}
