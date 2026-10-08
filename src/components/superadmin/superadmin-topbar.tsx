"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import {
  Crown,
  LogOut,
  Menu,
  ShieldCheck,
  User as UserIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  SuperAdminBrand,
  SuperAdminSidebarNav,
  getSuperAdminPageTitle,
} from "@/components/superadmin/superadmin-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { ProfileDialog } from "@/components/profile/profile-dialog";

function initials(name?: string | null) {
  if (!name) return "؟";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2);
  return (parts[0][0] || "") + (parts[1][0] || "");
}

/**
 * Sticky top bar for the SUPERADMIN shell.
 * Distinct from main app: dark slate background, emerald accent.
 */
export function SuperAdminTopbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [profileOpen, setProfileOpen] = React.useState(false);

  const pageTitle = getSuperAdminPageTitle(pathname);
  const user = session?.user;
  const userName = user?.name || "مدیر کل";

  async function handleLogout() {
    // Sign out and redirect to the superadmin login (NOT the main /login).
    await signOut({ redirect: false });
    router.replace("/superadmin/login");
    router.refresh();
  }

  return (
    <header className="bg-background/95 supports-[backdrop-filter]:bg-background/70 sticky top-0 z-30 flex h-16 items-center justify-between gap-2 border-b border-border px-4 backdrop-blur">
      {/* Right side (start in RTL): hamburger (mobile) + brand + page title */}
      <div className="flex items-center gap-3">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden text-foreground hover:bg-muted hover:text-emerald-500"
              aria-label="باز کردن منو"
            >
              <Menu className="size-5" />
            </Button>
          </SheetTrigger>
          <SheetContent
            side="right"
            className="bg-background border-border w-72 p-0 text-foreground"
          >
            <SheetHeader className="border-b border-border">
              <SheetTitle className="text-right text-foreground">
                <SuperAdminBrand />
              </SheetTitle>
            </SheetHeader>
            <SuperAdminSidebarNav onNavigate={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>

        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-600/15 text-emerald-500 ring-1 ring-emerald-500/30 md:hidden">
            <Crown className="size-5" />
          </div>
          <h1 className="text-lg font-semibold text-foreground sm:text-xl">
            {pageTitle}
          </h1>
        </div>
      </div>

      {/* Left side (end in RTL): role pill + theme + user menu */}
      <div className="flex items-center gap-2">
        <div className="hidden items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-emerald-500 sm:flex">
          <ShieldCheck className="size-3.5" />
          <span className="text-xs font-medium">دانیار · مدیر کل</span>
        </div>

        <ThemeToggle className="size-9 text-foreground hover:bg-muted hover:text-emerald-500" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="flex items-center gap-2 px-2 py-1 text-foreground hover:bg-muted hover:text-emerald-500"
              aria-label="منوی کاربر"
            >
              <Avatar className="size-8">
                <AvatarFallback className="bg-emerald-500/15 text-emerald-500 text-xs font-semibold">
                  {initials(userName)}
                </AvatarFallback>
              </Avatar>
              <div className="hidden flex-col items-start gap-0 sm:flex">
                <span className="text-sm font-medium leading-none">
                  {userName}
                </span>
                <Badge
                  variant="outline"
                  className="mt-1 gap-1 border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0 text-[10px] text-emerald-500"
                >
                  <Crown className="size-3" />
                  مدیر کل
                </Badge>
              </div>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-56 border-border bg-card text-foreground"
          >
            <DropdownMenuLabel className="flex flex-col gap-1">
              <span className="text-sm font-medium text-foreground">
                {userName}
              </span>
              {user?.username && (
                <span className="text-xs text-muted-foreground" dir="ltr">
                  {user.username}
                </span>
              )}
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-muted" />
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                setProfileOpen(true);
              }}
              className="flex items-center gap-2 text-foreground hover:bg-muted hover:text-emerald-500"
            >
              <UserIcon className="size-4" />
              <span>پروفایل</span>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link
                href="/"
                className="flex items-center gap-2 text-foreground hover:bg-muted hover:text-emerald-500"
              >
                <UserIcon className="size-4" />
                <span>بازگشت به سایت</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-muted" />
            <DropdownMenuItem
              variant="destructive"
              onClick={handleLogout}
              className="flex items-center gap-2"
            >
              <LogOut className="size-4" />
              <span>خروج از حساب</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ProfileDialog open={profileOpen} onOpenChange={setProfileOpen} />
    </header>
  );
}
