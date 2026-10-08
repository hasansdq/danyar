"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  Hand,
  Loader2,
  MessageSquare,
  Mic,
  MicOff,
  MonitorUp,
  MoreVertical,
  PenTool,
  PhoneOff,
  Send,
  Smile,
  Users,
  Video,
  VideoOff,
  Volume2,
  X,
  Pin,
  RotateCcw,
  LayoutGrid,
  Square,
  Lock,
  Unlock,
  PencilRuler,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-fetch";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { MessengerUser } from "./types";
import {
  useClassroomSocket,
  type Participant,
  type ClassroomMessage,
} from "./use-classroom-socket";
import { WhiteboardCanvas } from "./whiteboard-canvas";

/* ========================================================================== */
/* Types                                                                       */
/* ========================================================================== */

interface ClassroomSession {
  id: string;
  classId: string;
  roomCode: string;
  status: string;
  startedAt: string;
  endedAt?: string | null;
  startedBy: {
    id: string;
    fullName: string;
    username: string;
    role: string;
    avatar: string | null;
  };
}

type ViewMode = "grid" | "speaker";
type SidePanel = "none" | "chat" | "participants";
// Phase 36h-3+4 — whiteboard mode:
//   - "standalone": whiteboard replaces the video area (full-size).
//   - "overlay": whiteboard is a transparent overlay on top of the shared
//     screen (teacher draws on top of the screen share).
//   - null: whiteboard is not active.
type WhiteboardMode = "standalone" | "overlay" | null;

const REACTIONS = ["👍", "❤️", "🎉", "👏", "😂", "🙏", "🔥", "✨"];

/* ========================================================================== */
/* Main component                                                              */
/* ========================================================================== */

export function ClassroomView({
  open,
  onOpenChange,
  user,
  classId,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: MessengerUser;
  classId: string;
  className?: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const classroom = useClassroomSocket(user);

  // ---- Session state ----
  const [session, setSession] = React.useState<ClassroomSession | null>(null);
  const [sessionLoading, setSessionLoading] = React.useState(false);
  const [sessionError, setSessionError] = React.useState<string | null>(null);
  const [joined, setJoined] = React.useState(false);
  const [removed, setRemoved] = React.useState(false);
  const [viewMode, setViewMode] = React.useState<ViewMode>("grid");
  const [sidePanel, setSidePanel] = React.useState<SidePanel>("none");
  // Phase 36h-3+4 — whiteboard mode (standalone / overlay / null).
  const [whiteboardMode, setWhiteboardMode] = React.useState<WhiteboardMode>(null);
  // Track whether we attempted to start a session so we don't loop.
  const startedRef = React.useRef(false);

  // The current user is a teacher if they have role TEACHER or SUPERADMIN
  // (or they started the session). Students + ADMIN (principal) can only
  // view the whiteboard (not draw).
  const isTeacherRole =
    user.role === "TEACHER" || user.role === "SUPERADMIN" || session?.startedBy.id === user.id;

  // Sync the whiteboard UI flag with the classroom hook so the hook can
  // expose it (used by the parent for rendering decisions).
  React.useEffect(() => {
    classroom.toggleWhiteboard(whiteboardMode !== null);
  }, [whiteboardMode, classroom.toggleWhiteboard]);

  // ---- Lookup active session for this class ----
  const { data: activeSession, refetch } = useQuery<ClassroomSession | null>({
    queryKey: ["classroom-active", classId],
    queryFn: () => apiFetch<ClassroomSession | null>(`/api/classroom/active?classId=${classId}`),
    enabled: open && !joined,
    staleTime: 5_000,
  });

  // ---- Start or join session on open ----
  // When the dialog opens:
  //   - If there's already an active session for this class → join it.
  //   - Else, start a new session (TEACHER/ADMIN/SUPERADMIN only).
  React.useEffect(() => {
    if (!open) {
      startedRef.current = false;
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      setSessionLoading(true);
      setSessionError(null);
      try {
        // Check if there's an active session.
        let active = activeSession;
        if (!active) {
          const fresh = await refetch();
          active = fresh.data ?? null;
        }
        if (active) {
          // Join the existing session.
          setSession(active);
          // Phase 36 — students + ADMIN (principal) join with mic/cam OFF
          // by default. The teacher can grant access later. Teachers +
          // SUPERADMIN join with mic/cam on.
          const isTeacherRoleLocal =
            user.role === "TEACHER" || user.role === "SUPERADMIN";
          await classroom.joinSession(active.id, {
            video: isTeacherRoleLocal,
            audio: isTeacherRoleLocal,
          });
          setJoined(true);
          return;
        }
        // No active session — start one (TEACHER/ADMIN/SUPERADMIN only).
        // STUDENTs who open the FAB when no session is live get a "no
        // active session" message.
        if (user.role === "STUDENT") {
          setSessionError("در حال حاضر کلاس آنلاین فعالی برای این گروه وجود ندارد. منتظر بمانید تا استاد کلاس را شروع کند.");
          return;
        }
        const created = await apiFetch<ClassroomSession>("/api/classroom/start", {
          method: "POST",
          body: JSON.stringify({ classId }),
        });
        setSession(created);
        // Phase 36 — only teachers + SUPERADMIN start with media on.
        const isTeacherRoleStart =
          user.role === "TEACHER" || user.role === "SUPERADMIN";
        await classroom.joinSession(created.id, {
          video: isTeacherRoleStart,
          audio: isTeacherRoleStart,
        });
        setJoined(true);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "خطا در شروع/پیوستن به جلسه";
        setSessionError(msg);
      } finally {
        setSessionLoading(false);
      }
    })();
  }, [open]);

  // ---- Handle removed-from-session ----
  // When the `removedFromSession` flag flips to true (a teacher removed
  // the user via the socket), show the "removed" dialog + tear down
  // the local media.
  React.useEffect(() => {
    if (classroom.removedFromSession) {
      setRemoved(true);
      setJoined(false);
      classroom.leaveSession();
    }
  }, [classroom.removedFromSession, classroom]);

  // ---- Leave handler ----
  async function handleLeave() {
    if (session) {
      // Try to end the session if we started it (TEACHER/SUPERADMIN).
      if (session.startedBy.id === user.id || user.role === "SUPERADMIN") {
        try {
          await apiFetch(`/api/classroom/${session.id}/end`, { method: "POST" });
        } catch { /* ignore — the leave flow should still complete */ }
      }
    }
    // Phase 36h-3+4 — close the whiteboard before leaving.
    setWhiteboardMode(null);
    classroom.leaveSession();
    setJoined(false);
    setSession(null);
    onOpenChange(false);
    qc.invalidateQueries({ queryKey: ["classroom-active"] });
    toast({ title: "از کلاس آنلاین خارج شدید" });
  }

  // ---- Cleanup on close ----
  React.useEffect(() => {
    if (!open && joined) {
      // The dialog was closed while still joined — tear down.
      classroom.leaveSession();
      setJoined(false);
    }
  }, [open, joined, classroom]);

  // ---- Phase 36h-3+4 — auto-close the overlay whiteboard when screen
  // sharing ends. The overlay mode only makes sense while a screen is
  // being shared. When sharing stops, the overlay whiteboard would be
  // drawing on top of the camera tiles — not useful. Switch to no
  // whiteboard (or to standalone — but standalone is a separate click).
  React.useEffect(() => {
    if (!classroom.screenSharing && whiteboardMode === "overlay") {
      setWhiteboardMode(null);
    }
  }, [classroom.screenSharing, whiteboardMode]);

  /* ========================================================================== */
  /* Render states                                                              */
  /* ========================================================================== */

  // ----- Loading state -----
  if (open && sessionLoading && !joined) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[90vh] sm:max-w-none sm:h-[90vh] p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>کلاس آنلاین</SheetTitle>
          </SheetHeader>
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <Loader2 className="size-12 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              در حال آماده‌سازی کلاس آنلاین…
            </p>
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  // ----- Error state -----
  if (open && sessionError && !joined) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[90vh] sm:max-w-none sm:h-[90vh] p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>خطای کلاس آنلاین</SheetTitle>
          </SheetHeader>
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <AlertCircle className="size-12 text-amber-500" />
            <p className="text-sm text-foreground">{sessionError}</p>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              بستن
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  // ----- Removed state -----
  if (open && removed) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[90vh] sm:max-w-none sm:h-[90vh] p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>حذف از کلاس آنلاین</SheetTitle>
          </SheetHeader>
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <X className="size-12 text-destructive" />
            <p className="text-sm font-medium">از کلاس آنلاین حذف شدید</p>
            <p className="text-xs text-muted-foreground">
              شما توسط مدرس از این جلسه حذف شده‌اید.
            </p>
            <Button variant="outline" onClick={() => { setRemoved(false); onOpenChange(false); }}>
              بستن
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  // ----- Main classroom UI -----
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) void handleLeave(); else onOpenChange(o); }}>
      <SheetContent
        side="bottom"
        className={cn(
          "flex flex-col gap-0 bg-zinc-900 p-0 text-white sm:max-w-none",
          "h-[100dvh] sm:h-[100dvh] sm:rounded-t-2xl",
          className,
        )}
      >
        {/* Radix Dialog requires a DialogTitle for accessibility.
            Visually hidden (sr-only) — the visible heading is in the
            ClassroomHeader below. */}
        <SheetHeader className="sr-only">
          <SheetTitle>
            {className ? `${className} — ` : ""}کلاس آنلاین
          </SheetTitle>
        </SheetHeader>
        {/* Phase 36d — "Primer" video element. This is a hidden, muted
            <video> that's rendered as soon as the classroom opens (close
            to the user's FAB click). We call play() on it in a useEffect.
            On iOS Safari, this "registers" the page as having video
            playback intent, which helps later <video> elements (in
            VideoTile) autoplay without requiring a tap. The play() call
            will fail (no source), but the side-effect of "unlocking"
            the page for muted video autoplay persists. */}
        <video
          ref={(v) => {
            if (v) {
              v.muted = true;
              v.defaultMuted = true;
              v.setAttribute("muted", "");
              v.setAttribute("playsinline", "");
              v.play().catch(() => { /* expected to fail — no source */ });
            }
          }}
          className="sr-only"
          aria-hidden="true"
          tabIndex={-1}
        />
        {/* ---------- Header ---------- */}
        <ClassroomHeader
          session={session}
          connectionState={classroom.connectionState}
          localError={classroom.localError}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          onClose={() => void handleLeave()}
          className={className}
          isStudent={user.role === "STUDENT" || user.role === "ADMIN"}
        />

        {/* ---------- Body (video tiles + optional side panel) ---------- */}
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          {/* Video area — when whiteboard standalone mode is active, this is
              REPLACED by the whiteboard canvas (full-size). When overlay
              mode is active, the whiteboard canvas is rendered on TOP of
              this video area (transparent overlay). */}
          <div className="relative min-h-0 flex-1 bg-black">
            {whiteboardMode === "standalone" ? (
              // Standalone whiteboard — full-size, replaces video tiles.
              <WhiteboardCanvas
                canDraw={isTeacherRole}
                isOverlay={false}
                sendStroke={classroom.sendWhiteboardStroke}
                sendClear={classroom.sendWhiteboardClear}
                sendFullState={classroom.sendWhiteboardFullState}
                onStroke={classroom.onWhiteboardStroke}
                onClear={classroom.onWhiteboardClear}
                onRequestState={classroom.onWhiteboardRequestState}
                onFullState={classroom.onWhiteboardFullState}
                onClose={() => setWhiteboardMode(null)}
              />
            ) : (
              <>
                <ClassroomVideoArea
                  user={user}
                  classroom={classroom}
                  viewMode={viewMode}
                  participants={classroom.participants}
                  localStream={classroom.localStream}
                  remoteStreams={classroom.remoteStreams}
                  micOn={classroom.micOn}
                  camOn={classroom.camOn}
                  screenSharing={classroom.screenSharing}
                  handRaised={classroom.handRaised}
                  activeSpeakerId={classroom.activeSpeakerId}
                  session={session}
                  className={className}
                />
                {/* Overlay whiteboard — transparent overlay on top of the
                    shared screen. The teacher draws on top of the screen
                    share; students see the drawing overlaid. */}
                {whiteboardMode === "overlay" && (
                  <div className="absolute inset-0 z-10">
                    <WhiteboardCanvas
                      canDraw={isTeacherRole}
                      isOverlay
                      sendStroke={classroom.sendWhiteboardStroke}
                      sendClear={classroom.sendWhiteboardClear}
                      sendFullState={classroom.sendWhiteboardFullState}
                      onStroke={classroom.onWhiteboardStroke}
                      onClear={classroom.onWhiteboardClear}
                      onRequestState={classroom.onWhiteboardRequestState}
                      onFullState={classroom.onWhiteboardFullState}
                      onClose={() => setWhiteboardMode(null)}
                    />
                  </div>
                )}
              </>
            )}
          </div>

          {/* Side panel (chat / participants) — desktop: right column;
              mobile: bottom Sheet overlay. */}
          {sidePanel !== "none" && (
            <div className="hidden min-h-0 w-[320px] flex-col border-r border-zinc-800 bg-zinc-950 sm:flex">
              {sidePanel === "chat" && (
                <ClassroomChatPanel
                  user={user}
                  messages={classroom.messages}
                  onSend={(content) => classroom.sendMessage(content)}
                  onClose={() => setSidePanel("none")}
                  chatEnabled={classroom.chatEnabled}
                  isStudent={user.role === "STUDENT" || user.role === "ADMIN"}
                  onToggleChat={user.role === "TEACHER" || user.role === "SUPERADMIN" ? (enabled) => classroom.setClassroomChatEnabled(enabled) : undefined}
                />
              )}
              {sidePanel === "participants" && (
                <ClassroomParticipantsPanel
                  user={user}
                  participants={classroom.participants}
                  localMicOn={classroom.micOn}
                  localCamOn={classroom.camOn}
                  localHandRaised={classroom.handRaised}
                  localScreenSharing={classroom.screenSharing}
                  localMicAllowed={classroom.micAllowed}
                  localCamAllowed={classroom.camAllowed}
                  session={session}
                  onMuteUser={(uid) => classroom.muteUser(uid)}
                  onRemoveUser={(uid) => classroom.removeUser(uid)}
                  onGrantAccess={(uid, opts) => classroom.grantAccess(uid, opts)}
                  onToggleUserMedia={(uid, opts) => classroom.toggleUserMedia(uid, opts)}
                  onClose={() => setSidePanel("none")}
                />
              )}
            </div>
          )}
        </div>

        {/* ---------- Bottom controls bar ---------- */}
        <ClassroomControls
          micOn={classroom.micOn}
          camOn={classroom.camOn}
          screenSharing={classroom.screenSharing}
          handRaised={classroom.handRaised}
          forceMuted={classroom.forceMuted}
          sidePanel={sidePanel}
          micAllowed={classroom.micAllowed}
          camAllowed={classroom.camAllowed}
          isStudent={user.role === "STUDENT" || user.role === "ADMIN"}
          // Phase 36h-3+4 — whiteboard buttons.
          whiteboardActive={whiteboardMode !== null}
          onToggleWhiteboard={() =>
            setWhiteboardMode(whiteboardMode === "standalone" ? null : "standalone")
          }
          onToggleOverlayWhiteboard={() =>
            setWhiteboardMode(whiteboardMode === "overlay" ? null : "overlay")
          }
          onToggleMic={() => classroom.setMic(!classroom.micOn)}
          onToggleCam={() => classroom.setCam(!classroom.camOn)}
          onToggleScreenShare={() => classroom.toggleScreenShare(!classroom.screenSharing)}
          onToggleHand={() => classroom.raiseHand(!classroom.handRaised)}
          onTogglePanel={(p) => setSidePanel(sidePanel === p ? "none" : p)}
          onReaction={(e) => classroom.sendReaction(e)}
          onLeave={() => void handleLeave()}
          isMobile={false}
        />

        {/* ---------- Mobile side-panel overlay ---------- */}
        {sidePanel !== "none" && (
          <div className="absolute inset-0 z-50 flex flex-col bg-zinc-950 sm:hidden">
            <div className="flex items-center justify-between border-b border-zinc-800 p-3">
              <span className="text-sm font-medium">
                {sidePanel === "chat" ? "چت کلاس" : "شرکت‌کنندگان"}
              </span>
              <Button variant="ghost" size="icon" className="size-8 text-white" onClick={() => setSidePanel("none")}>
                <X className="size-4" />
              </Button>
            </div>
            <div className="min-h-0 flex-1">
              {sidePanel === "chat" && (
                <ClassroomChatPanel
                  user={user}
                  messages={classroom.messages}
                  onSend={(content) => classroom.sendMessage(content)}
                  onClose={() => setSidePanel("none")}
                  chatEnabled={classroom.chatEnabled}
                  isStudent={user.role === "STUDENT" || user.role === "ADMIN"}
                  onToggleChat={user.role === "TEACHER" || user.role === "SUPERADMIN" ? (enabled) => classroom.setClassroomChatEnabled(enabled) : undefined}
                  isMobile
                />
              )}
              {sidePanel === "participants" && (
                <ClassroomParticipantsPanel
                  user={user}
                  participants={classroom.participants}
                  localMicOn={classroom.micOn}
                  localCamOn={classroom.camOn}
                  localHandRaised={classroom.handRaised}
                  localScreenSharing={classroom.screenSharing}
                  localMicAllowed={classroom.micAllowed}
                  localCamAllowed={classroom.camAllowed}
                  session={session}
                  onMuteUser={(uid) => classroom.muteUser(uid)}
                  onRemoveUser={(uid) => classroom.removeUser(uid)}
                  onGrantAccess={(uid, opts) => classroom.grantAccess(uid, opts)}
                  onToggleUserMedia={(uid, opts) => classroom.toggleUserMedia(uid, opts)}
                  onClose={() => setSidePanel("none")}
                  isMobile
                />
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/* ========================================================================== */
/* Header                                                                      */
/* ========================================================================== */

function ClassroomHeader({
  session,
  connectionState,
  localError,
  viewMode,
  onViewModeChange,
  onClose,
  className,
  isStudent,
}: {
  session: ClassroomSession | null;
  connectionState: string;
  localError: string | null;
  viewMode: ViewMode;
  onViewModeChange: (v: ViewMode) => void;
  onClose: () => void;
  className?: string;
  // Phase 36 — students + principal only see the teacher's tile, so the
  // grid/speaker view toggle is hidden for them.
  isStudent?: boolean;
}) {
  const connColor =
    connectionState === "connected"
      ? "bg-emerald-500"
      : connectionState === "connecting" || connectionState === "reconnecting"
        ? "bg-amber-500"
        : "bg-red-500";
  const connLabel =
    connectionState === "connected"
      ? "متصل"
      : connectionState === "connecting"
        ? "در حال اتصال…"
        : connectionState === "reconnecting"
          ? "در حال اتصال مجدد…"
          : "قطع ارتباط";

  return (
    <header className="flex items-center justify-between gap-2 border-b border-zinc-800 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-600">
          <Video className="size-5 text-white" />
        </div>
        <div className="flex min-w-0 flex-col">
          <h2 className="truncate text-sm font-semibold">
            {className ? `${className} · ` : ""}کلاس آنلاین{session ? ` · کد ${session.roomCode}` : ""}
          </h2>
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            <span className={cn("size-1.5 rounded-full", connColor)} />
            {connLabel}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {/* View mode toggle (desktop only) — hidden for students +
            principal (Phase 36: they only see the teacher's tile). */}
        {!isStudent && (
          <div className="hidden items-center rounded-md border border-zinc-700 p-0.5 sm:flex">
            <button
              type="button"
              onClick={() => onViewModeChange("grid")}
              className={cn(
                "flex size-7 items-center justify-center rounded-sm transition-colors",
                viewMode === "grid" ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-white",
              )}
              title="نمایش شبکه‌ای"
            >
              <LayoutGrid className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => onViewModeChange("speaker")}
              className={cn(
                "flex size-7 items-center justify-center rounded-sm transition-colors",
                viewMode === "speaker" ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-white",
              )}
              title="نمایش گوینده"
            >
              <Square className="size-4" />
            </button>
          </div>
        )}
        {localError && (
          <span className="hidden text-[11px] text-amber-400 sm:inline">{localError}</span>
        )}
        <Button variant="ghost" size="icon" className="size-8 text-white hover:bg-zinc-800" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>
    </header>
  );
}

/* ========================================================================== */
/* Video area                                                                  */
/* ========================================================================== */

function ClassroomVideoArea({
  user,
  classroom,
  viewMode,
  participants,
  localStream,
  remoteStreams,
  micOn,
  camOn,
  screenSharing,
  handRaised,
  activeSpeakerId,
  session,
  className,
}: {
  user: MessengerUser;
  classroom: ReturnType<typeof useClassroomSocket>;
  viewMode: ViewMode;
  participants: Participant[];
  localStream: MediaStream | null;
  remoteStreams: Map<string, MediaStream>;
  micOn: boolean;
  camOn: boolean;
  screenSharing: boolean;
  handRaised: boolean;
  activeSpeakerId: string | null;
  session: ClassroomSession | null;
  className?: string;
}) {
  // Phase 36 — students + ADMIN (principal) only see the TEACHER's tile
  // (camera or shared screen). They cannot see other students' tiles.
  const isStudent = user.role === "STUDENT" || user.role === "ADMIN";
  // Build the list of all tiles (local + remote).
  type Tile = {
    userId: string;
    name: string;
    role: string;
    avatar: string | null;
    stream: MediaStream | null;
    micOn: boolean;
    camOn: boolean;
    isLocal: boolean;
    isSpeaking: boolean;
    handRaised: boolean;
    screenSharing: boolean;
    lastReaction?: { emoji: string; at: number };
  };
  // The teacher who started the session (or any participant with role
  // TEACHER) — students only see this tile.
  const teacherParticipants = participants.filter(
    (p) => p.role === "TEACHER" || p.role === "SUPERADMIN",
  );
  const allTiles: Tile[] = [
    {
      userId: user.id,
      name: user.name,
      role: user.role,
      avatar: user.avatar ?? null,
      stream: screenSharing && classroom.screenStream ? classroom.screenStream : localStream,
      micOn,
      camOn,
      isLocal: true,
      isSpeaking: activeSpeakerId === user.id,
      handRaised,
      screenSharing,
    },
    ...participants.map((p) => ({
      userId: p.userId,
      name: p.fullName,
      role: p.role,
      avatar: p.avatar,
      stream: remoteStreams.get(p.userId) ?? null,
      micOn: p.micOn,
      camOn: p.camOn,
      isLocal: false,
      isSpeaking: p.isSpeaking || activeSpeakerId === p.userId,
      handRaised: p.handRaised,
      screenSharing: p.screenSharing,
      lastReaction: p.lastReaction,
    })),
  ];
  // Phase 36 — for students + principal, filter to ONLY the teacher's tile(s).
  // Students don't see their own tile or other students' tiles.
  const tiles = isStudent
    ? allTiles.filter(
        (t) => !t.isLocal && (t.role === "TEACHER" || t.role === "SUPERADMIN"),
      )
    : allTiles;

  // Phase 36 — empty state for students when no teacher is in the session.
  if (isStudent && teacherParticipants.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <VideoOff className="size-12 text-zinc-600" />
        <p className="text-sm text-zinc-400">
          منتظر بمانید تا استاد کلاس را شروع کند.
        </p>
      </div>
    );
  }

  // Empty state — no other participants yet (teachers only).
  if (participants.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <VideoOff className="size-12 text-zinc-600" />
        {className ? (
          <p className="text-base font-medium text-zinc-300">{className}</p>
        ) : null}
        <p className="text-sm text-zinc-400">
          شما تنها فرد در این جلسه هستید. منتظر بمانید تا دیگران پیوستند.
        </p>
        {session && (
          <div className="mt-3 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-300">
            <span className="text-zinc-500">کد دعوت: </span>
            <span className="font-mono text-base tracking-wider text-emerald-400">{session.roomCode}</span>
          </div>
        )}
      </div>
    );
  }

  // Phase 36 — students + principal: render ONLY the teacher's tile,
  // full-size (no grid, no speaker strip). The student cannot see other
  // students' camera or shared screen.
  if (isStudent) {
    if (tiles.length === 0) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
          <VideoOff className="size-12 text-zinc-600" />
          <p className="text-sm text-zinc-400">
            استاد هنوز دوربین یا صفحه‌اش را به اشتراک نگذاشته است.
          </p>
        </div>
      );
    }
    // If the teacher is sharing their screen, show the screen large.
    // Otherwise show the teacher's camera tile large.
    const screenTile = tiles.find((t) => t.screenSharing);
    const mainTile = screenTile ?? tiles[0];
    return (
      <div className="h-full p-1">
        <VideoTile tile={mainTile} isLarge />
      </div>
    );
  }

  // Speaker view — large tile for the active speaker + small tiles for others.
  if (viewMode === "speaker" && activeSpeakerId) {
    const speaker = tiles.find((t) => t.userId === activeSpeakerId) ?? tiles[0];
    const others = tiles.filter((t) => t.userId !== speaker.userId);
    return (
      <div className="flex h-full flex-col gap-1 p-1">
        <div className="min-h-0 flex-1">
          <VideoTile tile={speaker} isLarge />
        </div>
        {others.length > 0 && (
          <div className="flex shrink-0 gap-1 overflow-x-auto pb-1" style={{ height: 100 }}>
            {others.map((t) => (
              <div key={t.userId} className="aspect-video h-full shrink-0">
                <VideoTile tile={t} isSmall />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Grid view — responsive grid based on participant count.
  const count = tiles.length;
  const cols =
    count <= 1 ? "grid-cols-1"
    : count <= 2 ? "grid-cols-1 sm:grid-cols-2"
    : count <= 4 ? "grid-cols-2"
    : count <= 6 ? "grid-cols-2 sm:grid-cols-3"
    : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4";
  return (
    <div className={cn("grid h-full gap-1 p-1", cols)}>
      {tiles.map((t) => (
        <div key={t.userId} className="min-h-0">
          <VideoTile tile={t} />
        </div>
      ))}
    </div>
  );
}

/* ========================================================================== */
/* Single video tile                                                           */
/* ========================================================================== */

function VideoTile({
  tile,
  isLarge = false,
  isSmall = false,
}: {
  tile: {
    userId: string;
    name: string;
    role: string;
    avatar: string | null;
    stream: MediaStream | null;
    micOn: boolean;
    camOn: boolean;
    isLocal: boolean;
    isSpeaking: boolean;
    handRaised: boolean;
    screenSharing: boolean;
    lastReaction?: { emoji: string; at: number };
  };
  isLarge?: boolean;
  isSmall?: boolean;
}) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  // Phase 36b — track whether the user has manually unmuted this remote
  // tile. Browsers block autoplay of UNMUTED videos without a user
  // interaction. So we start muted (autoplay works) + show an unmute
  // button. The user can click to enable audio.
  const [audioEnabled, setAudioEnabled] = React.useState<boolean>(false);
  // Phase 36c — track whether autoplay failed (so we can show a
  // "tap to play" overlay on mobile browsers that block autoplay).
  const [needsTapToPlay, setNeedsTapToPlay] = React.useState<boolean>(false);

  // Phase 36d — the core "attach stream + play" logic. Extracted as a
  // helper so both the callback ref + useEffect can call it. The key
  // iOS Safari fix: DON'T call play() immediately after setting srcObject.
  // iOS Safari needs the video element to process the stream first
  // (loadedmetadata event) before play() can succeed. Without this, play()
  // rejects with "NotAllowedError" → the video stays black + the
  // "tap to play" overlay shows — even though the video IS muted.
  const attachStreamAndPlay = React.useCallback(
    (v: HTMLVideoElement, stream: MediaStream) => {
      const shouldMute = tile.isLocal || !audioEnabled;
      // Set muted attributes BEFORE srcObject (iOS Safari checks the
      // attribute at srcObject-assignment time).
      v.muted = shouldMute;
      v.defaultMuted = shouldMute;
      if (shouldMute) v.setAttribute("muted", "");
      else v.removeAttribute("muted");
      v.setAttribute("playsinline", "");
      v.srcObject = stream;

      // Helper to attempt play + handle the result.
      // Phase 36d — retry up to 3 times with increasing delays. Mobile
      // browsers (especially iOS Safari) sometimes need multiple play()
      // attempts before the video starts — the first call can fail with
      // NotAllowedError even for muted videos if the element was created
      // outside a user gesture. Retrying gives the browser time to
      // "accept" the autoplay.
      const attemptPlay = (retryCount = 0) => {
        v.play().then(() => {
          setNeedsTapToPlay(false);
        }).catch((err) => {
          console.log(`[classroom] play() attempt ${retryCount} failed for ${tile.name}:`, err.name);
          if (retryCount < 3) {
            // Retry after 500ms, 1000ms, 2000ms.
            setTimeout(() => attemptPlay(retryCount + 1), 500 * (retryCount + 1));
          } else {
            // Show the tap-to-play overlay as a last resort.
            setNeedsTapToPlay(true);
          }
        });
      };

      // Phase 36d — on iOS Safari, play() called immediately after
      // srcObject = stream fails with NotAllowedError (even for muted
      // videos). The fix: wait for the `loadedmetadata` event (the video
      // element has processed the stream) before calling play(). This
      // makes autoplay work reliably on real iPhones/iPads without
      // requiring a tap.
      v.onloadedmetadata = () => {
        // Re-apply muted (some browsers reset it on metadata load).
        v.muted = shouldMute;
        v.defaultMuted = shouldMute;
        if (shouldMute) v.setAttribute("muted", "");
        attemptPlay();
      };
      // Phase 36e — also listen for `oncanplay` + `onloadeddata` — some
      // Android Chrome versions don't fire `loadedmetadata` reliably for
      // WebRTC MediaStreams. Multiple event listeners ensure we catch at
      // least one + attempt play().
      v.oncanplay = () => {
        v.muted = shouldMute;
        v.defaultMuted = shouldMute;
        if (shouldMute) v.setAttribute("muted", "");
        attemptPlay();
      };
      // Fallback: also try play() after a short delay in case
      // loadedmetadata already fired (or doesn't fire).
      setTimeout(attemptPlay, 200);
      // Phase 36e — additional fallback after 1 second (for slow mobile
      // networks where the stream takes longer to establish).
      setTimeout(attemptPlay, 1000);
    },
    [tile.isLocal, audioEnabled, tile.name],
  );

  // Phase 36b fix — attach the stream to the <video> element via a callback
  // ref. This is critical because the <video> element is CONDITIONALLY
  // rendered (only when `tile.camOn || tile.screenSharing`). When camOn
  // changes from false → true, the <video> element is newly mounted. A
  // regular useEffect with `[tile.stream]` dependency does NOT run in
  // this case (tile.stream didn't change, only camOn did) → srcObject is
  // never set → the video stays black. A callback ref runs every time the
  // <video> element mounts (or re-mounts), so srcObject is always set.
  const setVideoRef = React.useCallback(
    (v: HTMLVideoElement | null) => {
      videoRef.current = v;
      // Phase 36e — set muted SYNCHRONOUSLY in the callback ref (before
      // the browser paints). React's `muted` JSX prop is known to not
      // always render as an HTML attribute on initial render (React bug
      // #10389). Setting it here ensures the `muted` attribute is present
      // before the browser processes the video → autoplay works on Android
      // Chrome + iOS Safari.
      if (v) {
        const shouldMute = tile.isLocal || !audioEnabled;
        v.muted = shouldMute;
        v.defaultMuted = shouldMute;
        if (shouldMute) v.setAttribute("muted", "");
        v.setAttribute("playsinline", "");
      }
      if (v && tile.stream) {
        attachStreamAndPlay(v, tile.stream);
      }
    },
    [tile.stream, attachStreamAndPlay, tile.isLocal, audioEnabled],
  );

  // Also keep a useEffect for when tile.stream or audioEnabled changes on
  // an ALREADY-mounted video.
  React.useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (tile.stream) {
      attachStreamAndPlay(v, tile.stream);
    } else {
      v.srcObject = null;
    }
  }, [tile.stream, attachStreamAndPlay]);

  const initials = tile.name.charAt(0).toUpperCase() || "?";
  return (
    <div
      className={cn(
        "relative h-full w-full overflow-hidden rounded-md bg-zinc-800",
        tile.isSpeaking && "ring-2 ring-emerald-500",
      )}
    >
      {tile.stream && (tile.camOn || tile.screenSharing) ? (
        <>
          <video
            ref={setVideoRef}
            autoPlay
            playsInline
            // Phase 36c — `webkit-playsinline` for older iOS Safari (< 10).
            // `muted` as HTML attribute (iOS Safari requires this for
            // autoplay, not just the property). Also set in the callback ref.
            // Phase 36e — removed `defaultMuted` from JSX (React doesn't
            // recognize it as a DOM prop → warning on Android Chrome). It's
            // set via JS in the callback ref (v.defaultMuted = shouldMute).
            {...({ "webkit-playsinline": "true" } as any)}
            muted={tile.isLocal || !audioEnabled}
            className={cn(
              "h-full w-full",
              // Screen share should NOT be mirrored (it's a desktop view,
              // not a selfie). Camera tiles for the local user are mirrored.
              tile.screenSharing ? "object-contain" : "object-cover",
            )}
            style={{ transform: tile.isLocal && !tile.screenSharing ? "scaleX(-1)" : undefined }}
          />
          {/* Phase 36c — "tap to play" overlay for mobile browsers that
              block autoplay. Shown when v.play() rejects. The user taps
              the overlay to manually start playback (user gesture
              satisfies the autoplay policy). */}
          {needsTapToPlay && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                const v = videoRef.current;
                if (v) {
                  v.muted = tile.isLocal || !audioEnabled;
                  v.play().then(() => setNeedsTapToPlay(false)).catch(() => {});
                }
              }}
              className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 text-white"
            >
              <Video className="size-10" />
              <span className="text-sm font-medium">برای شروع پخش ضربه بزنید</span>
            </button>
          )}
        </>
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-zinc-800">
          {tile.avatar ? (
            <img
              src={tile.avatar}
              alt={tile.name}
              className={cn(
                "rounded-full border-2 border-zinc-600 object-cover",
                isSmall ? "size-10" : isLarge ? "size-24" : "size-16",
              )}
            />
          ) : (
            <div
              className={cn(
                "flex items-center justify-center rounded-full bg-emerald-600 font-bold text-white",
                isSmall ? "size-10 text-base" : isLarge ? "size-24 text-3xl" : "size-16 text-xl",
              )}
            >
              {initials}
            </div>
          )}
          {!isSmall && (
            <span className="text-xs text-zinc-400">{tile.name}</span>
          )}
        </div>
      )}
      {/* Name + mic indicator overlay */}
      <div className="absolute bottom-1 left-1 right-1 flex items-center justify-between gap-1 rounded bg-black/60 px-1.5 py-0.5 backdrop-blur-sm">
        <span className="flex min-w-0 items-center gap-1 text-[10px] text-white">
          <span className="truncate">{tile.name}</span>
          {tile.isLocal && <span className="text-zinc-400">(شما)</span>}
        </span>
        <span className="flex items-center gap-0.5">
          {tile.handRaised && <Hand className="size-3 text-amber-400" />}
          {tile.micOn ? (
            <Mic className="size-3 text-emerald-400" />
          ) : (
            <MicOff className="size-3 text-red-400" />
          )}
          {/* Phase 36b — unmute button for remote tiles (browsers block
              unmuted autoplay, so the user must click to enable audio). */}
          {!tile.isLocal && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setAudioEnabled((prev) => {
                  const next = !prev;
                  const v = videoRef.current;
                  if (v) {
                    v.muted = !next;
                    if (next) void v.play().catch(() => {});
                  }
                  return next;
                });
              }}
              className="flex size-3 items-center justify-center rounded text-white/70 hover:text-white"
              title={audioEnabled ? "قطع صدا" : "وصل صدا"}
            >
              {audioEnabled ? <Volume2 className="size-3" /> : <Volume2 className="size-3 opacity-40" />}
            </button>
          )}
        </span>
      </div>
      {/* Reaction bubble */}
      {tile.lastReaction && (
        <motion.div
          initial={{ opacity: 0, y: 0, scale: 0.5 }}
          animate={{ opacity: 1, y: -20, scale: 1 }}
          exit={{ opacity: 0 }}
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-3xl"
        >
          {tile.lastReaction.emoji}
        </motion.div>
      )}
      {tile.screenSharing && (
        <div className="absolute right-1 top-1 flex items-center gap-1 rounded bg-emerald-600/80 px-1 py-0.5 text-[9px] text-white">
          <MonitorUp className="size-2.5" />
          اشتراک صفحه
        </div>
      )}
    </div>
  );
}

/* ========================================================================== */
/* Controls bar                                                                */
/* ========================================================================== */

function ClassroomControls({
  micOn,
  camOn,
  screenSharing,
  handRaised,
  forceMuted,
  sidePanel,
  micAllowed,
  camAllowed,
  isStudent,
  whiteboardActive,
  onToggleWhiteboard,
  onToggleOverlayWhiteboard,
  onToggleMic,
  onToggleCam,
  onToggleScreenShare,
  onToggleHand,
  onTogglePanel,
  onReaction,
  onLeave,
  isMobile,
}: {
  micOn: boolean;
  camOn: boolean;
  screenSharing: boolean;
  handRaised: boolean;
  forceMuted: boolean;
  sidePanel: SidePanel;
  // Phase 36 — mic/cam permission flags. When false, the mic/cam button
  // is disabled (students + principal need teacher permission).
  micAllowed: boolean;
  camAllowed: boolean;
  // Phase 36 — students + principal don't have screen-share button.
  isStudent: boolean;
  // Phase 36h-3+4 — whiteboard buttons (teachers only).
  whiteboardActive: boolean;
  onToggleWhiteboard: () => void;
  onToggleOverlayWhiteboard: () => void;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onToggleScreenShare: () => void;
  onToggleHand: () => void;
  onTogglePanel: (p: SidePanel) => void;
  onReaction: (emoji: string) => void;
  onLeave: () => void;
  isMobile: boolean;
}) {
  const micDisabled = forceMuted || !micAllowed;
  const camDisabled = !camAllowed;
  return (
    <footer className="flex items-center justify-center gap-1 border-t border-zinc-800 bg-zinc-900 px-2 py-2 sm:gap-2 sm:overflow-x-auto">
      {/* Mic */}
      <ControlButton
        active={micOn}
        onClick={onToggleMic}
        title={
          forceMuted
            ? "توسط مدرس قطع شد"
            : !micAllowed
              ? "معلم اجازه میکروفون نداده است"
              : micOn ? "قطع صدا" : "وصل صدا"
        }
        disabled={micDisabled}
        icon={micOn ? <Mic className="size-5" /> : <MicOff className="size-5" />}
        activeClass="bg-zinc-700 text-white"
        inactiveClass="bg-red-600 text-white"
      />
      {/* Cam */}
      <ControlButton
        active={camOn}
        onClick={onToggleCam}
        title={
          !camAllowed
            ? "معلم اجازه دوربین نداده است"
            : camOn ? "قطع تصویر" : "وصل تصویر"
        }
        disabled={camDisabled}
        icon={camOn ? <Video className="size-5" /> : <VideoOff className="size-5" />}
        activeClass="bg-zinc-700 text-white"
        inactiveClass="bg-red-600 text-white"
      />
      {/* Screen share — teachers + SUPERADMIN only */}
      {!isStudent && (
        <ControlButton
          active={screenSharing}
          onClick={onToggleScreenShare}
          title={screenSharing ? "توقف اشتراک صفحه" : "اشتراک صفحه"}
          icon={<MonitorUp className="size-5" />}
          activeClass="bg-emerald-600 text-white"
          inactiveClass="bg-zinc-700 text-white"
        />
      )}
      {/* Phase 36h-3+4 — Whiteboard button (teachers only).
          Opens the standalone whiteboard (replaces video tiles). */}
      {!isStudent && (
        <ControlButton
          active={whiteboardActive}
          onClick={onToggleWhiteboard}
          title={whiteboardActive ? "بستن تخته سفید" : "تخته سفید"}
          icon={<PenTool className="size-5" />}
          activeClass="bg-emerald-600 text-white"
          inactiveClass="bg-zinc-700 text-white"
        />
      )}
      {/* Phase 36h-3+4 — Teaching tools button (teachers only, only shown
          when screen sharing is active). Opens the overlay whiteboard
          (transparent overlay on top of the shared screen). */}
      {!isStudent && screenSharing && (
        <ControlButton
          active={whiteboardActive}
          onClick={onToggleOverlayWhiteboard}
          title={whiteboardActive ? "بستن ابزارهای تدریس" : "ابزارهای تدریس"}
          icon={<PencilRuler className="size-5" />}
          activeClass="bg-emerald-600 text-white"
          inactiveClass="bg-zinc-700 text-white"
        />
      )}
      {/* Raise hand */}
      <ControlButton
        active={handRaised}
        onClick={onToggleHand}
        title={handRaised ? "پایین آوردن دست" : "بلند کردن دست"}
        icon={<Hand className="size-5" />}
        activeClass="bg-amber-500 text-white"
        inactiveClass="bg-zinc-700 text-white"
      />
      {/* Reactions */}
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-zinc-700 text-white transition-colors hover:bg-zinc-600"
            title="واکنش"
          >
            <Smile className="size-5" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-2" side="top" align="center">
          <div className="flex gap-1.5">
            {REACTIONS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => onReaction(e)}
                className="flex size-9 items-center justify-center rounded-full text-xl transition-transform hover:scale-125"
              >
                {e}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      {/* Chat panel */}
      <ControlButton
        active={sidePanel === "chat"}
        onClick={() => onTogglePanel("chat")}
        title="چت کلاس"
        icon={<MessageSquare className="size-5" />}
        activeClass="bg-emerald-600 text-white"
        inactiveClass="bg-zinc-700 text-white"
      />
      {/* Participants panel */}
      <ControlButton
        active={sidePanel === "participants"}
        onClick={() => onTogglePanel("participants")}
        title="شرکت‌کنندگان"
        icon={<Users className="size-5" />}
        activeClass="bg-emerald-600 text-white"
        inactiveClass="bg-zinc-700 text-white"
      />
      {/* Leave */}
      <button
        type="button"
        onClick={onLeave}
        className="ml-1 flex shrink-0 items-center gap-1.5 rounded-full bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-700"
        title="خروج از کلاس"
      >
        <PhoneOff className="size-5" />
        <span className="hidden sm:inline">خروج</span>
      </button>
    </footer>
  );
}

function ControlButton({
  active,
  onClick,
  title,
  disabled,
  icon,
  activeClass,
  inactiveClass,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  disabled?: boolean;
  icon: React.ReactNode;
  activeClass: string;
  inactiveClass: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={cn(
        "flex size-11 items-center justify-center rounded-full transition-colors disabled:opacity-50",
        active ? activeClass : inactiveClass,
      )}
    >
      {icon}
    </button>
  );
}

/* ========================================================================== */
/* Chat panel                                                                  */
/* ========================================================================== */

function ClassroomChatPanel({
  user,
  messages,
  onSend,
  onClose,
  isMobile = false,
  chatEnabled = true,
  isStudent = false,
  onToggleChat,
}: {
  user: MessengerUser;
  messages: ClassroomMessage[];
  onSend: (content: string) => void;
  onClose: () => void;
  isMobile?: boolean;
  // Phase 36h — when false (teacher disabled chat), students can't send.
  chatEnabled?: boolean;
  isStudent?: boolean;
  // Phase 36h — teacher can toggle chat (shown as a button in the header).
  onToggleChat?: (enabled: boolean) => void;
}) {
  const [input, setInput] = React.useState("");
  const scrollRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);
  // Phase 36h — students can't send when chat is disabled by the teacher.
  const canSend = chatEnabled || !isStudent;
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSend || !input.trim()) return;
    onSend(input);
    setInput("");
  }
  return (
    <div className="flex h-full flex-col">
      {/* Phase 36h — chat header with teacher toggle */}
      {onToggleChat && (
        <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5">
          <span className="text-xs text-zinc-400">چت کلاس</span>
          <button
            type="button"
            onClick={() => onToggleChat(!chatEnabled)}
            className={cn(
              "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors",
              chatEnabled
                ? "bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30"
                : "bg-red-600/20 text-red-400 hover:bg-red-600/30",
            )}
          >
            {chatEnabled ? "چت فعال" : "چت بسته"}
          </button>
        </div>
      )}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-zinc-500">
            هنوز پیامی ارسال نشده است. اولین پیام را شما بفرستید!
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={cn(
                "flex flex-col gap-0.5",
                m.userId === user.id ? "items-end" : "items-start",
              )}
            >
              <span className="text-[10px] text-zinc-500">
                {m.userId === user.id ? "شما" : m.fullName} · {m.role === "TEACHER" ? "معلم" : "دانش‌آموز"}
              </span>
              <div
                className={cn(
                  "max-w-[80%] rounded-lg px-2.5 py-1.5 text-sm",
                  m.userId === user.id
                    ? "bg-emerald-600 text-white"
                    : "bg-zinc-800 text-zinc-100",
                )}
              >
                {m.content}
              </div>
            </div>
          ))
        )}
        {!canSend && (
          <div className="rounded-md bg-amber-500/10 px-2 py-1 text-center text-[10px] text-amber-400">
            چت توسط معلم غیرفعال شده است
          </div>
        )}
      </div>
      <form onSubmit={handleSubmit} className="flex items-center gap-1 border-t border-zinc-800 p-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={canSend ? "پیام خود را بنویسید…" : "چت بسته است"}
          className="border-zinc-700 bg-zinc-800 text-white placeholder:text-zinc-500"
          maxLength={1000}
          disabled={!canSend}
        />
        <Button type="submit" size="icon" className="size-9 bg-emerald-600 hover:bg-emerald-700" disabled={!canSend}>
          <Send className="size-4" />
        </Button>
      </form>
    </div>
  );
}

/* ========================================================================== */
/* Participants panel                                                          */
/* ========================================================================== */

function ClassroomParticipantsPanel({
  user,
  participants,
  localMicOn,
  localCamOn,
  localHandRaised,
  localScreenSharing,
  localMicAllowed,
  localCamAllowed,
  session,
  onMuteUser,
  onRemoveUser,
  onGrantAccess,
  onToggleUserMedia,
  onClose,
  isMobile = false,
}: {
  user: MessengerUser;
  participants: Participant[];
  localMicOn: boolean;
  localCamOn: boolean;
  localHandRaised: boolean;
  localScreenSharing: boolean;
  localMicAllowed: boolean;
  localCamAllowed: boolean;
  session: ClassroomSession | null;
  onMuteUser: (userId: string) => void;
  onRemoveUser: (userId: string) => void;
  // Phase 36 — teacher grants/revokes mic/cam permission for a student.
  onGrantAccess: (userId: string, opts: { mic?: boolean; cam?: boolean }) => void;
  // Phase 36h — teacher toggles a participant's mic/cam by clicking the icon.
  onToggleUserMedia: (userId: string, opts: { mic?: boolean; cam?: boolean }) => void;
  onClose: () => void;
  isMobile?: boolean;
}) {
  // The current user appears at the top.
  const me: Participant = {
    userId: user.id,
    username: user.username,
    fullName: user.name,
    role: user.role,
    avatar: user.avatar ?? null,
    micOn: localMicOn,
    camOn: localCamOn,
    screenSharing: localScreenSharing,
    handRaised: localHandRaised,
    isSpeaking: false,
    micAllowed: localMicAllowed,
    camAllowed: localCamAllowed,
  };
  const allParticipants = [me, ...participants.filter((p) => p.userId !== user.id)];
  // The current user is a teacher if their role is TEACHER/ADMIN/SUPERADMIN
  // OR they started the session.
  const isTeacher =
    user.role === "TEACHER" || user.role === "ADMIN" || user.role === "SUPERADMIN"
    || session?.startedBy.id === user.id;
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <div className="mb-2 px-2 text-[11px] text-zinc-500">
          {allParticipants.length} شرکت‌کننده
        </div>
        <div className="space-y-1">
          {allParticipants.map((p) => {
            const isMe = p.userId === user.id;
            // Phase 36 — teachers can grant mic/cam to students + principal.
            const canGrantAccess =
              isTeacher && !isMe
              && (p.role === "STUDENT" || p.role === "ADMIN");
            const canControl =
              isTeacher && !isMe && (p.role === "STUDENT" || p.role === "TEACHER");
            return (
              <div
                key={p.userId}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-zinc-800"
              >
                {p.avatar ? (
                  <img src={p.avatar} alt={p.fullName} className="size-8 rounded-full object-cover" />
                ) : (
                  <div className="flex size-8 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white">
                    {p.fullName.charAt(0)}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1">
                    <span className="truncate text-sm text-white">{p.fullName}</span>
                    {isMe && <span className="text-[10px] text-zinc-500">(شما)</span>}
                  </div>
                  <span className="text-[10px] text-zinc-500">
                    {p.role === "TEACHER" || p.role === "ADMIN" ? "معلم" : "دانش‌آموز"}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {p.handRaised && <Hand className="size-3.5 text-amber-400" />}
                  {/* Phase 36h — clickable mic icon for teachers. Clicking
                      toggles the participant's mic (mute if on, unmute if off). */}
                  {isTeacher && !isMe ? (
                    <button
                      type="button"
                      onClick={() => onToggleUserMedia(p.userId, { mic: !p.micOn })}
                      className="flex size-5 items-center justify-center rounded hover:bg-zinc-700"
                      title={p.micOn ? "قطع صدا" : "وصل صدا"}
                    >
                      {p.micOn ? <Mic className="size-3.5 text-emerald-400" /> : <MicOff className="size-3.5 text-red-400" />}
                    </button>
                  ) : (
                    p.micOn ? <Mic className="size-3.5 text-emerald-400" /> : <MicOff className="size-3.5 text-red-400" />
                  )}
                  {/* Phase 36h — clickable cam icon for teachers. */}
                  {isTeacher && !isMe ? (
                    <button
                      type="button"
                      onClick={() => onToggleUserMedia(p.userId, { cam: !p.camOn })}
                      className="flex size-5 items-center justify-center rounded hover:bg-zinc-700"
                      title={p.camOn ? "قطع تصویر" : "وصل تصویر"}
                    >
                      {p.camOn ? <Video className="size-3.5 text-emerald-400" /> : <VideoOff className="size-3.5 text-zinc-500" />}
                    </button>
                  ) : (
                    p.camOn ? <Video className="size-3.5 text-emerald-400" /> : <VideoOff className="size-3.5 text-zinc-500" />
                  )}
                  {(canControl || canGrantAccess) && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="flex size-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-700 hover:text-white"
                        >
                          <MoreVertical className="size-3.5" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-1" side="left" align="center">
                        {/* Phase 36 — Grant mic/cam permission */}
                        {canGrantAccess && (
                          <>
                            <button
                              type="button"
                              onClick={() => onGrantAccess(p.userId, { mic: !p.micAllowed, cam: !p.camAllowed })}
                              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-emerald-400 hover:bg-zinc-700"
                            >
                              {p.micAllowed || p.camAllowed ? (
                                <><Lock className="size-3.5" /> سلب اجازه صدا و تصویر</>
                              ) : (
                                <><Unlock className="size-3.5" /> اعطای اجازه صدا و تصویر</>
                              )}
                            </button>
                            <div className="my-1 h-px bg-zinc-700" />
                          </>
                        )}
                        {canControl && (
                          <>
                            <button
                              type="button"
                              onClick={() => onMuteUser(p.userId)}
                              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700"
                            >
                              <MicOff className="size-3.5" /> قطع صدا
                            </button>
                            <button
                              type="button"
                              onClick={() => onRemoveUser(p.userId)}
                              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-red-400 hover:bg-zinc-700"
                            >
                              <X className="size-3.5" /> حذف از جلسه
                            </button>
                          </>
                        )}
                      </PopoverContent>
                    </Popover>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
