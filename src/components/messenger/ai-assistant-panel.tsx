"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot,
  Send,
  Loader2,
  Sparkles,
  Trash2,
  Check,
  X,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useDeviceType } from "./use-device-type";

/* ------------------------------------------------------------------ */
/* Types — mirrors the contract Task 2 (phase 12 backend) ships.        */
/* ------------------------------------------------------------------ */

/**
 * Optional action payload embedded in an AI reply. The frontend renders a
 * "تأیید و اجرا" (confirm + execute) button next to the AI's message when
 * `requiresConfirmation === true` + an `action` is present. Clicking it
 * POSTs to `/api/ai-assistant/action` to actually run the side effect
 * (e.g. change a user's password).
 */
export type AIAction =
  | {
      type: "change_password";
      username: string;
      newPassword: string;
    }
  | { type: string; [key: string]: unknown };

export interface AIAssistantReply {
  reply: string;
  action?: AIAction | null;
  requiresConfirmation?: boolean;
}

/** One row in the chat history we send back with each request. */
interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

/** Phase 21 — one row of the persisted AI conversation (GET /api/ai-assistant/history). */
interface HistoryRow {
  id: string;
  role: "user" | "assistant";
  content: string;
  actionJson: string | null;
  createdAt: string;
}

/** Safely parse the actionJson column back into an {@link AIAction} object. */
function safeParseAction(json: string | null): AIAction | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as { type?: unknown }).type === "string"
    ) {
      return parsed as AIAction;
    }
  } catch {
    return null;
  }
  return null;
}

/** Phase 21 — fetch the persisted conversation history (GET /api/ai-assistant/history). */
async function fetchHistory(): Promise<HistoryRow[]> {
  const res = await fetch("/api/ai-assistant/history", {
    credentials: "include",
  });
  const text = await res.text();
  let payload: { data?: HistoryRow[]; error?: string } | HistoryRow[] | null = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (!res.ok) {
    throw new Error(
      (payload && (payload as { error?: string }).error) ||
        `خطای سرور (${res.status})`,
    );
  }
  const data =
    (payload && (payload as { data?: HistoryRow[] }).data) ||
    (Array.isArray(payload) ? (payload as HistoryRow[]) : []);
  return data;
}

/** Phase 21 — wipe the persisted conversation history (DELETE /api/ai-assistant/history). */
async function deleteHistory(): Promise<void> {
  const res = await fetch("/api/ai-assistant/history", {
    method: "DELETE",
    credentials: "include",
  });
  const text = await res.text();
  let payload: { data?: { deleted: boolean }; error?: string } | null = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (!res.ok) {
    throw new Error(
      (payload && (payload as { error?: string }).error) ||
        `خطای سرور (${res.status})`,
    );
  }
}

/** Local message row — adds client-side fields (pending flag, optional action). */
interface ChatMessage extends HistoryMessage {
  id: string;
  /** Action awaiting the user's confirmation (rendered as a confirm button). */
  pendingAction?: AIAction | null;
  /** Whether this message was created locally while the request was in flight. */
  pending?: boolean;
  /** If set, this is an error message (red bubble). */
  error?: boolean;
}

const DEFAULT_WELCOME_MESSAGE =
  "سلام! من دستیار هوش مصنوعی شما هستم. می‌توانید آمار مدرسه را بپرسید، وضعیت تحصیلی دانش‌آموزان را پیگیری کنید، یا رمز عبور کاربران را تغییر دهید.";

const DEFAULT_QUICK_REPLIES = [
  "آمار مدرسه را بده",
  "وضعیت علی محمدی را بگو",
  "رمز student1 را به test1234 تغییر بده",
];

const MAX_HISTORY = 10;

/**
 * Shape of the AI-assistant config payload returned by
 * `GET /api/ai-assistant/config` (Task 2 phase-13 backend):
 *
 *   { data: { welcomeMessage, suggestedPrompts: string[],
 *             access: { stats, studentInfo, passwordChange } } }
 *
 * The panel reads the welcome message + suggested prompts from this config
 * instead of hardcoding them — the SUPERADMIN can edit them from the
 * `/superadmin/ai-settings` page.
 */
interface AIAssistantConfig {
  welcomeMessage?: string;
  suggestedPrompts?: string[];
  access?: {
    stats?: boolean;
    studentInfo?: boolean;
    passwordChange?: boolean;
  };
}

async function fetchAIConfig(): Promise<AIAssistantConfig> {
  const res = await fetch("/api/ai-assistant/config", {
    credentials: "include",
  });
  const text = await res.text();
  let payload:
    | { data?: AIAssistantConfig; error?: string }
    | AIAssistantConfig
    | null = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (!res.ok) {
    throw new Error(
      (payload && (payload as { error?: string }).error) ||
        `خطای سرور (${res.status})`,
    );
  }
  // Unwrap `{ data: ... }` if present, otherwise fall back to the raw shape.
  return (
    (payload && (payload as { data?: AIAssistantConfig }).data) ||
    (payload as AIAssistantConfig) ||
    {}
  );
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Very small markdown-ish renderer — splits the reply into paragraphs + lines. */
function renderAIContent(text: string): React.ReactNode {
  const blocks = text.split(/\n{2,}/);
  return blocks.map((block, i) => {
    const lines = block.split(/\n/);
    return (
      <div key={i} className={i > 0 ? "mt-2" : ""}>
        {lines.map((line, j) => (
          <p key={j} className="leading-relaxed">
            {line}
          </p>
        ))}
      </div>
    );
  });
}

/* ------------------------------------------------------------------ */
/* Panel component                                                     */
/* ------------------------------------------------------------------ */

interface AIAssistantPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AIAssistantPanel({
  open,
  onOpenChange,
}: AIAssistantPanelProps) {
  const { toast } = useToast();
  // Phase 18 — detect mobile so we can swap the keyboard shortcut:
  //   - desktop: Enter = send, Shift+Enter = new line
  //   - mobile:  Enter = new line (the Send button is used to send)
  // The hook returns "desktop" during SSR + first paint so the initial
  // render is stable; once mounted it reads `window.innerWidth` and
  // re-evaluates on resize/orientationchange.
  const device = useDeviceType();
  const isMobile = device === "mobile";

  // Fetch the configured welcome message + suggested prompts + access flags
  // from the AI-assistant config endpoint. The SUPERADMIN manages these from
  // the `/superadmin/ai-settings` page. We keep a 1-min staleTime so we don't
  // re-fetch on every sheet open — the panel remounts the Sheet anyway.
  const { data: config } = useQuery<AIAssistantConfig>({
    queryKey: ["ai-assistant-config"],
    queryFn: fetchAIConfig,
    staleTime: 60 * 1000,
    // Don't retry aggressively — the panel falls back to defaults below.
    retry: 1,
  });

  const welcomeMessage =
    (config?.welcomeMessage && config.welcomeMessage.trim()) ||
    DEFAULT_WELCOME_MESSAGE;
  const quickReplies =
    config?.suggestedPrompts &&
    Array.isArray(config.suggestedPrompts) &&
    config.suggestedPrompts.length > 0
      ? config.suggestedPrompts.filter(
          (p): p is string => typeof p === "string" && p.trim().length > 0,
        )
      : DEFAULT_QUICK_REPLIES;

  // Phase 21 — TanStack Query cache. Used to invalidate the history cache
  // after the user clears their history so a subsequent fetch returns [].
  const qc = useQueryClient();

  // Phase 21 — start with an empty message list. We hydrate from the
  // persisted AIConversation table when the panel first opens (see the
  // hydration effect below). The welcome message is shown only when the
  // user has no persisted history.
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  // Tracks whether we've already hydrated from the persisted history.
  // Stays `true` across open/close cycles so the in-memory conversation
  // survives a user closing + reopening the panel (matches the legacy
  // behaviour where the messages state was kept across open/close).
  const [hydrated, setHydrated] = React.useState(false);
  // Tracks the welcome bubble's id when we hydrated with the welcome
  // (i.e. the user had no prior history). The welcome-patching effect
  // below uses this id to update the bubble's content in place when the
  // configured welcomeMessage resolves.
  const [welcomeId, setWelcomeId] = React.useState<string | null>(null);
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false); // request in flight
  const [executing, setExecuting] = React.useState(false); // confirm in flight
  // Phase 21 — clearing-history in-flight flag for the "پاک کردن تاریخچه" button.
  const [clearing, setClearing] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

  // Phase 21 — fetch the user's persisted AI history when the panel opens.
  // Enabled only while `open === true` so we don't fire a request before the
  // user actually opens the sheet. staleTime 30s so re-openings within that
  // window don't refetch (the local messages state is the source of truth
  // across open/close cycles).
  const { data: history } = useQuery<HistoryRow[]>({
    queryKey: ["ai-assistant-history"],
    queryFn: fetchHistory,
    enabled: open,
    staleTime: 30 * 1000,
    retry: 1,
  });

  // Phase 21 — hydrate the local messages state from the persisted
  // history once it resolves. If the user has prior conversation, we render
  // those rows (with their stored actionJson restored as pendingAction so
  // a previously-suggested action can still be confirmed or dismissed).
  // If not, we render the welcome bubble + register its id so the
  // welcome-patching effect below can update it when the config-driven
  // welcomeMessage resolves.
  React.useEffect(() => {
    if (!open || hydrated) return;
    // Wait for the query to resolve (it returns [] OR an array of rows).
    if (history === undefined) return;
    if (Array.isArray(history) && history.length > 0) {
      setMessages(
        history.map((h) => ({
          id: h.id,
          role: h.role === "user" ? "user" : "assistant",
          content: h.content,
          pendingAction: safeParseAction(h.actionJson),
        })),
      );
      setWelcomeId(null);
    } else {
      const id = uid();
      setMessages([{ id, role: "assistant", content: welcomeMessage }]);
      setWelcomeId(id);
    }
    setHydrated(true);
  }, [open, hydrated, history, welcomeMessage]);

  // Patch the welcome bubble's content in place when the configured
  // welcomeMessage resolves (or changes) — only while we're still in the
  // welcome-only state (i.e. `welcomeId` is set). Once the user starts a
  // conversation, the welcome bubble is replaced and `welcomeId` becomes
  // null, so this effect becomes a no-op.
  React.useEffect(() => {
    if (!welcomeId) return;
    setMessages((prev) =>
      prev.map((m) =>
        m.id === welcomeId ? { ...m, content: welcomeMessage } : m,
      ),
    );
  }, [welcomeMessage, welcomeId]);

  // Auto-scroll to bottom whenever messages change.
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Phase 18 — auto-grow the textarea so it shows all of the user's
  // multi-line prompt without taking too much room. The textarea has a
  // min of 1 row + a max of 5 rows; in between it grows with the content
  // by adjusting its `rows` attribute (a cheap, native auto-grow that
  // doesn't need a layout-effect measuring pass).
  React.useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const lines = el.value.split("\n").length;
    const rows = Math.min(5, Math.max(1, lines));
    // Only update when the computed rows differs from the current value
    // to avoid layout thrash on every keystroke.
    if (el.rows !== rows) el.rows = rows;
  }, [input]);

  // Focus the input when the sheet opens + the persisted history has
  // finished hydrating (the textarea is disabled until `hydrated === true`
  // so focusing earlier is harmless but the user can't actually type yet).
  React.useEffect(() => {
    if (open && hydrated) {
      const t = setTimeout(() => textareaRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open, hydrated]);

  function pushMessage(msg: ChatMessage) {
    setMessages((prev) => {
      // Trim history to the last ~MAX_HISTORY * 2 rows so the request payload
      // stays small.
      const next = [...prev, msg];
      const cap = MAX_HISTORY * 2;
      if (next.length > cap) next.splice(0, next.length - cap);
      return next;
    });
  }

  function patchMessage(id: string, patch: Partial<ChatMessage>) {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    );
  }

  // Phase 21 — wipe BOTH the persisted history (DELETE) AND the local
  // message list. After the delete succeeds we re-seed the local list with
  // a fresh welcome bubble (new id so the Framer Motion entrance animation
  // re-triggers) and invalidate the history query cache so the next fetch
  // returns [].
  async function clearChat() {
    if (clearing) return;
    setClearing(true);
    try {
      await deleteHistory();
      qc.invalidateQueries({ queryKey: ["ai-assistant-history"] });
      const id = uid();
      setMessages([{ id, role: "assistant", content: welcomeMessage }]);
      setWelcomeId(id);
      toast({
        title: "تاریخچه پاک شد",
        description: "گفتگوی قبلی شما حذف شد.",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطای غیرمنتظره";
      toast({
        title: "خطا در پاک کردن تاریخچه",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setClearing(false);
    }
  }

  async function send(message: string) {
    const trimmed = message.trim();
    if (!trimmed || busy) return;
    setInput("");
    // Add the user message + a placeholder pending assistant row.
    const userMsg: ChatMessage = {
      id: uid(),
      role: "user",
      content: trimmed,
    };
    const placeholderId = uid();
    const placeholder: ChatMessage = {
      id: placeholderId,
      role: "assistant",
      content: "",
      pending: true,
    };
    pushMessage(userMsg);
    pushMessage(placeholder);

    // Build the history payload (everything BEFORE this turn, capped).
    const history: HistoryMessage[] = [
      ...messages
        .filter((m) => !m.pending && !m.error)
        .slice(-MAX_HISTORY)
        .map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: trimmed },
    ];

    setBusy(true);
    try {
      const res = await fetch("/api/ai-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ message: trimmed, history }),
      });
      const text = await res.text();
      let payload: { data?: AIAssistantReply; error?: string } | AIAssistantReply | null = null;
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = null;
        }
      }
      if (!res.ok) {
        const errMsg =
          (payload && ((payload as { error?: string }).error ||
            (payload as AIAssistantReply).reply)) ||
          `خطای سرور (${res.status})`;
        throw new Error(errMsg);
      }
      // The endpoint wraps in { data: ... } — unwrap.
      const data: AIAssistantReply =
        (payload && (payload as { data?: AIAssistantReply }).data) ||
        (payload as AIAssistantReply) ||
        { reply: "" };

      patchMessage(placeholderId, {
        content: data.reply || "",
        pending: false,
        pendingAction:
          data.requiresConfirmation && data.action ? data.action : null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطای غیرمنتظره";
      patchMessage(placeholderId, {
        content: msg,
        pending: false,
        error: true,
      });
      toast({
        title: "خطا در ارتباط با دستیار",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function confirmAction(msgId: string, action: AIAction) {
    if (executing) return;
    setExecuting(true);
    try {
      const res = await fetch("/api/ai-assistant/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: action.type, ...action }),
      });
      const text = await res.text();
      let payload: {
        data?: { success: boolean; message: string };
        error?: string;
      } | null = null;
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = null;
        }
      }
      if (!res.ok) {
        const errMsg =
          (payload && (payload.error || payload.data?.message)) ||
          `خطای سرور (${res.status})`;
        throw new Error(errMsg);
      }
      const result = payload?.data;
      const successMsg = result?.message || "عملیات با موفقیت انجام شد.";
      // Replace the action card with a success follow-up bubble.
      patchMessage(msgId, {
        pendingAction: null,
      });
      pushMessage({
        id: uid(),
        role: "assistant",
        content: `✅ ${successMsg}`,
      });
      toast({
        title: "عملیات اجرا شد",
        description: successMsg,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطای غیرمنتظره";
      toast({
        title: "اجرای عملیات ناموفق بود",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setExecuting(false);
    }
  }

  function cancelAction(msgId: string) {
    patchMessage(msgId, { pendingAction: null });
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    void send(input);
  }

  /**
   * Phase 18 — textarea keydown handler. The behavior depends on device:
   *   - desktop: Enter = send (no Shift), Shift+Enter = new line
   *   - mobile:  Enter = ALWAYS a new line (the user must use the Send
   *              button to send — required for multi-line / paragraph
   *              prompts on the on-screen keyboard which often sends
   *              Enter without an explicit Shift modifier)
   *
   * On desktop the user can also press Ctrl/Cmd+Enter to send regardless
   * of the Shift state (some users prefer that muscle memory).
   *
   * `e.preventDefault()` on Enter (desktop, no Shift) keeps the textarea
   * from inserting a newline before the send call. We DON'T call
   * preventDefault on the mobile path — we want the newline.
   */
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Ctrl/Cmd+Enter always sends (regardless of device).
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void send(input);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !isMobile) {
      e.preventDefault();
      void send(input);
    }
    // On mobile + when Shift is held on desktop, fall through — the
    // textarea inserts a newline naturally.
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex h-full w-full flex-col gap-0 p-0 sm:max-w-md"
      >
        {/* Header */}
        <SheetHeader className="flex flex-col gap-1 border-b bg-background px-4 py-3">
          <SheetTitle className="flex items-center gap-2 text-base">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Sparkles className="size-4" />
            </span>
            دستیار هوش مصنوعی مدیر
          </SheetTitle>
          <SheetDescription className="sr-only">
            گفتگوی متنی با دستیار هوش مصنوعی برای پرسش آمار مدرسه، پیگیری
            وضعیت دانش‌آموزان و مدیریت کاربران.
          </SheetDescription>
          <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Bot className="size-3.5" />
              آماده پاسخ‌گویی
            </span>
            <button
              type="button"
              onClick={() => void clearChat()}
              disabled={clearing || messages.length === 0}
              className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="پاک کردن تاریخچه"
              title="پاک کردن تاریخچه"
            >
              {clearing ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
              پاک کردن تاریخچه
            </button>
          </div>
        </SheetHeader>

        {/* Quick-reply chips — only show when the chat is at the welcome
            state (no history yet OR cleared). When history was hydrated
            with prior messages, `welcomeId === null` so we skip the chips. */}
        {messages.length <= 1 && welcomeId !== null && !busy ? (
          <div className="border-b bg-muted/30 px-3 py-2">
            <p className="mb-1.5 text-[10px] font-medium text-muted-foreground">
              نمونه‌هایی برای شروع:
            </p>
            <div className="flex flex-col gap-1.5">
              {quickReplies.map((q, i) => (
                <button
                  key={`${q}-${i}`}
                  type="button"
                  onClick={() => void send(q)}
                  className="rounded-md border bg-background px-3 py-1.5 text-right text-xs transition-colors hover:border-primary/30 hover:bg-primary/5"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* Messages — scrollable. Custom scrollbar because the chat is RTL. */}
        <div
          ref={scrollRef}
          className="scrollbar-rtl flex-1 overflow-y-auto bg-secondary/30 px-3 py-3"
        >
          <div className="mx-auto flex w-full max-w-md flex-col gap-2.5">
            {messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                executing={executing}
                onConfirm={() => m.pendingAction && confirmAction(m.id, m.pendingAction)}
                onCancel={() => cancelAction(m.id)}
              />
            ))}
            {/* Phase 21 — loading skeleton before history hydration resolves. */}
            {!hydrated && messages.length === 0 ? (
              <div className="flex items-center justify-start gap-2">
                <div className="bg-background flex size-7 shrink-0 items-center justify-center rounded-full border shadow-sm">
                  <Sparkles className="size-3.5 text-primary" />
                </div>
                <div className="bg-background flex items-center gap-2 rounded-2xl rounded-bl-sm border px-3 py-2 text-sm">
                  <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                  <span className="text-muted-foreground">
                    در حال بارگذاری گفتگو...
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* Composer (phase 18 — textarea, multi-line). */}
        <form
          onSubmit={onSubmit}
          className="flex items-end gap-2 border-t bg-background px-3 py-2.5"
        >
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="پیام خود را بنویسید..."
            disabled={busy || !hydrated}
            // Min 1 row, max 5 rows — the auto-grow effect above adjusts
            // `rows` based on the content so the textarea takes only as
            // much room as needed (and never more than 5 lines).
            rows={1}
            maxLength={1000}
            className="min-h-[40px] flex-1 resize-none leading-snug"
            aria-label="پیام به دستیار هوش مصنوعی"
          />
          {/* Phase 18 — the Send button is now the ONLY way to send on
              mobile (Enter = newline). On desktop Enter also sends, but
              the explicit button is still useful when the user is
              mid-paragraph and wants to send without lifting their
              hands to press Ctrl/Cmd+Enter. */}
          <Button
            type="submit"
            size="icon"
            disabled={busy || !hydrated || !input.trim()}
            aria-label="ارسال"
            title="ارسال"
            className="shrink-0"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/* Single message bubble                                               */
/* ------------------------------------------------------------------ */

interface MessageBubbleProps {
  message: ChatMessage;
  executing: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function MessageBubble({
  message,
  executing,
  onConfirm,
  onCancel,
}: MessageBubbleProps) {
  const isUser = message.role === "user";
  // Pending assistant message → loading bubble.
  if (!isUser && message.pending) {
    return (
      <div className="flex items-center justify-start gap-2">
        <div className="bg-background flex size-7 shrink-0 items-center justify-center rounded-full border shadow-sm">
          <Sparkles className="size-3.5 text-primary" />
        </div>
        <div className="bg-background flex items-center gap-2 rounded-2xl rounded-bl-sm border px-3 py-2 text-sm">
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
          <span className="text-muted-foreground">در حال فکر کردن...</span>
        </div>
      </div>
    );
  }

  return (
    <AnimatePresence initial={false}>
      <motion.div
        key={message.id}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn(
          "flex w-full",
          isUser ? "justify-end" : "justify-start",
        )}
      >
        <div
          className={cn(
            "flex max-w-[85%] flex-col gap-1.5 rounded-2xl px-3 py-2 text-sm shadow-sm",
            isUser
              ? "ml-auto rounded-br-sm bg-primary text-primary-foreground"
              : message.error
                ? "mr-auto rounded-bl-sm border border-destructive/40 bg-destructive/5 text-destructive"
                : "mr-auto rounded-bl-sm border bg-background text-foreground",
          )}
        >
          {!isUser && !message.error ? (
            <div className="flex items-center gap-1.5 pb-1 text-[10px] font-medium text-muted-foreground">
              <Bot className="size-3" />
              دستیار
            </div>
          ) : null}
          <div
            className={cn(
              "whitespace-pre-wrap break-words leading-relaxed",
              isUser ? "text-primary-foreground" : "",
            )}
          >
            {renderAIContent(message.content)}
          </div>

          {/* Confirmation card for an action requiring the user's OK */}
          {message.pendingAction ? (
            <ActionCard
              action={message.pendingAction}
              executing={executing}
              onConfirm={onConfirm}
              onCancel={onCancel}
            />
          ) : null}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

interface ActionCardProps {
  action: AIAction;
  executing: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function ActionCard({
  action,
  executing,
  onConfirm,
  onCancel,
}: ActionCardProps) {
  return (
    <div className="mt-1 rounded-lg border border-primary/30 bg-primary/5 p-2.5">
      <p className="mb-1.5 text-xs font-medium text-foreground">
        عملیات پیشنهادی:
      </p>
      <ActionSummary action={action} />
      <div className="mt-2 flex items-center gap-1.5">
        <Button
          type="button"
          size="sm"
          onClick={onConfirm}
          disabled={executing}
          className="gap-1"
        >
          {executing ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Check className="size-3.5" />
          )}
          تأیید و اجرا
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onCancel}
          disabled={executing}
          className="gap-1"
        >
          <X className="size-3.5" />
          انصراف
        </Button>
      </div>
    </div>
  );
}

function ActionSummary({ action }: { action: AIAction }) {
  // The AI backend (phase 16) emits a generic `type` field for any action
  // it proposes — the contract is open so new action types can be added
  // without bumping the API. Render each known type as a friendly Persian
  // sentence; fall back to a JSON dump for unknown types so the user can
  // still review the proposed change before approving it.
  switch (action.type) {
    case "change_password": {
      const a = action as Extract<AIAction, { type: "change_password" }>;
      return (
        <div className="text-xs text-muted-foreground">
          تغییر رمز عبور کاربر{" "}
          <span className="font-mono font-semibold text-foreground" dir="ltr">
            {a.username}
          </span>{" "}
          به{" "}
          <span className="font-mono font-semibold text-foreground" dir="ltr">
            {a.newPassword}
          </span>
          .
        </div>
      );
    }

    case "create_class": {
      const a = action as { type: string; name?: string };
      return (
        <div className="text-xs text-muted-foreground">
          ایجاد کلاس جدید با نام{" "}
          <span className="font-semibold text-foreground">«{a.name ?? "—"}»</span>.
        </div>
      );
    }

    case "create_group": {
      const a = action as {
        type: string;
        groupName?: string;
        name?: string;
        parentClassName?: string;
        parentClassId?: string;
      };
      const groupName = a.groupName ?? a.name;
      return (
        <div className="text-xs text-muted-foreground">
          ایجاد گروه گفتگو با نام{" "}
          <span className="font-semibold text-foreground">
            «{groupName ?? "—"}»
          </span>
          {a.parentClassName ? (
            <>
              {" "}
              در کلاس{" "}
              <span className="font-semibold text-foreground">
                «{a.parentClassName}»
              </span>
            </>
          ) : null}
          .
        </div>
      );
    }

    case "create_student":
    case "create_teacher": {
      const a = action as {
        type: string;
        fullName?: string;
        username?: string;
      };
      const role =
        action.type === "create_student" ? "دانش‌آموز" : "معلم";
      return (
        <div className="text-xs text-muted-foreground">
          {role} جدید{" "}
          <span className="font-semibold text-foreground">
            «{a.fullName ?? "—"}»
          </span>
          {a.username ? (
            <>
              {" "}
              با نام کاربری{" "}
              <span
                className="font-mono font-semibold text-foreground"
                dir="ltr"
              >
                {a.username}
              </span>
            </>
          ) : null}
          .
        </div>
      );
    }

    case "close_all_groups": {
      return (
        <div className="text-xs text-muted-foreground">
          بستن همه گفتگوهای گروهیِ کلاس‌ها. این عملیات قابل بازگشت است.
        </div>
      );
    }
  }

  // Fallback: render the JSON for any other action type so the user can
  // review the proposed change before approving it.
  return (
    <pre
      dir="ltr"
      className="overflow-x-auto rounded bg-muted/50 p-2 text-[10px] text-foreground"
    >
      {JSON.stringify(action, null, 2)}
    </pre>
  );
}
