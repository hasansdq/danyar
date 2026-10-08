"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LazySkeleton } from "@/components/ui/lazy-skeleton";
import { Loader2, Search, Users, UserCircle2 } from "lucide-react";
import { searchUsers, createDirectChat } from "@/lib/messenger-api";
import { useToast } from "@/hooks/use-toast";
import { ChatAvatar } from "./chat-avatar";
import { roleLabel } from "./persian";
import type { DirectChat, UserSearchResult } from "./types";

const DEBOUNCE_MS = 300;
const MIN_QUERY_LEN = 2;

/**
 * User-search dialog opened from the messenger header (magnifying-glass icon).
 *
 * As the user types a name, debounces 300ms then calls
 * `GET /api/users/search?q=...`. Results are same-school users only,
 * excluding the caller. Clicking a row starts (or opens) a 1:1 direct
 * chat with that user:
 *   POST `/api/direct-chats { userId }` → on success: close the dialog
 *   and hand the resulting DirectChat back so the messenger can swap
 *   the class chat for the direct chat view. On 403 (DM permission
 *   denied by the principal's per-school toggles), the server returns a
 *   Persian error message which we surface via toast.
 */
export function UserSearchDialog({
  open,
  onOpenChange,
  onDirectChatStarted,
  initialQuery = "",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Called after a successful POST /api/direct-chats. The messenger
   * uses this to switch the active view to the direct chat.
   */
  onDirectChatStarted: (chat: DirectChat) => void;
  /**
   * Optional seed query — used when the dialog is opened from a
   * "click a sender's name in the class chat" intent (so the search
   * box is pre-filled with that user's full name and the results
   * appear immediately).
   */
  initialQuery?: string;
}) {
  const { toast } = useToast();
  const { data: session } = useSession();
  const canSeeUsernames = session?.user?.role === "ADMIN" || session?.user?.role === "SUPERADMIN";
  const [query, setQuery] = React.useState(initialQuery);
  const [debouncedQuery, setDebouncedQuery] = React.useState(initialQuery);

  // Reset internal state when the dialog opens/closes, using the React
  // "previous prop" pattern (avoids the cascading-render lint warning that
  // a useEffect + setState would trigger).
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setQuery(initialQuery);
      setDebouncedQuery(initialQuery);
    } else {
      // Clear after close so the next open starts fresh (unless reseeded).
      setQuery("");
      setDebouncedQuery("");
    }
  }

  // If the parent updates `initialQuery` while the dialog is open (e.g. a
  // second sender name click), sync to it so the search re-runs.
  const [prevInitial, setPrevInitial] = React.useState(initialQuery);
  if (initialQuery !== prevInitial) {
    setPrevInitial(initialQuery);
    if (open) {
      setQuery(initialQuery);
      setDebouncedQuery(initialQuery);
    }
  }

  // Debounce the typed query so we don't fire a request per keystroke.
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  const trimmed = debouncedQuery.trim();
  const enabled = trimmed.length >= MIN_QUERY_LEN;

  const { data: results, isFetching } = useQuery<UserSearchResult[]>({
    queryKey: ["user-search", trimmed],
    queryFn: () => searchUsers(trimmed),
    enabled,
    staleTime: 15_000,
    gcTime: 60_000,
  });

  const [starting, setStarting] = React.useState<string | null>(null);

  async function handleSelect(user: UserSearchResult) {
    if (starting) return;
    setStarting(user.id);
    try {
      const chat = await createDirectChat({ userId: user.id });
      onDirectChatStarted(chat);
      onOpenChange(false);
      toast({
        title: "گفتگو خصوصی باز شد",
        description: `اکنون با ${user.fullName} در یک گفتگو خصوصی هستید.`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطای غیرمنتظره";
      toast({
        title: "آغاز گفتگو ناموفق بود",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setStarting(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-md">
        <DialogHeader className="border-b px-4 py-3 text-right">
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Search className="size-4" />
            </span>
            جستجوی کاربر
          </DialogTitle>
          <DialogDescription className="text-xs">
            نام کامل کاربر را بنویسید تا گفتگو خصوصی با او آغاز کنید.
          </DialogDescription>
        </DialogHeader>

        {/* Search input — sticky at the top of the body so it stays visible
            while the user scrolls the results list. */}
        <div className="border-b bg-background/95 px-3 py-2.5 backdrop-blur">
          <div className="relative">
            <Search className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="نام کامل کاربر…"
              className="pr-9"
              autoFocus
              autoComplete="off"
              inputMode="search"
            />
            {isFetching ? (
              <Loader2 className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            ) : null}
          </div>
        </div>

        {/* Results list — capped to keep the dialog usable on small screens. */}
        <div className="max-h-[55vh] overflow-y-auto p-2">
          {!enabled ? (
            <EmptyState
              icon={<Search className="size-5" />}
              title="برای جستجوی کاربران نام را بنویسید"
              description="حداقل دو نویسه از نام کامل کاربر مورد نظر را وارد کنید."
            />
          ) : isFetching && !results ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <LazySkeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : !results || results.length === 0 ? (
            <EmptyState
              icon={<Users className="size-5" />}
              title="کاربری یافت نشد"
              description={`برای «${trimmed}» هیچ کاربری در مدرسه شما یافت نشد.`}
            />
          ) : (
            <ul className="space-y-1">
              {results.map((user) => (
                <UserSearchRow
                  key={user.id}
                  user={user}
                  disabled={starting !== null}
                  loading={starting === user.id}
                  canSeeUsernames={canSeeUsernames}
                  onSelect={() => handleSelect(user)}
                />
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-end border-t px-3 py-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            بستن
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function UserSearchRow({
  user,
  disabled,
  loading,
  canSeeUsernames,
  onSelect,
}: {
  user: UserSearchResult;
  disabled: boolean;
  loading: boolean;
  canSeeUsernames: boolean;
  onSelect: () => void;
}) {
  // Color the role badge per the existing convention (teacher=teal,
  // admin=amber, student=muted) so the result list reads at a glance.
  const roleClass =
    user.role === "ADMIN"
      ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
      : user.role === "TEACHER"
        ? "bg-primary/10 text-primary"
        : "bg-muted text-muted-foreground";

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        disabled={disabled}
        className="flex w-full items-center gap-3 rounded-lg border border-transparent p-2 text-right transition-colors hover:border-border hover:bg-accent/60 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <ChatAvatar
          fullName={user.fullName}
          userId={user.id}
          avatar={user.avatar}
          size="md"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-sm font-medium leading-tight">
            {user.fullName}
          </span>
          <span
            dir="ltr"
            className="font-mono text-[11px] text-muted-foreground"
          >
            {canSeeUsernames ? `@${user.username}` : ""}
          </span>
        </div>
        <Badge variant="secondary" className={`shrink-0 text-[10px] ${roleClass}`}>
          {roleLabel(user.role)}
        </Badge>
        {loading ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
        ) : (
          <UserCircle2 className="size-4 shrink-0 text-muted-foreground" />
        )}
      </button>
    </li>
  );
}

function EmptyState({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon}
      </span>
      <p className="text-sm font-medium">{title}</p>
      {description ? (
        <p className="text-xs text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}
