import { redirect } from "next/navigation";
import { requireRoleOrRedirect } from "@/lib/session";
import { db } from "@/lib/db";
import { SidebarNav } from "@/components/admin/admin-sidebar";
import { AdminTopbar } from "@/components/admin/admin-topbar";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireRoleOrRedirect("ADMIN").catch(() => {
    redirect("/login");
  });

  if (!user) {
    redirect("/login");
  }

  // Fetch the school name for the "دانیار <schoolName>" branding.
  let schoolName: string | null = null;
  const dbUser = await db.user.findUnique({
    where: { id: user.id },
    select: { schoolId: true },
  });
  if (dbUser?.schoolId) {
    const school = await db.school.findUnique({
      where: { id: dbUser.schoolId },
      select: { name: true },
    });
    schoolName = school?.name ?? null;
  }

  return (
    <div className="bg-background text-foreground flex min-h-screen flex-col">
      <div className="flex flex-1 flex-col md:flex-row">
        {/* Desktop sidebar — right side in RTL (first child = start) */}
        <aside className="bg-sidebar text-sidebar-foreground hidden w-64 shrink-0 border-l md:block">
          <div className="flex h-16 items-center gap-2 border-b px-4">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold">
              د
            </div>
            <div className="flex flex-col">
              <span className="text-base font-bold leading-none">
                دانیار
              </span>
              <span className="text-muted-foreground text-[10px]">
                {schoolName ?? "سامانه آموزشی"}
              </span>
            </div>
          </div>
          <SidebarNav />
        </aside>

        {/* Main content area: topbar + page content */}
        <div className="flex min-w-0 flex-1 flex-col">
          <AdminTopbar schoolName={schoolName} />
          <main className="flex-1 overflow-x-hidden p-4 sm:p-6">
            <div className="mx-auto w-full max-w-7xl">{children}</div>
          </main>
        </div>
      </div>

      <footer className="bg-background mt-auto border-t px-4 py-3 text-center">
        <p className="text-muted-foreground text-xs">
          سامانه پیام‌رسان معلم — پنل مدیریت © {new Date().getFullYear()}
        </p>
      </footer>
    </div>
  );
}
