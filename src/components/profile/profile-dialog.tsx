"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { fetchMyProfile } from "@/lib/messenger-api";
import { AvatarUploader } from "./avatar-uploader";
import type { MyProfile } from "@/components/messenger/types";

/**
 * Profile dialog — opened from the user menu in any panel (messenger,
 * admin, superadmin). Fetches the user's full profile from
 * `GET /api/user/me` (the NextAuth session endpoint doesn't carry the
 * `avatar` field), shows a large avatar preview + uploader + the user's
 * basic info (fullName / username / role), and closes on demand.
 *
 * The dialog is uncontrolled-open via the `open` / `onOpenChange` props so
 * parents can wire it to a dropdown-item "پروفایل" entry without holding
 * extra state themselves.
 *
 * TanStack Query is used for the profile fetch (`my-profile` query key) and
 * invalidated after a successful upload / remove so a re-open shows the new
 * avatar immediately. We also keep a local-state mirror (`localAvatar`) so
 * the preview updates instantly without waiting for refetch.
 */
function roleLabel(role: string): string {
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

export function ProfileDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useQuery<MyProfile>({
    queryKey: ["my-profile"],
    queryFn: () => fetchMyProfile(),
    enabled: open,
    staleTime: 60 * 1000,
  });

  // Optimistic local mirror — set on upload / remove so the preview
  // updates immediately. Reset to undefined whenever the dialog opens
  // for a fresh fetch.
  const [localAvatar, setLocalAvatar] = React.useState<string | null | undefined>(undefined);

  React.useEffect(() => {
    if (open) {
      setLocalAvatar(undefined);
    }
  }, [open]);

  const effectiveAvatar =
    localAvatar !== undefined ? localAvatar : (data?.avatar ?? null);

  function handleAvatarUpdated(avatar: string | null) {
    setLocalAvatar(avatar);
    // Invalidate the cached profile + classes (so messenger list refreshes
    // the avatar if it's shown there) without blocking the UI on the refetch.
    void queryClient.invalidateQueries({ queryKey: ["my-profile"] });
    void queryClient.invalidateQueries({ queryKey: ["classes"] });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>پروفایل</DialogTitle>
          <DialogDescription className="sr-only">
            مشاهده و ویرایش تصویر پروفایل
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <span>در حال بارگذاری پروفایل…</span>
          </div>
        ) : isError ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-center text-sm text-destructive">
            {(error as Error)?.message || "بارگذاری پروفایل ناموفق بود."}
          </div>
        ) : data ? (
          <div className="flex flex-col gap-5">
            <AvatarUploader
              currentAvatar={effectiveAvatar}
              fullName={data.fullName || data.username}
              onUpdated={handleAvatarUpdated}
            />

            {/* User info card */}
            <div className="rounded-lg border bg-muted/30 p-3">
              <dl className="grid grid-cols-1 gap-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted-foreground">نام و نام خانوادگی</dt>
                  <dd className="font-medium">{data.fullName}</dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted-foreground">نام کاربری</dt>
                  <dd dir="ltr" className="font-mono text-xs">
                    {data.username}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted-foreground">نقش</dt>
                  <dd>
                    <Badge variant="secondary" className="text-[10px]">
                      {roleLabel(data.role)}
                    </Badge>
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            بستن
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
