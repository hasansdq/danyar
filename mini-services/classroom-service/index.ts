// classroom-service: socket.io mini-service for the Virtual Classroom module.
// Port 3004 is HARDCODED (per project gateway convention).
// The Next.js frontend connects via: io("/?XTransformPort=3004", { auth: { token } })
//
// Responsibilities:
//   1. Authenticate the connecting socket via a short-lived JWT issued by
//      the main app's /api/socket/token endpoint (NextAuth-session-gated,
//      signed with the shared SOCKET_AUTH_SECRET). The OLD client-supplied
//      userId scheme is REJECTED — identity spoofing is impossible now.
//   2. Manage per-session rooms (join_session / leave_session) — when a user
//      joins a ClassroomSession, their socket joins the room
//      "classroom:<sessionId>" + we upsert a ClassroomParticipant row.
//   3. WebRTC signaling relay — relay webrtc_offer / webrtc_answer /
//      webrtc_ice_candidate events between two peers (mesh topology:
//      each peer connects to every other peer directly).
//   4. State broadcasts — when a user toggles their mic/cam/screen-share,
//      broadcast a `participant_state` event to the room so every other
//      participant's UI updates instantly.
//   5. Classroom chat — relay `classroom_message` events to the room
//      (NO persistence — the chat is ephemeral, lives only for the duration
//      of the session).
//   6. Raise hand + reactions — broadcast `raise_hand` / `lower_hand` /
//      `reaction` events.
//   7. Teacher controls — `mute_user` (teacher forces a student's mic off),
//      `remove_user` (teacher kicks a student) — both verify the sender is a
//      TEACHER/ADMIN for the session's class before broadcasting.
//   8. Active-speaker detection — listen for `speaking` events (the client
//      uses the WebRTC API's audio-level detection) + broadcast
//      `active_speaker` to the room (drives Speaker View).
//   9. Entry/exit notifications — emit `participant_joined` /
//      `participant_left` so the UI can show toast notifications.
//  10. Disconnect handling — on socket disconnect, mark the
//      ClassroomParticipant.leftAt + broadcast `participant_left`.

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { Server } from "socket.io";
import { PrismaClient } from "@prisma/client";
import { verifySocketToken, isOriginAllowed, type SocketTokenPayload } from "./socket-auth";

// ---------- Configuration (hardcoded, no env) ----------
const PORT = 3004;
const DB_URL = process.env.DB_URL || "file:/home/z/my-project/db/custom.db";

// ---------- Prisma (shared DB file with the main app) ----------
// SECURITY: query logging is disabled in production (only errors are logged).
const isProd = process.env.NODE_ENV === "production";
const prisma = new PrismaClient({
  datasources: { db: { url: DB_URL } },
  log: isProd ? ["error"] : ["error", "warn"],
});

// ---------- HTTP server (for health check + socket.io attach) ----------
const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
  const path = req.url ? req.url.split("?")[0] : "";
  // Dedicated health endpoint (used by the Docker HEALTHCHECK + uptime
  // probes). "/" is kept for backward compatibility.
  if (path === "/" || path === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("classroom-service alive");
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
});

// ---------- socket.io server ----------
// SECURITY: NO wildcard CORS. No CORS headers are emitted at all (same-origin
// connections through the gateway don't need them); cross-origin requests
// are blocked server-side in the io.use middleware (SOCKET_ALLOWED_ORIGINS
// env + same-Host check).
const io = new Server(httpServer, {
  cors: {
    origin: false,
    methods: ["GET", "POST"],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e6,
});

// ---------- Types ----------
interface AuthPayload {
  /** Short-lived JWT from /api/socket/token — the ONLY accepted credential. */
  token?: string;
}

interface SocketData {
  userId: string;
  username: string;
  fullName: string;
  role: string; // STUDENT | TEACHER | ADMIN | SUPERADMIN
  avatar: string | null;
  // The session this socket is currently joined to (null when not in a
  // session). A socket can only be in ONE session at a time — joining a
  // new session auto-leaves the previous one.
  sessionId: string | null;
}

interface ParticipantState {
  // Per-participant live state (kept in memory — not persisted; the only
  // persisted field is the join/leave timestamps in ClassroomParticipant).
  micOn: boolean;
  camOn: boolean;
  screenSharing: boolean;
  handRaised: boolean;
  isSpeaking: boolean;
  // Phase 36 — mic/cam PERMISSIONS. Students + ADMIN (principal) join with
  // micAllowed=false, camAllowed=false. The teacher can grant these so the
  // student/principal can then turn on their mic/cam.
  micAllowed: boolean;
  camAllowed: boolean;
  // Last-seen timestamp — used by the client to detect stale connections.
  lastSeen: number;
}

// Phase 36h-3+4 — Collaborative whiteboard stroke payload. Mirrors the
// frontend's WhiteboardStroke type. The teacher emits this; the server
// relays it (stateless) to students in the room.
interface WhiteboardPointPayload { x: number; y: number }
interface WhiteboardStrokePayload {
  tool: "pencil" | "eraser" | "rectangle" | "circle" | "arrow";
  color: string;
  size: number;
  // Normalized 0..1 (fractions of canvas dimensions) so the drawing looks
  // the same on different screen sizes. For pencil/eraser — many points;
  // for shapes — exactly 2 points (start + end).
  points: WhiteboardPointPayload[];
}

// In-memory store: Map<sessionId, Map<userId, ParticipantState>>
// We key by userId (not socketId) so a reconnecting user keeps their state.
const sessionParticipants = new Map<
  string,
  Map<string, { socketId: string; info: ParticipantState; user: { id: string; username: string; fullName: string; role: string; avatar: string | null } }>
>();

interface ErrorResponse {
  message: string;
}

// ---------- Auth middleware ----------
// SECURITY: Socket.IO authentication — short-lived JWT issued by the main
// app's /api/socket/token endpoint, verified with the shared
// SOCKET_AUTH_SECRET. Client-supplied identity fields are REJECTED.
io.use(async (socket, next) => {
  try {
    // ---- Server-enforced origin check (covers WebSocket, which CORS headers don't) ----
    const origin = socket.handshake.headers.origin;
    const host = socket.handshake.headers.host;
    if (!isOriginAllowed(origin, host)) {
      return next(new Error("unauthorized: origin not allowed"));
    }

    // ---- JWT verification (replaces the spoofable client-supplied userId) ----
    const auth = (socket.handshake.auth || {}) as AuthPayload;
    const payload: SocketTokenPayload | null = verifySocketToken(auth?.token);
    if (!payload) {
      // Wrong/missing/expired token. NOTE: do NOT log the token value.
      console.warn(
        `[classroom-service] rejected socket=${socket.id} — invalid or expired auth token`,
      );
      return next(new Error("unauthorized: invalid or expired token"));
    }

    // SECURITY: the token's `sub` identifies the user; the DB remains the
    // source of truth for role/avatar (fresh values on every connect).
    const userRow = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        username: true,
        fullName: true,
        role: true,
        avatar: true,
      },
    });
    if (!userRow) {
      return next(new Error("unauthorized: user not found"));
    }
    const data: SocketData = {
      userId: payload.sub,
      username: userRow.username,
      fullName: userRow.fullName,
      role: userRow.role,
      avatar: userRow.avatar ?? null,
      sessionId: null,
    };
    socket.data = data;
    next();
  } catch (err) {
    next(err as Error);
  }
});

// ---------- Helpers ----------

/** Verify the calling user can access the session's class:
 *   - they have a ClassMembership row in the class, OR
 *   - they are the session's startedBy user, OR
 *   - they are an ADMIN principal of the class's school, OR
 *   - they are a SUPERADMIN (unscoped).
 * Also returns the ClassroomSession row (with class + startedBy) so the
 * caller can use the role/etc.
 */
async function authorizeSessionAccess(
  userId: string,
  sessionId: string,
  userRole: string,
): Promise<{ session: { id: string; classId: string; startedById: string; status: string; roomCode: string } | null; role: "TEACHER" | "STUDENT" | null }> {
  const session = await prisma.classroomSession.findUnique({
    where: { id: sessionId },
    select: { id: true, classId: true, startedById: true, status: true, roomCode: true },
  });
  if (!session) return { session: null, role: null };
  if (session.status !== "live") return { session: null, role: null };

  // The session starter is always a teacher.
  if (session.startedById === userId) {
    return { session, role: "TEACHER" };
  }

  // Check class membership.
  const membership = await prisma.classMembership.findUnique({
    where: { classId_userId: { classId: session.classId, userId } },
    select: { role: true },
  });
  if (membership) {
    return { session, role: membership.role === "TEACHER" ? "TEACHER" : "STUDENT" };
  }

  // ADMIN principal of the school that owns the class.
  if (userRole === "ADMIN") {
    const cls = await prisma.classRoom.findUnique({
      where: { id: session.classId },
      select: { schoolId: true },
    });
    const userRow = await prisma.user.findUnique({
      where: { id: userId },
      select: { schoolId: true },
    });
    if (cls?.schoolId && userRow?.schoolId && cls.schoolId === userRow.schoolId) {
      return { session, role: "TEACHER" };
    }
  }

  // SUPERADMIN bypasses.
  if (userRole === "SUPERADMIN") {
    return { session, role: "TEACHER" };
  }

  return { session: null, role: null };
}

/** Send the current participant list to a specific socket (used on join
 * so the new participant immediately sees who's already in the room).
 * Returns an array of { userId, username, fullName, role, avatar, micOn,
 * camOn, screenSharing, handRaised, isSpeaking }. */
function getParticipantList(sessionId: string) {
  const store = sessionParticipants.get(sessionId);
  if (!store) return [];
  return Array.from(store.entries()).map(([userId, entry]) => ({
    userId,
    username: entry.user.username,
    fullName: entry.user.fullName,
    role: entry.user.role,
    avatar: entry.user.avatar,
    micOn: entry.info.micOn,
    camOn: entry.info.camOn,
    screenSharing: entry.info.screenSharing,
    handRaised: entry.info.handRaised,
    isSpeaking: entry.info.isSpeaking,
    micAllowed: entry.info.micAllowed,
    camAllowed: entry.info.camAllowed,
  }));
}

// ---------- Connection lifecycle ----------
io.on("connection", (socket) => {
  const data = socket.data as SocketData;
  console.log(
    `[classroom-service] connected socket=${socket.id} user=${data.userId} (${data.username}) role=${data.role}`,
  );

  // Tell the client the socket is ready.
  socket.emit("ready", { id: socket.id, userId: data.userId });

  // ===========================================================================
  // join_session
  // ===========================================================================
  // Client emits: { sessionId }
  // Server:
  //   1. Verifies the user can access the session's class.
  //   2. Joins the socket to room "classroom:<sessionId>".
  //   3. Upserts a ClassroomParticipant row (joinedAt = now, leftAt = null).
  //   4. Adds the user to the in-memory sessionParticipants store.
  //   5. Broadcasts `participant_joined` to the room.
  //   6. Emits `participants` (the full list) back to the joining socket.
  // On failure: emits "error" { message }.
  socket.on("join_session", async (payload: { sessionId?: string }) => {
    try {
      const sessionId = payload?.sessionId;
      if (!sessionId || typeof sessionId !== "string") {
        const err: ErrorResponse = { message: "sessionId الزامی است" };
        socket.emit("error", err);
        return;
      }

      // If the user is already in another session, leave it first.
      if (data.sessionId && data.sessionId !== sessionId) {
        await leaveSessionInternal(socket, "joined_another");
      }

      const { session, role } = await authorizeSessionAccess(
        data.userId,
        sessionId,
        data.role,
      );
      if (!session || !role) {
        const err: ErrorResponse = { message: "دسترسی غیرمجاز به این جلسه" };
        socket.emit("error", err);
        return;
      }

      // Join the socket.io room.
      await socket.join(`classroom:${sessionId}`);
      data.sessionId = sessionId;

      // Upsert the ClassroomParticipant row (re-join after disconnect =
      // reset leftAt to null).
      await prisma.classroomParticipant.upsert({
        where: { sessionId_userId: { sessionId, userId: data.userId } },
        update: { leftAt: null, role },
        create: { sessionId, userId: data.userId, role },
      });

      // Add to the in-memory store.
      let store = sessionParticipants.get(sessionId);
      if (!store) {
        store = new Map();
        sessionParticipants.set(sessionId, store);
      }
      store.set(data.userId, {
        socketId: socket.id,
        user: {
          id: data.userId,
          username: data.username,
          fullName: data.fullName,
          role,
          avatar: data.avatar,
        },
        info: {
          micOn: false,
          camOn: false,
          screenSharing: false,
          handRaised: false,
          isSpeaking: false,
          // Phase 36 — teachers + SUPERADMIN have mic/cam allowed by default.
          // Students + ADMIN (principal) need explicit permission from the
          // teacher before they can turn on their mic/cam.
          micAllowed: role === "TEACHER",
          camAllowed: role === "TEACHER",
          lastSeen: Date.now(),
        },
      });

      // Tell the joining socket who's already in the room.
      socket.emit("participants", getParticipantList(sessionId));

      // Tell everyone else that this user joined.
      socket.to(`classroom:${sessionId}`).emit("participant_joined", {
        userId: data.userId,
        username: data.username,
        fullName: data.fullName,
        role,
        avatar: data.avatar,
        micOn: false,
        camOn: false,
        screenSharing: false,
        handRaised: false,
        isSpeaking: false,
        micAllowed: role === "TEACHER",
        camAllowed: role === "TEACHER",
      });

      // Phase 36h-3+4 — Ask the first TEACHER in the room (excluding the
      // joininger themselves if they're a teacher) for the current
      // whiteboard state. The teacher will respond via
      // `whiteboard_full_state` with `toUserId = joiner's id`. The server
      // relays the strokes back to the joiner so they see the existing
      // drawing immediately. We do this for ALL joiners (students AND
      // teachers — if a second teacher joins, they get the first
      // teacher's drawing too).
      const teacherEntry = Array.from(store.values()).find(
        (e) => e.user.role === "TEACHER" && e.user.id !== data.userId,
      );
      if (teacherEntry) {
        io.to(teacherEntry.socketId).emit("whiteboard_request_state", {
          fromUserId: data.userId,
        });
      }

      console.log(
        `[classroom-service] user=${data.userId} joined session=${sessionId} as ${role}`,
      );
    } catch (err) {
      console.error("[classroom-service] join_session error:", err);
      socket.emit("error", { message: "خطا در پیوستن به جلسه" } satisfies ErrorResponse);
    }
  });

  // ===========================================================================
  // leave_session
  // ===========================================================================
  socket.on("leave_session", async () => {
    await leaveSessionInternal(socket, "user_left");
  });

  // ===========================================================================
  // WebRTC signaling — relay between two peers.
  // ===========================================================================
  // The mesh topology: each peer connects to every other peer directly.
  // The signaling server is just a relay — it doesn't terminate or modify
  // the SDP/ICE messages, just routes them to the target socket.
  // The `to` field is the target user's userId (NOT socket.id — so the
  // client doesn't need to track socket ids, just user ids).
  socket.on("webrtc_offer", (payload: { to: string; sdp: unknown }) => {
    if (!data.sessionId) return;
    const target = sessionParticipants.get(data.sessionId)?.get(payload.to);
    console.log(`[classroom-service] webrtc_offer from=${data.userId} to=${payload.to} targetFound=${!!target}`);
    if (!target) return;
    io.to(target.socketId).emit("webrtc_offer", {
      from: data.userId,
      sdp: payload.sdp,
    });
  });

  socket.on("webrtc_answer", (payload: { to: string; sdp: unknown }) => {
    if (!data.sessionId) return;
    const target = sessionParticipants.get(data.sessionId)?.get(payload.to);
    console.log(`[classroom-service] webrtc_answer from=${data.userId} to=${payload.to} targetFound=${!!target}`);
    if (!target) return;
    io.to(target.socketId).emit("webrtc_answer", {
      from: data.userId,
      sdp: payload.sdp,
    });
  });

  socket.on("webrtc_ice_candidate", (payload: { to: string; candidate: unknown }) => {
    if (!data.sessionId) return;
    const target = sessionParticipants.get(data.sessionId)?.get(payload.to);
    if (!target) return;
    io.to(target.socketId).emit("webrtc_ice_candidate", {
      from: data.userId,
      candidate: payload.candidate,
    });
  });

  // ===========================================================================
  // State broadcasts — mic/cam/screen-share/hand-raise toggles.
  // ===========================================================================
  // The client emits `set_state` { micOn?, camOn?, screenSharing?, handRaised? }
  // with only the changed fields. The server updates the in-memory store +
  // broadcasts `participant_state` to the rest of the room so their UIs
  // update instantly.
  // Phase 36 — also supports `micAllowed`/`camAllowed` fields (teacher-
  // granted permissions). The server enforces that only TEACHERs can set
  // these — students can only toggle their own micOn/camOn.
  socket.on("set_state", (payload: {
    micOn?: boolean;
    camOn?: boolean;
    screenSharing?: boolean;
    handRaised?: boolean;
    micAllowed?: boolean;
    camAllowed?: boolean;
  }) => {
    if (!data.sessionId) return;
    const store = sessionParticipants.get(data.sessionId);
    const entry = store?.get(data.userId);
    if (!entry) return;
    // Students can only set micOn if micAllowed is true; same for camOn.
    if (typeof payload.micOn === "boolean") {
      if (payload.micOn && !entry.info.micAllowed) {
        socket.emit("error", { message: "معلم اجازه میکروفون نداده است" } satisfies ErrorResponse);
        return;
      }
      entry.info.micOn = payload.micOn;
    }
    if (typeof payload.camOn === "boolean") {
      if (payload.camOn && !entry.info.camAllowed) {
        socket.emit("error", { message: "معلم اجازه دوربین نداده است" } satisfies ErrorResponse);
        return;
      }
      entry.info.camOn = payload.camOn;
    }
    if (typeof payload.screenSharing === "boolean") entry.info.screenSharing = payload.screenSharing;
    if (typeof payload.handRaised === "boolean") entry.info.handRaised = payload.handRaised;
    // micAllowed/camAllowed can only be set by a teacher — use grant_access.
    entry.info.lastSeen = Date.now();
    console.log(`[classroom-service] set_state from=${data.userId} broadcasting:`, JSON.stringify(payload));
    socket.to(`classroom:${data.sessionId}`).emit("participant_state", {
      userId: data.userId,
      ...payload,
    });
  });

  // ===========================================================================
  // Phase 36 — Grant / revoke mic/cam permission.
  // Teacher emits `grant_access` { userId, mic?, cam? } to grant (+true) or
  // revoke (+false) mic/cam permission for a student/principal. The server
  // validates the sender is a TEACHER, updates the in-memory store, emits a
  // `permission_granted` event to the target (so their UI enables the mic/cam
  // buttons), + broadcasts `participant_state` to the room.
  // ===========================================================================
  socket.on("grant_access", async (payload: { userId: string; mic?: boolean; cam?: boolean }) => {
    if (!data.sessionId) return;
    const store = sessionParticipants.get(data.sessionId);
    const senderEntry = store?.get(data.userId);
    if (!senderEntry || senderEntry.user.role !== "TEACHER") {
      socket.emit("error", { message: "فقط معلم می‌تواند اجازه دهد" } satisfies ErrorResponse);
      return;
    }
    const target = store?.get(payload.userId);
    if (!target) {
      socket.emit("error", { message: "کاربر در جلسه نیست" } satisfies ErrorResponse);
      return;
    }
    const updates: { micAllowed?: boolean; camAllowed?: boolean; micOn?: boolean; camOn?: boolean } = {};
    if (typeof payload.mic === "boolean") {
      target.info.micAllowed = payload.mic;
      updates.micAllowed = payload.mic;
      // When revoking, also force mic off.
      if (!payload.mic) {
        target.info.micOn = false;
        updates.micOn = false;
      }
    }
    if (typeof payload.cam === "boolean") {
      target.info.camAllowed = payload.cam;
      updates.camAllowed = payload.cam;
      if (!payload.cam) {
        target.info.camOn = false;
        updates.camOn = false;
      }
    }
    target.info.lastSeen = Date.now();
    // Notify the target student directly.
    io.to(target.socketId).emit("permission_granted", {
      byUserId: data.userId,
      byFullName: data.fullName,
      mic: payload.mic,
      cam: payload.cam,
    });
    // Broadcast the new permission + (if revoked) the muted state to the room.
    socket.to(`classroom:${data.sessionId}`).emit("participant_state", {
      userId: payload.userId,
      ...updates,
    });
  });

  // ===========================================================================
  // Phase 36h-3+4 — Collaborative whiteboard (relay-only).
  // ===========================================================================
  // The teacher draws on the whiteboard; the strokes are broadcast to all
  // students in the room. The server is a STATELESS relay — it never stores
  // the drawing. The teacher is the source of truth (keeps the full list
  // of strokes in a React ref).
  //
  // Events:
  //   - whiteboard_stroke      teacher emits { stroke }            → relay to others
  //   - whiteboard_clear       teacher emits                       → relay to others
  //   - whiteboard_full_state  teacher emits { toUserId, strokes } → relay to one
  //
  // Late-joining flow:
  //   1. Student joins the session (join_session handler above).
  //   2. Server emits `whiteboard_request_state` { fromUserId } to the
  //      FIRST teacher found in the room.
  //   3. Teacher responds by emitting `whiteboard_full_state`
  //      { toUserId: studentId, strokes: [...] }.
  //   4. Server relays the strokes to the student.
  //
  // Only TEACHER / SUPERADMIN roles may emit whiteboard_stroke /
  // whiteboard_clear / whiteboard_full_state. Students are view-only.
  //
  // We use `socket.to(room).emit(...)` (NOT `io.to`) for whiteboard_stroke
  // + whiteboard_clear so the broadcast goes to OTHER sockets only (the
  // teacher already rendered locally + doesn't need their own echo back).
  // ===========================================================================

  socket.on("whiteboard_stroke", (payload: { stroke: WhiteboardStrokePayload }) => {
    if (!data.sessionId) return;
    const store = sessionParticipants.get(data.sessionId);
    const senderEntry = store?.get(data.userId);
    if (!senderEntry || senderEntry.user.role !== "TEACHER") {
      socket.emit("error", { message: "فقط معلم می‌تواند روی تخته سفید بکشد" } satisfies ErrorResponse);
      return;
    }
    if (!payload?.stroke || !Array.isArray(payload.stroke.points)) return;
    // Relay to OTHER sockets in the room (NOT the sender — the teacher
    // rendered locally already).
    socket.to(`classroom:${data.sessionId}`).emit("whiteboard_stroke", {
      stroke: payload.stroke,
    });
  });

  socket.on("whiteboard_clear", () => {
    if (!data.sessionId) return;
    const store = sessionParticipants.get(data.sessionId);
    const senderEntry = store?.get(data.userId);
    if (!senderEntry || senderEntry.user.role !== "TEACHER") {
      socket.emit("error", { message: "فقط معلم می‌تواند تخته سفید را پاک کند" } satisfies ErrorResponse);
      return;
    }
    socket.to(`classroom:${data.sessionId}`).emit("whiteboard_clear", {
      byUserId: data.userId,
    });
  });

  // Teacher responds to whiteboard_request_state with the full list of
  // strokes. The `toUserId` field tells the server WHO to relay to.
  socket.on("whiteboard_full_state", (payload: { toUserId: string; strokes: WhiteboardStrokePayload[] }) => {
    if (!data.sessionId) return;
    const store = sessionParticipants.get(data.sessionId);
    const senderEntry = store?.get(data.userId);
    if (!senderEntry || senderEntry.user.role !== "TEACHER") return;
    const target = store?.get(payload.toUserId);
    if (!target) return;
    io.to(target.socketId).emit("whiteboard_full_state", {
      strokes: Array.isArray(payload.strokes) ? payload.strokes : [],
    });
  });

  // ===========================================================================
  // Active-speaker detection — the client uses the WebRTC audio-level
  // API + emits `speaking` when the user starts/stops speaking. The
  // server broadcasts `active_speaker` to the room (Speaker View uses
  // this to highlight the active tile).
  // ===========================================================================
  socket.on("speaking", (payload: { isSpeaking: boolean }) => {
    if (!data.sessionId) return;
    const store = sessionParticipants.get(data.sessionId);
    const entry = store?.get(data.userId);
    if (!entry) return;
    if (entry.info.isSpeaking === payload.isSpeaking) return; // no change
    entry.info.isSpeaking = payload.isSpeaking;
    entry.info.lastSeen = Date.now();
    socket.to(`classroom:${data.sessionId}`).emit("active_speaker", {
      userId: data.userId,
      isSpeaking: payload.isSpeaking,
    });
  });

  // ===========================================================================
  // Classroom chat — ephemeral messages (NOT persisted in the DB; they
  // live only for the duration of the session).
  // ===========================================================================
  socket.on("classroom_message", (payload: { content: string; replyToId?: string | null }) => {
    if (!data.sessionId) return;
    const content = (payload?.content ?? "").toString().trim();
    if (!content) return;
    if (content.length > 1000) {
      socket.emit("error", { message: "پیام خیلی طولانی است (حداکثر ۱۰۰۰ کاراکتر)" } satisfies ErrorResponse);
      return;
    }
    const message = {
      id: `cm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      sessionId: data.sessionId,
      userId: data.userId,
      username: data.username,
      fullName: data.fullName,
      role: data.role,
      avatar: data.avatar,
      content,
      replyToId: payload.replyToId ?? null,
      createdAt: new Date().toISOString(),
    };
    // Broadcast to the WHOLE room (including the sender — so the sender's
    // UI confirms the message was delivered).
    io.to(`classroom:${data.sessionId}`).emit("classroom_message", message);
  });

  // ===========================================================================
  // Private message — one-to-one within the classroom. The `to` field is
  // the target user's userId. NOT persisted (ephemeral).
  // ===========================================================================
  socket.on("private_message", (payload: { to: string; content: string }) => {
    if (!data.sessionId) return;
    const content = (payload?.content ?? "").toString().trim();
    if (!content) return;
    const target = sessionParticipants.get(data.sessionId)?.get(payload.to);
    if (!target) {
      socket.emit("error", { message: "کاربر مورد نظر در جلسه نیست" } satisfies ErrorResponse);
      return;
    }
    const message = {
      id: `pm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      sessionId: data.sessionId,
      fromUserId: data.userId,
      fromUsername: data.username,
      fromFullName: data.fullName,
      fromAvatar: data.avatar,
      toUserId: payload.to,
      content,
      createdAt: new Date().toISOString(),
    };
    // Deliver to the target only.
    io.to(target.socketId).emit("private_message", message);
    // Ack to the sender (so they see their own message in the DM thread).
    socket.emit("private_message", message);
  });

  // ===========================================================================
  // Reactions — emoji reactions (👍 ❤️ 🎉 etc.) shown briefly as a
  // floating bubble on the sender's tile.
  // ===========================================================================
  socket.on("reaction", (payload: { emoji: string }) => {
    if (!data.sessionId) return;
    const emoji = (payload?.emoji ?? "").toString().slice(0, 8);
    if (!emoji) return;
    io.to(`classroom:${data.sessionId}`).emit("reaction", {
      userId: data.userId,
      username: data.username,
      fullName: data.fullName,
      emoji,
      at: Date.now(),
    });
  });

  // ===========================================================================
  // Teacher controls — mute_user / remove_user.
  // ===========================================================================
  // Both verify the sender is a TEACHER for the session's class before
  // broadcasting. The client-side on receipt:
  //   - `mute_user`: turns off the recipient's mic + disables the toggle.
  //   - `remove_user`: disconnects the recipient from the session.
  socket.on("mute_user", async (payload: { userId: string }) => {
    if (!data.sessionId) return;
    const store = sessionParticipants.get(data.sessionId);
    const senderEntry = store?.get(data.userId);
    if (!senderEntry || senderEntry.user.role !== "TEACHER") {
      socket.emit("error", { message: "فقط معلم می‌تواند کاربران را قطع صدا کند" } satisfies ErrorResponse);
      return;
    }
    const target = store?.get(payload.userId);
    if (!target) return;
    // Update the target's mic state in the store.
    target.info.micOn = false;
    io.to(target.socketId).emit("mute_user", { byUserId: data.userId });
    socket.to(`classroom:${data.sessionId}`).emit("participant_state", {
      userId: payload.userId,
      micOn: false,
    });
  });

  socket.on("remove_user", async (payload: { userId: string }) => {
    if (!data.sessionId) return;
    const store = sessionParticipants.get(data.sessionId);
    const senderEntry = store?.get(data.userId);
    if (!senderEntry || senderEntry.user.role !== "TEACHER") {
      socket.emit("error", { message: "فقط معلم می‌تواند کاربران را حذف کند" } satisfies ErrorResponse);
      return;
    }
    const target = store?.get(payload.userId);
    if (!target) return;
    io.to(target.socketId).emit("removed_from_session", {
      byUserId: data.userId,
      byFullName: data.fullName,
    });
    // The target's socket will handle the actual leave (their client will
    // emit `leave_session` which triggers the cleanup).
  });

  // ===========================================================================
  // Phase 36h — Teacher toggles a student's mic/cam by clicking the
  // mic/cam icon in the participants panel. The server validates the
  // sender is a teacher, updates the target's state, emits a
  // `force_toggle_media` event to the target (so their client toggles
  // the actual media track), + broadcasts `participant_state` to the room.
  // ===========================================================================
  socket.on("toggle_user_media", async (payload: { userId: string; mic?: boolean; cam?: boolean }) => {
    if (!data.sessionId) return;
    const store = sessionParticipants.get(data.sessionId);
    const senderEntry = store?.get(data.userId);
    if (!senderEntry || senderEntry.user.role !== "TEACHER") {
      socket.emit("error", { message: "فقط معلم می‌تواند صدا و تصویر کاربران را تغییر دهد" } satisfies ErrorResponse);
      return;
    }
    const target = store?.get(payload.userId);
    if (!target) return;
    const updates: { micOn?: boolean; camOn?: boolean; micAllowed?: boolean; camAllowed?: boolean } = {};
    if (typeof payload.mic === "boolean") {
      // Toggling mic ON requires permission; toggling OFF always works.
      if (payload.mic && !target.info.micAllowed) {
        // Auto-grant permission when teacher enables mic.
        target.info.micAllowed = true;
        updates.micAllowed = true;
      }
      target.info.micOn = payload.mic;
      updates.micOn = payload.mic;
    }
    if (typeof payload.cam === "boolean") {
      if (payload.cam && !target.info.camAllowed) {
        target.info.camAllowed = true;
        updates.camAllowed = true;
      }
      target.info.camOn = payload.cam;
      updates.camOn = payload.cam;
    }
    // Tell the target student to toggle their actual media track.
    io.to(target.socketId).emit("force_toggle_media", {
      byUserId: data.userId,
      ...payload,
    });
    // Broadcast the new state to the room.
    socket.to(`classroom:${data.sessionId}`).emit("participant_state", {
      userId: payload.userId,
      ...updates,
    });
  });

  // ===========================================================================
  // Phase 36h — Teacher enables/disables the classroom chat for students.
  // When disabled, students can't send messages (the chat input is
  // disabled). The teacher's own chat is always enabled.
  // ===========================================================================
  socket.on("set_chat_enabled", (payload: { enabled: boolean }) => {
    if (!data.sessionId) return;
    const store = sessionParticipants.get(data.sessionId);
    const senderEntry = store?.get(data.userId);
    if (!senderEntry || senderEntry.user.role !== "TEACHER") {
      socket.emit("error", { message: "فقط معلم می‌تواند چت را فعال/غیرفعال کند" } satisfies ErrorResponse);
      return;
    }
    // Broadcast to the whole room (including sender for confirmation).
    io.to(`classroom:${data.sessionId}`).emit("chat_enabled", {
      enabled: !!payload.enabled,
      byUserId: data.userId,
    });
  });

  // ===========================================================================
  // Disconnect — clean up the in-memory store + mark the
  // ClassroomParticipant.leftAt + broadcast `participant_left`.
  // ===========================================================================
  socket.on("disconnect", async () => {
    console.log(
      `[classroom-service] disconnected socket=${socket.id} user=${data.userId}`,
    );
    await leaveSessionInternal(socket, "disconnected");
  });
});

// ---------- Internal: leave a session (shared by leave_session + disconnect) ----------
async function leaveSessionInternal(
  socket: import("socket.io").Socket,
  reason: "user_left" | "disconnected" | "joined_another",
) {
  const data = socket.data as SocketData;
  const sessionId = data.sessionId;
  if (!sessionId) return;
  data.sessionId = null;

  // Leave the socket.io room.
  await socket.leave(`classroom:${sessionId}`);

  // Remove from the in-memory store.
  const store = sessionParticipants.get(sessionId);
  if (store) {
    store.delete(data.userId);
    if (store.size === 0) {
      sessionParticipants.delete(sessionId);
    }
  }

  // Mark the ClassroomParticipant.leftAt (only if there's an active row).
  try {
    await prisma.classroomParticipant.updateMany({
      where: { sessionId, userId: data.userId, leftAt: null },
      data: { leftAt: new Date() },
    });
  } catch (err) {
    console.error("[classroom-service] failed to mark leftAt:", err);
  }

  // Broadcast to the rest of the room.
  socket.to(`classroom:${sessionId}`).emit("participant_left", {
    userId: data.userId,
    username: data.username,
    fullName: data.fullName,
    reason,
  });
}

// ---------- Start the server ----------
httpServer.listen(PORT, () => {
  console.log(`[classroom-service] listening on port ${PORT}`);
});

// ---------- Graceful shutdown ----------
process.on("SIGINT", () => {
  console.log("[classroom-service] SIGINT — closing...");
  io.close(() => {
    httpServer.close(() => {
      prisma.$disconnect();
      process.exit(0);
    });
  });
});
process.on("SIGTERM", () => {
  console.log("[classroom-service] SIGTERM — closing...");
  io.close(() => {
    httpServer.close(() => {
      prisma.$disconnect();
      process.exit(0);
    });
  });
});
