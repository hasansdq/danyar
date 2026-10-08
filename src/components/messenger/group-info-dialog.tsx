"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import {
  Camera,
  Check,
  ChevronLeft,
  Info,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  Users,
  X,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { LazySkeleton } from "@/components/ui/lazy-skeleton";
import { useToast } from "@/hooks/use-toast";
import { ChatAvatar } from "./chat-avatar";
import { membershipRoleLabel, roleLabel, toPersianDigits } from "./persian";
import {
  deleteGroupAvatar,
  fetchGroupInfo,
  patchGroupInfo,
  searchUsers,
  uploadGroupAvatar,
} from "@/lib/messenger-api";
import { apiFetch } from "@/lib/api-fetch";
import type { GroupInfo, GroupMember, UserSearchResult } from "./types";

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

/** A combined row for the add-member search results. */
type AddCandidate = UserSearchResult & {
  /** Whether this user is already a member of the class. */
  alreadyMember: boolean;
};

/**
 * Filter + sort the candidate list by:
 *   - role: TEACHER + STUDENT only (no admins — admins are principals who
 *     have implicit access; enrolling them as members doesn't make sense)
 *   - membership: users already in the class appear first under a separate
 *     "already members" group (so the principal can see who they don't need
 *     to re-add)
 *   - search query (case-insensitive contains on name OR username)
 */
function filterAndSortCandidates(
  all: UserSearchResult[],
  members: GroupMember[],
  query: string,
): { candidates: AddCandidate[]; teachersCount: number; studentsCount: number } {
  const memberIdSet = new Set(members.map((m) => m.userId));
  const q = query.trim().toLowerCase();

  const candidates: AddCandidate[] = [];
  for (const u of all) {
    // Skip admins (principals) — they have implicit access.
    if (u.role === "ADMIN" || u.role === "SUPERADMIN") continue;
    // Only TEACHERs and STUDENTs are eligible for enrollment.
    if (u.role !== "TEACHER" && u.role !== "STUDENT") continue;
    if (q) {
      const name = (u.fullName || "").toLowerCase();
      const username = (u.username || "").toLowerCase();
      if (!name.includes(q) && !username.includes(q)) continue;
    }
    candidates.push({ ...u, alreadyMember: memberIdSet.has(u.id) });
  }

  // Sort: already-member first, then teachers (alphabetical), then students.
  candidates.sort((a, b) => {
    if (a.alreadyMember !== b.alreadyMember) return a.alreadyMember ? -1 : 1;
    if (a.role !== b.role) return a.role === "TEACHER" ? -1 : 1;
    return a.fullName.localeCompare(b.fullName, "fa");
  });

  const teachersCount = candidates.filter((c) => c.role === "TEACHER").length;
  const studentsCount = candidates.filter((c) => c.role === "STUDENT").length;
  return { candidates, teachersCount, studentsCount };
}

/* ------------------------------------------------------------------ */
/* GroupInfoDialog                                                    */
/* ------------------------------------------------------------------ */

interface GroupInfoDialogProps {
  /** The class id of the group whose info to show. */
  classId: string | null;
  /** The class name shown in the header before the fetch resolves. */
  fallbackName?: string;
  onOpenChange: (open: boolean) => void;
  /** Phase 35h — called when the user clicks a member row to start a
   * direct chat with that member. */
  onStartDirectChat?: (user: { id: string; fullName: string; username: string; role: string; avatar?: string | null }) => void;
}

export function GroupInfoDialog({
  classId,
  fallbackName,
  onOpenChange,
  onStartDirectChat,
}: GroupInfoDialogProps) {
  const open = classId !== null;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  // Phase 35h — only ADMIN (principal) + SUPERADMIN can see @usernames.
  const canSeeUsernames = session?.user?.role === "ADMIN" || session?.user?.role === "SUPERADMIN";

  // ----- Group info query (the canonical source of truth for the dialog) -----
  const {
    data: info,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<GroupInfo>({
    queryKey: ["group-info", classId],
    queryFn: () => fetchGroupInfo(classId!),
    enabled: open && !!classId,
    staleTime: 10 * 1000, // 10s — let the user re-open to refresh without spamming.
  });

  // ----- Local editing state (kept in sync with the query snapshot) -----
  // The dialog tracks a local copy of the name + description + avatar so the
  // user can edit the fields inline + see them update immediately. The PATCH
  // call returns the canonical snapshot, which we then sync back.
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [avatar, setAvatar] = React.useState<string | null>(null);
  const [editingName, setEditingName] = React.useState(false);
  const [editingDesc, setEditingDesc] = React.useState(false);
  const [savingName, setSavingName] = React.useState(false);
  const [savingDesc, setSavingDesc] = React.useState(false);
  const [avatarUploading, setAvatarUploading] = React.useState(false);
  const avatarInputRef = React.useRef<HTMLInputElement | null>(null);

  // Sync local state when the parent passes a different `info` snapshot
  // (e.g. after a successful PATCH or a refetch). Uses the React
  // "previous prop" pattern (avoids the cascading-render lint warning
  // a useEffect + setState would trigger).
  //
  // IMPORTANT: `prevInfo` tracks the EXACT value of `info` (including
  // `undefined` while the query is still resolving), NOT `info ?? null`.
  // Using `info ?? null` would cause `prevInfo` to always become `null`
  // while `info` stays `undefined`, making `info !== prevInfo` always
  // true → infinite re-render loop. By tracking the exact value, the
  // comparison only fires when `info` actually changes (undefined →
  // resolved data → null on error).
  const [prevInfo, setPrevInfo] = React.useState<GroupInfo | null | undefined>(
    info,
  );
  if (info !== prevInfo) {
    setPrevInfo(info);
    if (info) {
      setName(info.name);
      setDescription(info.description ?? "");
      setAvatar(info.avatar ?? null);
      setEditingName(false);
      setEditingDesc(false);
    }
  }

  // ----- Add-member search state -----
  const [searchQuery, setSearchQuery] = React.useState("");
  const [selectedUserIds, setSelectedUserIds] = React.useState<Set<string>>(
    new Set(),
  );
  const [enrolling, setEnrolling] = React.useState(false);

  // Fetch all users in the school (the search endpoint returns same-school
  // users when `q` is empty). We only need TEACHER + STUDENT users; admins
  // are filtered out client-side. Re-fetch only when the dialog opens —
  // closing + reopening is rare.
  const { data: allUsers, isLoading: usersLoading } = useQuery<
    UserSearchResult[]
  >({
    queryKey: ["group-info-add-candidates", classId],
    queryFn: () => searchUsers("", 100),
    enabled: open && !!classId,
    staleTime: 30 * 1000,
  });

  // Reset add-member state when the dialog closes.
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) {
      setSearchQuery("");
      setSelectedUserIds(new Set());
      setEditingName(false);
      setEditingDesc(false);
    }
  }

  const members = info?.members ?? [];
  const { candidates, teachersCount, studentsCount } = filterAndSortCandidates(
    allUsers ?? [],
    members,
    searchQuery,
  );

  // ---------- Handlers ----------

  async function handleSaveName() {
    if (!classId || !info) return;
    const trimmed = name.trim();
    if (!trimmed) {
      toast({
        title: "نام گروه خالی است",
        variant: "destructive",
      });
      return;
    }
    if (trimmed === info.name) {
      setEditingName(false);
      return;
    }
    setSavingName(true);
    try {
      const updated = await patchGroupInfo(classId, { name: trimmed });
      // Optimistic — update the canonical snapshot via queryClient so the
      // header (which reads `info`) + the conversation list also refresh.
      void queryClient.invalidateQueries({
        queryKey: ["group-info", classId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["classes", "header-refresh"],
      });
      setName(updated.name);
      setEditingName(false);
      toast({ title: "نام گروه به‌روزرسانی شد" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطای غیرمنتظره";
      toast({
        title: "به‌روزرسانی نام ناموفق بود",
        description: msg,
        variant: "destructive",
      });
      // Restore the canonical name.
      setName(info.name);
    } finally {
      setSavingName(false);
    }
  }

  async function handleSaveDescription() {
    if (!classId || !info) return;
    const trimmed = description.trim();
    if (trimmed === (info.description ?? "").trim()) {
      setEditingDesc(false);
      return;
    }
    setSavingDesc(true);
    try {
      const updated = await patchGroupInfo(classId, {
        description: trimmed || null,
      });
      void queryClient.invalidateQueries({
        queryKey: ["group-info", classId],
      });
      setDescription(updated.description ?? "");
      setEditingDesc(false);
      toast({ title: "توضیحات گروه به‌روزرسانی شد" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطای غیرمنتظره";
      toast({
        title: "به‌روزرسانی توضیحات ناموفق بود",
        description: msg,
        variant: "destructive",
      });
      setDescription(info.description ?? "");
    } finally {
      setSavingDesc(false);
    }
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the hidden input so picking the same file again re-fires onChange.
    if (avatarInputRef.current) avatarInputRef.current.value = "";
    if (!file || !classId) return;
    // Validate client-side: image only, ≤ 5 MB.
    if (!file.type.startsWith("image/")) {
      toast({
        title: "فقط تصویر مجاز است",
        variant: "destructive",
      });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "حجم تصویر بیش از حد مجاز است",
        description: "حداکثر حجم ۵ مگابایت است.",
        variant: "destructive",
      });
      return;
    }
    setAvatarUploading(true);
    try {
      const result = await uploadGroupAvatar(classId, file);
      setAvatar(result.avatar);
      void queryClient.invalidateQueries({
        queryKey: ["group-info", classId],
      });
      toast({ title: "تصویر گروه به‌روزرسانی شد" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطای غیرمنتظره";
      toast({
        title: "بارگذاری تصویر ناموفق بود",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setAvatarUploading(false);
    }
  }

  async function handleAvatarDelete() {
    if (!classId || !avatar) return;
    setAvatarUploading(true);
    try {
      await deleteGroupAvatar(classId);
      setAvatar(null);
      void queryClient.invalidateQueries({
        queryKey: ["group-info", classId],
      });
      toast({ title: "تصویر گروه حذف شد" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطای غیرمنتظره";
      toast({
        title: "حذف تصویر ناموفق بود",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setAvatarUploading(false);
    }
  }

  function toggleSelected(userId: string) {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  async function handleEnrollSelected() {
    if (!classId || selectedUserIds.size === 0) return;
    setEnrolling(true);
    // Group selected user ids by their role so we make one enroll call
    // per role (the enroll endpoint takes a single `role` per call).
    const byRole: { STUDENT: string[]; TEACHER: string[] } = {
      STUDENT: [],
      TEACHER: [],
    };
    for (const c of candidates) {
      if (!selectedUserIds.has(c.id)) continue;
      if (c.role === "STUDENT" || c.role === "TEACHER") {
        byRole[c.role].push(c.id);
      }
    }
    let total = 0;
    let failed = 0;
    for (const role of ["STUDENT", "TEACHER"] as const) {
      const userIds = byRole[role];
      if (userIds.length === 0) continue;
      try {
        await apiFetch<{ count: number }>(`/api/admin/enroll`, {
          method: "POST",
          body: JSON.stringify({ classId, userIds, role }),
        });
        total += userIds.length;
      } catch {
        failed += userIds.length;
      }
    }
    setEnrolling(false);
    setSelectedUserIds(new Set());
    if (failed === 0) {
      toast({
        title: "اعضا اضافه شدند",
        description: `${toPersianDigits(total)} کاربر به گروه اضافه شد.`,
      });
    } else {
      toast({
        title: "افزودن برخی کاربران ناموفق بود",
        description: `${toPersianDigits(total)} اضافه شد، ${toPersianDigits(failed)} ناموفق.`,
        variant: "destructive",
      });
    }
    // Refetch the group info so the members list reflects the new additions.
    void refetch();
  }

  // ---------- Render ----------

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex h-full w-full flex-col gap-0 p-0 sm:max-w-md"
      >
        <SheetHeader className="flex flex-col gap-1 border-b bg-background px-4 py-3">
          <SheetTitle className="flex items-center gap-2 text-base">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Info className="size-4" />
            </span>
            اطلاعات گروه
          </SheetTitle>
          <SheetDescription className="sr-only">
            مشاهده و ویرایش اطلاعات گروه، فهرست اعضا، و افزودن عضو جدید.
          </SheetDescription>
        </SheetHeader>

        {/* ---------- Loading / error / content ---------- */}
        <div className="scrollbar-rtl flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="space-y-3 p-4">
              <div className="flex flex-col items-center gap-2 py-4">
                <LazySkeleton className="size-24 rounded-full" />
                <LazySkeleton className="h-6 w-40" />
                <LazySkeleton className="h-3 w-56" />
              </div>
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <LazySkeleton className="size-9 rounded-full" />
                    <div className="flex flex-1 flex-col gap-1">
                      <LazySkeleton className="h-3 w-28" />
                      <LazySkeleton className="h-2 w-20" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
              <p>خطا در بارگذاری اطلاعات گروه.</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => void refetch()}
              >
                تلاش مجدد
              </Button>
              <p className="text-[10px] text-muted-foreground">
                {(error as Error)?.message || ""}
              </p>
            </div>
          ) : info ? (
            <div className="flex flex-col gap-4 p-4">
              {/* ---------- Avatar + name + description ---------- */}
              <div className="flex flex-col items-center gap-3">
                <div className="relative">
                  <ChatAvatar
                    fullName={info.name}
                    userId={info.id}
                    avatar={avatar}
                    size="lg"
                    className="size-24 text-3xl"
                  />
                  {/* Camera button to upload a new avatar. */}
                  <button
                    type="button"
                    onClick={() => avatarInputRef.current?.click()}
                    disabled={avatarUploading}
                    aria-label="بارگذاری تصویر گروه"
                    title="بارگذاری تصویر گروه"
                    className="absolute bottom-0 right-0 flex size-8 items-center justify-center rounded-full border border-border bg-background text-foreground shadow-sm transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {avatarUploading ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Camera className="size-4" />
                    )}
                  </button>
                  {/* Hidden file input for the avatar upload. */}
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={handleAvatarChange}
                    tabIndex={-1}
                    aria-hidden="true"
                  />
                </div>

                {/* Delete avatar button (only when an avatar is set). */}
                {avatar ? (
                  <button
                    type="button"
                    onClick={() => void handleAvatarDelete()}
                    disabled={avatarUploading}
                    className="inline-flex items-center gap-1 text-[11px] text-destructive hover:underline disabled:opacity-60"
                  >
                    <Trash2 className="size-3" />
                    حذف تصویر
                  </button>
                ) : null}

                {/* Group name — editable inline. */}
                {editingName ? (
                  <div className="flex w-full max-w-sm items-center gap-1.5">
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={100}
                      disabled={savingName}
                      className="h-9 text-center text-sm font-semibold"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void handleSaveName();
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          setEditingName(false);
                          setName(info.name);
                        }
                      }}
                    />
                    <Button
                      type="button"
                      size="icon"
                      className="size-9 shrink-0"
                      onClick={() => void handleSaveName()}
                      disabled={savingName || !name.trim()}
                      aria-label="ذخیره نام"
                    >
                      {savingName ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Check className="size-4" />
                      )}
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-9 shrink-0"
                      onClick={() => {
                        setEditingName(false);
                        setName(info.name);
                      }}
                      disabled={savingName}
                      aria-label="انصراف"
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditingName(true)}
                    className="group flex items-center gap-1.5 rounded-md px-2 py-1 text-center text-lg font-bold transition-colors hover:bg-accent"
                    title="ویرایش نام گروه"
                  >
                    <span dir="auto">{name || info.name}</span>
                    <Pencil className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </button>
                )}

                {/* Description — editable inline (textarea). */}
                {editingDesc ? (
                  <div className="flex w-full flex-col gap-1.5">
                    <Textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={3}
                      maxLength={500}
                      disabled={savingDesc}
                      placeholder="توضیحات گروه را بنویسید…"
                      className="resize-none text-sm"
                      autoFocus
                    />
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => {
                          setEditingDesc(false);
                          setDescription(info.description ?? "");
                        }}
                        disabled={savingDesc}
                      >
                        انصراف
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        className="h-7 gap-1 text-xs"
                        onClick={() => void handleSaveDescription()}
                        disabled={savingDesc}
                      >
                        {savingDesc ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Check className="size-3.5" />
                        )}
                        ذخیره
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditingDesc(true)}
                    className="group flex w-full max-w-sm items-start gap-1.5 rounded-md border border-dashed border-border p-2 text-right text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:bg-accent/40"
                    title="ویرایش توضیحات"
                  >
                    <Pencil className="mt-0.5 size-3 shrink-0 opacity-60" />
                    <span
                      className="flex-1 whitespace-pre-wrap break-words"
                      dir="auto"
                    >
                      {description?.trim()
                        ? description
                        : "برای افزودن توضیحات کلیک کنید…"}
                    </span>
                  </button>
                )}

                {/* Parent class badge (when this is a sub-group). */}
                {info.parentClassName ? (
                  <Badge
                    variant="secondary"
                    className="bg-muted px-2 py-0.5 text-[10px]"
                  >
                    زیرگروه {info.parentClassName}
                  </Badge>
                ) : null}
              </div>

              {/* ---------- Members list ---------- */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                    <Users className="size-4 text-primary" />
                    اعضا
                  </h3>
                  <Badge
                    variant="secondary"
                    className="bg-primary/10 text-primary px-2 py-0 text-[10px]"
                  >
                    {toPersianDigits(members.length)} نفر
                  </Badge>
                </div>
                {members.length === 0 ? (
                  <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
                    هنوز عضوی در این گروه نیست.
                  </p>
                ) : (
                  <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border p-1.5">
                    {members.map((m) => (
                      <MemberRow
                        key={m.userId}
                        member={m}
                        canSeeUsernames={canSeeUsernames}
                        onStartDirectChat={onStartDirectChat}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* ---------- Add member section ---------- */}
              <div className="flex flex-col gap-2 border-t pt-3">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                  <Plus className="size-4 text-primary" />
                  افزودن عضو
                </h3>
                <div className="relative">
                  <Search className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="جستجوی نام یا نام کاربری…"
                    className="pr-8 text-sm"
                    autoComplete="off"
                  />
                </div>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <Badge
                    variant="secondary"
                    className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-1.5 py-0 text-[9px]"
                  >
                    {toPersianDigits(teachersCount)} استاد
                  </Badge>
                  <Badge
                    variant="secondary"
                    className="bg-teal-500/10 text-teal-700 dark:text-teal-300 px-1.5 py-0 text-[9px]"
                  >
                    {toPersianDigits(studentsCount)} دانش‌آموز
                  </Badge>
                  {selectedUserIds.size > 0 ? (
                    <span className="text-primary">
                      {toPersianDigits(selectedUserIds.size)} انتخاب شده
                    </span>
                  ) : null}
                </div>

                {usersLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <LazySkeleton className="size-9 rounded-full" />
                        <div className="flex flex-1 flex-col gap-1">
                          <LazySkeleton className="h-3 w-24" />
                          <LazySkeleton className="h-2 w-16" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : candidates.length === 0 ? (
                  <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
                    {searchQuery
                      ? "نتیجه‌ای یافت نشد."
                      : "هیچ کاربر قابل افزودنی وجود ندارد."}
                  </p>
                ) : (
                  <div className="max-h-96 space-y-1 overflow-y-auto rounded-md border p-1.5">
                    {candidates.map((c) => {
                      const checked = selectedUserIds.has(c.id);
                      return (
                        <label
                          key={c.id}
                          className={`flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-right transition-colors ${
                            checked
                              ? "border-primary bg-primary/5"
                              : c.alreadyMember
                                ? "border-transparent bg-muted/40 opacity-70"
                                : "border-transparent hover:bg-accent/40"
                          }`}
                        >
                          <Checkbox
                            checked={checked}
                            disabled={c.alreadyMember}
                            onCheckedChange={() => toggleSelected(c.id)}
                          />
                          <ChatAvatar
                            fullName={c.fullName}
                            userId={c.id}
                            avatar={c.avatar}
                            size="sm"
                            className="size-8"
                          />
                          <div className="flex min-w-0 flex-1 flex-col">
                            <span
                              className="truncate text-sm font-medium"
                              dir="auto"
                            >
                              {c.fullName}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              {roleLabel(c.role)}
                              {canSeeUsernames && c.username ? ` · @${c.username}` : ""}
                            </span>
                          </div>
                          {c.alreadyMember ? (
                            <Badge
                              variant="secondary"
                              className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-1.5 py-0 text-[9px]"
                            >
                              عضو
                            </Badge>
                          ) : null}
                        </label>
                      );
                    })}
                  </div>
                )}

                {/* Enroll button (only when there are selections). */}
                {selectedUserIds.size > 0 ? (
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 w-full gap-1.5 text-xs"
                    onClick={() => void handleEnrollSelected()}
                    disabled={enrolling}
                  >
                    {enrolling ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Plus className="size-3.5" />
                    )}
                    افزودن انتخابی‌ها ({toPersianDigits(selectedUserIds.size)} نفر)
                  </Button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
              <p>اطلاعات گروه در دسترس نیست.</p>
              {fallbackName ? (
                <p className="text-xs">گروه: {fallbackName}</p>
              ) : null}
            </div>
          )}
        </div>

        {/* ---------- Footer (close button — mobile sticky) ---------- */}
        <div className="border-t bg-background px-4 py-2.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 w-full gap-1.5 text-sm"
            onClick={() => onOpenChange(false)}
          >
            <ChevronLeft className="size-4" />
            بستن
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/* MemberRow — single member row in the members list                   */
/* ------------------------------------------------------------------ */

function MemberRow({
  member,
  canSeeUsernames = false,
  onStartDirectChat,
}: {
  member: GroupMember;
  canSeeUsernames?: boolean;
  onStartDirectChat?: (user: { id: string; fullName: string; username: string; role: string; avatar?: string | null }) => void;
}) {
  const roleForBadge = member.userRole || member.role;
  const isTeacher = roleForBadge === "TEACHER";
  const isAdmin = roleForBadge === "ADMIN";
  return (
    <div
      className={`flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-accent ${
        onStartDirectChat ? "cursor-pointer" : ""
      }`}
      onClick={() => {
        if (onStartDirectChat) {
          onStartDirectChat({
            id: member.userId,
            fullName: member.fullName,
            username: member.username || "",
            role: roleForBadge,
            avatar: member.avatar ?? null,
          });
        }
      }}
    >
      <ChatAvatar
        fullName={member.fullName}
        userId={member.userId}
        avatar={member.avatar}
        avatarColor={member.avatarColor}
        size="sm"
        className="size-9"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span
          className="truncate text-sm font-medium"
          dir="auto"
        >
          {member.fullName}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {membershipRoleLabel(member.role)}
          {canSeeUsernames && member.username ? ` · @${member.username}` : ""}
        </span>
      </div>
      {isTeacher ? (
        <Badge
          variant="secondary"
          className="bg-primary/10 text-primary px-1.5 py-0 text-[9px]"
        >
          {roleLabel(roleForBadge)}
        </Badge>
      ) : isAdmin ? (
        <Badge
          variant="secondary"
          className="bg-amber-500/10 text-amber-700 dark:text-amber-300 px-1.5 py-0 text-[9px]"
        >
          {roleLabel(roleForBadge)}
        </Badge>
      ) : null}
    </div>
  );
}
