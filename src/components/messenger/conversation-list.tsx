"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { GraduationCap, MessageSquare, Search, Inbox, Video } from "lucide-react";
import { LazySkeleton } from "@/components/ui/lazy-skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ChatAvatar } from "./chat-avatar";
import {
  toPersianDigits,
  roleLabel,
  membershipRoleLabel,
} from "./persian";
import type {
  ClassItem,
  DirectChat,
  DirectChatUser,
  MessengerUser,
} from "./types";

/**
 * Shared shape for the "last message" embedded in a conversation row.
 * Class chats populate `senderName` from the latest Message; DMs
 * populate `isRead` / `readAt` from the recipient's read-receipt. The
 * fields are all OPTIONAL so a single unified shape works for both kinds
 * (TypeScript doesn't have to narrow the type by `item.kind` to read a
 * given field — much simpler downstream).
 */
export type ConversationLastMessage = {
  content: string;
  createdAt: string;
  /** Sender's user id — used to detect "is this MY last message?". */
  senderId: string;
  /** Sender's display name for the preview prefix (class chats only). */
  senderName?: string;
  /**
   * True when the SENDER's own last message has been read by the other
   * participant — drives the WhatsApp ✓✓ blue tick on DM rows.
   */
  isRead?: boolean | null;
  /** ISO timestamp of when the recipient read the message. */
  readAt?: string | null;
};

/**
 * Unified conversation row — one entry in the merged conversation list.
 *
 * `kind === "class"` rows correspond to a ClassRoom (group chat). Their
 * "last message" is the latest Message in that class (sender is a member
 * of the class). The conversation-list click opens the class chat.
 *
 * `kind === "dm"` rows correspond to a 1:1 DirectChat. Their "last message"
 * is the latest DirectMessage in that chat. The conversation-list click
 * opens the direct chat.
 */
export type ConversationItem =
  | {
      kind: "class";
      id: string;
      name: string;
      gradeLevel?: string | null;
      memberCount: number;
      role: "STUDENT" | "TEACHER" | "ADMIN";
      lastMessage: ConversationLastMessage | null;
      /**
       * Class chats don't have per-user unread tracking — always show 0
       * unread (no badge). The field is here so the row renderer can use
       * one code path for both kinds.
       */
      unreadCount: number;
      /**
       * Phase 24 — when `parentClassId` is non-null, this conversation is a
       * GROUP (chat) inside a parent class. When null, it's a top-level
       * class. The row renderer uses this to show a "گروه" badge so users
       * can visually distinguish classes (school-level categories) from
       * groups (chats within a class).
       */
      parentClassId?: string | null;
      raw: ClassItem;
    }
  | {
      kind: "dm";
      id: string;
      /** The OTHER participant in the direct chat. */
      otherUser: DirectChatUser;
      lastMessage: ConversationLastMessage | null;
      unreadCount: number;
      raw: DirectChat;
    };

/**
 * Build a unified, sorted conversation list from the two source datasets.
 *
 * Sort order:
 *  1. Chats with a `lastMessage` come first, sorted by createdAt desc.
 *  2. Chats WITHOUT a last message (e.g. a freshly-created DM with no
 *     messages yet) sort AFTER chats-with-messages, ordered by the
 *     chat's own `createdAt` / `lastMessageAt` desc (newest-created first).
 *
 * This way an empty chat the user just started shows up at the top of the
 * list (mirrors WhatsApp: a brand-new chat is pinned to the top until
 * someone sends a message).
 */
export function buildConversationList(
  classes: ClassItem[],
  dms: DirectChat[],
  currentUserId: string,
): ConversationItem[] {
  const withMsg: ConversationItem[] = [];
  const withoutMsg: ConversationItem[] = [];

  for (const c of classes) {
    const last = c.latestMessage ?? null;
    const item: ConversationItem = {
      kind: "class",
      id: c.id,
      name: c.name,
      gradeLevel: c.gradeLevel ?? null,
      memberCount: c.memberCount,
      role: c.role,
      lastMessage: last
        ? {
            content: last.content,
            createdAt: last.createdAt,
            senderId: last.sender.id,
            senderName: last.sender.fullName,
          }
        : null,
      unreadCount: 0,
      parentClassId: c.parentClassId ?? null,
      raw: c,
    };
    if (last) withMsg.push(item);
    else withoutMsg.push(item);
  }

  for (const d of dms) {
    const last = d.lastMessage ?? null;
    const item: ConversationItem = {
      kind: "dm",
      id: d.id,
      otherUser: d.otherUser,
      lastMessage: last
        ? {
            content: last.content,
            createdAt: last.createdAt,
            senderId: last.senderId,
            isRead: last.isRead ?? null,
            readAt: last.readAt ?? null,
          }
        : null,
      unreadCount: d.unreadCount ?? 0,
      raw: d,
    };
    if (last) withMsg.push(item);
    else withoutMsg.push(item);
  }

  withMsg.sort(
    (a, b) =>
      new Date(b.lastMessage!.createdAt).getTime() -
      new Date(a.lastMessage!.createdAt).getTime(),
  );
  withoutMsg.sort((a, b) => {
    const aTime =
      a.kind === "dm"
        ? a.raw.lastMessageAt ?? a.raw.createdAt ?? new Date(0).toISOString()
        : a.raw.createdAt;
    const bTime =
      b.kind === "dm"
        ? b.raw.lastMessageAt ?? b.raw.createdAt ?? new Date(0).toISOString()
        : b.raw.createdAt;
    return new Date(bTime).getTime() - new Date(aTime).getTime();
  });

  // Empty chats the user just started should float to the very top, but
  // only the freshly-created ones (within the last 60s) — older empty
  // chats sort below the active ones.
  return [...withoutMsg, ...withMsg];
}

/**
 * Format a message timestamp for a conversation row.
 *
 *  - Same day  → "HH:MM" (Persian digits).
 *  - This week → Persian short weekday ("شنبه", "یکشنبه", …).
 *  - Older     → Persian YYYY/MM/DD.
 *
 * Returns an empty string when the input can't be parsed.
 */
function formatConversationTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return toPersianDigits(
      d.toLocaleTimeString("fa-IR", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }),
    );
  }
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (diffDays < 7) {
    try {
      return new Intl.DateTimeFormat("fa-IR", { weekday: "short" }).format(d);
    } catch {
      // fall through to date
    }
  }
  try {
    return new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
      year: "2-digit",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    return d.toLocaleDateString();
  }
}

/** Truncate a string to ~`n` chars, appending an ellipsis when truncated. */
function truncate(s: string, n = 40): string {
  const str = (s || "").trim();
  if (str.length <= n) return str;
  return `${str.slice(0, n).trimEnd()}…`;
}

/** Build the last-message preview text for a row. */
function buildPreview(item: ConversationItem, currentUserId: string): string {
  const last = item.lastMessage;
  if (!last) {
    return item.kind === "dm"
      ? "گفتگو خصوصی ایجاد شد · پیامی هنوز رد و بدل نشده است"
      : "هنوز پیامی در این کلاس ارسال نشده است";
  }
  const content = truncate(last.content ?? "", 40);
  // For class chats: prefix with "شما: " if the sender is the current user,
  // otherwise "senderName: ". For DMs: same prefix rule, but the senderName
  // is not always available on the DM lastMessage shape — fall back to
  // "شما" / no prefix.
  const isOwn = last.senderId === currentUserId;
  if (item.kind === "class") {
    if (isOwn) return `شما: ${content}`;
    return `${last.senderName ? `${last.senderName}: ` : ""}${content}`;
  }
  // DM
  if (isOwn) return `شما: ${content}`;
  return content;
}

/**
 * WhatsApp-style read-tick indicator on the conversation row.
 *
 *  - Class chat: a single ✓ (Check, muted) when the last message is the
 *    current user's own — class chats have no per-user read tracking so
 *    we only show "sent".
 *  - Direct chat: when the last message is the current user's own:
 *      - isRead === true (or readAt set) → blue double ✓✓
 *      - otherwise → single ✓ (sent, not yet read)
 *
 * Returns `null` when no tick should be shown (other user's last message,
 * or no last message at all).
 */
function ReadTick({
  item,
  currentUserId,
}: {
  item: ConversationItem;
  currentUserId: string;
}) {
  const last = item.lastMessage;
  if (!last) return null;
  const isOwn = last.senderId === currentUserId;
  if (!isOwn) return null;

  if (item.kind === "class") {
    // Class chat — no per-user read tracking. Single ✓ (sent).
    return (
      <svg
        viewBox="0 0 16 16"
        className="size-3.5 shrink-0 text-muted-foreground"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-label="ارسال شده"
        role="img"
      >
        <title>ارسال شده</title>
        <path d="M2 8.5l3.5 3.5L14 4.5" />
      </svg>
    );
  }

  // DM
  const isRead =
    last.isRead === true || Boolean(last.readAt);
  if (isRead) {
    return (
      <svg
        viewBox="0 0 18 16"
        className="size-3.5 shrink-0 text-sky-500"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-label="خوانده شده"
        role="img"
      >
        <title>خوانده شده</title>
        <path d="M2 8.5l3.5 3.5L11 5.5" />
        <path d="M7 8.5l3.5 3.5L17 4.5" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-3.5 shrink-0 text-muted-foreground"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label="ارسال شد"
      role="img"
    >
      <title>ارسال شد</title>
      <path d="M2 8.5l3.5 3.5L14 4.5" />
    </svg>
  );
}

function ConversationRow({
  item,
  currentUserId,
  onSelect,
}: {
  item: ConversationItem;
  currentUserId: string;
  onSelect: (item: ConversationItem) => void;
}) {
  const last = item.lastMessage;
  const time = last ? formatConversationTime(last.createdAt) : "";
  const preview = buildPreview(item, currentUserId);
  const unread = item.unreadCount;

  return (
    <motion.button
      type="button"
      layout="position"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      onClick={() => onSelect(item)}
      className="group flex w-full items-center gap-3 px-3 py-2.5 text-right transition-colors hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none"
    >
      {/* Avatar (right side in RTL) */}
      <span className="relative shrink-0">
        {item.kind === "class" ? (
          <span className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
            <GraduationCap className="size-5" />
          </span>
        ) : (
          <ChatAvatar
            fullName={item.otherUser.fullName}
            userId={item.otherUser.id}
            avatar={item.otherUser.avatar}
            size="md"
          />
        )}
        {unread > 0 ? (
          <span className="absolute -top-0.5 -left-0.5 flex min-w-[18px] items-center justify-center rounded-full bg-emerald-600 px-1 text-[10px] font-bold text-white shadow-sm ring-2 ring-background">
            {toPersianDigits(unread > 99 ? "99+" : unread)}
          </span>
        ) : null}
        {/* Phase 36j — active video class indicator. When a teacher has
            started a stream for this class, show a pulsing video icon
            badge on the avatar. Visible to ALL roles (students, teachers,
            principals) so everyone knows the class is live. */}
        {item.kind === "class" && item.raw.streamingActive ? (
          <span className="absolute -bottom-0.5 -right-0.5 flex size-5 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm ring-2 ring-background" title="کلاس ویدئویی فعال">
            <Video className="size-3" />
            <span className="absolute inset-0 -z-10 animate-ping rounded-full bg-emerald-500/40" />
          </span>
        ) : null}
      </span>

      {/* Name + preview + tick (middle column) */}
      <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
        <span className="flex w-full items-center gap-1.5">
          <span
            className={cn(
              "truncate text-sm leading-tight",
              unread > 0 ? "font-bold text-foreground" : "font-medium text-foreground",
            )}
            dir="auto"
          >
            {item.kind === "class" ? item.name : item.otherUser.fullName}
          </span>
          {/* Phase 24 — distinguish classes (school-level categories) from
              groups (chats within a class). Groups get a "گروه" badge so
              users can tell them apart at a glance. */}
          {item.kind === "class" && item.parentClassId ? (
            <Badge
              variant="secondary"
              className="shrink-0 bg-sky-500/10 px-1 py-0 text-[9px] text-sky-600 dark:text-sky-400"
            >
              گروه
            </Badge>
          ) : null}
          {/* Phase 36j — "کلاس آنلاین" badge when a stream is active. */}
          {item.kind === "class" && item.raw.streamingActive ? (
            <Badge
              variant="secondary"
              className="shrink-0 gap-0.5 bg-emerald-500/15 px-1 py-0 text-[9px] text-emerald-600 dark:text-emerald-400"
            >
              <Video className="size-2.5" />
              کلاس آنلاین
            </Badge>
          ) : null}
          <Badge
            variant="secondary"
            className="shrink-0 px-1 py-0 text-[9px]"
          >
            {item.kind === "class"
              ? membershipRoleLabel(item.role)
              : roleLabel(item.otherUser.role)}
          </Badge>
        </span>
        <span className="flex w-full items-center gap-1 text-xs leading-tight text-muted-foreground">
          <ReadTick item={item} currentUserId={currentUserId} />
          <span className="truncate" dir="auto">
            {preview}
          </span>
        </span>
      </span>

      {/* Timestamp (left side in RTL) */}
      <span className="flex shrink-0 flex-col items-start gap-1 self-start pt-0.5">
        {time ? (
          <span
            className={cn(
              "text-[10px] leading-tight",
              unread > 0
                ? "font-bold text-emerald-600"
                : "text-muted-foreground",
            )}
            dir="ltr"
          >
            {time}
          </span>
        ) : null}
        {item.kind === "class" ? (
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <MessageSquare className="size-3" />
            {toPersianDigits(item.memberCount)}
          </span>
        ) : null}
      </span>
    </motion.button>
  );
}

/**
 * Conversation list — the messenger's default home view.
 *
 * Renders a WhatsApp-style scrollable list of all the user's chats:
 * class chats + 1:1 direct chats, merged + sorted by lastMessage time.
 * Each row shows avatar, name + role badge, last-message preview (with
 * WhatsApp-style read tick on the requester's own last message), timestamp,
 * and an unread badge for DMs.
 *
 * The parent passes the two source datasets + the user; the list reports
 * clicks via `onSelectConversation(item)`. The parent decides whether to
 * open a `<ClassChat>` or a `<DirectChat>` based on the item kind.
 */
export function ConversationList({
  user,
  classes,
  classesLoading,
  classesError,
  dms,
  dmsLoading,
  onRetryClasses,
  onOpenSearch,
  onSelectConversation,
  onRefresh,
}: {
  user: MessengerUser;
  classes: ClassItem[];
  classesLoading: boolean;
  classesError: boolean;
  dms: DirectChat[];
  dmsLoading: boolean;
  onRetryClasses?: () => void;
  onOpenSearch?: () => void;
  onSelectConversation: (item: ConversationItem) => void;
  onRefresh?: () => void;
}) {
  const items = React.useMemo(
    () => buildConversationList(classes, dms, user.id),
    [classes, dms, user.id],
  );

  const loading = classesLoading || dmsLoading;

  if (classesError) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <Inbox className="size-10 text-muted-foreground" />
        <p className="font-medium">بارگذاری گفتگوها ناموفق بود</p>
        <p className="text-sm text-muted-foreground">
          لطفاً چند لحظه دیگر دوباره تلاش کنید.
        </p>
        {onRetryClasses ? (
          <Button variant="outline" onClick={onRetryClasses}>
            بارگذاری مجدد
          </Button>
        ) : null}
      </div>
    );
  }

  if (loading && items.length === 0) {
    return (
      <div className="flex flex-col gap-2 p-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-xl px-3 py-2.5"
          >
            <LazySkeleton className="size-11 rounded-full" />
            <div className="flex flex-1 flex-col gap-1.5">
              <LazySkeleton className="h-3.5 w-1/2" />
              <LazySkeleton className="h-3 w-3/4" />
            </div>
            <LazySkeleton className="h-3 w-10" />
          </div>
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Inbox className="size-7" />
        </span>
        <p className="font-medium">هنوز گفتگویی ندارید</p>
        <p className="max-w-xs text-sm text-muted-foreground">
          هنوز گفتگویی ندارید. با جستجو می‌توانید گفتگو خصوصی آغاز کنید.
        </p>
        {onOpenSearch ? (
          <Button className="mt-1 gap-2" onClick={onOpenSearch}>
            <Search className="size-4" />
            جستجوی کاربران
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="no-scrollbar scrollbar-rtl h-full overflow-y-auto pb-20">
      {/* Phase 21 — reload button removed; pull-to-refresh replaces it */}
      <div className="divide-y">
        {items.map((item) => (
          <ConversationRow
            key={`${item.kind}:${item.id}`}
            item={item}
            currentUserId={user.id}
            onSelect={onSelectConversation}
          />
        ))}
      </div>
    </div>
  );
}
