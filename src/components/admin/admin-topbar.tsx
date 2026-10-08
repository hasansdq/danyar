"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import {
  LogOut,
  Menu,
  MessagesSquare,
  MessageCircleOff,
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
import { SidebarNav, getPageTitle } from "@/components/admin/admin-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { ProfileDialog } from "@/components/profile/profile-dialog";
import { DMSettingsDialog } from "@/components/admin/dm-settings-dialog";
import { AIAssistantButton } from "@/components/messenger/ai-assistant-button";

function roleLabel(role?: string) {
  switch (role) {
    case "SUPERADMIN":
      return "مدیر کل";
    case "ADMIN":
      return "مدیر مدرسه";
    case "TEACHER":
      return "معلم";
    case "STUDENT":
      return "دانش‌آموز";
    default:
      return role || "کاربر";
  }
}

function initials(name?: string | null) {
  if (!name) return "؟";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2);
  return (parts[0][0] || "") + (parts[1][0] || "");
}

export function AdminTopbar({ schoolName }: { schoolName?: string | null }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [profileOpen, setProfileOpen] = React.useState(false);
  // DM-settings dialog (principal-only). The button is shown only for
  // ADMIN (school principal). SUPERADMIN won't see the button here.
  const [dmSettingsOpen, setDmSettingsOpen] = React.useState(false);

  const pageTitle = getPageTitle(pathname);
  const user = session?.user;
  const userName = user?.name || "مدیر";
  const isPrincipal = user?.role === "ADMIN";

  return (
    <header className="bg-background/95 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-30 flex h-16 items-center justify-between gap-2 border-b px-4 backdrop-blur">
      {/* Right side (start in RTL): hamburger (mobile) + title */}
      <div className="flex items-center gap-2">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              aria-label="باز کردن منو"
            >
              <Menu className="size-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-72 p-0">
            <SheetHeader className="border-b">
              <SheetTitle className="text-right">
                <span className="flex flex-col">
                  <span className="text-base font-bold">دانیار</span>
                  <span className="text-xs font-normal text-muted-foreground">{schoolName ?? "سامانه آموزشی"}</span>
                </span>
              </SheetTitle>
            </SheetHeader>
            <SidebarNav onNavigate={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>
        <h1 className="text-lg font-semibold sm:text-xl">{pageTitle}</h1>
      </div>

      {/* Left side (end in RTL): DM-settings (principal only) + theme + user menu */}
      <div className="flex items-center gap-2">
        {isPrincipal ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-9"
            onClick={() => setDmSettingsOpen(true)}
            aria-label="تنظیمات چت خصوصی"
            title="تنظیمات چت خصوصی"
          >
            <MessageCircleOff className="size-4" />
          </Button>
        ) : null}
        <ThemeToggle className="size-9" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="flex items-center gap-2 px-2 py-1"
              aria-label="منوی کاربر"
            >
              <Avatar className="size-8">
                <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                  {initials(userName)}
                </AvatarFallback>
              </Avatar>
              <div className="hidden flex-col items-start gap-0 sm:flex">
                <span className="text-sm font-medium leading-none">
                  {userName}
                </span>
                <Badge
                  variant="secondary"
                  className="mt-1 gap-1 px-1.5 py-0 text-[10px]"
                >
                  <ShieldCheck className="size-3" />
                  {roleLabel(user?.role)}
                </Badge>
              </div>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel className="flex flex-col gap-1">
              <span className="text-sm font-medium">{userName}</span>
              {user?.username && (
                <span className="text-muted-foreground text-xs">
                  {user.username}
                </span>
              )}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                setProfileOpen(true);
              }}
              className="flex items-center gap-2"
            >
              <UserIcon className="size-4" />
              <span>پروفایل</span>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/" className="flex items-center gap-2">
                <MessagesSquare className="size-4" />
                <span>بازگشت به پیام‌رسان</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="flex items-center gap-2"
            >
              <LogOut className="size-4" />
              <span>خروج از حساب</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ProfileDialog open={profileOpen} onOpenChange={setProfileOpen} />
      {isPrincipal ? (
        <DMSettingsDialog
          open={dmSettingsOpen}
          onOpenChange={setDmSettingsOpen}
        />
      ) : null}
      {/* AI assistant FAB — only renders for principals + super-admins
          (the component gates itself on role + the ai_assistant permission
          toggle, so mounting it unconditionally is safe — non-principal
          admins render nothing). The admin layout doesn't open chats, so
          we never hide it here. */}
      <AIAssistantButton
        user={{
          id: user?.id ?? "",
          username: user?.username ?? "",
          name: userName,
          role: (user?.role ?? "ADMIN") as
            | "STUDENT"
            | "TEACHER"
            | "ADMIN"
            | "SUPERADMIN",
        }}
        adminMode
      />
    </header>
  );
}
