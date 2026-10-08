"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Building2,
  KeyRound,
  Crown,
  ScrollText,
  Settings,
  Boxes,
  Bot,
  Bell,
  ServerCog,
  LogIn,
  MessageSquareDot,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface SuperAdminNavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

export const SUPERADMIN_NAV: SuperAdminNavItem[] = [
  { href: "/superadmin", label: "داشبورد", icon: LayoutDashboard },
  { href: "/superadmin/users", label: "کاربران", icon: Users },
  { href: "/superadmin/schools", label: "مدارس", icon: Building2 },
  { href: "/superadmin/permissions", label: "دسترسی نقش‌ها", icon: KeyRound },
  { href: "/superadmin/login-settings", label: "مدیریت ورود کاربر", icon: LogIn },
  { href: "/superadmin/otp", label: "مدیریت OTP", icon: MessageSquareDot },
  { href: "/superadmin/modules", label: "ماژول‌ها", icon: Boxes },
  { href: "/superadmin/ai-provider", label: "ارائه‌دهنده هوش مصنوعی", icon: ServerCog },
  { href: "/superadmin/ai-settings", label: "تنظیمات دستیار", icon: Bot },
  { href: "/superadmin/notifications", label: "پوش نوتیفیکیشن", icon: Bell },
  { href: "/superadmin/settings", label: "تنظیمات سایت", icon: Settings },
];

export function getSuperAdminPageTitle(pathname: string): string {
  const exact = SUPERADMIN_NAV.find((n) => n.href === pathname);
  if (exact) return exact.label;
  const dyn = SUPERADMIN_NAV.find(
    (n) => n.href !== "/superadmin" && pathname.startsWith(n.href + "/"),
  );
  if (dyn) return dyn.label;
  if (pathname === "/superadmin") return "داشبورد";
  return "پنل مدیر کل";
}

interface SuperAdminSidebarNavProps {
  onNavigate?: () => void;
  className?: string;
}

export function SuperAdminSidebarNav({
  onNavigate,
  className,
}: SuperAdminSidebarNavProps) {
  const pathname = usePathname();

  return (
    <nav
      className={cn("flex flex-col gap-1 p-3", className)}
      aria-label="منوی پنل مدیر کل"
    >
      {SUPERADMIN_NAV.map((item) => {
        const isActive =
          pathname === item.href ||
          (item.href !== "/superadmin" && pathname.startsWith(item.href));
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-emerald-600 text-white shadow-sm"
                : "text-foreground hover:bg-muted hover:text-emerald-500",
            )}
            aria-current={isActive ? "page" : undefined}
          >
            <Icon className="size-4 shrink-0" />
            <span>{item.label}</span>
          </Link>
        );
      })}

      <div className="mt-4 border-t border-border pt-4">
        <Link
          href="/"
          onClick={onNavigate}
          className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ScrollText className="size-4 shrink-0" />
          <span>بازگشت به سایت</span>
        </Link>
      </div>
    </nav>
  );
}

/**
 * Branding block used at the top of the sidebar / mobile sheet header.
 * Distinct from main app — Crown + emerald accent on slate.
 */
export function SuperAdminBrand() {
  return (
    <div className="flex h-16 items-center gap-2 border-b border-border px-4">
      <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-sm">
        <Crown className="size-5" />
      </div>
      <div className="flex flex-col">
        <span className="text-base font-bold leading-none text-foreground">
          دانیار
        </span>
        <span className="text-[10px] text-muted-foreground">
          مدیر کل سامانه
        </span>
      </div>
    </div>
  );
}
