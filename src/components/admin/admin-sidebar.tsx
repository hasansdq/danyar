"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Megaphone,
  Users,
  School,
  ClipboardList,
  FileQuestion,
  GraduationCap,
  ScrollText,
  MessagesSquare,
  ClipboardCheck,
  Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

export const ADMIN_NAV: NavItem[] = [
  { href: "/admin", label: "داشبورد", icon: LayoutDashboard },
  { href: "/admin/announcements", label: "اطلاعیه‌ها", icon: Megaphone },
  { href: "/admin/users", label: "کاربران", icon: Users },
  { href: "/admin/classes", label: "کلاس‌ها", icon: School },
  { href: "/admin/assignments", label: "تکالیف", icon: ClipboardList },
  { href: "/admin/sample-questions", label: "نمونه سوالات", icon: FileQuestion },
  { href: "/admin/grades", label: "نمرات", icon: GraduationCap },
  { href: "/admin/attendance", label: "حضور و غیاب", icon: ClipboardCheck },
  { href: "/admin/bulk-chat", label: "مدیریت گفتگوها", icon: MessagesSquare },
];

export function getPageTitle(pathname: string): string {
  const exact = ADMIN_NAV.find((n) => n.href === pathname);
  if (exact) return exact.label;
  // Match dynamic sub-routes (e.g. /admin/classes/123)
  const dyn = ADMIN_NAV.find(
    (n) => n.href !== "/admin" && pathname.startsWith(n.href + "/"),
  );
  if (dyn) return dyn.label;
  if (pathname === "/admin") return "داشبورد";
  return "پنل مدیریت";
}

interface SidebarNavProps {
  onNavigate?: () => void;
  className?: string;
}

export function SidebarNav({ onNavigate, className }: SidebarNavProps) {
  const pathname = usePathname();

  return (
    <nav className={cn("flex flex-col gap-1 p-3", className)} aria-label="منوی مدیریت">
      {ADMIN_NAV.map((item) => {
        const isActive =
          pathname === item.href ||
          (item.href !== "/admin" && pathname.startsWith(item.href));
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-foreground hover:bg-accent hover:text-accent-foreground",
            )}
            aria-current={isActive ? "page" : undefined}
          >
            <Icon className="size-4 shrink-0" />
            <span>{item.label}</span>
          </Link>
        );
      })}
      <div className="mt-4 border-t pt-4">
        <Link
          href="/"
          onClick={onNavigate}
          className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <ScrollText className="size-4 shrink-0" />
          <span>بازگشت به پیام‌رسان</span>
        </Link>
      </div>
    </nav>
  );
}

interface PermissionLockedNoticeProps {
  featureLabel: string;
  className?: string;
}

/**
 * Notice shown by <AdminSectionGate /> when the SUPERADMIN has disabled the
 * modular permission for the current user's role: a centered card with a lock
 * icon explaining that the section is unavailable, without leaking any of the
 * section's content.
 */
export function PermissionLockedNotice({
  featureLabel,
  className,
}: PermissionLockedNoticeProps) {
  return (
    <div
      className={cn(
        "flex min-h-[50vh] items-center justify-center p-6",
        className,
      )}
      role="alert"
    >
      <div className="w-full max-w-md rounded-lg border bg-card text-card-foreground shadow-sm">
        <div className="flex flex-col items-center gap-3 p-6 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-600">
            <Lock className="size-6" />
          </span>
          <h2 className="text-base font-semibold">
            دسترسی به «{featureLabel}» محدود شده است
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            این بخش توسط مدیر کل پلتفرم برای نقش شما غیرفعال شده است. در صورت
            نیاز، از مدیر کل مدرسه بخواهید تا دسترسی این قابلیت را فعال کند.
          </p>
        </div>
      </div>
    </div>
  );
}
