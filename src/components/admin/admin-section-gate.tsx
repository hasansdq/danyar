"use client";

import * as React from "react";
import { useCan } from "@/components/messenger/use-permissions";
import { PermissionLockedNotice } from "./admin-sidebar";

/**
 * Client-side permission gate for admin section pages.
 *
 * Wraps an admin page's content. While the corresponding modular permission
 * is enabled (the default), the children render normally. When the
 * SUPERADMIN disables the feature for the current user's role, the
 * children are NOT rendered and a centered "permission denied" notice is
 * shown instead.
 *
 * Usage:
 *   <AdminSectionGate featureKey="manage_users" featureLabel="مدیریت کاربران">
 *     <UsersManager />
 *   </AdminSectionGate>
 *
 * The hook is optimistic (returns `true` while loading) so the page content
 * renders immediately on first paint and only switches to the lock notice
 * if the permission is genuinely disabled.
 */
export function AdminSectionGate({
  featureKey,
  featureLabel,
  children,
}: {
  featureKey: string;
  featureLabel: string;
  children: React.ReactNode;
}) {
  const allowed = useCan(featureKey);
  if (!allowed) {
    return <PermissionLockedNotice featureLabel={featureLabel} />;
  }
  return <>{children}</>;
}
