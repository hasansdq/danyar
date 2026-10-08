import { requireSuperAdminOrRedirect } from "@/lib/session";
import { SuperAdminBrand, SuperAdminSidebarNav } from "@/components/superadmin/superadmin-sidebar";
import { SuperAdminTopbar } from "@/components/superadmin/superadmin-topbar";

export const dynamic = "force-dynamic";

/**
 * Auth-gated layout for the SUPERADMIN panel.
 *
 * Calls `requireSuperAdminOrRedirect()` which:
 *   - Redirects to /login if not authenticated
 *   - Redirects to /superadmin/login if authenticated but not SUPERADMIN
 *   - Returns the session user otherwise
 *
 * This is a ROUTE GROUP (`(protected)`) so the URLs remain
 *   /superadmin, /superadmin/users, /superadmin/classes, etc.
 * while the login page lives at /superadmin/login OUTSIDE this layout
 * (uses the root layout only) — avoiding the redirect loop that would
 * occur if the login page itself were auth-gated.
 *
 * Distinct dark slate + emerald shell separates the SUPERADMIN panel
 * visually from the main app and the admin panel.
 */
export default async function SuperAdminProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireSuperAdminOrRedirect();

  return (
    <div className="bg-background text-foreground flex min-h-screen flex-col">
      <div className="flex flex-1 flex-col md:flex-row">
        {/* Desktop sidebar — right side in RTL (first child = start) */}
        <aside className="hidden w-64 shrink-0 border-l border-sidebar-border bg-sidebar text-sidebar-foreground md:block">
          <SuperAdminBrand />
          <SuperAdminSidebarNav />
        </aside>

        {/* Main content area: topbar + page content */}
        <div className="flex min-w-0 flex-1 flex-col">
          <SuperAdminTopbar />
          <main className="flex-1 overflow-x-hidden p-4 sm:p-6">
            <div className="mx-auto w-full max-w-7xl">
              {/* Pass the user info as a small banner context for client children */}
              <div
                data-superadmin-user-id={user.id}
                data-superadmin-user-name={user.name ?? ""}
                data-superadmin-user-username={user.username ?? ""}
              >
                {children}
              </div>
            </div>
          </main>
        </div>
      </div>

      <footer className="mt-auto border-t border-border bg-background px-4 py-3 text-center">
        <p className="text-xs text-muted-foreground">
          سامانه پیام‌رسان معلم — پنل مدیر کل © {new Date().getFullYear()}
        </p>
      </footer>
    </div>
  );
}
