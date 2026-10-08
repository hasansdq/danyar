"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bookmark,
  BookmarkCheck,
  ChevronLeft,
  ExternalLink,
  FileText,
  Eye,
  Loader2,
  Megaphone,
  Paperclip,
  Send,
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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { LazySkeleton } from "@/components/ui/lazy-skeleton";
import { useToast } from "@/hooks/use-toast";
import { ChatAvatar } from "./chat-avatar";
import { roleLabel, toPersianDigits } from "./persian";
import { formatFileSize } from "./file-helpers";
import { PullToRefresh } from "./pull-to-refresh";
import {
  fetchAnnouncements,
  fetchClasses,
  postAnnouncement,
  saveMessage,
  unsaveMessage,
} from "@/lib/messenger-api";
import type {
  AnnouncementRecord,
  ClassItem,
  MessengerUser,
} from "./types";

const MAX_ANNOUNCEMENT_LEN = 2000;

/* ------------------------------------------------------------------ */
/* AnnouncementsSheet                                                 */
/* ------------------------------------------------------------------ */

interface AnnouncementsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: MessengerUser;
}

/**
 * Phase 18 — the principal's announcements Sheet. Renders the
 * existing announcements list (paginated, scrollable) + a send-new form
 * with multi-group select. Mounted by the messenger-app header next to
 * the "+" create-menu button (ADMIN / principal only).
 *
 * Phase 22 updates:
 *   - Pull-to-refresh replaces the manual "به‌روزرسانی" button (matches
 *     the Phase 21 pattern used by the conversation list).
 *   - Each AnnouncementCard now shows the recipient / read count badge
 *     ("X از Y نفر خوانده‌اند") — driven by `recipientCount` +
 *     `readCount` from the API.
 *   - Each card has a "save" (Bookmark) toggle so the principal can
 *     bookmark important announcements for later reference (uses the
 *     existing /api/messages/[id]/save endpoint — announcements ARE
 *     messages with isAnnouncement=true).
 *
 * The Sheet fetches:
 *   - `GET /api/teacher/announcements` → list of past announcements
 *   - `GET /api/classes` → the principal's classes (for the multi-select
 *     chips in the send-new form)
 *
 * On a successful send, the sheet refreshes both queries (so the list
 * reflects the new announcement) + toasts the count.
 */
export function AnnouncementsSheet({
  open,
  onOpenChange,
  user,
}: AnnouncementsSheetProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ----- Existing announcements query -----
  const {
    data: announcements,
    isLoading: announcementsLoading,
    isError: announcementsError,
    error: announcementsErr,
    refetch: refetchAnnouncements,
    isFetching: announcementsFetching,
  } = useQuery<AnnouncementRecord[]>({
    queryKey: ["announcements", user.id],
    queryFn: async () => {
      const res = await fetchAnnouncements({ limit: 50 });
      return res.data ?? [];
    },
    enabled: open,
    staleTime: 10 * 1000, // 10s
  });

  // ----- Classes query (for the multi-select chips) -----
  const {
    data: classes,
    isLoading: classesLoading,
  } = useQuery<ClassItem[]>({
    queryKey: ["classes", user.id],
    queryFn: () => fetchClasses(),
    enabled: open,
    staleTime: 30 * 1000,
  });

  // ----- Send-new form state -----
  const [content, setContent] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [selectedClassIds, setSelectedClassIds] = React.useState<Set<string>>(
    new Set(),
  );
  const [sending, setSending] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  // Reset internal state when the sheet transitions to closed (so the
  // next open starts fresh). Uses the React "previous prop" pattern to
  // avoid the cascading-render lint warning.
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) {
      setContent("");
      setFile(null);
      setSelectedClassIds(new Set());
      setSending(false);
    }
  }

  function toggleClass(id: string) {
    setSelectedClassIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (!classes || classes.length === 0) return;
    if (selectedClassIds.size === classes.length) {
      setSelectedClassIds(new Set());
    } else {
      setSelectedClassIds(new Set(classes.map((c) => c.id)));
    }
  }

  async function handleSend() {
    const trimmed = content.trim();
    if (!trimmed && !file) return;
    if (selectedClassIds.size === 0) return;
    setSending(true);
    try {
      const result = await postAnnouncement({
        content: trimmed,
        classIds: Array.from(selectedClassIds),
        file,
      });
      toast({
        title: "اطلاعیه ارسال شد",
        description:
          typeof result.count === "number"
            ? `به ${toPersianDigits(result.count)} گروه ارسال شد.`
            : undefined,
      });
      // Clear the form.
      setContent("");
      setFile(null);
      setSelectedClassIds(new Set());
      // Refresh the list (so the new announcement appears at the top).
      await refetchAnnouncements();
      // Invalidate the classes query so the conversation list's
      // latest-message preview refreshes.
      await queryClient.invalidateQueries({
        queryKey: ["classes", user.id],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطای غیرمنتظره";
      toast({
        title: "ارسال اطلاعیه ناموفق بود",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  }

  const canSend =
    !sending &&
    (content.trim().length > 0 || !!file) &&
    selectedClassIds.size > 0;

  // Phase 22 — pull-to-refresh handler (replaces the manual refresh
  // button that used to live in the sheet header).
  async function handlePullRefresh() {
    await refetchAnnouncements();
    await queryClient.invalidateQueries({ queryKey: ["classes", user.id] });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex h-full w-full flex-col gap-0 p-0 sm:max-w-lg"
      >
        <SheetHeader className="flex flex-col gap-1 border-b bg-background px-4 py-3">
          <SheetTitle className="flex items-center gap-2 text-base">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Megaphone className="size-4" />
            </span>
            اطلاعیه‌ها
          </SheetTitle>
          <SheetDescription className="sr-only">
            ارسال اطلاعیه به یک یا چند گروه + مشاهده فهرست اطلاعیه‌های
            ارسال‌شده قبلی.
          </SheetDescription>
          <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Users className="size-3.5" />
              {announcements
                ? `${toPersianDigits(announcements.length)} اطلاعیه`
                : "در حال بارگذاری..."}
            </span>
            {/* Phase 22 — refresh indicator (pull down on the list to
                refresh; this label just hints the gesture). */}
            {announcementsFetching ? (
              <span className="flex items-center gap-1 text-primary">
                <Loader2 className="size-3.5 animate-spin" />
                در حال به‌روزرسانی...
              </span>
            ) : (
              <span className="text-muted-foreground">
                برای به‌روزرسانی پایین بکشید
              </span>
            )}
          </div>
        </SheetHeader>

        {/* ---------- Body: pull-to-refresh + scrollable ---------- */}
        <PullToRefresh
          onRefresh={handlePullRefresh}
          className="scrollbar-rtl flex-1"
        >
          <div className="flex flex-col gap-4 p-4">
            {/* ---------- Send-new form ---------- */}
            <section className="flex flex-col gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
              <div className="flex items-center gap-2">
                <Megaphone className="size-4 text-primary" />
                <h3 className="text-sm font-semibold">ارسال اطلاعیه جدید</h3>
              </div>

              {/* Content textarea */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="announcement-content" className="text-xs">
                  متن اطلاعیه
                </Label>
                <Textarea
                  id="announcement-content"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="مثال: سلام عزیزانم، به علت بارش برف فردا مدرسه تعطیله 😊"
                  rows={3}
                  maxLength={MAX_ANNOUNCEMENT_LEN}
                  className="resize-none text-sm"
                  disabled={sending}
                />
                <p className="text-muted-foreground text-[10px]">
                  {toPersianDigits(content.length)} از{" "}
                  {toPersianDigits(MAX_ANNOUNCEMENT_LEN)} کاراکتر
                </p>
              </div>

              {/* File attachment */}
              <div className="flex items-center gap-2">
                <Label className="text-xs">فایل پیوست (اختیاری):</Label>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="sr-only"
                  accept="image/*,application/pdf,video/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (fileInputRef.current) fileInputRef.current.value = "";
                    if (f) setFile(f);
                  }}
                  tabIndex={-1}
                  aria-hidden="true"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={sending}
                  className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-muted disabled:opacity-60"
                >
                  <Paperclip className="size-3.5" />
                  {file
                    ? file.name.substring(0, 24) +
                      (file.name.length > 24 ? "…" : "")
                    : "انتخاب فایل"}
                </button>
                {file ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setFile(null)}
                      className="inline-flex items-center gap-1 text-xs text-destructive hover:underline"
                    >
                      <X className="size-3" />
                      حذف
                    </button>
                    <span className="text-muted-foreground text-[10px]">
                      {formatFileSize(file.size)}
                    </span>
                  </>
                ) : null}
              </div>

              {/* Multi-group selection */}
              <div className="flex flex-col gap-2 border-t border-primary/10 pt-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={
                      !!classes &&
                      classes.length > 0 &&
                      selectedClassIds.size === classes.length
                    }
                    onCheckedChange={toggleSelectAll}
                    disabled={!classes || classes.length === 0 || sending}
                    aria-label="انتخاب همه گروه‌ها"
                  />
                  <Label className="cursor-pointer text-xs">
                    انتخاب همه ({toPersianDigits(classes?.length ?? 0)} گروه)
                  </Label>
                </div>
                {classesLoading ? (
                  <div className="flex flex-col gap-1.5">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <LazySkeleton key={i} className="h-8 w-full" />
                    ))}
                  </div>
                ) : !classes || classes.length === 0 ? (
                  <p className="rounded-md border border-dashed p-2 text-center text-[11px] text-muted-foreground">
                    هیچ گروهی برای ارسال اطلاعیه وجود ندارد.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {classes.map((c) => {
                      const selected = selectedClassIds.has(c.id);
                      return (
                        <label
                          key={c.id}
                          className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] transition-colors ${
                            selected
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border hover:bg-muted"
                          }`}
                        >
                          <Checkbox
                            checked={selected}
                            onCheckedChange={() => toggleClass(c.id)}
                            disabled={sending}
                          />
                          {c.name}
                          {c.section ? ` · شعبه ${c.section}` : ""}
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Send button */}
              <div className="flex items-center justify-between gap-2 border-t border-primary/10 pt-2">
                <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                  {toPersianDigits(selectedClassIds.size)} گروه انتخاب شده
                </Badge>
                <Button
                  type="button"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => void handleSend()}
                  disabled={!canSend}
                >
                  {sending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Send className="size-3.5" />
                  )}
                  {sending ? "در حال ارسال..." : "ارسال اطلاعیه"}
                </Button>
              </div>
            </section>

            {/* ---------- Existing announcements list ---------- */}
            <section className="flex flex-col gap-2">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                <ChevronLeft className="size-4 text-muted-foreground" />
                اطلاعیه‌های ارسال‌شده
              </h3>

              {announcementsLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div
                      key={i}
                      className="flex flex-col gap-1.5 rounded-md border p-2.5"
                    >
                      <LazySkeleton className="h-3 w-32" />
                      <LazySkeleton className="h-2.5 w-48" />
                      <LazySkeleton className="h-2 w-24" />
                    </div>
                  ))}
                </div>
              ) : announcementsError ? (
                <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-muted-foreground">
                  <p>خطا در بارگذاری اطلاعیه‌ها.</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => void refetchAnnouncements()}
                  >
                    تلاش مجدد
                  </Button>
                  <p className="text-[10px] text-muted-foreground">
                    {(announcementsErr as Error)?.message || ""}
                  </p>
                </div>
              ) : !announcements || announcements.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
                  <Megaphone className="size-8 opacity-40" />
                  <p>هنوز اطلاعیه‌ای ارسال نکرده‌اید.</p>
                  <p className="text-xs">
                    فرم بالا را پر کنید و گروه‌ها را انتخاب کنید.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {announcements.map((a) => (
                    <AnnouncementCard key={a.id} announcement={a} />
                  ))}
                </div>
              )}
            </section>
          </div>
        </PullToRefresh>

        {/* ---------- Footer (close button) ---------- */}
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
/* AnnouncementCard — single row in the existing-announcements list   */
/* ------------------------------------------------------------------ */

function AnnouncementCard({
  announcement,
}: {
  announcement: AnnouncementRecord;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [saved, setSaved] = React.useState(false);
  const [togglingSave, setTogglingSave] = React.useState(false);

  // The same announcement text appears once per target class. We render
  // each row individually so the principal can see WHICH group each
  // copy went to (the class name is shown as a badge).
  async function toggleSave() {
    setTogglingSave(true);
    try {
      if (saved) {
        await unsaveMessage(announcement.id);
        setSaved(false);
        toast({ title: "از ذخیره‌ها حذف شد" });
      } else {
        await saveMessage(announcement.id);
        setSaved(true);
        toast({ title: "ذخیره شد" });
      }
      // Invalidate the saved-messages query so the saved list refreshes.
      await queryClient.invalidateQueries({ queryKey: ["saved-messages"] });
    } catch (err) {
      toast({
        title: "خطا",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setTogglingSave(false);
    }
  }

  // Phase 22 — recipient + read counts (delivered vs. read).
  const recipientCount = announcement.recipientCount ?? 0;
  const readCount = announcement.readCount ?? 0;
  const readRatio =
    recipientCount > 0 ? Math.round((readCount / recipientCount) * 100) : 0;

  return (
    <div className="flex flex-col gap-1.5 rounded-md border bg-secondary/30 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <Badge
          variant="secondary"
          className="bg-primary/10 text-primary px-1.5 py-0 text-[9px]"
        >
          {announcement.className}
          {announcement.classSection ? ` · شعبه ${announcement.classSection}` : ""}
        </Badge>
        <span
          className="text-[10px] text-muted-foreground"
          title={new Date(announcement.createdAt).toLocaleString("fa-IR")}
        >
          {new Intl.DateTimeFormat("fa-IR", {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }).format(new Date(announcement.createdAt))}
        </span>
      </div>
      <p
        className="whitespace-pre-wrap break-words text-xs leading-relaxed"
        dir="auto"
      >
        {announcement.content}
      </p>

      {/* Phase 22 — delivery / read-receipt row */}
      {recipientCount > 0 ? (
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Eye className="size-3" />
          <span>
            {toPersianDigits(readCount)} از {toPersianDigits(recipientCount)} نفر خوانده‌اند
          </span>
          <div className="ml-auto h-1 w-16 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${readRatio}%` }}
            />
          </div>
          <span className="text-primary">{toPersianDigits(readRatio)}٪</span>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <ChatAvatar
            fullName={announcement.senderFullName}
            userId={announcement.senderId}
            size="sm"
            className="size-5 text-[9px]"
          />
          <span className="font-medium text-foreground">
            {announcement.senderFullName}
          </span>
          {announcement.senderRole
            ? ` · ${roleLabel(announcement.senderRole)}`
            : ""}
        </span>
        <div className="flex items-center gap-2">
          {/* Phase 22 — save (bookmark) toggle */}
          <button
            type="button"
            onClick={() => void toggleSave()}
            disabled={togglingSave}
            className={`inline-flex items-center gap-1 text-[10px] transition-colors hover:underline disabled:opacity-60 ${
              saved ? "text-primary" : "text-muted-foreground"
            }`}
            title={saved ? "حذف از ذخیره‌شده‌ها" : "ذخیره اطلاعیه"}
            aria-label={saved ? "حذف از ذخیره‌شده‌ها" : "ذخیره اطلاعیه"}
          >
            {saved ? (
              <BookmarkCheck className="size-3" />
            ) : (
              <Bookmark className="size-3" />
            )}
            {saved ? "ذخیره‌شده" : "ذخیره"}
          </button>
          {announcement.fileUrl ? (
            <a
              href={announcement.fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              <FileText className="size-3" />
              مشاهده فایل
              <ExternalLink className="size-2.5" />
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
