"use client";

import * as React from "react";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  Avatar,
  AvatarFallback,
} from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChatAvatar } from "./chat-avatar";
import { ProfileDialog } from "@/components/profile/profile-dialog";
import { ChevronDown, LogOut, User as UserIcon } from "lucide-react";
import { roleLabel } from "./persian";
import type { MessengerUser } from "./types";

/**
 * Header user menu — avatar with first letter / image + dropdown showing
 * full name, role badge, a "پروفایل" item that opens the ProfileDialog,
 * and a logout button.
 *
 * The dropdown trigger uses the local `localAvatar` mirror if set (so the
 * button updates instantly after an upload) and otherwise falls back to
 * the letter bubble (initials) for SSR / no-avatar users.
 */
export function UserMenu({ user }: { user: MessengerUser }) {
  const router = useRouter();
  // Keep the session in sync (used for the NextAuth sign-out flow).
  useSession();

  const [profileOpen, setProfileOpen] = React.useState(false);
  // Mirror of the user's avatar URL. Initially null (no avatar); updated
  // by the AvatarUploader on a successful upload/remove so the trigger
  // preview stays in sync without refetching the session.
  const [localAvatar, setLocalAvatar] = React.useState<string | null | undefined>(undefined);

  const effectiveAvatar =
    localAvatar !== undefined ? localAvatar : (user.avatar ?? null);

  const initial = (user.name || user.username || "?").trim().charAt(0).toUpperCase();

  async function handleLogout() {
    // signOut from next-auth invalidates the JWT cookie.
    await signOut({ redirect: false });
    router.replace("/login");
    router.refresh();
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 ps-1 pe-2"
            aria-label="حساب کاربری"
          >
            {effectiveAvatar ? (
              <img
                src={effectiveAvatar}
                alt={user.name || user.username}
                className="size-7 rounded-full object-cover"
              />
            ) : (
              <Avatar className="size-7">
                <AvatarFallback className="bg-primary text-primary-foreground text-xs font-bold">
                  {initial}
                </AvatarFallback>
              </Avatar>
            )}
            <span className="hidden text-sm font-medium sm:inline-block">
              {user.name || user.username}
            </span>
            <ChevronDown className="size-3.5 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="flex flex-col gap-1">
            <span className="flex items-center gap-2 font-normal">
              <ChatAvatar
                fullName={user.name || user.username}
                userId={user.id}
                avatarColor={user.avatarColor}
                avatar={effectiveAvatar}
                size="sm"
              />
              <span className="truncate font-medium">{user.name || user.username}</span>
            </span>
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <span dir="ltr" className="font-mono">
                {user.username}
              </span>
              <Badge variant="secondary" className="text-[10px]">
                {roleLabel(user.role)}
              </Badge>
            </span>
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
            پروفایل
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive focus:text-destructive focus:bg-destructive/10"
            onSelect={(e) => {
              e.preventDefault();
              void handleLogout();
            }}
          >
            <LogOut className="size-4" />
            خروج
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ProfileDialog
        open={profileOpen}
        onOpenChange={setProfileOpen}
      />
    </>
  );
}
