import { LoginSettingsManager } from "@/components/superadmin/login-settings-manager";

export const dynamic = "force-dynamic";

/**
 * /superadmin/login-settings — «مدیریت ورود کاربر».
 *
 * SUPERADMIN-only page (auth-gated by the (protected) layout) that manages:
 *  - password login on/off (platform-wide),
 *  - SMS login on/off (platform-wide),
 *  - TEST-MODE code display on/off (default on),
 *  - the superadmin's SMS login phone (default 0913652461).
 *
 * Thin server component — all query/optimistic-toggle logic lives in
 * {@link LoginSettingsManager}.
 */
export default function SuperAdminLoginSettingsPage() {
  return <LoginSettingsManager />;
}
