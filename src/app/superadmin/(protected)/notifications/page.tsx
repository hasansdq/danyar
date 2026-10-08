import { requireSuperAdminOrRedirect } from "@/lib/session";
import { NotificationsManager } from "@/components/superadmin/notifications-manager";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  await requireSuperAdminOrRedirect();
  return <NotificationsManager />;
}
