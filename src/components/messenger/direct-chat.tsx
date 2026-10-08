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
import { socketAuthCallback } from "@/lib/socket-auth-client";
import { motion, AnimatePresence } from "framer-motion";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LazySkeleton } from "@/components/ui/lazy-skeleton";
import { Textarea } from "@/components/ui/textarea";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Send,
  Loader2,
  ChevronUp,
  Wifi,
  WifiOff,
  MoreVertical,
  Trash2,
  ArrowRight,
  Palette,
  Paperclip,
  FileText,
  File as FileIcon,
  Download,
  ExternalLink,
  ImageIcon,
  Film,
  Check,
  CheckCheck,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  fetchDirectMessages,
  deleteDirectMessage,
  postDirectMessageWithFile,
  markDirectChatRead,
} from "@/lib/messenger-api";
import { ChatAvatar } from "./chat-avatar";
import { ChatSettingsDialog } from "./chat-settings-dialog";
// Phase 26 — composer upgrades: WhatsApp-style emoji picker + voice recorder.
// Both are standalone, reusable components (no shared state with the chat).
import { EmojiPicker } from "./emoji-picker";
import { VoiceRecorder } from "./voice-recorder";
import { VoiceMessagePlayer } from "./voice-message-player";
import { useDeviceType } from "./use-device-type";
import {
  useChatAppearance,
  resolveBackgroundCss,
} from "./chat-appearance";
import {
  toPersianDigits,
  formatPersianDay,
  roleLabel,
} from "./persian";
import {
  categorizeFile,
  formatFileSize,
  formatFileTypesLabel,
} from "./file-helpers";
import type {
  DirectChatUser,
  DirectMessageWithDelete,
  MessengerUser,
} from "./types";

// ----------------- Socket payload shapes -----------------
//
// The chat-service emits `new_direct_message` to the OTHER participant of a
// DM whenever someone POSTs a message and emits `relay_direct_message` to
// the sender's own client as the round-trip ack (we dedupe by id when our
// optimistic copy and the broadcast arrive at the same client).

type SocketNewDirectMessage = {
  id: string;
  chatId: string;
  senderId: string;
  senderName: string;
  senderRole: string;
  senderAvatar?: string | null;
  content: string;
  createdAt: string;
  fileUrl?: string | null;
  fileName?: string | null;
  fileType?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
};

type SocketDirectMessageDeleted = {
  id: string;
  chatId?: string;
  deletedBy?: string;
  deletedAt?: string;
};

/**
 * Phase 11 read-receipt broadcast: emitted by the chat mini-service to
 * the OTHER participant of a direct chat when they open it (the opener
 * emits `mark_direct_read { chatId }` → the service broadcasts this back
 * to the room). The recipient (i.e. the SENDER of the original messages)
 * uses `readAt` to flip their own ticks from single ✓ to blue ✓✓.
 */
type SocketDirectMessagesRead = {
  chatId: string;
  readAt: string;
  readerId?: string;
};

// ----------------- Timeline helpers -----------------

const LOAD_LIMIT = 50;
const STUDENT_DELETE_WINDOW_MS = 12 * 60 * 60 * 1000; // 12h
// DMs can carry an optional caption alongside the file. We don't enforce
// a per-class max-size here (DMs aren't bound to a ClassRoom's file-settings
// row); use a generous 25 MB ceiling that matches what the backend will
// likely enforce for DM file attachments.
const DM_MAX_FILE_BYTES = 25 * 1024 * 1024;

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

function sortMessages(items: DirectMessageWithDelete[]) {
  return [...items].sort((a, b) => {
    // Phase 35c fix: guard against undefined createdAt (was causing
    // "Cannot read properties of undefined (reading 'getTime')" when
    // the POST response shape was wrong — now also fixed at the API
    // client level in postDirectMessageWithFile).
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return ta - tb;
  });
}

// ============================================================
// DirectChat component
// ============================================================

/**
 * 1:1 private chat view — Telegram-style bubbles, avatars, file attachments,
 * date separators, optimistic send, soft-delete with permission rules, and
 * socket.io real-time sync via the chat mini-service.
 *
 * Differs from ClassChat in:
 *   - No polls, no chat-close/open, no per-class file-settings.
 *   - The "other user" header is clickable to start... nothing (we're
 *     already in a DM with them), so it's just informational.
 *   - Delete rules: sender can delete own within 12h; the other participant
 *     can delete ANY message in their DM; SUPERADMIN anytime.
 *
 * Socket events:
 *   - emits: `join_direct { chatId }`, `send_direct_message { chatId,
 *     content }`, `relay_direct_message { chatId, message }`,
 *     `delete_direct_message { messageId }`
 *   - listens: `new_direct_message`, `direct_message_deleted`
 */
export function DirectChat({
  user,
  chatId,
  otherUser,
  onBack,
}: {
  user: MessengerUser;
  chatId: string;
  otherUser: DirectChatUser;
  onBack: () => void;
}) {
  const { toast } = useToast();

  // ----- State -----
  const [messages, setMessages] = useState<DirectMessageWithDelete[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const [input, setInput] = useState("");
  const [connected, setConnected] = useState(false);

  // Chat-appearance settings dialog (per-device). The hook drives the live
  // background + font-size on the messages container — same as ClassChat.
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const appearance = useChatAppearance();
  const { resolvedTheme } = useTheme();
  const chatBackgroundCss = resolveBackgroundCss(
    appearance.settings.background,
    resolvedTheme,
  );

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] =
    useState<DirectMessageWithDelete | null>(null);

  // ----- File attachment state -----
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  // Phase 27 — tracks whether the VoiceRecorder is currently recording.
  // On mobile/tablet, the composer hides the emoji button + paperclip +
  // textarea while recording, so the recording UI takes the full width.
  const [isRecording, setIsRecording] = useState(false);
  const device = useDeviceType();
  const hideComposerForRecording =
    isRecording && (device === "mobile" || device === "tablet");

  // ----- Refs -----
  const socketRef = useRef<Socket | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const wasNearBottomRef = useRef<boolean>(true);
  const initializedForChatRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Phase 26 — the composer now uses a <Textarea> instead of a single-line
  // <Input>. This ref lets us insert emojis at the cursor position + auto-
  // resize the textarea (max ~5 rows) as the user types multi-line text.
  const inputTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-resize the composer textarea to fit its content (capped at ~5 rows
  // so long messages don't push the chat viewport out of view). Called from
  // the textarea's onChange handler + reset to single-row whenever `input`
  // becomes empty (after send / clear).
  const adjustTextareaHeight = useCallback(() => {
    const ta = inputTextareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, []);

  // -------------------- Helpers --------------------

  const isOwnMessage = useCallback(
    (m: DirectMessageWithDelete) => {
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

  // -------------------- Initial history load --------------------

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessages([]);
    setHasMore(false);
    setNextCursor(null);
    initializedForChatRef.current = null;

    async function loadInitial() {
      try {
        const res = await fetchDirectMessages({
          chatId,
          limit: LOAD_LIMIT,
        });
        if (cancelled) return;
        // API returns newest first; reverse for chronological display.
        setMessages(sortMessages([...res.data].reverse()));
        setHasMore(res.hasMore);
        setNextCursor(res.nextCursor);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "خطای غیرمنتظره";
        toast({
          title: "خطا در بارگذاری پیام‌ها",
          description: msg,
          variant: "destructive",
        });
      } finally {
        if (!cancelled) {
          setLoading(false);
          requestAnimationFrame(() =>
            requestAnimationFrame(() => scrollToBottom()),
          );
        }
      }
    }
    void loadInitial();
    return () => {
      cancelled = true;
    };
  }, [chatId, toast, scrollToBottom]);

  // -------------------- Socket.io connection --------------------

  useEffect(() => {
    const socket = io("/?XTransformPort=3003", {
      // SECURITY: verified server-side via shared-secret JWT issued to the
      // NextAuth session — client identity fields are not trusted.
      auth: socketAuthCallback(),
      transports: ["websocket", "polling"],
      reconnection: true,
      // Phase 24 fix: retry effectively forever (was 10 attempts ≈ 10s).
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
      if (initializedForChatRef.current === chatId) return;
      initializedForChatRef.current = chatId;
      socket.emit("join_direct", { chatId });
      // Phase 11 — mark the other participant's unread messages as read on
      // initial chat open. Best-effort: REST call persists readAt on the
      // server + the socket event lets the OTHER participant (sender of
      // those messages) live-flip their ticks to blue ✓✓. Errors are
      // swallowed inside `markDirectChatRead` — read receipts are an
      // enhancement, not a hard dependency.
      void markDirectChatRead(chatId);
      socket.emit("mark_direct_read", { chatId });
    });

    // ----- new_direct_message -----
    socket.on(
      "new_direct_message",
      (raw: SocketNewDirectMessage) => {
        if (!raw || raw.chatId !== chatId) return;
        const msg: DirectMessageWithDelete = {
          id: raw.id,
          chatId: raw.chatId,
          content: raw.content,
          createdAt: raw.createdAt,
          sender: {
            id: raw.senderId,
            fullName: raw.senderName,
            role: raw.senderRole,
            username: "",
            avatar: raw.senderAvatar ?? null,
          },
          senderId: raw.senderId,
          fileUrl: raw.fileUrl ?? null,
          fileName: raw.fileName ?? null,
          fileType: raw.fileType ?? null,
          fileSize: raw.fileSize ?? null,
          mimeType: raw.mimeType ?? null,
        };
        setMessages((prev) => {
          if (prev.find((it) => it.id === msg.id)) return prev;
          return sortMessages([...prev, msg]);
        });
        if (wasNearBottomRef.current) {
          requestAnimationFrame(() => scrollToBottom(true));
        }
        // Phase 11 — the OTHER participant just sent a new message into
        // this open chat. We're viewing it, so mark it (and any other
        // unread from them) as read immediately.
        if (raw.senderId !== user.id) {
          void markDirectChatRead(chatId);
          socket.emit("mark_direct_read", { chatId });
        }
      },
    );

    // ----- direct_message_deleted -----
    socket.on(
      "direct_message_deleted",
      (payload: SocketDirectMessageDeleted) => {
        if (!payload?.id) return;
        setMessages((prev) => prev.filter((it) => it.id !== payload.id));
      },
    );

    // ----- direct_messages_read (phase 11) -----
    // The OTHER participant just opened this chat (or scrolled to the
    // bottom). They emitted `mark_direct_read { chatId }`, the chat-service
    // broadcast `direct_messages_read { chatId, readAt, readerId }` back
    // to the room. We're the SENDER, so flip every OWN message whose
    // readAt is still null to this readAt → the ticks turn blue ✓✓.
    socket.on(
      "direct_messages_read",
      (payload: SocketDirectMessagesRead) => {
        if (!payload?.chatId || payload.chatId !== chatId) return;
        const stamp = payload.readAt || new Date().toISOString();
        setMessages((prev) =>
          prev.map((m) => {
            // Only stamp our OWN messages (the ones the OTHER user just
            // read). Their own messages don't change.
            if (m.senderId === user.id && !m.readAt) {
              return { ...m, readAt: stamp };
            }
            return m;
          }),
        );
      },
    );

    socket.on("error", (err: { message?: string }) => {
      if (err?.message) {
        toast({
          title: "خطای گفتگو",
          description: err.message,
          variant: "destructive",
        });
      }
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [chatId, user.id, user.username, user.name, user.role, toast]);

  // -------------------- Scroll handler (pagination + near-bottom) --------------------

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    const prevScrollHeight = viewportRef.current?.scrollHeight ?? 0;
    try {
      const res = await fetchDirectMessages({
        chatId,
        cursor: nextCursor,
        limit: LOAD_LIMIT,
      });
      const older = sortMessages([...res.data].reverse());
      setMessages((prev) => sortMessages([...older, ...prev]));
      setHasMore(res.hasMore);
      setNextCursor(res.nextCursor);
      requestAnimationFrame(() => {
        const viewport = viewportRef.current;
        if (!viewport) return;
        const newScrollHeight = viewport.scrollHeight;
        viewport.scrollTop = newScrollHeight - prevScrollHeight;
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطای غیرمنتظره";
      toast({
        title: "خطا در بارگذاری پیام‌های قدیمی",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setLoadingMore(false);
    }
  }, [chatId, nextCursor, loadingMore, toast]);

  const handleScroll = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const { scrollTop, scrollHeight, clientHeight } = viewport;
    const nearBottom = scrollHeight - scrollTop - clientHeight < 120;
    wasNearBottomRef.current = nearBottom;
    if (scrollTop < 60 && hasMore && !loadingMore && !loading) {
      void loadMore();
    }
  }, [hasMore, loadingMore, loading, loadMore]);

  // -------------------- File attachment --------------------

  /**
   * Validate a user-selected file BEFORE posting. DMs don't have per-class
   * file-settings, so we just check a generous size ceiling. The server
   * still re-validates (defence in depth).
   */
  const validatePendingFile = useCallback(
    (file: File): string | null => {
      if (file.size > DM_MAX_FILE_BYTES) {
        return `حداکثر حجم فایل در گفتگو خصوصی ${toPersianDigits(
          25,
        )} مگابایت است`;
      }
      return null;
    },
    [],
  );

  const handlePickFile = useCallback(() => {
    if (!connected || uploading) return;
    fileInputRef.current?.click();
  }, [connected, uploading]);

  /**
   * Stage a user-selected file in `pendingFile` (the chip preview appears
   * above the input). Called from the file picker's onChange handler AND
   * from the VoiceRecorder (Phase 26) when the user sends a voice message.
   *
   * Validates the file client-side (DM size ceiling) — if invalid, toasts
   * the Persian error and aborts. The server still re-validates.
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

  // handleFileChange defined below (Phase 28 — multi-file upload).

  const handleRemovePendingFile = useCallback(() => {
    setPendingFile(null);
  }, []);

  /**
   * Phase 28 — extracted core upload helper for direct messages. Same
   * idea as the class-chat `uploadOneFileNow`: takes the file directly,
   * doesn't touch pendingFile/input state (caller's job), and doesn't
   * manage `uploading` state either (caller's job — so multi-file
   * uploads only flip the spinner once for the whole batch).
   */
  const uploadOneFileNow = useCallback(
    async (file: File, caption: string) => {
      const validationError = validatePendingFile(file);
      if (validationError) {
        toast({
          title: "ارسال فایل ممکن نیست",
          description: validationError,
          variant: "destructive",
        });
        return;
      }

      const tempId = `__optim_dm_file__${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const optimistic: DirectMessageWithDelete = {
        id: tempId,
        chatId,
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
      setMessages((prev) => sortMessages([...prev, optimistic]));
      wasNearBottomRef.current = true;
      requestAnimationFrame(() => scrollToBottom(true));

      try {
        const created = await postDirectMessageWithFile({
          chatId,
          content: caption || undefined,
          file,
        });

        setMessages((prev) => {
          const withoutTemp = prev.filter((m) => m.id !== tempId);
          if (withoutTemp.find((m) => m.id === created.id)) {
            return withoutTemp;
          }
          return sortMessages([...withoutTemp, created]);
        });

        const socket = socketRef.current;
        if (socket?.connected) {
          socket.emit("relay_direct_message", {
            chatId,
            message: {
              id: created.id,
              chatId: created.chatId,
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
            },
          });
        }
      } catch (err) {
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        toast({
          title: "بارگذاری فایل ناموفق بود",
          description: err instanceof Error ? err.message : "خطای غیرمنتظره",
          variant: "destructive",
        });
      }
    },
    [
      validatePendingFile,
      chatId,
      user.id,
      user.name,
      user.role,
      user.username,
      user.avatar,
      toast,
      scrollToBottom,
    ],
  );

  /**
   * Upload the staged file via POST /api/direct-messages (multipart). On
   * success: optimistic-replace the staged chip with the real persisted
   * message, emit `relay_direct_message` so the other participant gets it
   * in real-time, clear the chip + the (optional) caption.
   *
   * Phase 28 — the core upload path is now in `uploadOneFileNow` above;
   * this wrapper layers the staged-file lifecycle on top (managing the
   * pendingFile + input + uploading + toast).
   */
  const handleUploadFile = useCallback(async () => {
    const file = pendingFile;
    if (!file || uploading) return;

    setUploading(true);
    try {
      const caption = input.trim();
      await uploadOneFileNow(file, caption);
      setPendingFile(null);
      setInput("");
      toast({ title: "فایل ارسال شد" });
    } finally {
      setUploading(false);
    }
  }, [
    pendingFile,
    uploading,
    input,
    uploadOneFileNow,
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
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (files.length === 0) return;
      const [first, ...rest] = files;
      stageFile(first);
      if (rest.length === 0) return;
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

      const tempId = `__optim_dm__${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const optimistic: DirectMessageWithDelete = {
        id: tempId,
        chatId,
        content,
        createdAt: new Date().toISOString(),
        sender: {
          id: user.id,
          fullName: user.name,
          role: user.role,
          username: user.username,
          avatar: user.avatar ?? null,
        },
      };
      setMessages((prev) => sortMessages([...prev, optimistic]));
      setInput("");
      wasNearBottomRef.current = true;
      requestAnimationFrame(() => scrollToBottom(true));

      // POST via REST (the route accepts multipart with optional content
      // AND optional file, so a text-only message still goes through the
      // multipart path uniformly), then relay via socket.io so the other
      // participant gets the message in real-time. The persisted message
      // is the single source of truth; we dedupe by id against the
      // optimistic copy.
      (async () => {
        try {
          const created = await postDirectMessageWithFile({
            chatId,
            content,
          });

          setMessages((prev) => {
            const withoutTemp = prev.filter((m) => m.id !== tempId);
            if (withoutTemp.find((m) => m.id === created.id)) {
              return withoutTemp;
            }
            return sortMessages([...withoutTemp, created]);
          });

          if (socket?.connected) {
            socket.emit("relay_direct_message", {
              chatId,
              message: {
                id: created.id,
                chatId: created.chatId,
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
              },
            });
          }
        } catch (err) {
          setMessages((prev) => prev.filter((m) => m.id !== tempId));
          toast({
            title: "ارسال ناموفق",
            description: err instanceof Error ? err.message : "خطای غیرمنتظره",
            variant: "destructive",
          });
        }
      })();
    },
    [
      pendingFile,
      handleUploadFile,
      input,
      chatId,
      user.id,
      user.name,
      user.role,
      user.username,
      toast,
      scrollToBottom,
    ],
  );

  // -------------------- Delete message --------------------

  /**
   * For 1:1 DMs, the delete rules are:
   *   - SENDER can delete their own message within 12h of createdAt.
   *   - The OTHER participant can delete ANY message in the conversation
   *     (it's their private chat — they own what shows in it).
   *   - SUPERADMIN can delete any direct message anytime (handled server-side;
   *     on the client the messenger only renders for STUDENT/TEACHER/ADMIN
   *     so we don't special-case SUPERADMIN here).
   *
   * The server re-validates; this client gate is just for the menu affordance.
   */
  const canDeleteMessage = useCallback(
    (m: DirectMessageWithDelete): boolean => {
      if (isOwnMessage(m)) {
        const created = new Date(m.createdAt).getTime();
        if (Number.isNaN(created)) return false;
        return Date.now() - created < STUDENT_DELETE_WINDOW_MS;
      }
      // The other participant → can delete any message in their DM.
      return true;
    },
    [isOwnMessage],
  );

  const handleDeleteConfirm = useCallback(async () => {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target) return;
    const messageId = target.id;
    // Optimistically remove from list.
    setMessages((prev) => prev.filter((it) => it.id !== messageId));
    try {
      await deleteDirectMessage(messageId);
      // Broadcast the delete to the other participant.
      const socket = socketRef.current;
      if (socket?.connected) {
        socket.emit("delete_direct_message", { messageId });
      }
      toast({ title: "پیام حذف شد" });
    } catch (err) {
      // Restore on failure.
      setMessages((prev) => sortMessages([...prev, target]));
      toast({
        title: "حذف ناموفق",
        description: err instanceof Error ? err.message : "خطای غیرمنتظره",
        variant: "destructive",
      });
    }
  }, [deleteTarget, toast]);

  // -------------------- Grouped timeline --------------------

  const grouped = useMemo(() => {
    const groups: { key: string; label: string; items: DirectMessageWithDelete[] }[] = [];
    let lastKey: string | null = null;
    for (const it of messages) {
      const k = dayKey(it.createdAt);
      if (k !== lastKey) {
        groups.push({
          key: k,
          label: formatPersianDay(it.createdAt),
          items: [it],
        });
        lastKey = k;
      } else {
        groups[groups.length - 1].items.push(it);
      }
    }
    return groups;
  }, [messages]);

  const inputDisabled = !connected;

  // -------------------- Phase 26: emoji insertion --------------------

  /**
   * Insert an emoji at the current cursor position in the composer textarea.
   * If the textarea isn't focused (no selection), append it to the end.
   * After insertion, restore the cursor just past the emoji so the user can
   * keep typing. The picker stays open so the user can pick more emojis.
   *
   * Direct-chat doesn't emit a typing indicator (no socket event for that
   * here), so we just call `setInput` directly with the spliced text.
   */
  const handleEmojiSelect = useCallback(
    (emoji: string) => {
      const ta = inputTextareaRef.current;
      if (!ta) {
        // Fallback: just append.
        setInput((prev) => prev + emoji);
        return;
      }
      const start = ta.selectionStart ?? input.length;
      const end = ta.selectionEnd ?? input.length;
      const next = input.slice(0, start) + emoji + input.slice(end);
      setInput(next);
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
    [input, adjustTextareaHeight],
  );

  // Reset the textarea height to a single row whenever the input clears
  // (after sending a message / clearing the draft). Without this, the
  // textarea stays expanded after the text vanishes.
  useEffect(() => {
    if (input === "") {
      const ta = inputTextareaRef.current;
      if (ta) ta.style.height = "auto";
    }
  }, [input]);

  // ============================================================
  // Render
  // ============================================================

  return (
    <div className="flex h-full flex-col rounded-none border bg-muted shadow-sm sm:m-2 sm:rounded-xl">
      {/* ---------- HEADER ---------- */}
      <div className="flex items-center justify-between gap-2 border-b bg-background/95 px-3 py-2.5 backdrop-blur sm:rounded-t-xl">
        <div className="flex min-w-0 items-center gap-2">
          {/* Back to class chat */}
          <Button
            variant="ghost"
            size="icon"
            className="size-9 shrink-0"
            onClick={onBack}
            aria-label="بازگشت به چت کلاس"
            title="بازگشت به چت کلاس"
          >
            <ArrowRight className="size-5" />
          </Button>
          <ChatAvatar
            fullName={otherUser.fullName}
            userId={otherUser.id}
            avatar={otherUser.avatar}
            size="sm"
          />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-semibold leading-tight">
              {otherUser.fullName}
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
              <span dir="ltr" className="font-mono text-muted-foreground">
                {/* Phase 35h — @username only visible to ADMIN + SUPERADMIN */}
                {(user.role === "ADMIN" || user.role === "SUPERADMIN") ? `@${otherUser.username}` : ""}
              </span>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <Badge
            variant="secondary"
            className="bg-primary/10 text-primary text-[10px]"
          >
            {roleLabel(otherUser.role)}
          </Badge>
          {/* Appearance settings — same per-device dialog as ClassChat. */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAppearanceOpen(true)}
            className="h-8 gap-1 px-2 text-xs"
            aria-label="تنظیمات ظاهری پیام‌رسان"
            title="تنظیمات ظاهری پیام‌رسان"
          >
            <Palette className="size-3.5" />
            <span className="hidden sm:inline">تنظیمات ظاهری</span>
          </Button>
        </div>
      </div>

      {/* ---------- MESSAGES ---------- */}
      <div className="flex-1 overflow-hidden">
        <div
          ref={viewportRef}
          onScroll={handleScroll}
          className="scrollbar-rtl h-full overflow-y-auto px-3 py-3"
          style={{
            background: chatBackgroundCss,
            fontSize: `${appearance.settings.fontSize}px`,
          }}
        >
          {loadingMore ? (
            <div className="mb-3 flex justify-center">
              <LazySkeleton className="h-6 w-32" />
            </div>
          ) : hasMore ? (
            <div className="mb-3 flex justify-center">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground"
                onClick={() => void loadMore()}
              >
                <ChevronUp className="size-3.5" />
                بارگذاری پیام‌های قدیمی‌تر
              </Button>
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
          ) : messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 py-10 text-center text-muted-foreground">
              <Send className="size-8 opacity-50" />
              <p className="text-sm">
                هنوز پیامی بین شما و {otherUser.fullName} رد و بدل نشده است.
              </p>
              <p className="text-xs">اولین پیام را شما ارسال کنید!</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {grouped.map((group) => (
                <div key={group.key} className="space-y-2.5">
                  <div className="flex items-center justify-center py-1">
                    <span className="rounded-full bg-muted px-3 py-0.5 text-[10px] text-muted-foreground">
                      {group.label}
                    </span>
                  </div>
                  {group.items.map((m) => (
                    <DirectMessageRow
                      key={m.id}
                      message={m}
                      own={isOwnMessage(m)}
                      canDelete={canDeleteMessage(m)}
                      onDeleteRequest={() => setDeleteTarget(m)}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ---------- File chip preview ---------- */}
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
                <Trash2 className="size-4" />
              </Button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* ---------- INPUT ---------- */}
      <form
        onSubmit={sendMessage}
        className="flex items-end gap-2 border-t bg-background px-3 py-2.5 sm:rounded-b-xl"
      >
        {/* Hidden file input — clicked by the paperclip button. Also reused
            by the VoiceRecorder (Phase 26): when the user sends a voice
            message, the recorded File is staged via `stageFile` (same path
            as a manually-picked file) so the chip preview + the existing
            POST /api/direct-messages multipart upload flow handle it. */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.svg,.mp4,.webm,.mov,.avi,image/*,video/*,application/pdf"
          multiple
          className="sr-only"
          onChange={handleFileChange}
          tabIndex={-1}
          aria-hidden="true"
        />
        {/* Phase 26 — emoji picker. Rendered as the FIRST child so RTL flex
            places it on the right edge (mirror of Telegram/WhatsApp).
            Phase 27 — HIDDEN on mobile/tablet while recording so the
            recording UI takes the full width. */}
        {!hideComposerForRecording ? (
          <EmojiPicker
            onSelect={handleEmojiSelect}
            disabled={inputDisabled || uploading}
          />
        ) : null}
        {/* Phase 27 — HIDDEN on mobile/tablet while recording. */}
        {!hideComposerForRecording ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 shrink-0"
            onClick={handlePickFile}
            disabled={!connected || uploading}
            aria-label="ارسال فایل"
            title="ارسال فایل"
          >
            {uploading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Paperclip className="size-4" />
            )}
          </Button>
        ) : null}
        {/* Phase 26 — multi-line textarea. Pressing Enter creates a new
            line (default textarea behavior); Ctrl/Cmd+Enter submits the
            form. `items-end` on the form keeps the icon buttons aligned
            with the bottom of the textarea as it grows. Auto-resizes up
            to ~5 rows.
            Phase 27 — HIDDEN on mobile/tablet while recording. */}
        {!hideComposerForRecording ? (
          <Textarea
            ref={inputTextareaRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              adjustTextareaHeight();
            }}
            placeholder={
              pendingFile ? "توضیح اختیاری برای فایل…" : "پیام خود را بنویسید…"
            }
            maxLength={2000}
            disabled={inputDisabled}
            className="scrollbar-rtl flex-1 resize-none overflow-y-auto rounded-md border border-input bg-transparent px-3 py-2 text-sm leading-relaxed min-h-9 max-h-40"
            autoComplete="off"
            rows={1}
            onKeyDown={(e) => {
              // Ctrl/Cmd+Enter sends the message (desktop power-user
              // shortcut). Plain Enter creates a new line (default textarea
              // behavior) so mobile + tablet + desktop users can all write
              // multi-line text.
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                const form = e.currentTarget.form;
                if (form) form.requestSubmit();
              }
            }}
          />
        ) : null}
        {hideComposerForRecording ? (
          /* Phase 27 — when recording on mobile/tablet, show ONLY the
             VoiceRecorder (full-width) so the recording UI takes the
             entire bottom bar. */
          <VoiceRecorder
            onSend={(file) => stageFile(file)}
            disabled={inputDisabled || uploading}
            onRecordingChange={setIsRecording}
            className="flex-1"
          />
        ) : input.trim() || pendingFile ? (
          <Button
            type="submit"
            size="icon"
            disabled={inputDisabled || uploading || (!input.trim() && !pendingFile)}
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
             show the VoiceRecorder in place of the Send button. */
          <VoiceRecorder
            onSend={(file) => stageFile(file)}
            disabled={inputDisabled || uploading}
            onRecordingChange={setIsRecording}
          />
        )}
      </form>

      {/* ---------- Chat-appearance settings dialog ---------- */}
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
    </div>
  );
}

// ============================================================
// DirectMessageRow — single message bubble with avatar, name, time, menu
// ============================================================

function DirectMessageRow({
  message,
  own,
  canDelete,
  onDeleteRequest,
}: {
  message: DirectMessageWithDelete;
  own: boolean;
  canDelete: boolean;
  onDeleteRequest: () => void;
}) {
  const hasFile = Boolean(message.fileUrl && message.fileType);
  const hasCaption = Boolean(
    message.content && message.content.trim().length > 0,
  );

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className={`group flex items-end gap-2 ${
        own ? "flex-row-reverse justify-start" : "justify-start"
      }`}
    >
      <ChatAvatar
        fullName={message.sender.fullName}
        userId={message.sender.id || message.sender.username}
        avatar={message.sender.avatar}
        size="sm"
        className="sm:size-10"
      />

      <div
        className={`flex max-w-[80%] flex-col gap-1 sm:max-w-[70%] ${
          own ? "items-end" : "items-start"
        }`}
      >
        <div
          className={`flex items-center gap-1.5 px-1 text-[0.75em] text-muted-foreground ${
            own ? "flex-row-reverse" : ""
          }`}
        >
          <span className="font-medium text-foreground">
            {own ? "شما" : message.sender.fullName}
          </span>
          <span dir="ltr">{shortTime(message.createdAt)}</span>
          {/* Phase 11 — WhatsApp-style read tick on OWN messages:
              - readAt set      → blue double ✓✓ (`CheckCheck` text-sky-500)
              - readAt null/absent → single ✓ (`Check` muted)
              The "delivered" state is intentionally skipped (just sent vs
              read) so the affordance stays simple. */}
          {own ? (
            message.readAt ? (
              <CheckCheck
                className="size-3 shrink-0 text-sky-500"
                aria-label="خوانده شد"
              />
            ) : (
              <Check
                className="size-3 shrink-0 text-muted-foreground"
                aria-label="ارسال شد"
              />
            )
          ) : null}
        </div>

        <div
          className={`flex items-center gap-1 ${own ? "flex-row-reverse" : ""}`}
        >
          <div
            className={`relative flex flex-col gap-1.5 rounded-2xl px-2.5 py-2 leading-relaxed shadow-sm ${
              hasFile
                ? own
                  ? "bg-primary/10 text-foreground border bubble-tail-end"
                  : "bg-background text-foreground border bubble-tail-start"
                : own
                  ? "bg-primary text-primary-foreground bubble-tail-end"
                  : "bg-background text-foreground border bubble-tail-start"
            }`}
            style={
              // Phase 27 — the tail color must match the bubble's fill.
              ({
                "--bubble-tail-color": own
                  ? hasFile
                    ? "hsl(var(--primary) / 0.1)"
                    : "hsl(var(--primary))"
                  : "hsl(var(--background))",
              } as React.CSSProperties)
            }
          >
            {hasFile ? (
              <DirectFileAttachment
                fileUrl={message.fileUrl!}
                fileName={message.fileName}
                fileType={message.fileType}
                fileSize={message.fileSize}
                mimeType={message.mimeType}
                own={own}
              />
            ) : null}
            {hasCaption ? (
              <span className="whitespace-pre-wrap break-words px-0.5">
                {message.content}
              </span>
            ) : null}
          </div>
          {canDelete ? (
            <DropdownMenu>
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
              <DropdownMenuContent align={own ? "start" : "end"}>
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    onDeleteRequest();
                  }}
                  className="gap-2 text-destructive focus:text-destructive"
                >
                  <Trash2 className="size-4" />
                  حذف پیام
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>
    </motion.div>
  );
}

// ============================================================
// DirectFileAttachment — renders image / video / pdf / file inline
//
// Duplicated from ClassChat's FileAttachment to keep DirectChat a
// self-contained module (the task explicitly permits duplication OR
// extraction of shared sub-components). Same shape, same behavior —
// only the URL handling is identical since direct-messages are stored
// in /uploads/ just like class messages.
// ============================================================

function DirectFileAttachment({
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
      <DirectImageAttachment
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
        <DirectDownloadLink
          fileUrl={fileUrl}
          fileName={safeName}
          sizeLabel={sizeLabel}
          own={own}
        />
      </div>
    );
  }

  if (fileType === "audio") {
    // Phase 27 — Telegram-style voice message player with a real waveform
    // (computed via Web Audio API) + a play/pause button + duration timer
    // + a download link. Same component as in class-chat.
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
            <DirectDownloadLink
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
        <DirectDownloadLink
          fileUrl={fileUrl}
          fileName={safeName}
          sizeLabel={null}
          own={own}
        />
      </div>
    </div>
  );
}

function DirectImageAttachment({
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
      <DirectDownloadLink
        fileUrl={fileUrl}
        fileName={fileName}
        sizeLabel={null}
        own={own}
      />
    </div>
  );
}

function DirectDownloadLink({
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
