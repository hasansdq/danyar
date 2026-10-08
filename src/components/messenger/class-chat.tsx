"use client";

import * as React from "react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { io, type Socket } from "socket.io-client";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { socketAuthCallback } from "@/lib/socket-auth-client";
import { motion, AnimatePresence } from "framer-motion";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LazySkeleton } from "@/components/ui/lazy-skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import {
  Send,
  Loader2,
  ChevronUp,
  Wifi,
  WifiOff,
  MoreVertical,
  Trash2,
  Plus,
  X,
  BarChart3,
  Lock,
  Unlock,
  CheckCircle2,
  Users,
  SlidersHorizontal,
  Filter,
  Palette,
  Paperclip,
  FileText,
  File as FileIcon,
  Download,
  ExternalLink,
  ImageIcon,
  Film,
  ArrowRight,
  Check,
  Reply as ReplyIcon,
  Pencil,
  Forward,
  Eye,
  CheckSquare,
  Bookmark,
  Info,
  ClipboardList,
  FileQuestion,
  Calendar,
  Pin,
  PinOff,
  Search,
  BookOpen,
  Megaphone,
  Video,
  AlignJustify,
} from "lucide-react";
import {
  fetchClasses,
  fetchMessages,
  fetchPolls,
  deleteMessage,
  patchClassFileSettings,
  postMessageWithFile,
  postMessage,
  patchMessage,
  forwardMessage,
  fetchMessageReaders,
  markClassRead,
  saveMessage,
  unsaveMessage,
  type MessageReader,
} from "@/lib/messenger-api";
import { useTheme } from "next-themes";
import { useToast } from "@/hooks/use-toast";
import { ChatAvatar } from "./chat-avatar";
import { FileSettingsDialog } from "./file-settings-dialog";
import { ChatSettingsDialog } from "./chat-settings-dialog";
import { GroupInfoDialog } from "./group-info-dialog";
// Phase 35 — Virtual Classroom (online class) module. Mounted as a Sheet
// opened by the FAB at the bottom of the class chat.
import { ClassroomView } from "./classroom-view";
// Phase 26 — composer upgrades: WhatsApp-style emoji picker + voice recorder.
// Both are standalone, reusable components (no shared state with the chat).
import { EmojiPicker } from "./emoji-picker";
import { VoiceRecorder } from "./voice-recorder";
import { VoiceMessagePlayer } from "./voice-message-player";
import { useDeviceType } from "./use-device-type";
import { useSiteSettings } from "@/components/use-site-settings";
import { apiFetch } from "@/lib/api-fetch";
import { cn } from "@/lib/utils";
import {
  useChatAppearance,
  resolveBackgroundCss,
} from "./chat-appearance";
import {
  toPersianDigits,
  formatPersianDay,
  formatPersianDate,
  roleLabel,
} from "./persian";
import {
  categorizeFile,
  formatFileSize,
  formatFileTypesLabel,
} from "./file-helpers";
import { useSwipeToReply, SWIPE_TRANSITION_BUBBLE } from "./use-swipe-to-reply";
import type {
  ChatMessageWithDelete,
  ClassItem,
  DirectChatUser,
  FileSettings,
  MessengerUser,
  Poll,
} from "./types";

// ----------------- Socket payload shapes -----------------

type SocketNewMessage = {
  id: string;
  classId: string;
  senderId: string;
  senderName: string;
  senderRole: string;
  senderAvatar?: string | null;
  content: string;
  createdAt: string;
  // Phase-3 file-attachment fields. Always present on broadcasts from the
  // chat-service (null for plain-text messages) so the renderer can use a
  // single union type. Optional for backward compat with older clients.
  fileUrl?: string | null;
  fileName?: string | null;
  fileType?: string | null; // "image" | "pdf" | "video" | "file" | null
  fileSize?: number | null;
  mimeType?: string | null;
  // Phase-17 reply / forward / edit metadata. The chat-service may strip
  // these when normalizing the broadcast payload (relay_message), so the
  // renderer treats them all as optional and falls back to undefined →
  // no quote preview, no edited badge, etc. When the server broadcasts
  // them (forward/reply created via REST), we render the appropriate UI.
  replyToId?: string | null;
  forwardedFromId?: string | null;
  editedAt?: string | null;
  replyTo?: {
    id: string;
    content: string;
    sender: { id: string; fullName: string; role: string };
  } | null;
  readCount?: number;
  // Phase 18 — bookmark metadata. The chat-service doesn't broadcast save /
  // unsave events (each user's bookmarks are private), so these are
  // optional + default to false/0 when absent. REST GET /api/messages
  // stamps them on every row.
  isSaved?: boolean;
  savedCount?: number;
};

type SocketMessageDeleted = {
  id: string;
  classId: string;
  deletedBy?: string;
  deletedAt?: string;
};

// Phase 17 — broadcast when ANY client edits a message via `edit_message`.
// The chat-service stamps `editedAt = now` server-side and re-broadcasts
// the canonical shape so every connected client can live-update the bubble.
type SocketMessageEdited = {
  id: string;
  classId?: string;
  content: string;
  editedAt: string;
};

type SocketPollCreated = { poll: Poll };
type SocketPollUpdated = {
  id: string;
  optionVotes: number[];
  totalVotes: number;
};
type SocketPollClosed = { id: string; closedAt: string };
type SocketChatClosed = {
  classId: string;
  chatClosed: boolean;
  closedBy?: { id?: string; fullName?: string; role?: string } | string | null;
  closedAt?: string;
};
type SocketChatOpened = { classId: string; chatClosed: boolean };
type SocketTyping = { userId: string; fullName: string; isTyping: boolean };

// ----------------- Timeline helpers -----------------

type TimelineItem =
  | { kind: "message"; id: string; createdAt: string; data: ChatMessageWithDelete }
  | { kind: "poll"; id: string; createdAt: string; data: Poll };

type TypingState = { fullName: string; expiresAt: number };

const TYPING_TIMEOUT_MS = 3500;
const LOAD_LIMIT = 100;
const STUDENT_DELETE_WINDOW_MS = 12 * 60 * 60 * 1000; // 12h

function toTimelineMessage(m: ChatMessageWithDelete): TimelineItem {
  return { kind: "message", id: m.id, createdAt: m.createdAt, data: m };
}
function toTimelinePoll(p: Poll): TimelineItem {
  return { kind: "poll", id: p.id, createdAt: p.createdAt, data: p };
}

function sortTimeline(items: TimelineItem[]): TimelineItem[] {
  return [...items].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

/** Persian YYYY/MM/DD key for grouping messages by day. */
function dayKey(iso: string): string {
  try {
    return new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toDateString();
  }
}

/** Short Persian time (HH:MM). */
function shortTime(iso: string): string {
  try {
    return toPersianDigits(
      new Date(iso).toLocaleTimeString("fa-IR", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }),
    );
  } catch {
    return "";
  }
}

// ============================================================
// Main ClassChat component
// ============================================================

/**
 * Telegram-style class chat — polls, message delete with permissions, chat
 * close/open, avatars + full names, date separators, typing indicator,
 * optimistic send. Connects to the socket.io chat mini-service on port 3003
 * (via the gateway `XTransformPort` convention) for real-time updates.
 *
 * Phase 10 additions:
 *   - `onStartDirectChat` prop + `openingForUserId` prop. When set, the
 *     sender's avatar + full name in `MessageRow` become clickable → the
 *     parent (messenger-app) POSTs `/api/direct-chats { userId: senderId }`
 *     and swaps the view to the direct chat. The `openingForUserId` value
 *     reflects the in-flight sender id so the row can show a spinner.
 */
export function ClassChat({
  user,
  classId,
  className,
  initialChatClosed = false,
  fileSettings: initialFileSettings,
  openingForUserId = null,
  onStartDirectChat,
  onBack,
  onOpenAssignment,
  onOpenSampleQuestion,
}: {
  user: MessengerUser;
  classId: string;
  className?: string;
  initialChatClosed?: boolean;
  fileSettings?: Partial<FileSettings> | null;
  /**
   * The user id that the parent is currently trying to open a direct chat
   * with (in-flight POST). When set, the matching sender's row shows a
   * spinner in place of the "start DM" hover affordance.
   */
  openingForUserId?: string | null;
  /**
   * Called when the user clicks the "back" button in the chat header. The
   * parent (messenger-app) clears the active class chat and returns to the
   * conversation list. When undefined (older callers), the back button
   * isn't rendered at all — preserves the pre-phase-11 behavior.
   */
  onBack?: () => void;
  /**
   * Called when the user clicks a sender's avatar / full name in the chat
   * to start a 1:1 DM. The parent is responsible for POSTing to
   * /api/direct-chats and swapping the view. When undefined, the avatar /
   * name render as plain (non-clickable) elements — preserves the
   * pre-phase-10 behavior for callers that haven't been updated yet.
   */
  onStartDirectChat?: (otherUser: DirectChatUser) => void;
  /**
   * Phase 19 — called when the user taps the "مشاهده تکلیف" button on a
   * linked-assignment card message (forward-to-chat flow). The parent
   * (messenger-app) opens the assignments feature Sheet via
   * `setOpenFeature("assignments")` for the CURRENT class context. When
   * undefined, the button isn't rendered (older callers preserve their
   * pre-phase-19 behavior).
   */
  onOpenAssignment?: () => void;
  /**
   * Phase 19 — same as `onOpenAssignment` but for linked-sample-question
   * card messages (the button label is "مشاهده نمونه سوال" and the
   * parent opens `setOpenFeature("questions")`).
   */
  onOpenSampleQuestion?: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ----- State -----
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const [input, setInput] = useState("");
  const [connected, setConnected] = useState(false);
  const [typing, setTyping] = useState<TypingState | null>(null);

  const [chatClosed, setChatClosed] = useState<boolean>(initialChatClosed);
  const [chatClosedBy, setChatClosedBy] = useState<string | null>(null);

  // Create-poll dialog
  const [pollDialogOpen, setPollDialogOpen] = useState(false);

  // Chat-appearance settings dialog (ALL roles). The hook reads
  // `useDeviceType()` internally and only exposes the CURRENT device's slot,
  // so a phone user editing their settings never touches the desktop/tablet
  // slots. The chat root consumes the same hook below to apply the live
  // background + font-size.
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const appearance = useChatAppearance();
  const { resolvedTheme } = useTheme();

  // Resolve the CSS `background` value for the current settings + theme.
  // `default` is `transparent` so the chat root's `bg-muted` shows through.
  const chatBackgroundCss = resolveBackgroundCss(
    appearance.settings.background,
    resolvedTheme,
  );

  // File-upload-settings dialog (teacher/admin only). Tracks the latest
  // snapshot locally so the chat-input area can reflect changes immediately
  // after a successful save, before the classes query revalidates.
  const [fileSettingsOpen, setFileSettingsOpen] = useState(false);
  const [fileSettings, setFileSettings] = useState<Partial<FileSettings> | null>(
    initialFileSettings ?? null,
  );
  // Sync local file-settings state when the parent passes a different snapshot
  // (e.g. after switching class or after the classes query refetches).
  const [prevFileSettings, setPrevFileSettings] = useState(initialFileSettings);
  if (initialFileSettings !== prevFileSettings) {
    setPrevFileSettings(initialFileSettings);
    setFileSettings(initialFileSettings ?? null);
  }

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<TimelineItem | null>(null);

  // ----- Phase 17: message options state -----
  // `replyTo` — when set, the next sent message will be a reply to this id.
  // A preview bar appears above the message input. Cleared on send / cancel.
  const [replyTo, setReplyTo] = useState<ChatMessageWithDelete | null>(null);

  // `editingId` — when set, the MessageRow with this id switches its bubble
  // body to an inline Textarea + Save/Cancel. `editingContent` tracks the
  // draft text. `editSavingId` flags a per-row spinner while PATCH is in flight.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [editSavingId, setEditSavingId] = useState<string | null>(null);

  // Forward dialog — `mode: "single"` (one message) or `"batch"` (multiple
  // selected messages). `messageIds` is the list to forward. The dialog
  // renders the user's classes; on pick, we POST forward for each id and
  // emit `relay_message` per created message.
  const [forwardState, setForwardState] = useState<
    | { mode: "single" | "batch"; messageIds: string[] }
    | null
  >(null);

  // Seen-by dialog — `seenByMessageId` is the id of the message whose
  // readers we want to show. The dialog fetches `GET /api/messages/[id]/readers`
  // on open and renders an avatar + name + time list.
  const [seenByMessageId, setSeenByMessageId] = useState<string | null>(null);

  // Select mode — toggled from the message context menu ("انتخاب"). When on,
  // every message row renders a checkbox on the trailing edge; a sticky batch
  // action bar appears above the input with batch-forward / batch-delete /
  // cancel actions. `selectedIds` is the live set of selected message ids.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Batch-delete confirmation. The action bar's "حذف انتخابی‌ها" button opens
  // this dialog; on confirm we iterate `selectedIds` and DELETE each one.
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);

  // ----- Phase 18: group info dialog + save-message state -----
  // `groupInfoOpen` — when true, opens the GroupInfoDialog (Sheet) which
  // fetches GET /api/classes/[id]/info and lets the principal edit the
  // group's avatar / name / description / members. Triggered by clicking
  // the chat header's avatar + name.
  const [groupInfoOpen, setGroupInfoOpen] = useState(false);

  // `saveInFlightId` — when set, indicates the bookmark action for this
  // message id is currently in flight (POST or DELETE). Drives the
  // per-row spinner on the bookmark menu item.
  const [saveInFlightId, setSaveInFlightId] = useState<string | null>(null);

  // ----- File attachment state (phase 3) -----
  // `pendingFile` holds the user-selected file BEFORE upload. The chip preview
  // above the input reflects this state. `uploading` flips to true while the
  // POST /api/messages multipart request is in flight.
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  // Phase 27 — tracks whether the VoiceRecorder is currently recording.
  // On mobile/tablet, the composer hides the emoji button + paperclip +
  // textarea while recording, so the recording UI takes the full width
  // of the bottom bar (Telegram/WhatsApp pattern).
  const [isRecording, setIsRecording] = useState(false);
  const device = useDeviceType();
  const hideComposerForRecording =
    isRecording && (device === "mobile" || device === "tablet");

  // Phase 27 — "فقط مدیر و معلم" filter. When enabled (and the module
  // is globally enabled by the SUPERADMIN), the chat header shows a
  // Filter button. When active, STUDENT messages are hidden — only
  // TEACHER + ADMIN + SUPERADMIN messages render. The filtered list
  // flows naturally (no empty space between visible messages).
  const [teacherOnlyMode, setTeacherOnlyMode] = useState(false);
  const { data: siteSettings } = useSiteSettings();
  const teacherOnlyModuleEnabled =
    siteSettings?.modules?.teacherOnlyMessages ?? true;

  // Phase 28 — in-chat search. When the user clicks the header Search
  // button, the chat header transforms into a search input. The
  // filteredTimeline is then further filtered by the query (matches
  // against content + sender full name, case-insensitive). An empty
  // query shows all messages.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Phase 35 — Virtual Classroom state. `classroomOpen` opens the
  // ClassroomView Sheet (Google-Meet-style online class).
  const [classroomOpen, setClassroomOpen] = useState(false);

  // Phase 35b — fetch the current class's streaming flags from the
  // classes list. The /api/classes response includes `streamingEnabled`
  // (per-group) + `schoolStreamingEnabled` (per-school) on each class
  // item. We find the matching class by id.
  const { data: streamingClasses } = useQuery<ClassItem[]>({
    queryKey: ["classes", "streaming", classId],
    queryFn: () => fetchClasses(),
    staleTime: 10_000,
  });
  const currentClassStreaming = streamingClasses?.find((c) => c.id === classId);
  const groupStreamingEnabled = currentClassStreaming?.streamingEnabled ?? false;
  const schoolStreamingEnabled = currentClassStreaming?.schoolStreamingEnabled ?? true;
  // FAB is visible only when BOTH the school flag AND the group flag are ON.
  // The group flag defaults to OFF — a TEACHER must explicitly toggle it on
  // via the header icon.
  const streamingAllowed = schoolStreamingEnabled && groupStreamingEnabled;
  // Only TEACHER/ADMIN/SUPERADMIN can toggle the streaming flag for a group.
  // `isPrivileged` is declared below (line ~603) — we'll set
  // `canToggleStreaming` there. For now, just declare the toggling state.
  const [streamingToggling, setStreamingToggling] = useState(false);

  // Phase 28 — pinned messages. We keep an in-memory Set<string> of
  // pinned message ids. When a TEACHER/ADMIN/SUPERADMIN pins or unpins
  // a message via POST /api/messages/[id]/pin, we update the set + the
  // MessageRow re-renders with the Pin icon overlay. We DON'T have a
  // backend GET /api/messages that returns pinned status yet, so we
  // start empty (nothing pinned) — pins applied during this session
  // show up; persisted pins from previous sessions aren't shown until
  // the backend ships the joined response. That's a known limitation;
  // the SUPERADMIN/principal can still pin a message again to re-show
  // the indicator.
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const canPin = user.role === "TEACHER" || user.role === "ADMIN";
  const handleTogglePin = useCallback(
    async (messageId: string, pin: boolean) => {
      // Optimistic update — flip the local Set immediately.
      setPinnedIds((cur) => {
        const next = new Set(cur);
        if (pin) next.add(messageId);
        else next.delete(messageId);
        return next;
      });
      try {
        await apiFetch<{ id: string; pinned: boolean }>(
          `/api/messages/${encodeURIComponent(messageId)}/pin`,
          {
            method: "POST",
            body: JSON.stringify({ pin }),
          },
        );
        toast({
          title: pin ? "پیام سنجاق شد" : "سنجاق پیام حذف شد",
        });
      } catch (err) {
        // Roll back on error.
        setPinnedIds((cur) => {
          const next = new Set(cur);
          if (pin) next.delete(messageId);
          else next.add(messageId);
          return next;
        });
        toast({
          title: pin ? "سنجاق پیام ناموفق بود" : "حذف سنجاق ناموفق بود",
          description: err instanceof Error ? err.message : "خطای غیرمنتظره",
          variant: "destructive",
        });
      }
    },
    [toast],
  );

  // ----- Refs -----
  const socketRef = useRef<Socket | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingEmitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingEmitRef = useRef<boolean>(false);
  const wasNearBottomRef = useRef<boolean>(true);
  const isRestoringScrollRef = useRef<boolean>(false);
  const initializedForClassRef = useRef<string | null>(null);
  // Hidden <input type="file"> ref — clicked programmatically by the paperclip
  // button so we can keep the input out of the visual layout.
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Phase 26 — the composer now uses a <Textarea> instead of a single-line
  // <Input>. This ref lets us insert emojis at the cursor position + auto-
  // resize the textarea (max ~5 rows) as the user types multi-line text.
  const inputTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-resize the composer textarea to fit its content (capped at ~5 rows
  // so long messages don't push the chat viewport out of view). Called from
  // the textarea's onChange handler + reset to single-row whenever `input`
  // becomes empty (after send / cancel reply / clear).
  const adjustTextareaHeight = useCallback(() => {
    const ta = inputTextareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, []);

  // ----- Derived flags -----
  // The user is treated as a "teacher of the class" if either their
  // user-level role is ADMIN, or they're a TEACHER. (We don't know the
  // per-class membership role here without a fetch — but ADMIN always
  // has full powers, and TEACHER users in this messenger were enrolled
  // as TEACHER. The server still enforces real membership.)
  const isPrivileged = user.role === "ADMIN" || user.role === "TEACHER";
  // Phase 35b — canToggleStreaming = isPrivileged (TEACHER/ADMIN can toggle
  // the per-group streaming flag). Declared here AFTER isPrivileged to
  // avoid the "Cannot access before initialization" error.
  const canToggleStreaming = isPrivileged;

  // ----- File-upload-derived flags -----
  // The class-level file-upload settings. Fall back to schema defaults
  // (enabled=true, maxFileSizeMb=10, allowedFileTypes=null = all allowed)
  // when the API hasn't populated them yet.
  const fileUploadEnabled = fileSettings?.fileUploadEnabled ?? true;
  const maxFileSizeMb = fileSettings?.maxFileSizeMb ?? 0; // 0 = unlimited
  const allowedFileTypes = fileSettings?.allowedFileTypes ?? null;

  // The paperclip button is disabled when:
  //   - the socket isn't connected
  //   - OR the chat is closed AND the user is a student (students can't post)
  //   - OR file uploads are disabled for the class
  const fileAttachDisabled =
    !connected || (chatClosed && !isPrivileged) || !fileUploadEnabled;

  // -------------------- Helpers --------------------

  const isOwnMessage = useCallback(
    (m: { sender?: { id?: string }; senderId?: string }) => {
      const senderId = m.sender?.id ?? m.senderId;
      return senderId === user.id;
    },
    [user.id],
  );

  const scrollToBottom = useCallback((smooth = false) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior: smooth ? "smooth" : "auto",
    });
  }, []);

  // -------------------- Initial history load (messages + polls) --------------------

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setTimeline([]);
    setHasMore(false);
    setNextCursor(null);
    setChatClosed(initialChatClosed);
    initializedForClassRef.current = null;

    async function loadInitial() {
      // Fire messages + polls in parallel. Polls endpoint may not exist
      // yet (Task 2-a phase-2 running in parallel) — fail gracefully.
      const [messagesResult, pollsResult] = await Promise.allSettled([
        fetchMessages({ classId, limit: LOAD_LIMIT }),
        fetchPolls(classId),
      ]);

      if (cancelled) return;

      const items: TimelineItem[] = [];

      if (messagesResult.status === "fulfilled") {
        const res = messagesResult.value;
        // API returns newest first; reverse for chronological display.
        const chronological = [...res.data].reverse().map(toTimelineMessage);
        items.push(...chronological);
        setHasMore(res.hasMore);
        setNextCursor(res.nextCursor);
      } else {
        const err = messagesResult.reason as Error | undefined;
        toast({
          title: "خطا در بارگذاری پیام‌ها",
          description: err?.message || "خطای غیرمنتظره",
          variant: "destructive",
        });
      }

      if (pollsResult.status === "fulfilled") {
        const polls = pollsResult.value ?? [];
        items.push(...polls.map(toTimelinePoll));
      }
      // Polls failure is silent — chat still works without polls.

      if (!cancelled) {
        setTimeline(sortTimeline(items));
        setLoading(false);
        requestAnimationFrame(() =>
          requestAnimationFrame(() => scrollToBottom()),
        );
      }

      // Phase 17: fire-and-forget the mark-all-read REST call so the
      // backend upserts MessageRead rows for this user in this class. The
      // socket `mark_read` event is emitted in the `ready` handler above
      // (we don't have a connected socket here in loadInitial's scope).
      // Failures are swallowed by `markClassRead` itself — read receipts
      // are best-effort; the chat still works without them.
      void markClassRead(classId);
    }
    void loadInitial();
    return () => {
      cancelled = true;
    };
  }, [classId, toast, scrollToBottom, initialChatClosed]);

  // -------------------- Socket.io connection --------------------

  useEffect(() => {
    // Phase 35k — use XTransformPort for the live preview (works through
    // the Caddy gateway). The deployed URL's FC blocks XTransformPort
    // (502) — the Socket.io client will fail to connect + show "قطع ارتباط"
    // in the deployed version. The chat still works via REST API (messages
    // are fetched/sent via /api/messages), just without real-time updates.
    const socket = io("/?XTransformPort=3003", {
      // SECURITY: verified server-side via shared-secret JWT issued to the
      // NextAuth session — client identity fields are not trusted.
      auth: socketAuthCallback(),
      transports: ["websocket", "polling"],
      reconnection: true,
      // Phase 24 fix: previously reconnectionAttempts=10 meant the socket
      // gave up after ~10 seconds of retrying → permanent "قطع ارتباط"
      // banner until manual page refresh. Now we retry effectively forever
      // (Infinity isn't serializable across the socket.io manager, so we
      // use a very large number) with a 2s base delay capped at 10s.
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 10000,
      timeout: 20000,
    });
    socketRef.current = socket;

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", () => setConnected(false));

    socket.on("ready", () => {
      if (initializedForClassRef.current === classId) return;
      initializedForClassRef.current = classId;
      socket.emit("join_class", { classId });
      // Phase 17: mark all messages in this class as read for the calling
      // user. The REST call upserts MessageRead rows server-side; the socket
      // event lets other connected clients live-bump their `readCount`
      // counters on messages they sent. The REST call is best-effort (silent
      // on failure) since the endpoint may not be deployed yet.
      socket.emit("mark_read", { classId });
    });

    // ----- new_message -----
    socket.on("new_message", (raw: SocketNewMessage) => {
      const msg: ChatMessageWithDelete = {
        id: raw.id,
        classId: raw.classId,
        content: raw.content,
        createdAt: raw.createdAt,
        sender: {
          id: raw.senderId,
          fullName: raw.senderName,
          role: raw.senderRole,
          username: "",
          avatar: raw.senderAvatar ?? null,
        },
        // Preserve file-attachment fields so file-bearing messages broadcast
        // via `send_message` (text-only, fields null) or `relay_message`
        // (file messages uploaded via REST) render through the same path.
        senderId: raw.senderId,
        fileUrl: raw.fileUrl ?? null,
        fileName: raw.fileName ?? null,
        fileType: raw.fileType ?? null,
        fileSize: raw.fileSize ?? null,
        mimeType: raw.mimeType ?? null,
        // Phase 17: reply / forward / edit metadata. The chat-service may
        // strip these when normalizing the broadcast payload (relay_message),
        // so we coerce to null/undefined defensively. When the broadcast
        // carries them (e.g. a reply created via REST + relay_message), the
        // renderer shows the quote preview / forwarded / edited badge.
        replyToId: raw.replyToId ?? null,
        forwardedFromId: raw.forwardedFromId ?? null,
        editedAt: raw.editedAt ?? null,
        replyTo: raw.replyTo ?? null,
        readCount: typeof raw.readCount === "number" ? raw.readCount : 0,
        // Phase 18 — bookmark metadata. The chat-service doesn't broadcast
        // save / unsave events (each user's bookmarks are private), so
        // the broadcast payload may not include them — default to false/0.
        isSaved: raw.isSaved === true,
        savedCount: typeof raw.savedCount === "number" ? raw.savedCount : 0,
      };
      setTimeline((prev) => {
        if (prev.find((it) => it.id === msg.id)) return prev;
        return sortTimeline([...prev, toTimelineMessage(msg)]);
      });
      if (wasNearBottomRef.current) {
        requestAnimationFrame(() => scrollToBottom(true));
      }
    });

    // ----- message_deleted -----
    socket.on("message_deleted", (payload: SocketMessageDeleted) => {
      if (!payload?.id) return;
      setTimeline((prev) => prev.filter((it) => it.id !== payload.id));
    });

    // ----- message_edited (phase 17) -----
    // Broadcast by the chat-service when ANY client emits `edit_message`
    // { messageId, content } and the server successfully PATCHes the row.
    // We live-update the matching timeline bubble + clear our own editing
    // state if WE were the editor (the editor's optimistic update is already
    // in place — this just confirms the server's authoritative editedAt).
    socket.on("message_edited", (payload: SocketMessageEdited) => {
      if (!payload?.id) return;
      setTimeline((prev) =>
        prev.map((it) => {
          if (it.kind !== "message" || it.id !== payload.id) return it;
          const updated: ChatMessageWithDelete = {
            ...it.data,
            content: payload.content,
            editedAt: payload.editedAt,
          };
          return { ...it, data: updated };
        }),
      );
    });

    // ----- poll_created -----
    socket.on("poll_created", (payload: SocketPollCreated) => {
      const poll = payload?.poll;
      if (!poll?.id) return;
      setTimeline((prev) => {
        if (prev.find((it) => it.id === poll.id)) return prev;
        return sortTimeline([...prev, toTimelinePoll(poll)]);
      });
      if (wasNearBottomRef.current) {
        requestAnimationFrame(() => scrollToBottom(true));
      }
    });

    // ----- poll_updated -----
    socket.on("poll_updated", (payload: SocketPollUpdated) => {
      if (!payload?.id) return;
      setTimeline((prev) =>
        prev.map((it) => {
          if (it.kind !== "poll" || it.id !== payload.id) return it;
          const updated: Poll = {
            ...it.data,
            optionVotes: payload.optionVotes ?? it.data.optionVotes,
            totalVotes:
              typeof payload.totalVotes === "number"
                ? payload.totalVotes
                : it.data.totalVotes,
          };
          return { ...it, data: updated };
        }),
      );
    });

    // ----- poll_closed -----
    socket.on("poll_closed", (payload: SocketPollClosed) => {
      if (!payload?.id) return;
      setTimeline((prev) =>
        prev.map((it) => {
          if (it.kind !== "poll" || it.id !== payload.id) return it;
          const updated: Poll = {
            ...it.data,
            closedAt: payload.closedAt ?? it.data.closedAt,
          };
          return { ...it, data: updated };
        }),
      );
    });

    // ----- chat_closed / chat_opened -----
    socket.on("chat_closed", (payload: SocketChatClosed) => {
      if (!payload || payload.classId !== classId) return;
      setChatClosed(Boolean(payload.chatClosed));
      const closedByName =
        typeof payload.closedBy === "string"
          ? payload.closedBy
          : payload.closedBy?.fullName ?? null;
      setChatClosedBy(closedByName);
    });
    socket.on("chat_opened", (payload: SocketChatOpened) => {
      if (!payload || payload.classId !== classId) return;
      setChatClosed(Boolean(payload.chatClosed));
      setChatClosedBy(null);
    });

    // ----- typing -----
    socket.on("user_typing", (p: SocketTyping) => {
      if (!p?.isTyping) {
        setTyping(null);
        return;
      }
      // Don't show typing for the current user.
      if (p.userId === user.id) return;
      setTyping({
        fullName: p.fullName,
        expiresAt: Date.now() + TYPING_TIMEOUT_MS,
      });
    });

    // ----- error -----
    socket.on("error", (err: { message?: string }) => {
      if (err?.message) {
        toast({
          title: "خطای چت",
          description: err.message,
          variant: "destructive",
        });
      }
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      if (typingEmitTimerRef.current) clearTimeout(typingEmitTimerRef.current);
    };
  }, [classId, user.id, user.username, user.name, user.role, toast]);

  // -------------------- Typing indicator expiry --------------------

  useEffect(() => {
    if (!typing) return;
    const ms = Math.max(0, typing.expiresAt - Date.now());
    const t = setTimeout(() => setTyping(null), ms || TYPING_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [typing]);

  // -------------------- Scroll handler (pagination + near-bottom) --------------------

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    // Block handleScroll from re-triggering loadMore while we're
    // prepending messages + restoring the scroll position.
    isRestoringScrollRef.current = true;
    const prevScrollHeight = viewportRef.current?.scrollHeight ?? 0;
    const prevScrollTop = viewportRef.current?.scrollTop ?? 0;
    try {
      const res = await fetchMessages({
        classId,
        cursor: nextCursor,
        limit: LOAD_LIMIT,
      });
      const older = [...res.data].reverse().map(toTimelineMessage);
      setTimeline((prev) => sortTimeline([...older, ...prev]));
      setHasMore(res.hasMore);
      setNextCursor(res.nextCursor);
      // Use double rAF to ensure the DOM has fully rendered (including
      // the loading spinner removal) before we restore the scroll position.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const viewport = viewportRef.current;
          if (!viewport) {
            isRestoringScrollRef.current = false;
            return;
          }
          const newScrollHeight = viewport.scrollHeight;
          const delta = newScrollHeight - prevScrollHeight;
          viewport.scrollTop = prevScrollTop + delta;
          // Release the block AFTER the scroll position is restored,
          // so the next onScroll event sees the correct position.
          isRestoringScrollRef.current = false;
        });
      });
    } catch (err: any) {
      isRestoringScrollRef.current = false;
      toast({
        title: "خطا در بارگذاری پیام‌های قدیمی",
        description: err?.message || "خطای غیرمنتظره",
        variant: "destructive",
      });
    } finally {
      setLoadingMore(false);
    }
  }, [classId, nextCursor, loadingMore, toast]);

  const handleScroll = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const { scrollTop, scrollHeight, clientHeight } = viewport;
    const nearBottom = scrollHeight - scrollTop - clientHeight < 120;
    wasNearBottomRef.current = nearBottom;
    // Skip auto-load while restoring scroll position (after loadMore
    // prepended older messages). Without this guard, the scroll event
    // fired by the DOM update would re-trigger loadMore in a loop.
    if (isRestoringScrollRef.current) return;
    if (scrollTop < 200 && hasMore && !loadingMore && !loading) {
      void loadMore();
    }
  }, [hasMore, loadingMore, loading, loadMore]);

  // -------------------- File attachment (phase 3) --------------------

  /**
   * Validate the user-selected file against the class's file-upload settings
   * BEFORE posting to the server. Returns `null` if the file is acceptable,
   * or a Persian error message if it should be rejected client-side. The
   * server still re-validates everything (defence in depth).
   */
  const validatePendingFile = useCallback(
    (file: File): string | null => {
      if (!fileUploadEnabled) {
        return "ارسال فایل در این کلاس غیرفعال است";
      }
      if (allowedFileTypes && allowedFileTypes.length > 0) {
        const category = categorizeFile(file);
        if (!allowedFileTypes.includes(category)) {
          return `این نوع فایل مجاز نیست. انواع مجاز: ${formatFileTypesLabel(allowedFileTypes)}`;
        }
      }
      if (maxFileSizeMb > 0) {
        const maxBytes = maxFileSizeMb * 1024 * 1024;
        if (file.size > maxBytes) {
          return `حداکثر حجم فایل ${toPersianDigits(maxFileSizeMb)} مگابایت است`;
        }
      }
      return null;
    },
    [fileUploadEnabled, allowedFileTypes, maxFileSizeMb],
  );

  /**
   * Open the OS file picker by clicking the hidden <input type="file">.
   * Called when the user clicks the paperclip button.
   */
  const handlePickFile = useCallback(() => {
    if (fileAttachDisabled) return;
    fileInputRef.current?.click();
  }, [fileAttachDisabled]);

  /**
   * Stage a user-selected file in `pendingFile` (the chip preview appears
   * above the input). Called from the file picker's onChange handler AND
   * from the VoiceRecorder (Phase 26) when the user sends a voice message.
   *
   * Validates the file client-side (settings, size, type) — if invalid,
   * toasts the Persian error and aborts (does NOT clear the picker value,
   * so the user can retry the same file after the toast).
   */
  const stageFile = useCallback(
    (file: File) => {
      const error = validatePendingFile(file);
      if (error) {
        toast({
          title: "ارسال فایل ممکن نیست",
          description: error,
          variant: "destructive",
        });
        return;
      }
      setPendingFile(file);
    },
    [validatePendingFile, toast],
  );

  /**
   * Remove the staged file from the chip preview (e.g. user changed their
   * mind). Does NOT touch the text input — the caption (if any) stays.
   */
  const handleRemovePendingFile = useCallback(() => {
    setPendingFile(null);
  }, []);

  /**
   * Phase 28 — extracted core upload helper. Takes a file directly (no
   * pendingFile dependency), validates it client-side, optimistically
   * appends a placeholder bubble, calls POST /api/messages multipart,
   * replaces the placeholder with the persisted row, and emits
   * `relay_message` so other clients get the message in real-time.
   *
   * Does NOT touch pendingFile / input / replyTo state — the caller is
   * responsible for clearing those if appropriate (e.g. the staged
   * single-file path clears them; the multi-file loop doesn't).
   *
   * Does NOT manage `uploading` state either — the caller manages it so
   * multi-file uploads only flip the spinner once for the whole batch.
   */
  const uploadOneFileNow = useCallback(
    async (file: File, caption: string) => {
      // Validate before posting — defence in depth.
      const validationError = validatePendingFile(file);
      if (validationError) {
        toast({
          title: "ارسال فایل ممکن نیست",
          description: validationError,
          variant: "destructive",
        });
        return;
      }
      // Students cannot send when chat is closed.
      if (chatClosed && !isPrivileged) {
        toast({
          title: "گفتگو بسته است",
          description: "این گفتگو توسط استاد بسته شده است.",
          variant: "destructive",
        });
        return;
      }

      const tempId = `__optim_file__${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const optimistic: ChatMessageWithDelete = {
        id: tempId,
        classId,
        content: caption,
        createdAt: new Date().toISOString(),
        sender: {
          id: user.id,
          fullName: user.name,
          role: user.role,
          username: user.username,
          avatar: user.avatar ?? null,
        },
        senderId: user.id,
        fileUrl: null,
        fileName: file.name,
        fileType: categorizeFile(file),
        fileSize: file.size,
        mimeType: file.type || null,
      };
      setTimeline((prev) =>
        sortTimeline([...prev, toTimelineMessage(optimistic)]),
      );
      wasNearBottomRef.current = true;
      requestAnimationFrame(() => scrollToBottom(true));

      try {
        const created = await postMessageWithFile({
          classId,
          content: caption || undefined,
          file,
          replyToId: replyTo?.id ?? null,
        });

        setTimeline((prev) => {
          const withoutTemp = prev.filter((m) => m.id !== tempId);
          if (withoutTemp.find((m) => m.id === created.id)) {
            return withoutTemp;
          }
          const enriched: ChatMessageWithDelete = {
            ...created,
            replyToId: created.replyToId ?? (replyTo?.id ?? null),
            replyTo:
              created.replyTo ??
              (replyTo
                ? {
                    id: replyTo.id,
                    content: replyTo.content,
                    sender: {
                      id: replyTo.sender.id,
                      fullName: replyTo.sender.fullName,
                      role: replyTo.sender.role,
                    },
                  }
                : null),
          };
          return sortTimeline([...withoutTemp, toTimelineMessage(enriched)]);
        });

        const socket = socketRef.current;
        if (socket?.connected) {
          socket.emit("relay_message", {
            classId,
            message: {
              id: created.id,
              classId: created.classId,
              senderId: created.senderId ?? created.sender.id,
              senderName: created.sender.fullName,
              senderRole: created.sender.role,
              senderAvatar: created.sender.avatar ?? null,
              content: created.content,
              createdAt: created.createdAt,
              fileUrl: created.fileUrl ?? null,
              fileName: created.fileName ?? null,
              fileType: created.fileType ?? null,
              fileSize: created.fileSize ?? null,
              mimeType: created.mimeType ?? null,
              replyToId: created.replyToId ?? (replyTo?.id ?? null),
              forwardedFromId: created.forwardedFromId ?? null,
              editedAt: created.editedAt ?? null,
              replyTo:
                created.replyTo ??
                (replyTo
                  ? {
                      id: replyTo.id,
                      content: replyTo.content,
                      sender: {
                        id: replyTo.sender.id,
                        fullName: replyTo.sender.fullName,
                        role: replyTo.sender.role,
                      },
                    }
                  : null),
            },
          });
        }
      } catch (err: any) {
        // Remove the optimistic placeholder on failure.
        setTimeline((prev) => prev.filter((m) => m.id !== tempId));
        toast({
          title: "بارگذاری فایل ناموفق بود",
          description: err?.message || "خطای غیرمنتظره",
          variant: "destructive",
        });
      }
    },
    [
      validatePendingFile,
      chatClosed,
      isPrivileged,
      classId,
      user.id,
      user.name,
      user.role,
      user.username,
      user.avatar,
      toast,
      scrollToBottom,
      replyTo,
    ],
  );

  /**
   * Upload the staged file via POST /api/messages (multipart). On success:
   *   - Optimistically replaces the staged chip with a real timeline item.
   *   - Emits socket `relay_message { classId, message: createdMessage }`
   *     so OTHER clients in the room (and this sender, via the broadcast
   *     round-trip) get the message. The local append + the broadcast are
   *     deduped by message id in the `new_message` handler.
   *   - Clears the chip + the text input.
   * On error: toasts the Persian error from the API and KEEPS the chip so
   * the user can retry (or remove it manually via the ✕ on the chip).
   *
   * Phase 28 — the core upload path is now in `uploadOneFileNow` above;
   * this wrapper layers the staged-file lifecycle on top (managing the
   * pendingFile + input + replyTo + uploading + toast).
   */
  const handleUploadFile = useCallback(async () => {
    const file = pendingFile;
    if (!file || uploading) return;

    setUploading(true);
    try {
      const caption = input.trim();
      await uploadOneFileNow(file, caption);
      // Clear the staged file + the (optional) caption + the reply state.
      // (Only clear when the upload actually completed — on error, keep
      // the chip so the user can retry.)
      setPendingFile(null);
      setInput("");
      const socket = socketRef.current;
      setReplyTo(null);
      if (lastTypingEmitRef.current && socket?.connected) {
        socket.emit("typing", { classId, isTyping: false });
        lastTypingEmitRef.current = false;
      }
      toast({ title: "فایل ارسال شد" });
    } finally {
      setUploading(false);
    }
  }, [
    pendingFile,
    uploading,
    input,
    uploadOneFileNow,
    classId,
    toast,
  ]);

  /**
   * Handle a file (or files) selected from the picker. Resets the input
   * value (so the same file can be re-picked after the user removes it via
   * the chip ✕) and delegates the validation + staging to `stageFile`.
   *
   * Phase 28 — multi-file: the input now accepts `multiple` files. The
   * FIRST file is staged via `stageFile` (existing chip-preview flow —
   * user sees the chip + can add a caption + send). The remaining files
   * are uploaded SEQUENTIALLY in the background via `uploadOneFileNow`
   * (each becomes its own message immediately, no chip preview).
   */
  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files ? Array.from(e.target.files) : [];
      // Reset the input value so the same file(s) can be picked again
      // after the user removes them via the chip ✕. Without this, the
      // change event won't fire for the same path twice.
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (files.length === 0) return;
      // Stage the first file via the existing chip-preview flow.
      const [first, ...rest] = files;
      stageFile(first);
      if (rest.length === 0) return;
      // Sequentially upload the remaining files. Each one optimistically
      // appends a placeholder + replaces with the real persisted row.
      // The replyTo preview is included when set so multi-file replies
      // to a specific message all quote the same parent.
      setUploading(true);
      try {
        for (const f of rest) {
          // eslint-disable-next-line no-await-in-loop
          await uploadOneFileNow(f, "");
        }
      } finally {
        setUploading(false);
      }
    },
    [stageFile, uploadOneFileNow],
  );

  // -------------------- Send message --------------------

  const sendMessage = useCallback(
    (e?: FormEvent) => {
      e?.preventDefault();
      // If the user has a file staged for upload, route to the upload path
      // instead of the text-only socket event. The upload path also takes
      // the optional text caption in the input box.
      if (pendingFile) {
        void handleUploadFile();
        return;
      }
      const content = input.trim();
      if (!content) return;
      const socket = socketRef.current;
      if (!socket || !socket.connected) {
        toast({
          title: "اتصال برقرار نیست",
          description: "لطفاً چند لحظه صبر کنید و دوباره تلاش کنید.",
          variant: "destructive",
        });
        return;
      }
      // Students cannot send when chat is closed.
      if (chatClosed && !isPrivileged) {
        toast({
          title: "گفتگو بسته است",
          description: "این گفتگو توسط استاد بسته شده است.",
          variant: "destructive",
        });
        return;
      }

      const tempId = `__optim__${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const optimistic: ChatMessageWithDelete = {
        id: tempId,
        classId,
        content,
        createdAt: new Date().toISOString(),
        sender: {
          id: user.id,
          fullName: user.name,
          role: user.role,
          username: user.username,
          avatar: user.avatar ?? null,
        },
        // Phase 17 — when replying, the optimistic bubble shows the quote
        // preview immediately so the user sees their reply land in context.
        replyToId: replyTo?.id ?? null,
        replyTo: replyTo
          ? {
              id: replyTo.id,
              content: replyTo.content,
              sender: {
                id: replyTo.sender.id,
                fullName: replyTo.sender.fullName,
                role: replyTo.sender.role,
              },
            }
          : null,
      };
      setTimeline((prev) =>
        sortTimeline([...prev, toTimelineMessage(optimistic)]),
      );
      setInput("");
      wasNearBottomRef.current = true;
      requestAnimationFrame(() => scrollToBottom(true));

      if (lastTypingEmitRef.current && socket.connected) {
        socket.emit("typing", { classId, isTyping: false });
        lastTypingEmitRef.current = false;
      }

      // Phase 17 — when `replyTo` is set, the message MUST go through the
      // REST POST /api/messages JSON path so the backend persists `replyToId`.
      // The socket `send_message` event has no reply field in the chat-service
      // contract yet (Task-2 phase-17 may add it). After REST returns, we
      // replace the optimistic placeholder with the real row + emit
      // `relay_message` so OTHER clients in the room see the reply (the
      // chat-service dedupes by id on the sender side).
      if (replyTo) {
        const repliedTo = replyTo;
        void (async () => {
          try {
            const created = await postMessage({
              classId,
              content,
              replyToId: repliedTo.id,
            });
            setTimeline((prev) => {
              const withoutTemp = prev.filter((m) => m.id !== tempId);
              if (withoutTemp.find((m) => m.id === created.id)) {
                return withoutTemp;
              }
              const enriched: ChatMessageWithDelete = {
                ...created,
                replyToId: created.replyToId ?? repliedTo.id,
                replyTo:
                  created.replyTo ??
                  {
                    id: repliedTo.id,
                    content: repliedTo.content,
                    sender: {
                      id: repliedTo.sender.id,
                      fullName: repliedTo.sender.fullName,
                      role: repliedTo.sender.role,
                    },
                  },
              };
              return sortTimeline([...withoutTemp, toTimelineMessage(enriched)]);
            });
            // Relay to other clients in the room. Include the phase-17 fields
            // in case the chat-service forwards them.
            if (socket?.connected) {
              socket.emit("relay_message", {
                classId,
                message: {
                  id: created.id,
                  classId: created.classId,
                  senderId: created.senderId ?? created.sender.id,
                  senderName: created.sender.fullName,
                  senderRole: created.sender.role,
                  senderAvatar: created.sender.avatar ?? null,
                  content: created.content,
                  createdAt: created.createdAt,
                  fileUrl: created.fileUrl ?? null,
                  fileName: created.fileName ?? null,
                  fileType: created.fileType ?? null,
                  fileSize: created.fileSize ?? null,
                  mimeType: created.mimeType ?? null,
                  replyToId: created.replyToId ?? repliedTo.id,
                  forwardedFromId: created.forwardedFromId ?? null,
                  editedAt: created.editedAt ?? null,
                  replyTo:
                    created.replyTo ??
                    {
                      id: repliedTo.id,
                      content: repliedTo.content,
                      sender: {
                        id: repliedTo.sender.id,
                        fullName: repliedTo.sender.fullName,
                        role: repliedTo.sender.role,
                      },
                    },
                },
              });
            }
            setReplyTo(null);
          } catch (err: any) {
            setTimeline((prev) => prev.filter((m) => m.id !== tempId));
            toast({
              title: "ارسال ناموفق",
              description: err?.message || "خطای غیرمنتظره",
              variant: "destructive",
            });
          }
        })();
        return;
      }

      socket.emit(
        "send_message",
        { classId, content },
        (ack: {
          ok?: boolean;
          message?: SocketNewMessage;
          error?: { message?: string };
        }) => {
          if (ack?.ok && ack.message) {
            setTimeline((prev) => {
              const withoutTemp = prev.filter((m) => m.id !== tempId);
              if (withoutTemp.find((m) => m.id === ack.message!.id)) {
                return withoutTemp;
              }
              const real: ChatMessageWithDelete = {
                id: ack.message!.id,
                classId: ack.message!.classId,
                content: ack.message!.content,
                createdAt: ack.message!.createdAt,
                sender: {
                  id: ack.message!.senderId,
                  fullName: ack.message!.senderName,
                  role: ack.message!.senderRole,
                  username: "",
                  avatar: ack.message!.senderAvatar ?? null,
                },
                // Text-only send_message acks always have null file fields.
                fileUrl: ack.message!.fileUrl ?? null,
                fileName: ack.message!.fileName ?? null,
                fileType: ack.message!.fileType ?? null,
                fileSize: ack.message!.fileSize ?? null,
                mimeType: ack.message!.mimeType ?? null,
                // Phase 17 — pick up reply/forward/edited metadata if the
                // chat-service happens to broadcast them.
                replyToId: ack.message!.replyToId ?? null,
                forwardedFromId: ack.message!.forwardedFromId ?? null,
                editedAt: ack.message!.editedAt ?? null,
                replyTo: ack.message!.replyTo ?? null,
                readCount:
                  typeof ack.message!.readCount === "number"
                    ? ack.message!.readCount
                    : 0,
              };
              return sortTimeline([...withoutTemp, toTimelineMessage(real)]);
            });
          } else if (ack?.error?.message) {
            setTimeline((prev) => prev.filter((m) => m.id !== tempId));
            toast({
              title: "ارسال ناموفق",
              description: ack.error.message,
              variant: "destructive",
            });
          }
        },
      );
    },
    [
      input,
      classId,
      user.id,
      user.name,
      user.role,
      user.username,
      user.avatar,
      toast,
      scrollToBottom,
      chatClosed,
      isPrivileged,
      pendingFile,
      handleUploadFile,
      replyTo,
    ],
  );

  // -------------------- Typing emit --------------------

  const handleInputChange = useCallback(
    (value: string) => {
      setInput(value);
      const socket = socketRef.current;
      if (!socket || !socket.connected) return;

      if (value.trim().length > 0 && !lastTypingEmitRef.current) {
        socket.emit("typing", { classId, isTyping: true });
        lastTypingEmitRef.current = true;
        if (typingEmitTimerRef.current) clearTimeout(typingEmitTimerRef.current);
        typingEmitTimerRef.current = setTimeout(() => {
          lastTypingEmitRef.current = false;
        }, 1200);
      }
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      typingTimerRef.current = setTimeout(() => {
        if (socket.connected && lastTypingEmitRef.current) {
          socket.emit("typing", { classId, isTyping: false });
          lastTypingEmitRef.current = false;
        }
      }, 2000);
    },
    [classId],
  );

  // -------------------- Phase 26: emoji insertion --------------------

  /**
   * Insert an emoji at the current cursor position in the composer textarea.
   * If the textarea isn't focused (no selection), append it to the end.
   * After insertion, restore the cursor just past the emoji so the user can
   * keep typing. The picker stays open so the user can pick more emojis.
   *
   * `handleInputChange` is reused so the typing-indicator emit + socket
   * typing broadcast fire identically to a typed character.
   */
  const handleEmojiSelect = useCallback(
    (emoji: string) => {
      const ta = inputTextareaRef.current;
      if (!ta) {
        // Fallback: just append.
        handleInputChange(input + emoji);
        return;
      }
      const start = ta.selectionStart ?? input.length;
      const end = ta.selectionEnd ?? input.length;
      const next = input.slice(0, start) + emoji + input.slice(end);
      handleInputChange(next);
      // Restore the cursor after the inserted emoji. rAF so the value has
      // propagated through React's controlled-input re-render first.
      requestAnimationFrame(() => {
        ta.focus();
        const pos = start + emoji.length;
        ta.setSelectionRange(pos, pos);
        // Also re-fit the textarea height (the new content may wrap).
        adjustTextareaHeight();
      });
    },
    [input, handleInputChange, adjustTextareaHeight],
  );

  // Reset the textarea height to a single row whenever the input clears
  // (after sending a message / cancelling a reply / clearing the draft).
  // Without this, the textarea stays expanded after the text vanishes.
  useEffect(() => {
    if (input === "") {
      const ta = inputTextareaRef.current;
      if (ta) ta.style.height = "auto";
    }
  }, [input]);

  // -------------------- Delete message --------------------

  const canDeleteMessage = useCallback(
    (m: ChatMessageWithDelete): boolean => {
      // Admins and teachers can delete any message.
      if (isPrivileged) return true;
      // Students can delete their own messages within 12h of creation.
      if (!isOwnMessage(m)) return false;
      const created = new Date(m.createdAt).getTime();
      if (Number.isNaN(created)) return false;
      return Date.now() - created < STUDENT_DELETE_WINDOW_MS;
    },
    [isPrivileged, isOwnMessage],
  );

  const handleDeleteConfirm = useCallback(async () => {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target || target.kind !== "message") return;
    const messageId = target.id;
    // Optimistically remove from list.
    setTimeline((prev) => prev.filter((it) => it.id !== messageId));
    try {
      await deleteMessage(messageId);
      // Also broadcast the delete to other connected clients.
      const socket = socketRef.current;
      if (socket?.connected) {
        socket.emit("delete_message", { messageId });
      }
      toast({ title: "پیام حذف شد" });
    } catch (err: any) {
      // Restore on failure.
      setTimeline((prev) => sortTimeline([...prev, target]));
      toast({
        title: "حذف ناموفق",
        description: err?.message || "خطای غیرمنتظره",
        variant: "destructive",
      });
    }
  }, [deleteTarget, toast]);

  // -------------------- Phase 17: edit / reply / forward / seen-by / select --------------------

  /**
   * Whether the calling user may EDIT a given message. Mirrors the backend's
   * rule: the SENDER can edit their own message within 12h of `createdAt`;
   * ADMIN / SUPERADMIN (privileged) can edit any message anytime.
   */
  const canEditMessage = useCallback(
    (m: ChatMessageWithDelete): boolean => {
      if (isPrivileged) return true;
      if (!isOwnMessage(m)) return false;
      const created = new Date(m.createdAt).getTime();
      if (Number.isNaN(created)) return false;
      return Date.now() - created < STUDENT_DELETE_WINDOW_MS;
    },
    [isPrivileged, isOwnMessage],
  );

  /** Switch the message's bubble into inline-edit mode (textarea + Save/Cancel). */
  const handleStartEdit = useCallback((m: ChatMessageWithDelete) => {
    setEditingId(m.id);
    setEditingContent(m.content ?? "");
  }, []);

  /** Abort inline-edit mode without saving. */
  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setEditingContent("");
    setEditSavingId(null);
  }, []);

  /**
   * Save the inline-edited content. PATCH /api/messages/[id] { content },
   * optimistically update the bubble, emit `edit_message { messageId, content }`
   * over the socket so other clients get the `message_edited` broadcast and
   * live-update their copy. On error: toast + revert to the original content.
   */
  const handleSaveEdit = useCallback(
    async (messageId: string) => {
      const trimmed = editingContent.trim();
      if (!trimmed) {
        toast({
          title: "متن پیام خالی است",
          variant: "destructive",
        });
        return;
      }
      // Find the current message so we can revert on failure.
      const target = timeline.find(
        (it): it is TimelineItem =>
          it.kind === "message" && it.id === messageId,
      );
      const originalContent = target?.kind === "message" ? target.data.content : "";

      setEditSavingId(messageId);
      // Optimistically patch the local bubble so the user sees the new text
      // immediately + a temporary "ویرایش..." indicator (the badge will be
      // stamped with the server-authoritative editedAt once the broadcast
      // arrives — we set it optimistically here so the badge renders).
      const optimisticEditedAt = new Date().toISOString();
      setTimeline((prev) =>
        prev.map((it) => {
          if (it.kind !== "message" || it.id !== messageId) return it;
          return {
            ...it,
            data: { ...it.data, content: trimmed, editedAt: optimisticEditedAt },
          };
        }),
      );
      try {
        await patchMessage(messageId, trimmed);
        // Emit the edit_message socket event so OTHER connected clients get
        // the `message_edited` broadcast and live-update their copy. The
        // sender's own client already updated optimistically above.
        const socket = socketRef.current;
        if (socket?.connected) {
          socket.emit("edit_message", { messageId, content: trimmed });
        }
        setEditingId(null);
        setEditingContent("");
        toast({ title: "پیام ویرایش شد" });
      } catch (err: any) {
        // Revert the optimistic update.
        setTimeline((prev) =>
          prev.map((it) => {
            if (it.kind !== "message" || it.id !== messageId) return it;
            return { ...it, data: { ...it.data, content: originalContent } };
          }),
        );
        toast({
          title: "ویرایش ناموفق",
          description: err?.message || "خطای غیرمنتظره",
          variant: "destructive",
        });
      } finally {
        setEditSavingId(null);
      }
    },
    [editingContent, timeline, toast],
  );

  /** Begin a reply — sets the `replyTo` state so the next send includes `replyToId`. */
  const handleStartReply = useCallback((m: ChatMessageWithDelete) => {
    setReplyTo(m);
    // Refocus the input so the user can type their reply immediately.
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLTextAreaElement | HTMLInputElement>(
        '[data-messenger-input="true"]',
      );
      el?.focus();
    });
  }, []);

  /** Cancel an in-progress reply (clears the preview bar above the input). */
  const handleCancelReply = useCallback(() => {
    setReplyTo(null);
  }, []);

  /**
   * Open the forward dialog for a single message. The dialog renders the
   * user's classes; on pick, we POST /api/messages/[id]/forward { targetClassId }
   * + emit `relay_message` to broadcast into the target class.
   */
  const handleStartForward = useCallback((m: ChatMessageWithDelete) => {
    setForwardState({ mode: "single", messageIds: [m.id] });
  }, []);

  /**
   * Batch-forward: open the forward dialog with the currently-selected set
   * of message ids. The dialog forwards each one in sequence.
   */
  const handleStartBatchForward = useCallback(() => {
    if (selectedIds.size === 0) return;
    setForwardState({
      mode: "batch",
      messageIds: Array.from(selectedIds),
    });
  }, [selectedIds]);

  /** Open the seen-by dialog for a message (renders the readers list). */
  const handleStartSeenBy = useCallback((m: ChatMessageWithDelete) => {
    setSeenByMessageId(m.id);
  }, []);

  /**
   * Phase 18 — toggle the bookmark state of a message. Calls POST or
   * DELETE /api/messages/[id]/save depending on the current `isSaved`
   * flag, then optimistically flips the local `isSaved` + `savedCount`
   * fields on the timeline row. The server's authoritative snapshot
   * (returned by the endpoint) overrides the optimistic state on
   * success; on failure we revert + toast.
   *
   * Bookmark state is per-user — we DON'T broadcast a socket event for
   * this (no other client needs to know who bookmarked what). Other
   * connected clients will see the updated `savedCount` (the server
   * counts all bookmarks) when they next refetch messages.
   */
  const handleToggleSave = useCallback(
    async (m: ChatMessageWithDelete) => {
      if (saveInFlightId === m.id) return;
      const wasSaved = m.isSaved === true;
      const oldCount = m.savedCount ?? 0;
      // Optimistic update.
      setTimeline((prev) =>
        prev.map((it) => {
          if (it.kind !== "message" || it.id !== m.id) return it;
          return {
            ...it,
            data: {
              ...it.data,
              isSaved: !wasSaved,
              savedCount: Math.max(0, oldCount + (wasSaved ? -1 : 1)),
            },
          };
        }),
      );
      setSaveInFlightId(m.id);
      try {
        const updated = wasSaved
          ? await unsaveMessage(m.id)
          : await saveMessage(m.id);
        // The server returns the canonical snapshot — apply it so the
        // local state matches even if the optimistic guess was off.
        setTimeline((prev) =>
          prev.map((it) => {
            if (it.kind !== "message" || it.id !== m.id) return it;
            return {
              ...it,
              data: {
                ...it.data,
                isSaved:
                  typeof updated.isSaved === "boolean"
                    ? updated.isSaved
                    : !wasSaved,
                savedCount:
                  typeof updated.savedCount === "number"
                    ? updated.savedCount
                    : it.data.savedCount,
              },
            };
          }),
        );
        toast({
          title: wasSaved ? "پیام از ذخیره‌ها خارج شد" : "پیام ذخیره شد",
        });
      } catch (err: any) {
        // Revert the optimistic update.
        setTimeline((prev) =>
          prev.map((it) => {
            if (it.kind !== "message" || it.id !== m.id) return it;
            return {
              ...it,
              data: {
                ...it.data,
                isSaved: wasSaved,
                savedCount: oldCount,
              },
            };
          }),
        );
        toast({
          title: "ذخیره پیام ناموفق بود",
          description: err?.message || "خطای غیرمنتظره",
          variant: "destructive",
        });
      } finally {
        setSaveInFlightId(null);
      }
    },
    [saveInFlightId, toast],
  );

  /**
   * Toggle select-mode (checkboxes on every message row + sticky batch
   * action bar above the input). When turning select-mode OFF, clear the
   * selected set so a later toggle starts fresh.
   */
  const handleToggleSelectMode = useCallback(() => {
    setSelectMode((prev) => {
      const next = !prev;
      if (!next) {
        setSelectedIds(new Set());
      }
      return next;
    });
  }, []);

  /**
   * Enter select-mode AND pre-select the message the user clicked "انتخاب" on.
   * This makes the click feel responsive — the user sees the checkbox appear
   * immediately rather than just toggling into a no-op select mode.
   */
  const handleStartSelectFromMessage = useCallback(
    (m: ChatMessageWithDelete) => {
      setSelectMode(true);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.add(m.id);
        return next;
      });
    },
    [],
  );

  /** Toggle a single message's selected checkbox in select mode. */
  const handleToggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  /**
   * Exit select mode (the batch action bar "لغو" button). Clears the selected
   * set + flips select-mode off.
   */
  const handleExitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  /**
   * Batch-delete all selected messages. Iterates through `selectedIds`,
   * calls DELETE /api/messages/[id] for each, emits `delete_message` for
   * each so other clients see them disappear in real-time. Reports a
   * single toast with the count of successes / failures. Exits select
   * mode at the end (clears the selected set + the action bar).
   */
  const handleBatchDeleteConfirm = useCallback(async () => {
    const ids = Array.from(selectedIds);
    setBatchDeleteOpen(false);
    if (ids.length === 0) {
      handleExitSelectMode();
      return;
    }
    // Optimistically remove all selected from the local timeline.
    setTimeline((prev) => prev.filter((it) => !selectedIds.has(it.id)));
    const socket = socketRef.current;
    let ok = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        await deleteMessage(id);
        if (socket?.connected) {
          socket.emit("delete_message", { messageId: id });
        }
        ok += 1;
      } catch {
        failed += 1;
      }
    }
    if (failed === 0) {
      toast({
        title: "پیام‌ها حذف شدند",
        description: `${toPersianDigits(ok)} پیام حذف شد.`,
      });
    } else {
      toast({
        title: "حذف برخی پیام‌ها ناموفق بود",
        description: `${toPersianDigits(ok)} حذف شد، ${toPersianDigits(failed)} ناموفق.`,
        variant: "destructive",
      });
      // Re-fetch to restore the failed ones.
      void (async () => {
        try {
          const res = await fetchMessages({ classId, limit: LOAD_LIMIT });
          const chronological = [...res.data].reverse().map(toTimelineMessage);
          setTimeline((prev) => {
            // Keep the (presumably) newer optimistic-only rows + merge the
            // freshly-fetched page so the failed-DELETE rows reappear.
            const mergedMap = new Map<string, TimelineItem>();
            for (const it of chronological) mergedMap.set(it.id, it);
            for (const it of prev) {
              if (!mergedMap.has(it.id)) mergedMap.set(it.id, it);
            }
            return sortTimeline(Array.from(mergedMap.values()));
          });
        } catch {
          // give up — the user can manually refresh.
        }
      })();
    }
    handleExitSelectMode();
  }, [selectedIds, classId, toast, handleExitSelectMode]);

  // -------------------- Close / open chat --------------------

  const handleToggleChatClose = useCallback(async () => {
    const socket = socketRef.current;
    try {
      if (chatClosed) {
        // Open
        if (socket?.connected) {
          socket.emit("open_chat", { classId });
        }
        setChatClosed(false);
        setChatClosedBy(null);
        toast({ title: "گفتگو باز شد" });
      } else {
        // Close
        if (socket?.connected) {
          socket.emit("close_chat", { classId });
        }
        setChatClosed(true);
        setChatClosedBy(user.name);
        toast({ title: "گفتگو بسته شد" });
      }
    } catch (err: any) {
      toast({
        title: "خطا",
        description: err?.message || "خطای غیرمنتظره",
        variant: "destructive",
      });
    }
  }, [chatClosed, classId, socketRef, toast, user.name]);

  // -------------------- File-upload settings (teacher/admin) --------------------

  /**
   * Persisted-callback used by FileSettingsDialog. Hits the teacher endpoint;
   * the same dialog is reused in the admin panel where the caller swaps in a
   * different `onSave`. Returns the server snapshot so the dialog can hand
   * it back via `onSaved`.
   */
  const handleSaveFileSettings = useCallback(
    async (values: FileSettings): Promise<FileSettings> => {
      const saved = await patchClassFileSettings({
        classId,
        ...values,
      });
      return saved;
    },
    [classId],
  );

  /**
   * After the dialog successfully saves, update the local snapshot (so the
   * chat input area can immediately reflect the new limits) and invalidate
   * the parent classes query so the class list / class selector refreshes.
   */
  const handleFileSettingsSaved = useCallback(
    (settings: FileSettings) => {
      setFileSettings(settings);
      // Soft-invalidate; the parent useQuery(["classes", user.id]) will
      // refetch in the background. Don't await — keep the chat responsive.
      void queryClient.invalidateQueries({
        queryKey: ["classes", user.id],
      });
    },
    [queryClient, user.id],
  );

  // -------------------- Create poll --------------------

  const handleCreatePoll = useCallback(
    (body: {
      question: string;
      options: string[];
      multipleChoice: boolean;
    }) => {
      const socket = socketRef.current;
      if (!socket?.connected) {
        toast({
          title: "اتصال برقرار نیست",
          description: "لطفاً چند لحظه صبر کنید و دوباره تلاش کنید.",
          variant: "destructive",
        });
        return;
      }
      socket.emit("create_poll", {
        classId,
        question: body.question,
        options: body.options,
        multipleChoice: body.multipleChoice,
      });
      setPollDialogOpen(false);
      toast({ title: "نظرسنجی ایجاد شد" });
    },
    [classId, toast],
  );

  // -------------------- Vote poll --------------------

  const handleVoteSingle = useCallback(
    (pollId: string, optionIndex: number) => {
      const socket = socketRef.current;
      if (!socket?.connected) return;
      // Locally mark the user's vote.
      setTimeline((prev) =>
        prev.map((it) => {
          if (it.kind !== "poll" || it.id !== pollId) return it;
          if (it.data.closedAt) return it;
          const updated: Poll = { ...it.data, myVote: optionIndex };
          return { ...it, data: updated };
        }),
      );
      socket.emit("vote_poll", { pollId, optionIndex });
    },
    [],
  );

  const handleVoteMultiple = useCallback(
    (pollId: string, optionIndexes: number[]) => {
      const socket = socketRef.current;
      if (!socket?.connected) return;
      setTimeline((prev) =>
        prev.map((it) => {
          if (it.kind !== "poll" || it.id !== pollId) return it;
          if (it.data.closedAt) return it;
          const updated: Poll = { ...it.data, myVote: optionIndexes };
          return { ...it, data: updated };
        }),
      );
      socket.emit("vote_poll_multiple", { pollId, optionIndexes });
    },
    [],
  );

  // -------------------- Close poll --------------------

  const handleClosePoll = useCallback(
    (pollId: string) => {
      const socket = socketRef.current;
      if (!socket?.connected) return;
      setTimeline((prev) =>
        prev.map((it) => {
          if (it.kind !== "poll" || it.id !== pollId) return it;
          const updated: Poll = {
            ...it.data,
            closedAt: new Date().toISOString(),
          };
          return { ...it, data: updated };
        }),
      );
      socket.emit("close_poll", { pollId });
      toast({ title: "نظرسنجی بسته شد" });
    },
    [toast],
  );

  // -------------------- Grouped timeline (with date separators) --------------------

  // Phase 27 — when `teacherOnlyMode` is active (and the module is
  // enabled), filter the timeline to only TEACHER + ADMIN + SUPERADMIN
  // messages BEFORE grouping. Polls are always kept (they're class-level
  // broadcasts, not tied to a sender role in the same way). This means
  // empty date groups don't render (no empty space between visible
  // messages — the user explicitly asked for this).
  // Phase 28 — also apply the in-chat search filter (when `searchOpen`
  // is true + `searchQuery` is non-empty, match against content + sender
  // full name, case-insensitive). The search filter is layered ON TOP
  // of the teacher-only filter so both can be active simultaneously.
  const filteredTimeline = useMemo(() => {
    let list = timeline;
    if (teacherOnlyMode && teacherOnlyModuleEnabled) {
      list = list.filter((it) => {
        if (it.kind === "poll") return true; // always show polls
        const role = it.data?.sender?.role;
        return role === "TEACHER" || role === "ADMIN" || role === "SUPERADMIN";
      });
    }
    if (searchOpen && searchQuery.trim().length > 0) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter((it) => {
        if (it.kind === "poll") {
          return (it.data.question ?? "").toLowerCase().includes(q);
        }
        const m = it.data;
        const content = (m?.content ?? "").toLowerCase();
        const senderName = (m?.sender?.fullName ?? "").toLowerCase();
        return content.includes(q) || senderName.includes(q);
      });
    }
    return list;
  }, [timeline, teacherOnlyMode, teacherOnlyModuleEnabled, searchOpen, searchQuery]);

  const grouped = useMemo(() => {
    const groups: { key: string; label: string; items: TimelineItem[] }[] = [];
    let lastKey: string | null = null;
    for (const it of filteredTimeline) {
      const k = dayKey(it.createdAt);
      if (k !== lastKey) {
        groups.push({ key: k, label: formatPersianDay(it.createdAt), items: [it] });
        lastKey = k;
      } else {
        groups[groups.length - 1].items.push(it);
      }
    }
    return groups;
  }, [filteredTimeline]);

  // ----- Input disabled flag -----
  const inputDisabled =
    !connected || (chatClosed && !isPrivileged);

  // ============================================================
  // Render
  // ============================================================

  return (
    <div className="flex h-full flex-col rounded-none border bg-muted shadow-sm sm:m-2 sm:rounded-xl">
      {/* ---------- HEADER ---------- */}
      <div className="flex items-center justify-between gap-2 border-b bg-background/95 px-3 py-2.5 backdrop-blur sm:rounded-t-xl">
        {searchOpen ? (
          // Phase 28 — in-chat search bar. When `searchOpen` is true,
          // the header transforms into a search input + a close X.
          // Typing filters `filteredTimeline` in real-time (matches
          // against message content + sender full name,
          // case-insensitive). The X closes the search + clears the
          // query so the timeline flows back to its full state.
          <>
            <Button
              variant="ghost"
              size="icon"
              className="size-9 shrink-0"
              onClick={() => {
                setSearchOpen(false);
                setSearchQuery("");
              }}
              aria-label="بستن جستجو"
              title="بستن جستجو"
            >
              <ArrowRight className="size-5" />
            </Button>
            <Input
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="جستجوی پیام یا فرستنده…"
              className="h-9 flex-1"
              dir="auto"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setSearchOpen(false);
                  setSearchQuery("");
                }
              }}
            />
            {searchQuery ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-9 shrink-0"
                onClick={() => setSearchQuery("")}
                aria-label="پاک کردن جستجو"
                title="پاک کردن"
              >
                <X className="size-5" />
              </Button>
            ) : null}
          </>
        ) : (
        <>
        <div className="flex min-w-0 items-center gap-2">
          {/* Back to conversation list (phase 11). Only rendered when the
              parent opts in via `onBack` — older callers see no back button. */}
          {onBack ? (
            <Button
              variant="ghost"
              size="icon"
              className="size-9 shrink-0"
              onClick={onBack}
              aria-label="بازگشت به فهرست گفتگوها"
              title="بازگشت به فهرست گفتگوها"
            >
              <ArrowRight className="size-5" />
            </Button>
          ) : null}
          <ChatAvatar
            fullName={className || "کلاس"}
            userId={classId}
            size="sm"
          />
          {/* Phase 18 — the avatar + group name + connection status are
              wrapped in a button that opens the GroupInfoDialog (Sheet)
              which lets the principal edit the avatar / name / description
              and add/remove members. Visible to ALL roles (students +
              teachers can view the members list; only principals get the
              edit affordances — the dialog hides them when the user lacks
              permission). */}
          {/* Phase 35e fix: changed the outer element from <button> to <div>
              with role="button" because it contains a nested <button> (the
              reconnect button below). HTML doesn't allow <button> inside
              <button> — it causes a hydration error + nested-button warning.
              The div retains the same behavior (click → open group info,
              keyboard accessible via tabIndex + onKeyDown). */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => setGroupInfoOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setGroupInfoOpen(true);
              }
            }}
            className="group flex min-w-0 cursor-pointer items-center gap-2 rounded-md p-0.5 text-right transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label="مشاهده اطلاعات گروه"
            title="مشاهده اطلاعات گروه"
          >
            <div className="flex min-w-0 flex-col">
              <span className="flex items-center gap-1 truncate text-sm font-semibold leading-tight">
                <span className="truncate" dir="auto">
                  {className ?? "چت کلاس"}
                </span>
                <Info className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </span>
              <span
                className={`flex items-center gap-1 text-[10px] leading-tight ${
                  connected ? "text-emerald-600" : "text-amber-600"
                }`}
              >
                {connected ? (
                  <>
                    <Wifi className="size-3" />
                    متصل
                  </>
                ) : (
                  <>
                    <WifiOff className="size-3" />
                    در حال اتصال مجدد…
                  </>
                )}
                {chatClosed ? (
                  <span className="text-amber-600">· گفتگو بسته است</span>
                ) : null}
              </span>
            </div>
          </div>
        </div>

        {/* All action buttons live in ONE always-rendered container so the
            layout doesn't reflow when a student (non-privileged) opens the
            chat. The privileged buttons (poll / close-chat) are wrapped in
            a conditional fragment; the appearance-settings button is ALWAYS
            visible to every role.

            Phase 35j — removed "تنظیمات ارسال فایل" button entirely.
            Added a hamburger menu (left side) for TEACHER+ADMIN containing:
            تنظیمات ظاهری, فقط مدیر و معلم, بستن گروه, ایجاد نظرسنجی. */}
        <div className="flex items-center gap-1">
          {/* Phase 28 — in-chat search toggle. Visible to ALL roles. */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSearchOpen(true)}
            className="h-8 gap-1 px-2 text-xs"
            aria-label="جستجوی پیام"
            title="جستجوی پیام در این گفتگو"
          >
            <Search className="size-3.5" />
            <span className="hidden sm:inline">جستجو</span>
          </Button>

          {/* Phase 35b — streaming toggle (TEACHER/ADMIN only). Stays
              as a direct button (not in the hamburger menu) since it's
              the most important toggle for the teacher. */}
          {canToggleStreaming && schoolStreamingEnabled ? (
            <Button
              type="button"
              variant={groupStreamingEnabled ? "default" : "outline"}
              size="sm"
              onClick={async () => {
                if (streamingToggling) return;
                setStreamingToggling(true);
                try {
                  await apiFetch<{ id: string; streamingEnabled: boolean }>(
                    `/api/classes/${classId}/streaming`,
                    {
                      method: "POST",
                      body: JSON.stringify({
                        enabled: !groupStreamingEnabled,
                      }),
                    },
                  );
                  await queryClient.invalidateQueries({
                    queryKey: ["classes"],
                    exact: false,
                  });
                  toast({
                    title: groupStreamingEnabled
                      ? "استریم برای این گروه غیرفعال شد"
                      : "استریم برای این گروه فعال شد",
                    description: groupStreamingEnabled
                      ? "دکمه استریم برای اعضای گروه مخفی شد."
                      : "دکمه استریم برای همه اعضای گروه نمایان شد.",
                  });
                } catch (err: any) {
                  toast({
                    title: "خطا در تغییر وضعیت استریم",
                    description: err?.message || "خطای غیرمنتظره",
                    variant: "destructive",
                  });
                } finally {
                  setStreamingToggling(false);
                }
              }}
              disabled={streamingToggling}
              className="h-8 gap-1 px-2 text-xs"
              aria-label={
                groupStreamingEnabled
                  ? "غیرفعال کردن استریم گروه"
                  : "فعال کردن استریم گروه"
              }
              title={
                groupStreamingEnabled
                  ? "استریم فعال است — کلیک برای غیرفعال کردن"
                  : "استریم غیرفعال است — کلیک برای فعال کردن"
              }
              aria-pressed={groupStreamingEnabled}
            >
              {streamingToggling ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Video className="size-3.5" />
              )}
              <span className="hidden sm:inline">
                {groupStreamingEnabled ? "استریم: روشن" : "استریم: خاموش"}
              </span>
            </Button>
          ) : null}

          {/* Phase 35j — hamburger menu for ALL roles. Contains:
              تنظیمات ظاهری (all roles), فقط مدیر و معلم (all roles when
              module enabled), بستن گروه (TEACHER/ADMIN only),
              ایجاد نظرسنجی (TEACHER/ADMIN only). */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label="منوی تنظیمات گفتگو"
                title="منوی تنظیمات گفتگو"
              >
                <AlignJustify className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  setAppearanceOpen(true);
                }}
                className="gap-2"
              >
                <Palette className="size-4" />
                تنظیمات ظاهری
              </DropdownMenuItem>
              {teacherOnlyModuleEnabled ? (
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    setTeacherOnlyMode((v) => !v);
                  }}
                  className="gap-2"
                  aria-pressed={teacherOnlyMode}
                >
                  <Filter className="size-4" />
                  {teacherOnlyMode ? "غیرفعال: فقط مدیر و معلم" : "فعال: فقط مدیر و معلم"}
                </DropdownMenuItem>
              ) : null}
              {isPrivileged ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      setPollDialogOpen(true);
                    }}
                    className="gap-2"
                  >
                    <BarChart3 className="size-4" />
                    ایجاد نظرسنجی
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      handleToggleChatClose();
                    }}
                    className="gap-2"
                  >
                    {chatClosed ? <Unlock className="size-4" /> : <Lock className="size-4" />}
                    {chatClosed ? "باز کردن گفتگو" : "بستن گفتگو"}
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        </>
        )}
      </div>

      {/* ---------- Pinned message banner (Phase 28) ----------
          Clickable to scroll the matching message into view. Includes an
          X (unpin) affordance for TEACHER/ADMIN/SUPERADMIN + a typed label
          when the pinned message is a linked-card (تکلیف / نمونه سوال) or
          an اطلاعیه (announcement). */}
      {(() => {
        const pinnedMsg = timeline.find((it) => it.kind === "message" && pinnedIds.has(it.id));
        if (!pinnedMsg || pinnedMsg.kind !== "message") return null;
        const senderName = pinnedMsg.data?.sender?.fullName ?? "";
        const content = pinnedMsg.data?.content ?? "";
        // Phase 29 — detect linked-card / announcement pinned messages so
        // the banner shows a typed badge ("تکلیف" / "نمونه سوال" /
        // "اطلاعیه") BEFORE the sender name. The badge takes priority over
        // the plain-text content preview because the linked card's content
        // is just the assignment/sample-question title (no extra info).
        const isLinkedAssignment = !!pinnedMsg.data?.linkedAssignmentId;
        const isLinkedSampleQuestion = !!pinnedMsg.data?.linkedSampleQuestionId;
        const isAnnouncement = !!pinnedMsg.data?.isAnnouncement;
        let typeLabel: string | null = null;
        let TypeIcon = Pin;
        if (isLinkedAssignment) {
          typeLabel = "تکلیف";
          TypeIcon = BookOpen;
        } else if (isLinkedSampleQuestion) {
          typeLabel = "نمونه سوال";
          TypeIcon = FileQuestion;
        } else if (isAnnouncement) {
          typeLabel = "اطلاعیه";
          TypeIcon = Megaphone;
        }
        return (
          <div
            className="group/banner flex cursor-pointer items-center gap-2 border-b border-primary/20 bg-primary/5 px-3 py-1.5 text-xs transition-colors hover:bg-primary/10"
            onClick={() => {
              const vp = viewportRef.current;
              if (!vp) return;
              const el = document.getElementById(`msg-${pinnedMsg.id}`);
              if (el) {
                el.scrollIntoView({ behavior: "smooth", block: "center" });
              }
            }}
            title="پرش به پیام سنجاق شده"
          >
            <Pin className="size-3.5 shrink-0 text-primary" />
            {typeLabel ? (
              <span className="flex shrink-0 items-center gap-1 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                <TypeIcon className="size-3" />
                {typeLabel}
              </span>
            ) : null}
            <span className="font-medium text-primary">{senderName}:</span>
            <span className="truncate text-muted-foreground">
              {content.substring(0, 80)}
              {content.length > 80 ? "…" : ""}
            </span>
            {canPin ? (
              <button
                type="button"
                aria-label="حذف سنجاق"
                title="حذف سنجاق"
                onClick={(e) => {
                  // Stop the parent's "scroll to message" onClick from firing
                  // — we only want to unpin, not jump the scroll.
                  e.stopPropagation();
                  void handleTogglePin(pinnedMsg.data.id, false);
                }}
                className="mr-auto flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>
        );
      })()}

      {/* ---------- Chat-closed banner ---------- */}
      {chatClosed ? (
        <div className="flex items-center gap-2 border-b border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <Lock className="size-3.5 shrink-0" />
          <span>
            {chatClosedBy
              ? `این گفتگو توسط ${chatClosedBy} بسته شده است.`
              : "این گفتگو بسته شده است."}
            {!isPrivileged
              ? " تا زمان باز شدن توسط استاد، نمی‌توانید پیام بفرستید."
              : " شما (به‌عنوان استاد) همچنان می‌توانید پیام بفرستید."}
          </span>
        </div>
      ) : null}

      {/* ---------- MESSAGES ---------- */}
      <div className="flex-1 overflow-hidden">
        <div
          ref={viewportRef}
          onScroll={handleScroll}
          className="no-scrollbar scrollbar-rtl h-full overflow-y-auto overflow-x-hidden px-3 py-3"
          style={{
            // Apply the user-selected chat background. `default` resolves to
            // `transparent` so the parent card's `bg-muted` shows through
            // (preserving the original look when the user hasn't customized
            // anything). When the theme changes, `chatBackgroundCss` swaps
            // to the dark/light variant automatically (next-themes forces a
            // re-render on toggle).
            background: chatBackgroundCss,
            // Apply the user-selected font-size. The bubble + sender line +
            // timestamp below consume this via `inherit` / `em` units so
            // they scale together (the small chrome — date separator,
            // badges, file-name chips — keeps its own fixed text sizes).
            fontSize: `${appearance.settings.fontSize}px`,
          }}
        >
          {/* Load older indicator */}
          {loadingMore ? (
            <div className="mb-3 flex flex-col items-center justify-center gap-1.5 py-2">
              <Loader2 className="size-5 animate-spin text-primary" />
              <span className="text-[10px] text-muted-foreground">
                در حال بارگذاری پیام‌های قدیمی‌تر…
              </span>
            </div>
          ) : null}

          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className={`flex ${i % 2 === 0 ? "justify-start" : "justify-end"}`}
                >
                  <LazySkeleton className="h-14 w-48 rounded-2xl" />
                </div>
              ))}
            </div>
          ) : timeline.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 py-10 text-center text-muted-foreground">
              <Send className="size-8 opacity-50" />
              <p className="text-sm">هنوز پیامی در این کلاس ارسال نشده است.</p>
              <p className="text-xs">اولین پیام را شما ارسال کنید!</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {grouped.map((group) => (
                <div key={group.key} className="space-y-2.5">
                  {/* Date separator */}
                  <div className="flex items-center justify-center py-1">
                    <span className="rounded-full bg-muted px-3 py-0.5 text-[10px] text-muted-foreground">
                      {group.label}
                    </span>
                  </div>
                  {group.items.map((item) => {
                    if (item.kind === "poll") {
                      return (
                        <PollRow
                          key={item.id}
                          poll={item.data}
                          currentUserId={user.id}
                          isPrivileged={isPrivileged}
                          onVoteSingle={handleVoteSingle}
                          onVoteMultiple={handleVoteMultiple}
                          onClose={handleClosePoll}
                        />
                      );
                    }
                    return (
                      <MessageRow
                        key={item.id}
                        message={item.data}
                        own={isOwnMessage(item.data)}
                        currentUserId={user.id}
                        canDelete={canDeleteMessage(item.data)}
                        canEdit={canEditMessage(item.data)}
                        onDeleteRequest={() => setDeleteTarget(item)}
                        onReply={() => handleStartReply(item.data)}
                        onEdit={() => handleStartEdit(item.data)}
                        onForward={() => handleStartForward(item.data)}
                        onSeenBy={() => handleStartSeenBy(item.data)}
                        onSelectMessage={() =>
                          handleStartSelectFromMessage(item.data)
                        }
                        onToggleSave={() => void handleToggleSave(item.data)}
                        isSaved={item.data.isSaved === true}
                        savedCount={item.data.savedCount ?? 0}
                        saveInFlight={saveInFlightId === item.id}
                        editing={editingId === item.id}
                        editContent={editingContent}
                        editSaving={editSavingId === item.id}
                        onEditContentChange={setEditingContent}
                        onSaveEdit={() => handleSaveEdit(item.id)}
                        onCancelEdit={handleCancelEdit}
                        selectMode={selectMode}
                        selected={selectedIds.has(item.id)}
                        onToggleSelected={() => handleToggleSelected(item.id)}
                        openingForUserId={openingForUserId}
                        onStartDirectChat={onStartDirectChat}
                        onOpenAssignment={onOpenAssignment}
                        onOpenSampleQuestion={onOpenSampleQuestion}
                        pinned={pinnedIds.has(item.id)}
                        canPin={canPin}
                        onTogglePin={(pin) =>
                          void handleTogglePin(item.data.id, pin)
                        }
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ---------- Typing indicator ---------- */}
      <div className="h-6 px-3 text-[11px] text-muted-foreground">
        {typing ? (
          <span className="animate-pulse">
            {typing.fullName} در حال تایپ…
          </span>
        ) : null}
      </div>

      {/* ---------- File chip preview (above input; shown when a file is staged) ---------- */}
      <AnimatePresence>
        {pendingFile ? (
          <motion.div
            key="file-chip"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="border-t bg-secondary/40 px-3"
          >
            <div className="flex items-center gap-2 py-2">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                {(() => {
                  const cat = categorizeFile(pendingFile);
                  if (cat === "image") return <ImageIcon className="size-4" />;
                  if (cat === "video") return <Film className="size-4" />;
                  if (cat === "pdf") return <FileText className="size-4" />;
                  return <FileIcon className="size-4" />;
                })()}
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span
                  className="truncate text-xs font-medium"
                  title={pendingFile.name}
                  dir="auto"
                >
                  {pendingFile.name}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {formatFileSize(pendingFile.size)} ·{" "}
                  {formatFileTypesLabel([categorizeFile(pendingFile)])}
                  {input.trim()
                    ? ` · توضیح: «${input.trim().slice(0, 24)}${input.trim().length > 24 ? "…" : ""}»`
                    : ""}
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={handleRemovePendingFile}
                disabled={uploading}
                aria-label="حذف فایل"
              >
                <X className="size-4" />
              </Button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* ---------- Reply preview bar (phase 17) ----------
          When `replyTo` is set, show a one-line preview of the message the
          user is replying to above the input — sender name + truncated content
          + a ✕ cancel button. Cleared on send / cancel. */}
      <AnimatePresence>
        {replyTo ? (
          <motion.div
            key="reply-preview"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="border-t bg-primary/5 px-3"
          >
            <div className="flex items-center gap-2 py-2">
              <ReplyIcon className="size-4 shrink-0 text-primary" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[11px] font-semibold text-primary">
                  {replyTo.sender.id === user.id
                    ? "پاسخ به: شما"
                    : `پاسخ به: ${replyTo.sender.fullName}`}
                </span>
                <span
                  className="truncate text-[11px] text-muted-foreground"
                  dir="auto"
                >
                  {replyTo.content || (replyTo.fileUrl ? "📎 فایل" : "")}
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={handleCancelReply}
                disabled={uploading}
                aria-label="لغو پاسخ"
              >
                <X className="size-4" />
              </Button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* ---------- Select-mode batch action bar (phase 17) ----------
          When `selectMode` is on, show a sticky bar with the count + batch
          forward / batch delete / cancel buttons. Replaces the regular input
          affordances visually so the user knows they're in select mode. */}
      <AnimatePresence>
        {selectMode ? (
          <motion.div
            key="select-bar"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-center gap-2 border-t bg-primary/5 px-3 py-2"
          >
            <CheckSquare className="size-4 shrink-0 text-primary" />
            <span className="flex-1 text-xs text-muted-foreground">
              {toPersianDigits(selectedIds.size)} پیام انتخاب شده
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1 px-2 text-xs"
              onClick={handleStartBatchForward}
              disabled={selectedIds.size === 0}
            >
              <Forward className="size-3.5" />
              هدایت انتخابی‌ها
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1 px-2 text-xs text-destructive hover:text-destructive"
              onClick={() => setBatchDeleteOpen(true)}
              disabled={selectedIds.size === 0}
            >
              <Trash2 className="size-3.5" />
              حذف انتخابی‌ها
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 gap-1 px-2 text-xs"
              onClick={handleExitSelectMode}
            >
              <X className="size-3.5" />
              لغو
            </Button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* ---------- INPUT ---------- */}
      <form
        onSubmit={sendMessage}
        className="flex items-end gap-2 border-t bg-background px-3 py-2.5 sm:rounded-b-xl"
      >
        {/* Hidden file input — clicked by the paperclip button.
            accept covers images, PDFs, and common video containers.
            Also reused by the VoiceRecorder (Phase 26) — when the user sends
            a voice message, the recorded File is staged via `stageFile`
            (same path as a manually-picked file) so the chip preview + the
            existing POST /api/messages multipart upload flow handle it. */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.svg,.mp4,.webm,.mov,.avi,image/*,video/*,application/pdf"
          multiple
          className="sr-only"
          onChange={handleFileChange}
          // The hidden input shouldn't participate in form keyboard flow.
          tabIndex={-1}
          aria-hidden="true"
        />

        {/* Phase 26 — emoji picker. Rendered as the FIRST child so RTL flex
            places it on the right edge (mirror of Telegram/WhatsApp). The
            picker is a Popover with a Smile trigger; onSelect inserts the
            emoji at the textarea cursor via `handleEmojiSelect`.
            Phase 27 — HIDDEN on mobile/tablet while recording so the
            recording UI takes the full width. */}
        {!hideComposerForRecording ? (
          <EmojiPicker
            onSelect={handleEmojiSelect}
            disabled={inputDisabled || uploading}
          />
        ) : null}

        {/* Paperclip — visually the rightmost (start) in RTL.
            Phase 27 — HIDDEN on mobile/tablet while recording. */}
        {!hideComposerForRecording ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 shrink-0"
            onClick={handlePickFile}
            disabled={fileAttachDisabled || uploading}
            aria-label="ارسال فایل"
            title={
              !fileUploadEnabled
                ? "ارسال فایل در این کلاس غیرفعال است"
                : "ارسال فایل"
            }
          >
            {uploading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Paperclip className="size-4" />
            )}
          </Button>
        ) : null}

        {/* Phase 26 — multi-line textarea. Pressing Enter creates a new line
            (default textarea behavior); Ctrl/Cmd+Enter submits the form.
            `items-end` on the form keeps the icon buttons aligned with the
            bottom of the textarea as it grows. Auto-resizes up to ~5 rows.
            Phase 27 — HIDDEN on mobile/tablet while recording. */}
        {!hideComposerForRecording ? (
          <Textarea
          ref={inputTextareaRef}
          value={input}
          onChange={(e) => {
            handleInputChange(e.target.value);
            adjustTextareaHeight();
          }}
          placeholder={
            chatClosed && !isPrivileged
              ? "گفتگو بسته است"
              : pendingFile
                ? "توضیح اختیاری برای فایل…"
                : replyTo
                  ? "پاسخ خود را بنویسید…"
                  : "پیام خود را بنویسید…"
          }
          maxLength={2000}
          disabled={inputDisabled}
          className="scrollbar-rtl flex-1 resize-none overflow-y-auto rounded-md border border-input bg-transparent px-3 py-2 text-sm leading-relaxed min-h-9 max-h-40"
          autoComplete="off"
          rows={1}
          onKeyDown={(e) => {
            // Ctrl/Cmd+Enter sends the message (desktop power-user shortcut).
            // Plain Enter creates a new line (default textarea behavior) so
            // mobile + tablet + desktop users can all write multi-line text.
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              const form = e.currentTarget.form;
              if (form) form.requestSubmit();
            }
          }}
          data-messenger-input="true"
        />
        ) : null}
        {hideComposerForRecording ? (
          /* Phase 27 — when recording on mobile/tablet, show ONLY the
             VoiceRecorder (full-width) so the recording UI takes the
             entire bottom bar. No emoji/paperclip/textarea. */
          <VoiceRecorder
            onSend={(file) => stageFile(file)}
            disabled={inputDisabled || uploading || !fileUploadEnabled}
            onRecordingChange={setIsRecording}
            className="flex-1"
          />
        ) : input.trim() || pendingFile ? (
          <Button
            type="submit"
            size="icon"
            disabled={
              inputDisabled || uploading || (!input.trim() && !pendingFile)
            }
            aria-label={pendingFile ? "ارسال فایل" : "ارسال"}
            className="size-9 shrink-0"
          >
            {uploading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
          </Button>
        ) : (
          /* Phase 26 — when the textarea is empty AND no file is staged,
             show the VoiceRecorder in place of the Send button. When the
             user stops recording, the File is staged via `stageFile` (same
             path as the paperclip picker) and the composer switches back
             to the Send button so the user can attach an optional caption
             before sending. Respects the class's file-upload setting. */
          <VoiceRecorder
            onSend={(file) => stageFile(file)}
            disabled={inputDisabled || uploading || !fileUploadEnabled}
            onRecordingChange={setIsRecording}
          />
        )}
      </form>

      {/* ---------- Create-poll dialog ---------- */}
      <CreatePollDialog
        open={pollDialogOpen}
        onOpenChange={setPollDialogOpen}
        onSubmit={handleCreatePoll}
      />

      {/* ---------- File-upload-settings dialog (teacher/admin only) ---------- */}
      {isPrivileged ? (
        <FileSettingsDialog
          open={fileSettingsOpen}
          onOpenChange={setFileSettingsOpen}
          classLabel={className}
          initialSettings={fileSettings}
          onSave={handleSaveFileSettings}
          onSaved={handleFileSettingsSaved}
        />
      ) : null}

      {/* ---------- Chat-appearance settings dialog (ALL roles) ---------- */}
      <ChatSettingsDialog
        open={appearanceOpen}
        onOpenChange={setAppearanceOpen}
      />

      {/* ---------- Delete confirmation ---------- */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف پیام</AlertDialogTitle>
            <AlertDialogDescription>
              آیا از حذف این پیام مطمئن هستید؟ این عملیات قابل بازگشت نیست.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>انصراف</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ---------- Batch-delete confirmation (phase 17 select mode) ---------- */}
      <AlertDialog
        open={batchDeleteOpen}
        onOpenChange={setBatchDeleteOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف پیام‌های انتخابی</AlertDialogTitle>
            <AlertDialogDescription>
              آیا از حذف {toPersianDigits(selectedIds.size)} پیام انتخاب‌شده
              مطمئن هستید؟ این عملیات قابل بازگشت نیست.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>انصراف</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleBatchDeleteConfirm()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ---------- Forward dialog (phase 17) ----------
          Renders the user's classes; on pick, POSTs forward for each message
          id in `forwardState.messageIds` and emits relay_message per created
          message so the target class chat sees it live. */}
      <ForwardDialog
        open={forwardState !== null}
        onOpenChange={(open) => {
          if (!open) setForwardState(null);
        }}
        state={forwardState}
        sourceClassId={classId}
        onForwarded={(createdByMessageId) => {
          // After a successful forward: toast, clear the dialog, exit select
          // mode if it was a batch forward, and invalidate the classes query
          // so the target class's latestMessage preview refreshes.
          const count = Object.keys(createdByMessageId).length;
          toast({
            title: "پیام هدایت شد",
            description:
              count > 1
                ? `${toPersianDigits(count)} پیام به کلاس مقصد هدایت شد.`
                : undefined,
          });
          if (forwardState?.mode === "batch") {
            handleExitSelectMode();
          }
          void queryClient.invalidateQueries({
            queryKey: ["classes", user.id],
          });
        }}
      />

      {/* ---------- Seen-by dialog (phase 17) ----------
          Fetches GET /api/messages/[id]/readers on open and renders an
          avatar + name + time list. Shows an empty state when no one has
          read the message yet. */}
      <SeenByDialog
        messageId={seenByMessageId}
        user={user}
        onOpenChange={(open) => {
          if (!open) setSeenByMessageId(null);
        }}
      />

      {/* ---------- Group-info dialog (phase 18) ----------
          Opens when the user clicks the chat header's avatar + name.
          Fetches GET /api/classes/[id]/info + lets the principal edit
          the group's avatar / name / description + add/remove members. */}
      <GroupInfoDialog
        classId={groupInfoOpen ? classId : null}
        fallbackName={className}
        onOpenChange={setGroupInfoOpen}
        onStartDirectChat={onStartDirectChat ? (u) => {
          setGroupInfoOpen(false);
          onStartDirectChat(u);
        } : undefined}
      />

      {/* ---------- Phase 35: Virtual Classroom FAB ----------
          A circular Floating Action Button in the bottom-LEFT corner (RTL
          mirror of LTR's bottom-right) that opens the ClassroomView Sheet
          (Google-Meet-style online class). Only visible in subject-group
          chats (the parent ClassChat component is only mounted for class
          chats — direct chats use DirectChat).

          Phase 35b — FAB is gated by `streamingAllowed` (both the
          per-school AND per-group streaming flags must be ON). Default
          OFF — a TEACHER must explicitly enable streaming via the header
          toggle icon before the FAB appears for anyone.

          Phase 35d — FAB is always fixed (no scroll hide/show).
          Position dynamically adjusts to sit above the reply-preview bar
          when one is visible. Has a continuous pulsing ring animation
          (emphasis) when streaming is enabled, to attract students'
          attention that the streaming class has started. */}
      {streamingAllowed ? (
        <button
          type="button"
          aria-label="شروع کلاس آنلاین"
          title="کلاس آنلاین"
          onClick={() => setClassroomOpen(true)}
          className={cn(
            "fixed z-30 flex size-12 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg ring-2 ring-emerald-600/20 transition-all duration-300 hover:bg-emerald-700 active:scale-95",
            // RTL: FAB goes in the bottom-LEFT corner.
            "left-4",
            // Phase 36i — on desktop (sm+), align with the max-w-5xl (64rem)
            // container so the FAB is "inside the group bounds" (not at the
            // viewport edge). On viewports ≤ 64rem, left-4 is correct.
            "sm:left-[max(1rem,calc((100vw-64rem)/2))]",
            // Phase 35d — position above the chat composer (~56px) + above
            // the mobile bottom nav (~57px). When a reply-preview bar is
            // visible (~48px tall), move the FAB up by that much so it
            // sits above the reply bar, not overlapping it.
            replyTo ? "bottom-32" : "bottom-20",
          )}
        >
          {/* Phase 35d — pulsing ring animation when streaming is enabled.
              Uses two `animate-ping` rings with staggered delays for a
              radar-pulse effect that continuously draws attention. */}
          <span className="absolute inset-0 -z-10 flex items-center justify-center">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500/40" />
            <span
              className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500/30"
              style={{ animationDelay: "0.75s" }}
            />
          </span>
          <Video className="size-6" />
        </button>
      ) : null}

      {/* ---------- Phase 35: Virtual Classroom Sheet ----------
          Mounts the ClassroomView component (full WebRTC + UI). The Sheet
          is full-screen so the video tiles get maximum space. */}
      <ClassroomView
        open={classroomOpen}
        onOpenChange={setClassroomOpen}
        user={user}
        classId={classId}
        className={className}
      />
    </div>
  );
}

// ============================================================
// LinkedMessageCard — bordered card for linked-assignment / sample-question
// messages (phase 19 "forward to chat" flow).
// ============================================================

/**
 * Renders the inner content of a "linked card" message bubble. The outer
 * bubble chrome (border, padding) is provided by MessageRow — this
 * component just renders the assignment / sample-question icon + title
 * + (for assignments) due date + a button that opens the matching
 * feature Sheet via the parent's `onOpenAssignment` / `onOpenSampleQuestion`
 * callbacks.
 *
 * Exactly one of `assignment` / `sampleQuestion` is set (the parent
 * guards `isLinkedCard` on at least one being non-null).
 */
function LinkedMessageCard({
  assignment,
  sampleQuestion,
  onOpenAssignment,
  onOpenSampleQuestion,
}: {
  assignment: {
    id: string;
    title: string;
    dueDate?: string | null;
    fileUrl?: string | null;
    fileName?: string | null;
  } | null;
  sampleQuestion: {
    id: string;
    title: string;
    fileUrl?: string | null;
    fileName?: string | null;
  } | null;
  onOpenAssignment?: () => void;
  onOpenSampleQuestion?: () => void;
}) {
  if (assignment) {
    return (
      <div className="flex flex-col gap-2 py-1">
        <div className="flex items-start gap-2">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600">
            <ClipboardList className="size-5" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[10px] font-medium uppercase tracking-wide text-primary">
              تکلیف
            </span>
            <span
              className="truncate text-sm font-semibold leading-tight"
              title={assignment.title}
            >
              {assignment.title}
            </span>
            {assignment.dueDate ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Calendar className="size-3" />
                مهلت تحویل: {formatPersianDate(assignment.dueDate)}
              </span>
            ) : null}
          </div>
        </div>
        {onOpenAssignment ? (
          <Button
            type="button"
            size="sm"
            variant="default"
            className="h-7 gap-1 self-start px-2.5 text-[11px]"
            onClick={onOpenAssignment}
          >
            <ClipboardList className="size-3.5" />
            مشاهده تکلیف
          </Button>
        ) : null}
      </div>
    );
  }

  if (sampleQuestion) {
    return (
      <div className="flex flex-col gap-2 py-1">
        <div className="flex items-start gap-2">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-teal-500/10 text-teal-600">
            <FileQuestion className="size-5" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[10px] font-medium uppercase tracking-wide text-primary">
              نمونه سوال
            </span>
            <span
              className="truncate text-sm font-semibold leading-tight"
              title={sampleQuestion.title}
            >
              {sampleQuestion.title}
            </span>
          </div>
        </div>
        {onOpenSampleQuestion ? (
          <Button
            type="button"
            size="sm"
            variant="default"
            className="h-7 gap-1 self-start px-2.5 text-[11px]"
            onClick={onOpenSampleQuestion}
          >
            <FileQuestion className="size-3.5" />
            مشاهده نمونه سوال
          </Button>
        ) : null}
      </div>
    );
  }

  // Defensive — the parent shouldn't render LinkedMessageCard without a
  // linked entity, but if it does, render nothing rather than crash.
  return null;
}

// ============================================================
// MessageRow — single message bubble with avatar, name, time, menu
// ============================================================

function MessageRow({
  message,
  own,
  currentUserId,
  canDelete,
  canEdit,
  onDeleteRequest,
  onReply,
  onEdit,
  onForward,
  onSeenBy,
  onSelectMessage,
  onToggleSave,
  isSaved,
  savedCount,
  saveInFlight,
  editing,
  editContent,
  editSaving,
  onEditContentChange,
  onSaveEdit,
  onCancelEdit,
  selectMode,
  selected,
  onToggleSelected,
  openingForUserId = null,
  onStartDirectChat,
  onOpenAssignment,
  onOpenSampleQuestion,
  pinned = false,
  canPin = false,
  onTogglePin,
}: {
  message: ChatMessageWithDelete;
  own: boolean;
  currentUserId: string;
  canDelete: boolean;
  /** Phase 17 — whether the calling user may edit this message. */
  canEdit: boolean;
  onDeleteRequest: () => void;
  /** Phase 17 — start a reply to this message (sets the input preview bar). */
  onReply: () => void;
  /** Phase 17 — switch the bubble into inline-edit mode. */
  onEdit: () => void;
  /** Phase 17 — open the forward dialog with this message's id. */
  onForward: () => void;
  /** Phase 17 — open the seen-by dialog for this message. */
  onSeenBy: () => void;
  /** Phase 17 — enter select mode AND pre-select this message. */
  onSelectMessage: () => void;
  /** Phase 18 — toggle the bookmark (save / unsave) for this message. */
  onToggleSave: () => void;
  /** Phase 18 — whether the calling user has saved (bookmarked) this message. */
  isSaved: boolean;
  /** Phase 18 — total number of users who have saved this message. */
  savedCount: number;
  /** Phase 18 — true while the POST/DELETE save call is in flight (per-row spinner). */
  saveInFlight: boolean;
  /** Phase 17 — when true, the bubble is in inline-edit mode (textarea + Save/Cancel). */
  editing: boolean;
  /** Phase 17 — the draft text in the inline-edit textarea. */
  editContent: string;
  /** Phase 17 — true while the PATCH is in flight (disables Save/Cancel + shows a spinner). */
  editSaving: boolean;
  /** Phase 17 — update the inline-edit draft text. */
  onEditContentChange: (value: string) => void;
  /** Phase 17 — persist the edited content (PATCH /api/messages/[id]). */
  onSaveEdit: () => void;
  /** Phase 17 — abort inline-edit mode. */
  onCancelEdit: () => void;
  /** Phase 17 — when true, the row renders a checkbox on the leading edge. */
  selectMode: boolean;
  /** Phase 17 — when `selectMode` is on, whether THIS row is currently selected. */
  selected: boolean;
  /** Phase 17 — toggle the row's selected state. */
  onToggleSelected: () => void;
  /**
   * The sender id the parent is currently opening a DM with (in-flight
   * POST). When this matches the row's sender id, we render a small
   * spinner in place of the "click to DM" affordance.
   */
  openingForUserId?: string | null;
  /**
   * Phase-10: when provided, the sender's avatar + full name become
   * clickable → call this with the sender's identifying info to start a
   * 1:1 DM. We DON'T make the user's OWN avatar/name clickable (it
   * wouldn't make sense to DM yourself).
   */
  onStartDirectChat?: (otherUser: DirectChatUser) => void;
  /**
   * Phase 19 — called when the user taps "مشاهده تکلیف" on a
   * linked-assignment card message. The parent opens the assignments
   * feature Sheet. Undefined for callers that haven't wired the prop —
   * the card still renders (title + due date + icon) but the button is
   * hidden so the row doesn't surface a dead control.
   */
  onOpenAssignment?: () => void;
  /**
   * Phase 19 — same as `onOpenAssignment` but for linked-sample-question
   * card messages (the button label is "مشاهده نمونه سوال").
   */
  onOpenSampleQuestion?: () => void;
  /** Phase 28 — whether this message is currently pinned. */
  pinned?: boolean;
  /** Phase 28 — whether the calling user may pin/unpin this message
   *  (TEACHER/ADMIN/SUPERADMIN only). */
  canPin?: boolean;
  /** Phase 28 — toggle the pin. Called with `true` to pin, `false` to unpin. */
  onTogglePin?: (pin: boolean) => void;
}) {
  const isTeacher = message.sender.role === "TEACHER";
  const isAdmin = message.sender.role === "ADMIN";

  const hasFile = Boolean(message.fileUrl && message.fileType);
  const hasCaption = Boolean(message.content && message.content.trim().length > 0);
  // Phase 17 — derived reply / forward / edit metadata for the row's badges
  // + the quoted reply preview above the bubble.
  const hasReply = Boolean(message.replyToId && message.replyTo);
  const isForwarded = Boolean(message.forwardedFromId);
  const isEdited = Boolean(message.editedAt);
  const readCount = message.readCount ?? 0;

  // Phase 19 — linked-assignment / linked-sample-question card metadata.
  // When set, the row renders a bordered "card" bubble (instead of a text
  // bubble) showing the linked item's title + due date (for assignments)
  // + a button that opens the matching feature Sheet. The linked metadata
  // is joined by GET /api/messages (and POST's created-message response)
  // so the card can render without a second round-trip.
  const linkedAssignment =
    message.linkedAssignmentId && message.linkedAssignment
      ? message.linkedAssignment
      : null;
  const linkedSampleQuestion =
    message.linkedSampleQuestionId && message.linkedSampleQuestion
      ? message.linkedSampleQuestion
      : null;
  const isLinkedCard = !!linkedAssignment || !!linkedSampleQuestion;

  // Phase-10: the sender is clickable to start a DM, EXCEPT when:
  //   - the sender is the current user (own message → "شما"), OR
  //   - the parent didn't pass `onStartDirectChat` (older callers).
  const canStartDm =
    !!onStartDirectChat && message.sender.id !== currentUserId;
  const opening = canStartDm && openingForUserId === message.sender.id;

  function handleStartDirectChat() {
    if (!onStartDirectChat || opening) return;
    onStartDirectChat({
      id: message.sender.id,
      fullName: message.sender.fullName,
      username: message.sender.username || "",
      role: message.sender.role,
      avatar: message.sender.avatar ?? null,
    });
  }

  // The trigger is always rendered now (any user can reply / forward /
  // seen-by / select any message). It used to be gated by `canDelete` only.
  const showMenu = !selectMode;

  // Phase 28 — swipe-right-to-reply gesture on the row wrapper. The hook
  // returns handlers (touch + mouse + click) that we spread onto the row.
  // When the drag crosses the threshold (60px), `onReply()` fires.
  const swipe = useSwipeToReply(() => onReply());

  // Phase 28 — controlled DropdownMenu state. We need this so we can
  // open the menu programmatically from the bubble's `onContextMenu`
  // (right-click on desktop) AND from a long-press (touchstart → 500ms
  // timer → open). The Radix DropdownMenu supports `open` + `onOpenChange`
  // for fully-controlled mode.
  const [menuOpen, setMenuOpen] = useState(false);
  // Long-press timer ref (touch).
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track the touch start coords so we can cancel the long-press when the
  // finger moves > 10px (it's a scroll, not a press).
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);

  function clearLongPressTimer() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressStartRef.current = null;
  }

  // Long-press touchstart handler. Start a 500ms timer; if it fires
  // before the user lifts their finger or scrolls, open the menu. We
  // also call `e.preventDefault()` on touchstart so the browser doesn't
  // fire a synthetic `contextmenu` event after the long-press completes
  // (which would re-open the menu). On touchend / touchmove (with
  // movement) we clear the timer.
  function handleBubbleTouchStart(e: React.TouchEvent) {
    if (!showMenu) return;
    const t = e.touches[0];
    if (!t) return;
    longPressStartRef.current = { x: t.clientX, y: t.clientY };
    clearLongPressTimer();
    longPressTimerRef.current = setTimeout(() => {
      // Only open if the user hasn't moved (checked in touchmove).
      setMenuOpen(true);
      // Haptic feedback (mobile). Wrapped in try/catch since not all
      // browsers support it.
      try {
        if (typeof navigator !== "undefined" && "vibrate" in navigator) {
          navigator.vibrate?.(15);
        }
      } catch {
        // ignore
      }
    }, 500);
  }
  function handleBubbleTouchMove(e: React.TouchEvent) {
    if (!longPressStartRef.current) return;
    const t = e.touches[0];
    if (!t) return;
    const dx = Math.abs(t.clientX - longPressStartRef.current.x);
    const dy = Math.abs(t.clientY - longPressStartRef.current.y);
    if (dx > 10 || dy > 10) {
      clearLongPressTimer();
    }
  }
  function handleBubbleTouchEnd() {
    clearLongPressTimer();
  }
  function handleBubbleContextMenu(e: React.MouseEvent) {
    if (!showMenu) return;
    // Prevent the browser's native context menu so ours opens instead.
    e.preventDefault();
    setMenuOpen(true);
  }

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      // Phase 28 — apply the swipe translateX. The `transition` classes
      // from the hook (SWIPE_TRANSITION_BUBBLE) handle the snap-back
      // animation when the user releases.
      className={`group flex items-end gap-2 ${SWIPE_TRANSITION_BUBBLE} ${
        own ? "flex-row-reverse justify-start" : "justify-start"
      }`}
      style={{
        transform:
          swipe.swipeX < 0 ? `translateX(${swipe.swipeX}px)` : undefined,
      }}
      {...swipe.handlers}
    >
      {/* Phase 17 — select-mode checkbox. Rendered as the trailing element
          (right side in RTL for incoming, left side for own) so the
          avatar + bubble stay in their usual layout. The checkbox is
          keyboard-accessible + has an aria-label. */}
      {selectMode ? (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            onToggleSelected();
          }}
          aria-pressed={selected}
          aria-label={selected ? "لغو انتخاب پیام" : "انتخاب پیام"}
          className="shrink-0 self-center rounded-md p-1 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden"
        >
          <span
            className={`flex size-5 items-center justify-center rounded border transition-colors ${
              selected
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background"
            }`}
          >
            {selected ? <Check className="size-3.5" /> : null}
          </span>
        </button>
      ) : null}

      {/* Avatar — use the sender's id for deterministic color when no
          uploaded image is present. Phase-10: when the sender isn't the
          current user + the parent opted in, the avatar is wrapped in a
          button that triggers a "start DM" intent. */}
      {canStartDm && !selectMode ? (
        <button
          type="button"
          onClick={handleStartDirectChat}
          disabled={opening}
          aria-label={`شروع گفتگو خصوصی با ${message.sender.fullName}`}
          title={`گفتگو خصوصی با ${message.sender.fullName}`}
          className="shrink-0 rounded-full transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-60"
        >
          <ChatAvatar
            fullName={message.sender.fullName}
            userId={message.sender.id || message.sender.username}
            avatar={message.sender.avatar}
            size="sm"
            className="sm:size-10"
          />
        </button>
      ) : (
        <ChatAvatar
          fullName={message.sender.fullName}
          userId={message.sender.id || message.sender.username}
          avatar={message.sender.avatar}
          size="sm"
          className="sm:size-10"
        />
      )}

      <div
        className={`flex max-w-[80%] flex-col gap-1 sm:max-w-[70%] ${
          own ? "items-end" : "items-start"
        }`}
      >
        {/* Sender + time line. Uses `text-[0.75em]` so the meta line scales
            proportionally with the chat font-size set on the messages
            container (0.75em = 75% of the inherited base). The Badge stays
            at its own fixed size since it's chrome. Phase-10: the sender's
            full name is a button when `canStartDm`. */}
        <div
          className={`flex items-center gap-1.5 px-1 text-[0.75em] text-muted-foreground ${
            own ? "flex-row-reverse" : ""
          }`}
        >
          {canStartDm ? (
            <button
              type="button"
              onClick={handleStartDirectChat}
              disabled={opening}
              className="font-medium text-foreground transition-colors hover:text-primary focus-visible:underline focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
              title={`گفتگو خصوصی با ${message.sender.fullName}`}
            >
              {own ? "شما" : message.sender.fullName}
            </button>
          ) : (
            <span className="font-medium text-foreground">
              {own ? "شما" : message.sender.fullName}
            </span>
          )}
          {opening ? (
            <Loader2 className="size-3 animate-spin text-primary" />
          ) : null}
          {isTeacher ? (
            <Badge
              variant="secondary"
              className="bg-primary/10 text-primary px-1 py-0 text-[9px]"
            >
              {roleLabel(message.sender.role)}
            </Badge>
          ) : null}
          {isAdmin ? (
            <Badge
              variant="secondary"
              className="bg-amber-500/10 text-amber-700 px-1 py-0 text-[9px] dark:text-amber-300"
            >
              {roleLabel(message.sender.role)}
            </Badge>
          ) : null}
          <span dir="ltr">{shortTime(message.createdAt)}</span>
          {/* Phase 17 — "ویرایش‌شده" badge (rendered as muted text + the edit
              pencil icon so it doesn't take much horizontal room). Sits
              AFTER the timestamp in DOM order so RTL flex visually clusters
              it next to the timestamp on the bubble's trailing edge. */}
          {isEdited ? (
            <span className="flex items-center gap-0.5 text-[9px] text-muted-foreground/80">
              <Pencil className="size-2.5" />
              ویرایش‌شده
            </span>
          ) : null}
          {/* Phase 11 — WhatsApp-style read tick on OWN messages. Class chats
              have no per-user read tracking, so we only ever show the single
              "sent" ✓ (`Check`, muted). The tick sits AFTER the timestamp in
              DOM order so in RTL with `flex-row-reverse` it ends up visually
              next to the timestamp on the bubble's trailing edge. */}
          {own ? (
            <Check
              className="size-3 shrink-0 text-muted-foreground"
              aria-label="ارسال شد"
            />
          ) : null}
        </div>

        {/* Bubble + context menu */}
        <div
          className={`relative flex items-center gap-1 ${
            own ? "flex-row-reverse" : ""
          }`}
        >
          {/* Phase 28 — swipe-right-to-reply icon overlay. Slides in from
              the START edge (right in RTL) with opacity as the user drags
              the row past 0. Hidden when swipeX === 0 (no drag yet). */}
          {swipe.showReplyIcon ? (
            <span
              className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2 text-primary"
              style={{ opacity: swipe.replyIconOpacity }}
              aria-hidden="true"
            >
              <ReplyIcon className="size-5" />
            </span>
          ) : null}
          {/* Phase 28 — Pin icon overlay. Rendered next to the bubble when
              the message is currently pinned. Visible to ALL roles (so
              students can see what's pinned); only TEACHER/ADMIN/SUPERADMIN
              can toggle it via the context menu below. */}
          {pinned ? (
            <span
              className={`flex size-5 shrink-0 items-center justify-center text-primary ${
                own ? "order-2" : "order-[-1]"
              }`}
              title="سنجاق شده"
              aria-label="سنجاق شده"
            >
              <Pin className="size-4 fill-current" />
            </span>
          ) : null}
          <div
            className={`relative flex flex-col gap-1.5 rounded-2xl px-2.5 py-2 leading-relaxed shadow-sm ${
              message.isAnnouncement ? "announcement-bubble " : ""
            }${
              isLinkedCard
                ? // Phase 19 — linked-card messages get a distinct "card"
                  // chrome: bordered, slightly wider min-width so the
                  // title doesn't wrap awkwardly, and the assignment /
                  // sample-question accent color on the border.
                  own
                  ? "bg-primary/5 text-foreground border-2 border-primary/40 min-w-[220px] max-w-full"
                  : "bg-background text-foreground border-2 border-primary/40 min-w-[220px] max-w-full"
                : hasFile
                  ? own
                    ? "bg-primary/10 text-foreground border bubble-tail-end"
                    : "bg-background text-foreground border bubble-tail-start"
                  : own
                    ? "bg-primary text-primary-foreground bubble-tail-end"
                    : "bg-background text-foreground border bubble-tail-start"
            }`}
            style={
              // Phase 27 — the tail color must match the bubble's fill
              // so the CSS-triangle tail blends in. We set it via a CSS
              // custom property consumed by .bubble-tail-start::before /
              // .bubble-tail-end::after in globals.css.
              !isLinkedCard && !message.isAnnouncement
                ? ({
                    "--bubble-tail-color": own
                      ? hasFile
                        ? "hsl(var(--primary) / 0.1)"
                        : "hsl(var(--primary))"
                      : "hsl(var(--background))",
                  } as React.CSSProperties)
                : undefined
            }
            // Phase 28 — long-press + right-click open the controlled
            // DropdownMenu (defined below) so the user can access the
            // message actions without aiming for the small ⋮ button.
            onTouchStart={handleBubbleTouchStart}
            onTouchMove={handleBubbleTouchMove}
            onTouchEnd={handleBubbleTouchEnd}
            onContextMenu={handleBubbleContextMenu}
          >
            {/* Phase 17 — forwarded badge. Renders as a small muted text
                above the bubble content. We don't have the original sender's
                name in the GET response (only `forwardedFromId`), so we just
                show "هدایت‌شده". */}
            {isForwarded ? (
              <span
                className={`flex items-center gap-1 text-[10px] font-medium ${
                  own
                    ? "text-primary-foreground/70"
                    : "text-muted-foreground"
                }`}
                dir="auto"
              >
                <Forward className="size-3" />
                هدایت‌شده
              </span>
            ) : null}

            {/* Phase 17 — quoted reply preview. Renders the replied-to
                sender's name + truncated content as a small inset card above
                the bubble content. Mirrors the WhatsApp/iMessage reply quote. */}
            {hasReply && message.replyTo ? (
              <div
                className={`max-w-full rounded-md border-r-2 px-2 py-1 text-[11px] ${
                  own
                    ? "border-primary-foreground/40 bg-primary-foreground/10"
                    : "border-primary/50 bg-primary/5"
                }`}
                dir="auto"
              >
                <div
                  className={`truncate font-semibold ${
                    own ? "text-primary-foreground/80" : "text-primary"
                  }`}
                >
                  {message.replyTo.sender.id === currentUserId
                    ? "شما"
                    : message.replyTo.sender.fullName}
                </div>
                <div
                  className={`truncate ${
                    own
                      ? "text-primary-foreground/60"
                      : "text-muted-foreground"
                  }`}
                >
                  {message.replyTo.content || "📎 فایل"}
                </div>
              </div>
            ) : null}

            {isLinkedCard ? (
              // Phase 19 — linked-assignment / sample-question card.
              // Renders a bordered card with the linked item's icon +
              // title + (for assignments) due date + a button that opens
              // the matching feature Sheet. Visually distinct from a
              // text bubble so recipients immediately see it's a special
              // "forwarded resource" message.
              <LinkedMessageCard
                assignment={linkedAssignment}
                sampleQuestion={linkedSampleQuestion}
                onOpenAssignment={onOpenAssignment}
                onOpenSampleQuestion={onOpenSampleQuestion}
              />
            ) : hasFile ? (
              <FileAttachment
                fileUrl={message.fileUrl!}
                fileName={message.fileName}
                fileType={message.fileType}
                fileSize={message.fileSize}
                mimeType={message.mimeType}
                own={own}
              />
            ) : null}
            {editing ? (
              // Phase 17 — inline edit UI. Replaces the bubble content with a
              // textarea + Save/Cancel row while preserving the bubble chrome
              // (the reply quote / forwarded badge still render above; the
              // file attachment is NOT editable via this UI so we hide it
              // during edit to make the editing surface clear).
              <div className="flex flex-col gap-1.5 py-0.5">
                <Textarea
                  value={editContent}
                  onChange={(e) => onEditContentChange(e.target.value)}
                  disabled={editSaving}
                  maxLength={2000}
                  rows={Math.min(6, Math.max(2, editContent.split("\n").length))}
                  className="min-h-[60px] resize-none bg-background/80 text-foreground"
                  dir="auto"
                  autoFocus
                  onKeyDown={(e) => {
                    // Ctrl/Cmd+Enter saves; Escape cancels.
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      onSaveEdit();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      onCancelEdit();
                    }
                  }}
                />
                <div className="flex items-center justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[11px]"
                    onClick={onCancelEdit}
                    disabled={editSaving}
                  >
                    انصراف
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 gap-1 px-2 text-[11px]"
                    onClick={onSaveEdit}
                    disabled={editSaving || !editContent.trim()}
                  >
                    {editSaving ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Check className="size-3" />
                    )}
                    ذخیره
                  </Button>
                </div>
              </div>
            ) : !isLinkedCard && hasCaption ? (
              <span className="whitespace-pre-wrap break-words px-0.5">
                {message.content}
              </span>
            ) : null}
          </div>
          {showMenu ? (
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 opacity-0 transition-opacity group-hover:opacity-100 data-[state=open]:opacity-100"
                  aria-label="عملیات پیام"
                >
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align={own ? "start" : "end"}
                className="min-w-[12rem]"
              >
                {/* Top group: Reply / Edit / Forward / Seen-by / Select */}
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    onReply();
                  }}
                  className="gap-2"
                >
                  <ReplyIcon className="size-4" />
                  پاسخ
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    if (canEdit) {
                      onEdit();
                    }
                  }}
                  disabled={!canEdit}
                  className="gap-2"
                >
                  <Pencil className="size-4" />
                  ویرایش
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    onForward();
                  }}
                  className="gap-2"
                >
                  <Forward className="size-4" />
                  هدایت
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    onSeenBy();
                  }}
                  className="gap-2"
                >
                  <Eye className="size-4" />
                  <span className="flex flex-1 items-center justify-between gap-2">
                    <span>مشاهده خوانندگان</span>
                    <span className="text-[10px] text-muted-foreground">
                      {toPersianDigits(readCount)} دیده
                    </span>
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    onSelectMessage();
                  }}
                  className="gap-2"
                >
                  <CheckSquare className="size-4" />
                  انتخاب
                </DropdownMenuItem>
                {/* Phase 18 — Save (bookmark) message. Filled bookmark icon
                    when already saved; otherwise outline. The trailing
                    badge shows the total saved-by count when > 0. */}
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    if (!saveInFlight) {
                      onToggleSave();
                    }
                  }}
                  disabled={saveInFlight}
                  className="gap-2"
                >
                  {saveInFlight ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : isSaved ? (
                    <Bookmark className="size-4 fill-current text-primary" />
                  ) : (
                    <Bookmark className="size-4" />
                  )}
                  <span className="flex flex-1 items-center justify-between gap-2">
                    <span>{isSaved ? "ذخیره‌شده" : "ذخیره"}</span>
                    {savedCount > 0 ? (
                      <span className="text-[10px] text-muted-foreground">
                        {toPersianDigits(savedCount)} ذخیره
                      </span>
                    ) : null}
                  </span>
                </DropdownMenuItem>
                {/* Phase 28 — Pin / Unpin (TEACHER / ADMIN / SUPERADMIN only).
                    Pin icon when pinned; PinOff when not. Both close the
                    menu on select (the parent's optimistic update flips the
                    overlay Pin icon immediately). */}
                {canPin ? (
                  pinned ? (
                    <DropdownMenuItem
                      onSelect={(e) => {
                        e.preventDefault();
                        onTogglePin?.(false);
                      }}
                      className="gap-2"
                    >
                      <PinOff className="size-4" />
                      حذف سنجاق
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      onSelect={(e) => {
                        e.preventDefault();
                        onTogglePin?.(true);
                      }}
                      className="gap-2"
                    >
                      <Pin className="size-4" />
                      سنجاق کردن
                    </DropdownMenuItem>
                  )
                ) : null}
                {/* Separator before the destructive Delete action. */}
                {canDelete ? <DropdownMenuSeparator /> : null}
                {canDelete ? (
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      onDeleteRequest();
                    }}
                    variant="destructive"
                    className="gap-2"
                  >
                    <Trash2 className="size-4" />
                    حذف پیام
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>
    </motion.div>
  );
}

// ============================================================
// FileAttachment — renders image / video / pdf / file inline
// ============================================================

/**
 * Renders a file attachment inside a message bubble. Decides the layout
 * based on `fileType`:
 *   - image → <img> with loading skeleton + caption (caption is rendered
 *             by the parent bubble).
 *   - video → <video controls preload="metadata"> HTML5 player.
 *   - pdf   → bordered card with FileText icon + name + size + [مشاهده]
 *            (opens in new tab via browser PDF viewer) + [دانلود] link.
 *   - file  → generic file card with Paperclip icon + name + size +
 *            [دانلود] link.
 *
 * The file URL is always treated as a relative path under /uploads/. The
 * `<a download>` attribute is set so browsers download instead of
 * navigating; for PDFs we use a separate [مشاهده] link without `download`
 * so the browser opens its built-in PDF viewer.
 */
function FileAttachment({
  fileUrl,
  fileName,
  fileType,
  fileSize,
  mimeType,
  own,
}: {
  fileUrl: string;
  fileName?: string | null;
  fileType?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
  own: boolean;
}) {
  const safeName = fileName || "فایل";
  const sizeLabel = formatFileSize(fileSize ?? null);

  if (fileType === "image") {
    return (
      <ImageAttachment
        fileUrl={fileUrl}
        fileName={safeName}
        own={own}
      />
    );
  }

  if (fileType === "video") {
    return (
      <div className="flex flex-col gap-1">
        <video
          src={fileUrl}
          controls
          preload="metadata"
          className="max-h-80 w-full max-w-full rounded-lg bg-black"
        />
        <DownloadLink fileUrl={fileUrl} fileName={safeName} sizeLabel={sizeLabel} own={own} />
      </div>
    );
  }

  if (fileType === "audio") {
    // Phase 27 — Telegram-style voice message player with a real waveform
    // (computed via Web Audio API) + a play/pause button + duration timer
    // + a download link. The player handles its own state (loading,
    // playing, seeking) so the parent just provides fileUrl + fileName.
    return (
      <div className="voice-message-bubble">
        <VoiceMessagePlayer
          fileUrl={fileUrl}
          fileName={fileName}
          mimeType={mimeType}
          own={own}
        />
      </div>
    );
  }

  if (fileType === "pdf") {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/60 p-2">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-red-500/10 text-red-600 dark:text-red-300">
            <FileText className="size-5" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <span
              className="truncate text-xs font-medium"
              title={safeName}
              dir="auto"
            >
              {safeName}
            </span>
            <span className="text-[10px] text-muted-foreground">
              PDF · {sizeLabel}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <a
              href={fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-7 items-center gap-1 rounded-md border border-border/60 bg-background px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-accent"
              aria-label="مشاهده فایل PDF"
            >
              <ExternalLink className="size-3.5" />
              مشاهده
            </a>
            <DownloadLink
              fileUrl={fileUrl}
              fileName={safeName}
              sizeLabel={null}
              own={own}
              compact
            />
          </div>
        </div>
      </div>
    );
  }

  // Generic file (zip, doc, audio, etc.)
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/60 p-2">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <FileIcon className="size-5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span
            className="truncate text-xs font-medium"
            title={safeName}
            dir="auto"
          >
            {safeName}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {mimeType || "فایل"} · {sizeLabel}
          </span>
        </div>
        <DownloadLink
          fileUrl={fileUrl}
          fileName={safeName}
          sizeLabel={null}
          own={own}
        />
      </div>
    </div>
  );
}

/**
 * Image attachment with a skeleton placeholder while the file loads. The
 * skeleton collapses (height: 0) once the image fires its onLoad event.
 */
function ImageAttachment({
  fileUrl,
  fileName,
  own,
}: {
  fileUrl: string;
  fileName: string;
  own: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <div className="relative overflow-hidden rounded-lg">
        {!loaded ? (
          <LazySkeleton className="absolute inset-0 h-48 w-full rounded-lg" />
        ) : null}
        {/* Skeleton stays on top until the image fires onLoad, then the
            img fades in. Use a plain <img> (not next/image) since the src
            is a runtime /uploads/ path that next/image can't optimize. */}
        <img
          src={fileUrl}
          alt={fileName}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => setLoaded(true)}
          className={`max-h-80 w-full max-w-full rounded-lg object-cover transition-opacity ${
            loaded ? "opacity-100" : "opacity-0"
          }`}
        />
      </div>
      <DownloadLink fileUrl={fileUrl} fileName={fileName} sizeLabel={null} own={own} />
    </div>
  );
}

/**
 * Small "[دانلود]" link/button. Uses an `<a download>` attribute so the
 * browser downloads instead of navigating. In `compact` mode the link
 * renders as a button-styled chip; otherwise as a small text link.
 */
function DownloadLink({
  fileUrl,
  fileName,
  sizeLabel,
  own,
  compact = false,
}: {
  fileUrl: string;
  fileName: string;
  sizeLabel: string | null;
  own: boolean;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <a
        href={fileUrl}
        download={fileName}
        className="inline-flex h-7 items-center gap-1 rounded-md border border-border/60 bg-background px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-accent"
        aria-label={`دانلود ${fileName}`}
      >
        <Download className="size-3.5" />
        دانلود
      </a>
    );
  }
  return (
    <a
      href={fileUrl}
      download={fileName}
      className={`inline-flex items-center gap-1 self-start text-[11px] underline-offset-2 hover:underline ${
        own
          ? "text-primary-foreground/80 hover:text-primary-foreground"
          : "text-primary hover:text-primary/80"
      }`}
      aria-label={`دانلود ${fileName}`}
    >
      <Download className="size-3" />
      دانلود{sizeLabel ? ` · ${sizeLabel}` : ""}
    </a>
  );
}

// ============================================================
// PollRow — inline poll card with vote bars + close button
// ============================================================

function PollRow({
  poll,
  currentUserId,
  isPrivileged,
  onVoteSingle,
  onVoteMultiple,
  onClose,
}: {
  poll: Poll;
  currentUserId: string;
  isPrivileged: boolean;
  onVoteSingle: (pollId: string, optionIndex: number) => void;
  onVoteMultiple: (pollId: string, optionIndexes: number[]) => void;
  onClose: (pollId: string) => void;
}) {
  const isClosed = Boolean(poll.closedAt);
  const isCreator = poll.createdBy?.id === currentUserId;
  const canClosePoll = !isClosed && (isCreator || isPrivileged);

  // Track local selection state for multiple-choice polls.
  // Local override is only used after the user toggles checkboxes but before
  // they submit. After submit, we read from `poll.myVote` (server source of
  // truth). We use the prev-value pattern (per React docs) to sync back from
  // the server when needed, without using an effect.
  const [multiSelected, setMultiSelected] = useState<number[]>(() => {
    if (poll.multipleChoice && Array.isArray(poll.myVote)) {
      return [...poll.myVote];
    }
    return [];
  });
  const [prevMyVote, setPrevMyVote] = useState<unknown>(poll.myVote);
  if (poll.myVote !== prevMyVote) {
    setPrevMyVote(poll.myVote);
    if (poll.multipleChoice && Array.isArray(poll.myVote)) {
      setMultiSelected([...poll.myVote]);
    }
  }

  // Has the user already voted?
  const hasVoted = poll.multipleChoice
    ? Array.isArray(poll.myVote) && poll.myVote.length > 0
    : poll.myVote !== null && poll.myVote !== undefined;

  // Helper: is a given option index part of the user's vote?
  const isOptionMine = (idx: number) => {
    if (poll.multipleChoice) {
      return Array.isArray(poll.myVote) && poll.myVote.includes(idx);
    }
    return poll.myVote === idx;
  };

  const totalVotes = poll.totalVotes ?? 0;
  const optionVotes = poll.optionVotes ?? [];

  const toggleMulti = (idx: number) => {
    if (isClosed) return;
    setMultiSelected((prev) =>
      prev.includes(idx) ? prev.filter((x) => x !== idx) : [...prev, idx],
    );
  };

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="mx-auto w-full max-w-[90%] sm:max-w-[80%]"
    >
      <Card className="overflow-hidden border-primary/20 bg-secondary/30">
        <CardContent className="p-3">
          {/* Header: question + badges */}
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-semibold leading-tight">
                {poll.question}
              </span>
              <span className="text-[10px] text-muted-foreground">
                نظرسنجی ·{" "}
                {poll.multipleChoice ? "چند گزینه‌ای" : "تک گزینه‌ای"}
              </span>
            </div>
            {isClosed ? (
              <Badge
                variant="secondary"
                className="gap-1 bg-amber-500/10 text-amber-700 dark:text-amber-300"
              >
                <CheckCircle2 className="size-3" />
                بسته شده
              </Badge>
            ) : null}
          </div>

          {/* Options */}
          <div className="space-y-1.5">
            {poll.options.map((optionText, idx) => {
              const votes = optionVotes[idx] ?? 0;
              const pct =
                totalVotes > 0 ? Math.round((votes / totalVotes) * 100) : 0;
              const mine = isOptionMine(idx);

              if (poll.multipleChoice) {
                const checked = multiSelected.includes(idx);
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => toggleMulti(idx)}
                    disabled={isClosed || (hasVoted && !mine)}
                    className={`relative flex w-full items-center gap-2 overflow-hidden rounded-md border px-2 py-1.5 text-right transition-colors disabled:cursor-not-allowed disabled:opacity-70 ${
                      mine
                        ? "border-primary bg-primary/10"
                        : "border-border bg-background hover:bg-accent/40"
                    }`}
                  >
                    <ProgressFill percent={pct} mine={mine} />
                    <Checkbox
                      checked={checked}
                      disabled={isClosed || (hasVoted && !mine)}
                      onCheckedChange={() => toggleMulti(idx)}
                      className="relative z-10"
                    />
                    <span className="relative z-10 flex-1 text-xs">
                      {optionText}
                    </span>
                    {hasVoted || isClosed ? (
                      <span className="relative z-10 text-[10px] text-muted-foreground">
                        {toPersianDigits(votes)} · {toPersianDigits(pct)}٪
                      </span>
                    ) : null}
                  </button>
                );
              }

              // Single-choice
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    if (isClosed || hasVoted) return;
                    onVoteSingle(poll.id, idx);
                  }}
                  disabled={isClosed || (hasVoted && !mine)}
                  className={`relative flex w-full items-center gap-2 overflow-hidden rounded-md border px-2 py-1.5 text-right transition-colors disabled:cursor-not-allowed disabled:opacity-70 ${
                    mine
                      ? "border-primary bg-primary/10"
                      : "border-border bg-background hover:bg-accent/40"
                  }`}
                >
                  <ProgressFill percent={pct} mine={mine} />
                  <span
                    className={`relative z-10 size-3 shrink-0 rounded-full border-2 ${
                      mine
                        ? "border-primary bg-primary"
                        : "border-muted-foreground/40"
                    }`}
                  />
                  <span className="relative z-10 flex-1 text-xs">
                    {optionText}
                  </span>
                  {hasVoted || isClosed ? (
                    <span className="relative z-10 text-[10px] text-muted-foreground">
                      {toPersianDigits(votes)} · {toPersianDigits(pct)}٪
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {/* Multiple-choice submit button */}
          {poll.multipleChoice && !isClosed && !hasVoted ? (
            <Button
              type="button"
              size="sm"
              className="mt-2 h-7 w-full text-xs"
              disabled={multiSelected.length === 0}
              onClick={() => onVoteMultiple(poll.id, multiSelected)}
            >
              ثبت رای
            </Button>
          ) : null}

          {/* Footer: total + close button */}
          <div className="mt-2 flex items-center justify-between border-t pt-2">
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Users className="size-3" />
              مجموع آرا: {toPersianDigits(totalVotes)}
            </span>
            {canClosePoll ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[11px] text-muted-foreground hover:text-destructive"
                onClick={() => onClose(poll.id)}
              >
                <Lock className="size-3" />
                بستن نظرسنجی
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

/** A horizontal fill bar drawn BEHIND a poll option row to show vote share. */
function ProgressFill({
  percent,
  mine,
}: {
  percent: number;
  mine: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className="absolute inset-y-0 right-0 z-0 transition-all duration-300"
      style={{
        width: `${percent}%`,
        background: mine
          ? "color-mix(in srgb, var(--primary) 18%, transparent)"
          : "color-mix(in srgb, var(--muted-foreground) 12%, transparent)",
      }}
    />
  );
}

// ============================================================
// CreatePollDialog — question + dynamic options + multiple toggle
// ============================================================

function CreatePollDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (body: {
    question: string;
    options: string[];
    multipleChoice: boolean;
  }) => void;
}) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [multipleChoice, setMultipleChoice] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Reset internal state when the dialog transitions to closed.
  // Uses the "previous prop" pattern from the React docs (instead of an
  // effect) to avoid the cascading-render lint warning.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) {
      setQuestion("");
      setOptions(["", ""]);
      setMultipleChoice(false);
      setSubmitting(false);
    }
  }

  const validOptions = options.map((o) => o.trim()).filter(Boolean);
  const canSubmit =
    question.trim().length > 0 && validOptions.length >= 2 && !submitting;

  function setOption(idx: number, value: string) {
    setOptions((prev) =>
      prev.map((o, i) => (i === idx ? value : o)),
    );
  }

  function addOption() {
    if (options.length >= 10) return;
    setOptions((prev) => [...prev, ""]);
  }

  function removeOption(idx: number) {
    if (options.length <= 2) return;
    setOptions((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    onSubmit({
      question: question.trim(),
      options: validOptions,
      multipleChoice,
    });
    // Parent will close the dialog via onOpenChange.
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>ایجاد نظرسنجی</DialogTitle>
          <DialogDescription>
            یک نظرسنجی جدید برای دانش‌آموزان این کلاس ایجاد کنید.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Question */}
          <div className="space-y-1.5">
            <Label htmlFor="poll-question">سوال</Label>
            <Input
              id="poll-question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="سوال نظرسنجی را بنویسید…"
              maxLength={300}
              autoFocus
            />
          </div>

          <Separator />

          {/* Options */}
          <div className="space-y-2">
            <Label>گزینه‌ها</Label>
            <div className="space-y-2">
              {options.map((opt, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Input
                    value={opt}
                    onChange={(e) => setOption(idx, e.target.value)}
                    placeholder={`گزینه ${toPersianDigits(idx + 1)}`}
                    maxLength={200}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-9 shrink-0 text-muted-foreground hover:text-destructive disabled:opacity-30"
                    onClick={() => removeOption(idx)}
                    disabled={options.length <= 2}
                    aria-label="حذف گزینه"
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-1 h-8 gap-1 text-xs"
              onClick={addOption}
              disabled={options.length >= 10}
            >
              <Plus className="size-3.5" />
              افزودن گزینه
            </Button>
          </div>

          <Separator />

          {/* Multiple-choice toggle */}
          <div className="flex items-center justify-between gap-2 rounded-md border p-2.5">
            <div className="flex flex-col">
              <Label htmlFor="poll-multiple" className="text-sm">
                انتخاب چندگزینه‌ای
              </Label>
              <span className="text-[11px] text-muted-foreground">
                کاربران می‌توانند چند گزینه را همزمان انتخاب کنند
              </span>
            </div>
            <Switch
              id="poll-multiple"
              checked={multipleChoice}
              onCheckedChange={setMultipleChoice}
            />
          </div>
        </form>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            انصراف
          </Button>
          <Button
            type="button"
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            {submitting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <BarChart3 className="size-4" />
            )}
            ایجاد
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// ForwardDialog (phase 17) — pick a target class + POST forward
// ============================================================

/**
 * The forward dialog. Renders the user's classes (cached in TanStack Query
 * under the key `["classes", user.id]` by the messenger-app parent) and, on
 * pick, calls `POST /api/messages/[id]/forward { targetClassId }` for each
 * message id in `state.messageIds`. On success: emits `relay_message` to
 * broadcast into the target class, reports progress, and calls `onForwarded`
 * with a `{ [sourceMessageId]: createdMessageId }` map.
 *
 * The dialog auto-closes on success + clears the parent's `forwardState`.
 */
function ForwardDialog({
  open,
  onOpenChange,
  state,
  sourceClassId,
  onForwarded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state:
    | { mode: "single" | "batch"; messageIds: string[] }
    | null;
  /** The class id the messages are being forwarded FROM (so we can exclude
   *  it from the target list — no-op "forward to the same class"). */
  sourceClassId: string;
  /** Called once after ALL forwards succeed (or partially succeed). The
   *  map is `{ [sourceMessageId]: createdMessageId }` for each successfully
   *  forwarded message. The caller decides what to do with failures (toast,
   *  retry, etc.) — we surface them via the per-row status line in the UI. */
  onForwarded: (createdByMessageId: Record<string, string>) => void;
}) {
  const { toast } = useToast();
  // Pull the cached classes query (the parent — messenger-app — owns the
  // queryKey ["classes", user.id]). This way the dialog doesn't refetch and
  // always renders the latest list the user sees in the conversation list.
  const { data: classes, isLoading } = useQuery<ClassItem[]>({
    queryKey: ["classes", "__forward_dialog__"], // separate cache key so we
    // don't accidentally refetch the parent's classes when this dialog mounts.
    queryFn: () => fetchClasses(),
    enabled: open,
    staleTime: 60 * 1000, // 1 min — fresh enough for picking a target class.
  });

  const [pickedClassId, setPickedClassId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Reset internal state when the dialog transitions to closed.
  // Uses the "previous prop" pattern from the React docs (instead of an
  // effect) to avoid the cascading-render lint warning.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) {
      setPickedClassId(null);
      setSubmitting(false);
    }
  }

  // Filter out the source class (you can't forward to the same class — it
  // would create a near-duplicate message in the same room).
  const targetClasses = (classes ?? []).filter(
    (c) => c.id !== sourceClassId,
  );

  const canSubmit =
    !!pickedClassId && !!state && state.messageIds.length > 0 && !submitting;

  async function handleSubmit() {
    if (!state || !pickedClassId || submitting) return;
    setSubmitting(true);
    const createdMap: Record<string, string> = {};
    let failed = 0;
    for (const messageId of state.messageIds) {
      try {
        const created = await forwardMessage(messageId, pickedClassId);
        createdMap[messageId] = created.id;
      } catch (err: any) {
        failed += 1;
        // Surface the FIRST error in a toast, but keep going so the user
        // can see a partial result if e.g. one message in a batch was
        // deleted between the user clicking "forward" and us iterating.
        if (failed === 1) {
          toast({
            title: "هدایت برخی پیام‌ها ناموفق بود",
            description: err?.message || "خطای غیرمنتظره",
            variant: "destructive",
          });
        }
      }
    }
    setSubmitting(false);
    if (Object.keys(createdMap).length > 0) {
      onForwarded(createdMap);
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>هدایت پیام به کلاس دیگر</DialogTitle>
          <DialogDescription>
            {state && state.messageIds.length > 1
              ? `${toPersianDigits(state.messageIds.length)} پیام به کلاس مقصد هدایت می‌شود.`
              : "یک کلاس مقصد برای هدایت این پیام انتخاب کنید."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label>کلاس مقصد</Label>
          {isLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              در حال بارگذاری کلاس‌ها…
            </div>
          ) : targetClasses.length === 0 ? (
            <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
              کلاس دیگری برای هدایت وجود ندارد.
            </p>
          ) : (
            <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border p-1.5">
              {targetClasses.map((c) => {
                const picked = pickedClassId === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setPickedClassId(c.id)}
                    className={`flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-right transition-colors ${
                      picked
                        ? "border-primary bg-primary/5"
                        : "border-transparent hover:bg-accent"
                    }`}
                  >
                    <span
                      className={`flex size-4 shrink-0 items-center justify-center rounded-full border-2 ${
                        picked
                          ? "border-primary bg-primary"
                          : "border-muted-foreground/40"
                      }`}
                    >
                      {picked ? (
                        <Check className="size-2.5 text-primary-foreground" />
                      ) : null}
                    </span>
                    <ChatAvatar
                      fullName={c.name}
                      userId={c.id}
                      size="sm"
                      className="size-7"
                    />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">
                        {c.name}
                      </span>
                      {c.gradeLevel || c.section ? (
                        <span className="text-[10px] text-muted-foreground">
                          {[c.gradeLevel, c.section].filter(Boolean).join(" · ")}
                        </span>
                      ) : null}
                    </div>
                    <Badge
                      variant="secondary"
                      className="bg-muted px-1.5 py-0 text-[10px]"
                    >
                      {toPersianDigits(c.memberCount)} نفر
                    </Badge>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            انصراف
          </Button>
          <Button
            type="button"
            disabled={!canSubmit}
            onClick={() => void handleSubmit()}
          >
            {submitting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Forward className="size-4" />
            )}
            هدایت
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// SeenByDialog (phase 17) — list users who have read a message
// ============================================================

/**
 * Seen-by dialog. Fetches `GET /api/messages/[id]/readers` when opened and
 * renders a list of avatars + names + read-times. Shows an empty-state when
 * no one has read the message yet. Loading + error states also handled.
 */
function SeenByDialog({
  messageId,
  user,
  onOpenChange,
}: {
  /** The id of the message whose readers to show. When `null`, the dialog is
   *  closed (controlled by the parent's `seenByMessageId` state). */
  messageId: string | null;
  /** The current viewer — only ADMIN/SUPERADMIN see the @username handles. */
  user: MessengerUser;
  onOpenChange: (open: boolean) => void;
}) {
  const open = messageId !== null;
  const { data, isLoading, isError, error, refetch } = useQuery<
    MessageReader[]
  >({
    queryKey: ["message-readers", messageId],
    queryFn: () => fetchMessageReaders(messageId!),
    enabled: open && !!messageId,
    staleTime: 5 * 1000, // 5s — let the user re-open to refresh without a network spam.
  });

  const readers = data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>مشاهده خوانندگان پیام</DialogTitle>
          <DialogDescription>
            کاربرانی که این پیام را دیده‌اند.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {isLoading ? (
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
          ) : isError ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-muted-foreground">
              <p>خطا در بارگذاری خوانندگان.</p>
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
          ) : readers.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
              <Eye className="size-8 opacity-40" />
              <p>هنوز کسی این پیام را ندیده است.</p>
            </div>
          ) : (
            <div className="max-h-96 space-y-1 overflow-y-auto rounded-md border p-1.5">
              {readers.map((r) => (
                <div
                  key={r.userId}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-accent"
                >
                  <ChatAvatar
                    fullName={r.fullName}
                    userId={r.userId}
                    avatar={r.avatar}
                    size="sm"
                    className="size-9"
                  />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">
                      {r.fullName}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {roleLabel(r.role)}
                      {(user.role === "ADMIN" || user.role === "SUPERADMIN") && r.username ? ` · @${r.username}` : ""}
                    </span>
                  </div>
                  <span
                    className="shrink-0 text-[10px] text-muted-foreground"
                    dir="ltr"
                  >
                    {shortTime(r.readAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

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
