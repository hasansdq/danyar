"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bot,
  ChevronLeft,
  History,
  Loader2,
  MessageCircle,
  Search,
  UserCircle,
} from "lucide-react";
import {
  listAiConversationUsers,
  fetchAiConversation,
  type AiConversationUserSummary,
  type AiConversationRow,
} from "@/lib/superadmin-api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LazySkeleton } from "@/components/ui/lazy-skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  formatPersianDate,
  formatPersianNumber,
  roleLabel,
} from "@/components/messenger/persian";

/**
 * SUPERADMIN-only viewer for the principals' AI-assistant chat history.
 *
 * Phase 21 — every (user, assistant) message pair the principal's chat
 * panel persists to the `AIConversation` table is exposed here:
 *
 *  1. The list view fetches `GET /api/superadmin/ai-conversations` (no
 *     userId) — returns a flat list of users with at least one persisted
 *     row, with the total message count + the most-recent message
 *     timestamp. The user types in the search box to filter by name +
 *     username + role label.
 *  2. Clicking a row opens a {@link ConversationDialog} that fetches
 *     `GET /api/superadmin/ai-conversations?userId=<id>` and renders the
 *     conversation oldest-first, with user messages right-aligned + AI
 *     replies left-aligned (matching the chat panel's RTL layout).
 *
 * The dialog itself is a separate component so the conversation-fetch
 * query only fires when the user actually clicks a row (lazy).
 */
export function AiConversationsViewer() {
  const { toast } = useToast();
  const [search, setSearch] = React.useState("");
  const [selectedUserId, setSelectedUserId] = React.useState<string | null>(
    null,
  );

  const {
    data: users = [],
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery<AiConversationUserSummary[]>({
    queryKey: ["superadmin-ai-conversations"],
    queryFn: listAiConversationUsers,
    staleTime: 60 * 1000,
  });

  // Filter rows by the search input — case-insensitive, matches name +
  // username + role label.
  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => {
      return (
        u.fullName.toLowerCase().includes(q) ||
        u.username.toLowerCase().includes(q) ||
        roleLabel(u.role).includes(search.trim())
      );
    });
  }, [users, search]);

  // The selected user object (for the dialog header).
  const selectedUser = React.useMemo(() => {
    if (!selectedUserId) return null;
    return users.find((u) => u.userId === selectedUserId) ?? null;
  }, [users, selectedUserId]);

  function openConversation(userId: string) {
    setSelectedUserId(userId);
  }

  function closeConversation() {
    setSelectedUserId(null);
  }

  // Surface a fetch error as a toast (the list UI also renders the error
  // inline so the SUPERADMIN sees it without opening the toast history).
  React.useEffect(() => {
    if (isError && error) {
      toast({
        title: "خطا در بارگذاری تاریخچه",
        description: (error as Error).message,
        variant: "destructive",
      });
    }
  }, [isError, error, toast]);

  return (
    <Card className="border border-border bg-card">
      <CardHeader className="border-b border-border pb-3">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500 ring-1 ring-emerald-500/20">
            <History className="size-5" />
          </div>
          <div className="flex flex-1 flex-col">
            <CardTitle className="text-base text-foreground">
              تاریخچه چت مدیران با دستیار
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              مشاهده و بازبینی گفت‌وگوی هر مدیر مدرسه با دستیار هوش مصنوعی.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="gap-2"
            aria-label="بارگذاری مجدد"
            title="بارگذاری مجدد"
          >
            {isFetching ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <History className="size-3.5" />
            )}
            به‌روزرسانی
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 p-4">
        {/* Search box */}
        <div className="relative">
          <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="جستجو بر اساس نام یا نقش..."
            className="pr-9"
            aria-label="جستجوی کاربر"
          />
        </div>

        {/* Loading skeleton */}
        {isLoading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <LazySkeleton
                key={i}
                className="h-16 w-full border border-border bg-card/60"
              />
            ))}
          </div>
        ) : isError ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-center text-sm text-destructive">
            خطا در بارگذاری تاریخچه: {(error as Error)?.message || "نامشخص"}
          </p>
        ) : filtered.length === 0 ? (
          <p className="rounded-md border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
            {search.trim()
              ? "هیچ کاربری با این فیلتر یافت نشد."
              : "هنوز هیچ گفت‌وگویی با دستیار ثبت نشده است."}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {filtered.map((u) => (
              <li key={u.userId}>
                <UserRow
                  user={u}
                  onOpen={() => openConversation(u.userId)}
                />
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {/* Conversation dialog */}
      <ConversationDialog
        open={selectedUserId !== null}
        onOpenChange={(next) => {
          if (!next) closeConversation();
        }}
        user={selectedUser}
        userId={selectedUserId}
      />
    </Card>
  );
}

/* ----------------------------------------------------------------- */
/* Single user row                                                   */
/* ----------------------------------------------------------------- */

interface UserRowProps {
  user: AiConversationUserSummary;
  onOpen: () => void;
}

function UserRow({ user, onOpen }: UserRowProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-lg border border-border bg-card px-3 py-3 text-right transition-colors hover:border-emerald-500/40 hover:bg-emerald-500/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
    >
      <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
        <UserCircle className="size-5" />
      </div>
      <div className="flex flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">
            {user.fullName}
          </span>
          <Badge variant="outline" className="text-[10px]">
            {roleLabel(user.role)}
          </Badge>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span dir="ltr" className="font-mono">
            @{user.username}
          </span>
          <span className="flex items-center gap-1">
            <MessageCircle className="size-3" />
            {formatPersianNumber(user.messageCount)} پیام
          </span>
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        {user.lastMessageAt ? (
          <span className="text-[10px] text-muted-foreground">
            آخرین پیام: {formatPersianDate(user.lastMessageAt)}
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground">—</span>
        )}
        <ChevronLeft className="size-4 text-muted-foreground" />
      </div>
    </button>
  );
}

/* ----------------------------------------------------------------- */
/* Conversation dialog                                               */
/* ----------------------------------------------------------------- */

interface ConversationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: AiConversationUserSummary | null;
  userId: string | null;
}

function ConversationDialog({
  open,
  onOpenChange,
  user,
  userId,
}: ConversationDialogProps) {
  const { data: rows = [], isLoading } = useQuery<AiConversationRow[]>({
    queryKey: ["superadmin-ai-conversation", userId],
    queryFn: () => (userId ? fetchAiConversation(userId, 100) : Promise.resolve([])),
    enabled: open && !!userId,
    staleTime: 30 * 1000,
  });

  // Reset scroll to top when a new conversation opens — actually we want
  // to scroll to the BOTTOM since messages are oldest-first (the latest
  // reply is the most relevant). See the ref effect below.
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open, rows]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-full flex-col gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="flex flex-col gap-1 border-b bg-card px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-base text-foreground">
            <span className="flex size-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500">
              <Bot className="size-4" />
            </span>
            گفت‌وگوی دستیار هوش مصنوعی
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {user ? (
              <>
                <span className="font-medium text-foreground">
                  {user.fullName}
                </span>{" "}
                <span dir="ltr" className="font-mono">
                  @{user.username}
                </span>{" "}
                · {roleLabel(user.role)}
              </>
            ) : (
              "بارگذاری..."
            )}
          </DialogDescription>
        </DialogHeader>

        <div
          ref={scrollRef}
          className="scrollbar-rtl flex-1 overflow-y-auto bg-secondary/30 px-3 py-3"
        >
          <div className="mx-auto flex w-full max-w-xl flex-col gap-2.5">
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                در حال بارگذاری گفت‌وگو...
              </div>
            ) : rows.length === 0 ? (
              <p className="rounded-md border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
                هیچ پیامی برای این کاربر ثبت نشده است.
              </p>
            ) : (
              rows.map((r) => (
                <HistoryBubble key={r.id} row={r} />
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ----------------------------------------------------------------- */
/* Single message bubble                                             */
/* ----------------------------------------------------------------- */

function HistoryBubble({ row }: { row: AiConversationRow }) {
  const isUser = row.role === "user";
  // Parse the action JSON for assistant bubbles so we can show a small
  // "اقدام پیشنهادی" badge if one was attached.
  let actionLabel: string | null = null;
  if (!isUser && row.actionJson) {
    try {
      const parsed = JSON.parse(row.actionJson) as { type?: string };
      if (parsed && typeof parsed.type === "string") {
        actionLabel = parsed.type;
      }
    } catch {
      actionLabel = null;
    }
  }

  return (
    <div
      className={cn(
        "flex w-full",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      <div
        className={cn(
          "flex max-w-[85%] flex-col gap-1 rounded-2xl px-3 py-2 text-sm shadow-sm",
          isUser
            ? "ml-auto rounded-br-sm bg-primary text-primary-foreground"
            : "mr-auto rounded-bl-sm border bg-background text-foreground",
        )}
      >
        {!isUser ? (
          <div className="flex items-center gap-1.5 pb-1 text-[10px] font-medium text-muted-foreground">
            <Bot className="size-3" />
            دستیار
            {actionLabel ? (
              <Badge
                variant="outline"
                className="mr-1 border-emerald-500/40 bg-emerald-500/10 px-1 text-[9px] text-emerald-600 dark:text-emerald-300"
              >
                اقدام: {actionLabel}
              </Badge>
            ) : null}
          </div>
        ) : null}
        <div
          className={cn(
            "whitespace-pre-wrap break-words leading-relaxed",
            isUser ? "text-primary-foreground" : "",
          )}
        >
          {row.content}
        </div>
        <div
          className={cn(
            "mt-0.5 text-[9px]",
            isUser
              ? "text-primary-foreground/70"
              : "text-muted-foreground",
          )}
        >
          {formatPersianDate(row.createdAt)}
        </div>
      </div>
    </div>
  );
}
