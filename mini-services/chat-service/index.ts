// chat-service: socket.io mini-service for the Custom Teacher Messenger
// Port 3003 is HARDCODED (per project gateway convention).
// The Next.js frontend connects via: io("/?XTransformPort=3003", { auth: { token } })
//
// Responsibilities:
//   1. Authenticate the connecting socket via a short-lived JWT issued by
//      the main app's /api/socket/token endpoint (NextAuth-session-gated,
//      signed with the shared SOCKET_AUTH_SECRET). The OLD client-supplied
//      userId scheme is REJECTED — identity spoofing is impossible now.
//   2. Manage per-class rooms (join_class / leave_class) with Prisma-backed
//      membership verification.
//   3. Persist & broadcast class chat messages (send_message -> new_message),
//      respecting the per-class chatClosed flag (students can't send to closed chats).
//   4. Relay file-bearing messages created via the REST upload API
//      (relay_message -> new_message, NO new DB row — REST already persisted it).
//   5. Broadcast typing indicators (typing -> user_typing).
//   6. Soft-delete messages with permission rules (delete_message -> message_deleted).
//   7. Telegram-style polls (create_poll, vote_poll, vote_poll_multiple,
//      close_poll -> poll_created / poll_updated / poll_closed).
//   8. Per-class chat close/open (close_chat, open_chat -> chat_closed / chat_opened).
//   9. Bulk operations (bulk_broadcast, bulk_close_chats) for teachers/admins.
//  10. Phase 17 — message options: edit_message (-> message_edited) +
//      mark_read (per-user read receipts, no broadcast).

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { Server } from "socket.io";
import { PrismaClient } from "@prisma/client";
import { verifySocketToken, isOriginAllowed, type SocketTokenPayload } from "./socket-auth";

// ---------- Configuration (hardcoded, no env) ----------
const PORT = 3003;
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
    res.end("chat-service alive");
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
});

// ---------- socket.io server ----------
// SECURITY:
//  - NO wildcard CORS. No CORS headers are emitted at all (same-origin
//    connections through the gateway don't need them); cross-origin
//    requests are blocked server-side in the io.use middleware below
//    (SOCKET_ALLOWED_ORIGINS env + same-Host check).
const io = new Server(httpServer, {
  cors: {
    origin: false,
    methods: ["GET", "POST"],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e6, // 1 MB — event payloads are small (files go via REST upload API)
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
  role: string;
  avatar: string | null;
  // School the user belongs to (null for SUPERADMIN / unaffiliated). Resolved
  // from the DB at connect time, kept in sync on socket.data so per-event
  // handlers don't need another lookup.
  schoolId: string | null;
}

// new_message shape (broadcast to room "class:<classId>").
// File fields are present on every message (null for plain-text messages) so
// the client can render a single, consistent shape whether the message was
// created via the "send_message" (text-only) socket event, the REST file
// upload API + "relay_message" event, or the "bulk_broadcast" event.
//
// Phase 17 additions:
//   - replyToId / forwardedFromId / editedAt — always present (null for a
//     brand-new outgoing message that isn't a reply / forward / hasn't been
//     edited yet). The frontend renders a small "↳ reply" or "↻ forwarded"
//     banner above the bubble when these are set.
interface NewMessagePayload {
  id: string;
  classId: string;
  senderId: string;
  senderName: string;
  senderRole: string;
  senderAvatar: string | null;
  content: string;
  createdAt: string; // ISO string
  fileUrl: string | null;
  fileName: string | null;
  fileType: string | null; // "image" | "pdf" | "video" | "file" | null
  fileSize: number | null;
  mimeType: string | null;
  // Phase-17 reply / forward / edit metadata.
  replyToId: string | null;
  forwardedFromId: string | null;
  editedAt: string | null; // ISO string | null
}

// message_edited shape (broadcast to room "class:<classId>" when a sender
// edits their message). The frontend swaps the message's `content` + sets
// `editedAt` so the bubble shows "✎ ویرایش شد" + the new text.
interface MessageEditedPayload {
  id: string;
  classId: string;
  content: string;
  editedAt: string; // ISO string
  editedBy: PublicUser;
}

interface PublicUser {
  id: string;
  fullName: string;
  role: string;
}

interface PollCreatedPayload {
  id: string;
  classId: string;
  question: string;
  options: string[];
  multipleChoice: boolean;
  createdAt: string; // ISO
  createdBy: PublicUser;
  closedAt: string | null;
  optionVotes: number[];
  totalVotes: number;
  myVote: number | number[] | null;
}

interface PollUpdatedPayload {
  id: string;
  optionVotes: number[];
  totalVotes: number;
}

interface PollClosedPayload {
  id: string;
  closedAt: string;
}

interface MessageDeletedPayload {
  id: string;
  classId: string;
  deletedBy: PublicUser;
  deletedAt: string;
}

interface ChatClosedPayload {
  classId: string;
  chatClosed: boolean;
  closedBy: PublicUser;
  closedAt: string;
}

interface ChatOpenedPayload {
  classId: string;
  chatClosed: boolean;
}

interface ErrorResponse {
  message: string;
}

// new_direct_message shape (broadcast to room "direct:<chatId>").
// Mirrors NewMessagePayload but uses `chatId` instead of `classId`.
// `readAt` is always `null` for a brand-new outgoing message (the recipient
// hasn't opened the chat yet). The SENDER's UI renders single ✓; once the
// recipient emits `mark_direct_read`, we broadcast `direct_messages_read`
// and the sender flips to double ✓✓ (blue).
interface NewDirectMessagePayload {
  id: string;
  chatId: string;
  senderId: string;
  senderName: string;
  senderRole: string;
  senderAvatar: string | null;
  content: string;
  createdAt: string; // ISO string
  readAt: string | null; // ISO string | null — null when unread
  fileUrl: string | null;
  fileName: string | null;
  fileType: string | null; // "image" | "pdf" | "video" | "file" | null
  fileSize: number | null;
  mimeType: string | null;
}

interface DirectMessageDeletedPayload {
  id: string;
  chatId: string;
  deletedBy: PublicUser;
  deletedAt: string;
}

// direct_messages_read shape — broadcast to room "direct:<chatId>" when the
// recipient opens the chat (or scrolls to the bottom). Tells the SENDER of
// the previously-unread messages to flip their ticks to blue.
// `readerId` is the user who opened the chat (the recipient). `readAt` is
// the timestamp that was written to the DB rows — the sender can also use
// it to mark their own messages as read on their side.
interface DirectMessagesReadPayload {
  chatId: string;
  readAt: string; // ISO string — the timestamp written to all unread rows
  readerId: string;
}

const roomFor = (classId: string) => `class:${classId}`;
const directRoomFor = (chatId: string) => `direct:${chatId}`;
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
const MAX_CONTENT_LEN = 2000;

// ---------- Helper functions ----------
function isAdmin(role: string) {
  return role === "ADMIN";
}

function isTeacher(role: string) {
  return role === "TEACHER";
}

function isStudent(role: string) {
  return role === "STUDENT";
}

async function getMembership(userId: string, classId: string) {
  return prisma.classMembership.findUnique({
    where: { classId_userId: { classId, userId } },
    select: { id: true, role: true },
  });
}

async function isTeacherOf(userId: string, classId: string): Promise<boolean> {
  const m = await getMembership(userId, classId);
  return !!m && m.role === "TEACHER";
}

// True if the user is the TEACHER of the class OR an ADMIN (can moderate the class).
async function canModerateClass(user: SocketData, classId: string): Promise<boolean> {
  if (isAdmin(user.role)) return true;
  return isTeacherOf(user.userId, classId);
}

// True if the user can post / relay a message to the given class:
//   - any ClassMembership row exists (members of any role), OR
//   - ADMIN principal of the class's school (schoolId match), OR
//   - ADMIN who is the School.principalId of the class's school, OR
//   - SUPERADMIN (full bypass).
// This mirrors the REST API's `POST /api/messages` access control so a
// principal can chat with any class in their school even without joining it.
//
// Phase 24 fix: we RE-FETCH the user's schoolId from the DB here instead of
// trusting `socket.data.schoolId` (which was set once at connect time and
// may go stale if the principal is reassigned to a different school, or if
// the chat-service has been running for hours and its Prisma connection
// picks up an old snapshot). We also add a School.principalId fallback for
// the case where `user.schoolId` is null in the User table but the user is
// still linked to the school via `School.principalId` — this happens for
// legacy admin accounts.
async function canPostToClass(user: SocketData, classId: string): Promise<boolean> {
  const membership = await getMembership(user.userId, classId);
  if (membership) return true;
  if (user.role === "SUPERADMIN") return true;
  if (!isAdmin(user.role)) return false;

  // Load the target class + the user row in parallel.
  const [cls, userRow] = await Promise.all([
    prisma.classRoom.findUnique({
      where: { id: classId },
      select: { schoolId: true },
    }),
    prisma.user.findUnique({
      where: { id: user.userId },
      select: { schoolId: true },
    }),
  ]);

  // No school on the class? Skip the principal-bypass check (a class with
  // no school is platform-wide — only SUPERADMIN can access it).
  if (!cls?.schoolId) return false;

  // Path 1: user.schoolId matches the class's schoolId.
  if (userRow?.schoolId && userRow.schoolId === cls.schoolId) return true;

  // Path 2: the user is the official principal of the class's school
  // (School.principalId). This catches legacy admin accounts whose
  // user.schoolId may be null but who are linked via School.principalId.
  const school = await prisma.school.findUnique({
    where: { id: cls.schoolId },
    select: { principalId: true },
  });
  if (school?.principalId && school.principalId === user.userId) return true;

  return false;
}

// Safely parse the Poll.options JSON-encoded string back to an array.
function parsePollOptions(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((o) => String(o));
    }
  } catch {
    /* ignore */
  }
  return [];
}

// Recompute per-option vote tallies for a poll.
async function computeTallies(pollId: string, options: string[]) {
  const votes = await prisma.pollVote.findMany({
    where: { pollId },
    select: { optionIndex: true },
  });
  const optionVotes = options.map(() => 0);
  for (const v of votes) {
    if (v.optionIndex >= 0 && v.optionIndex < options.length) {
      optionVotes[v.optionIndex]++;
    }
  }
  return { optionVotes, totalVotes: votes.length };
}

// Get the optionIndexes the current user has voted for on a poll.
async function getMyVote(pollId: string, userId: string): Promise<number | number[] | null> {
  const mine = await prisma.pollVote.findMany({
    where: { pollId, userId },
    select: { optionIndex: true },
    orderBy: { optionIndex: "asc" },
  });
  if (mine.length === 0) return null;
  if (mine.length === 1) return mine[0].optionIndex;
  return mine.map((m) => m.optionIndex);
}

// Build the full public Poll payload (includes tallies + myVote for the calling user).
async function serializePoll(
  poll: {
    id: string;
    classId: string;
    question: string;
    options: string;
    multipleChoice: boolean;
    createdAt: Date;
    createdById: string;
    closedAt: Date | null;
  },
  userId: string,
): Promise<PollCreatedPayload> {
  const options = parsePollOptions(poll.options);
  const { optionVotes, totalVotes } = await computeTallies(poll.id, options);
  const createdBy = await prisma.user.findUnique({
    where: { id: poll.createdById },
    select: { id: true, fullName: true, role: true },
  });
  const myVote = await getMyVote(poll.id, userId);
  return {
    id: poll.id,
    classId: poll.classId,
    question: poll.question,
    options,
    multipleChoice: poll.multipleChoice,
    createdAt: poll.createdAt.toISOString(),
    createdBy: {
      id: createdBy?.id ?? poll.createdById,
      fullName: createdBy?.fullName ?? "",
      role: createdBy?.role ?? "TEACHER",
    },
    closedAt: poll.closedAt ? poll.closedAt.toISOString() : null,
    optionVotes,
    totalVotes,
    myVote,
  };
}

// Compute per-option tallies for a poll WITHOUT touching the user table (used for
// broadcasted poll_updated events so all members get the same numbers).
async function talliesForBroadcast(pollId: string, options: string[]): Promise<PollUpdatedPayload> {
  const { optionVotes, totalVotes } = await computeTallies(pollId, options);
  return { id: pollId, optionVotes, totalVotes };
}

// For TEACHER: all classes where they have membership with role=TEACHER.
// For ADMIN (principal): all classes in their school. If the principal has
// no schoolId, returns an empty list (defensive). Optionally filter by an
// explicit classIds subset.
async function getModeratedClasses(
  user: SocketData,
  filterIds?: string[],
): Promise<{ id: string; name: string }[]> {
  let classes: { id: string; name: string }[] = [];
  if (isAdmin(user.role)) {
    if (user.schoolId) {
      classes = await prisma.classRoom.findMany({
        where: { schoolId: user.schoolId },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      });
    } else {
      classes = [];
    }
  } else {
    const memberships = await prisma.classMembership.findMany({
      where: { userId: user.userId, role: "TEACHER" },
      select: { class: { select: { id: true, name: true } } },
      orderBy: { class: { name: "asc" } },
    });
    classes = memberships.map((m) => m.class);
  }
  if (filterIds && filterIds.length > 0) {
    const set = new Set(filterIds);
    classes = classes.filter((c) => set.has(c.id));
  }
  return classes;
}

// ---------- Direct-chat helpers ----------
// Returns the DirectChat row if the user is a participant (userA or userB),
// else null. SUPERADMIN bypasses the participant check (returns the chat row
// even if they're not a participant — used for moderation).
async function getDirectChatForUser(
  userId: string,
  chatId: string,
): Promise<{ id: string; userAId: string; userBId: string; schoolId: string | null } | null> {
  const chat = await prisma.directChat.findUnique({
    where: { id: chatId },
    select: { id: true, userAId: true, userBId: true, schoolId: true },
  });
  if (!chat) return null;
  if (chat.userAId !== userId && chat.userBId !== userId) return null;
  return chat;
}

// True if the user can post / join the direct chat room:
//   - they are a participant (userA or userB), OR
//   - they are a SUPERADMIN (full bypass — for moderation / support).
async function canAccessDirectChat(
  user: SocketData,
  chatId: string,
): Promise<boolean> {
  if (user.role === "SUPERADMIN") return true;
  const chat = await prisma.directChat.findUnique({
    where: { id: chatId },
    select: { userAId: true, userBId: true },
  });
  if (!chat) return false;
  return chat.userAId === user.userId || chat.userBId === user.userId;
}

// ---------- Auth middleware ----------
// SECURITY: Socket.IO authentication — short-lived JWT issued by the main
// app's /api/socket/token endpoint (NextAuth-session-gated), verified with
// the shared SOCKET_AUTH_SECRET. Client-supplied identity fields (userId,
// role, ...) are REJECTED — only the token's subject + fresh DB data are
// trusted, making identity spoofing impossible.
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
        `[chat-service] rejected socket=${socket.id} — invalid or expired auth token`,
      );
      return next(new Error("unauthorized: invalid or expired token"));
    }

    // SECURITY: the token's `sub` identifies the user; the DB remains the
    // source of truth for role/avatar/school (fresh values on every connect,
    // so a revoked role change takes effect immediately).
    const userRow = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        username: true,
        fullName: true,
        role: true,
        avatar: true,
        schoolId: true,
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
      schoolId: userRow.schoolId ?? null,
    };
    socket.data = data;
    next();
  } catch (err) {
    next(err as Error);
  }
});

// ---------- Connection lifecycle ----------
io.on("connection", (socket) => {
  const data = socket.data as SocketData;
  console.log(
    `[chat-service] connected socket=${socket.id} user=${data.userId} (${data.username}) role=${data.role}`,
  );

  // Tell the client the socket is ready to receive events.
  socket.emit("ready", { id: socket.id, userId: data.userId });

  // ===========================================================================
  // join_class
  // ===========================================================================
  // Client emits: { classId }
  // Server: verifies the user can access the class:
  //   - they have a ClassMembership row, OR
  //   - they are a principal (ADMIN) and the class is in their school, OR
  //   - they are a SUPERADMIN (unscoped).
  // Then joins the socket to room "class:<id>" so they receive new_message /
  // message_deleted / chat_closed / chat_opened / poll_* broadcasts.
  // On failure: emits "error" { message }. On success: ack { ok, classId, role }.
  socket.on("join_class", async (payload: { classId?: string }, cb?: (res: unknown) => void) => {
    try {
      const classId = payload?.classId;
      if (!classId || typeof classId !== "string") {
        const err: ErrorResponse = { message: "classId الزامی است" };
        socket.emit("error", err);
        if (cb) cb({ ok: false, error: err });
        return;
      }

      // Try explicit membership first (the common path).
      let role: string | null = null;
      const membership = await prisma.classMembership.findUnique({
        where: { classId_userId: { classId, userId: data.userId } },
        select: { id: true, role: true },
      });
      if (membership) {
        role = membership.role;
      } else if (await canPostToClass(data, classId)) {
        // Principal of the class's school (or SUPERADMIN) — synthetic role.
        role = data.role;
      }

      if (!role) {
        const err: ErrorResponse = { message: "شما عضو این کلاس نیستید" };
        socket.emit("error", err);
        if (cb) cb({ ok: false, error: err });
        return;
      }
      await socket.join(roomFor(classId));
      console.log(`[chat-service] ${data.username} joined ${roomFor(classId)} as ${role}`);
      if (cb) cb({ ok: true, classId, role });
    } catch (e) {
      console.error("[chat-service] join_class error:", e);
      const err: ErrorResponse = { message: "خطای سرور هنگام پیوستن به کلاس" };
      socket.emit("error", err);
      if (cb) cb({ ok: false, error: err });
    }
  });

  // ===========================================================================
  // leave_class
  // ===========================================================================
  socket.on("leave_class", async (payload: { classId?: string }, cb?: (res: unknown) => void) => {
    try {
      const classId = payload?.classId;
      if (classId && typeof classId === "string") {
        await socket.leave(roomFor(classId));
        console.log(`[chat-service] ${data.username} left ${roomFor(classId)}`);
      }
      if (cb) cb({ ok: true });
    } catch (e) {
      console.error("[chat-service] leave_class error:", e);
      if (cb) cb({ ok: false, error: { message: "خطای سرور" } });
    }
  });

  // ===========================================================================
  // send_message  (UPDATED: respects per-class chatClosed flag)
  // ===========================================================================
  // Client emits: { classId, content }
  // Server:
  //   1. Validates content (non-empty, <= 2000 chars).
  //   2. Verifies membership via ClassMembership.
  //   3. Loads the ClassRoom; if chatClosed === true AND the sender's role is
  //      STUDENT, emits "error" { message: "این گفتگو توسط معلم/مدیر بسته شده است" }
  //      and returns. Teachers/admins CAN still send (they're the closers).
  //   4. Persists a Message record (senderId = socket.data.userId).
  //   5. Broadcasts "new_message" to room "class:<classId>" INCLUDING the sender.
  socket.on(
    "send_message",
    async (payload: { classId?: string; content?: string }, cb?: (res: unknown) => void) => {
      try {
        const classId = payload?.classId;
        const rawContent = typeof payload?.content === "string" ? payload.content : "";
        const content = rawContent.trim();

        if (!classId || typeof classId !== "string") {
          const err: ErrorResponse = { message: "classId الزامی است" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }
        if (!content) {
          const err: ErrorResponse = { message: "محتوای پیام خالی است" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }
        if (content.length > MAX_CONTENT_LEN) {
          const err: ErrorResponse = { message: "پیام نباید بیش از ۲۰۰۰ کاراکتر باشد" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }

        // Access check: members can post; principals (ADMIN) can post to any
        // class in their school even without a membership row; SUPERADMIN
        // bypasses entirely. Mirrors `POST /api/messages` in the main app.
        const allowed = await canPostToClass(data, classId);
        if (!allowed) {
          const err: ErrorResponse = { message: "شما عضو این کلاس نیستید" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }

        // chatClosed check — only students are blocked; teachers/admins
        // (incl. principals) can send anyway.
        const cls = await prisma.classRoom.findUnique({
          where: { id: classId },
          select: { chatClosed: true },
        });
        if (cls?.chatClosed && isStudent(data.role)) {
          const err: ErrorResponse = {
            message: "این گفتگو توسط معلم/مدیر بسته شده است",
          };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }

        // Persist message
        const msg = await prisma.message.create({
          data: {
            classId,
            senderId: data.userId,
            content,
          },
        });

        const broadcast: NewMessagePayload = {
          id: msg.id,
          classId: msg.classId,
          senderId: data.userId,
          senderName: data.fullName || data.username,
          senderRole: data.role,
          senderAvatar: data.avatar,
          content: msg.content,
          createdAt: msg.createdAt.toISOString(),
          // Plain-text messages have no file attachment — keep the shape
          // consistent with file-bearing messages so the client renders a
          // single union type.
          fileUrl: null,
          fileName: null,
          fileType: null,
          fileSize: null,
          mimeType: null,
          // Phase-17 reply / forward / edit metadata — always null for a
          // brand-new outgoing `send_message` (it isn't a reply, isn't a
          // forward, hasn't been edited).
          replyToId: null,
          forwardedFromId: null,
          editedAt: null,
        };

        // Broadcast to everyone in the room INCLUDING the sender.
        io.to(roomFor(classId)).emit("new_message", broadcast);
        console.log(
          `[chat-service] message ${msg.id} from ${data.username} (${data.userId}) in ${roomFor(classId)} len=${content.length}`,
        );
        if (cb) cb({ ok: true, message: broadcast });
      } catch (e) {
        console.error("[chat-service] send_message error:", e);
        const err: ErrorResponse = { message: "خطای سرور هنگام ارسال پیام" };
        socket.emit("error", err);
        if (cb) cb({ ok: false, error: err });
      }
    },
  );

  // ===========================================================================
  // relay_message  (NEW — phase 3: file-bearing messages)
  // ===========================================================================
  // Client emits: { classId, message }
  //   - `message` is the FULL message object created & persisted by the REST
  //     file-upload API (POST /api/messages, multipart). The REST route already
  //     validated everything (auth, membership, chatClosed, file size/type, etc.)
  //     and wrote the Message row including fileUrl/fileName/fileType/fileSize/
  //     mimeType. The socket's ONLY job is to relay that exact object to the rest
  //     of the class room — we do NOT create a new DB row here.
  // Server:
  //   1. Verifies the socket user is a member of `classId` via ClassMembership.
  //      (Defence in depth — the REST API already enforced this, but a malicious
  //      client could emit `relay_message` with an arbitrary classId.)
  //   2. Re-checks chatClosed for STUDENTS (teachers/admins may post to closed
  //      chats — they're the closers). This mirrors the send_message rule.
  //   3. Trusts the message payload AS-IS and broadcasts "new_message" to room
  //      "class:<classId>" (including the sender — the client dedupes by id so
  //      the sender's optimistic append + the broadcast don't double-render).
  //   4. Acks the sender with { ok: true, relayed: true }.
  //
  // The broadcast payload shape MUST match NewMessagePayload exactly so the
  // client renders file and text messages through a single code path.
  socket.on(
    "relay_message",
    async (
      payload: {
        classId?: string;
        message?: NewMessagePayload & {
          sender?: { id?: string; fullName?: string; role?: string; username?: string; avatar?: string | null };
          senderAvatar?: string | null;
        };
      },
      cb?: (res: unknown) => void,
    ) => {
      try {
        const classId = payload?.classId;
        const incoming = payload?.message;

        if (!classId || typeof classId !== "string") {
          const err: ErrorResponse = { message: "classId الزامی است" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }
        if (
          !incoming ||
          typeof incoming !== "object" ||
          typeof incoming.id !== "string" ||
          typeof incoming.classId !== "string" ||
          typeof incoming.senderId !== "string" ||
          typeof incoming.content !== "string" ||
          typeof incoming.createdAt !== "string"
        ) {
          const err: ErrorResponse = { message: "پیام نامعتبر است" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }

        // Access check (defence in depth — REST API already verified). Same
        // rule as send_message: members, principals (ADMIN school match), or
        // SUPERADMIN can relay.
        const allowed = await canPostToClass(data, classId);
        if (!allowed) {
          const err: ErrorResponse = { message: "شما عضو این کلاس نیستید" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }

        // chatClosed re-check — students are blocked, teachers/admins can relay.
        if (isStudent(data.role)) {
          const cls = await prisma.classRoom.findUnique({
            where: { id: classId },
            select: { chatClosed: true },
          });
          if (cls?.chatClosed) {
            const err: ErrorResponse = {
              message: "این گفتگو توسط معلم/مدیر بسته شده است",
            };
            socket.emit("error", err);
            if (cb) cb({ ok: false, error: err });
            return;
          }
        }

        // Normalize the relayed payload to the canonical NewMessagePayload
        // shape. We trust the REST API's data (sender object already enriched)
        // but coerce nullable file fields defensively in case a buggy caller
        // sends undefined instead of null.
        const broadcast: NewMessagePayload = {
          id: incoming.id,
          classId: incoming.classId,
          senderId: incoming.senderId,
          senderName:
            incoming.senderName ??
            incoming.sender?.fullName ??
            incoming.sender?.username ??
            data.fullName ??
            data.username,
          senderRole: incoming.senderRole ?? incoming.sender?.role ?? data.role,
          senderAvatar:
            incoming.senderAvatar ??
            incoming.sender?.avatar ??
            data.avatar ??
            null,
          content: incoming.content,
          createdAt: incoming.createdAt,
          fileUrl: incoming.fileUrl ?? null,
          fileName: incoming.fileName ?? null,
          fileType: incoming.fileType ?? null,
          fileSize: typeof incoming.fileSize === "number" ? incoming.fileSize : null,
          mimeType: incoming.mimeType ?? null,
          // Phase-17 reply / forward / edit metadata — pass through from the
          // REST-created message (the file-upload API now serializes these on
          // the created row). Defensive `?? null` so a caller that omits the
          // field entirely doesn't surface `undefined` to the client.
          replyToId:
            typeof incoming.replyToId === "string" ? incoming.replyToId : null,
          forwardedFromId:
            typeof incoming.forwardedFromId === "string"
              ? incoming.forwardedFromId
              : null,
          editedAt:
            typeof incoming.editedAt === "string" ? incoming.editedAt : null,
        };

        // Broadcast to everyone in the room INCLUDING the sender. The sender's
        // client should dedupe against its optimistic append by message id.
        io.to(roomFor(classId)).emit("new_message", broadcast);
        console.log(
          `[chat-service] relay_message ${broadcast.id} from ${data.username} (${data.userId}) in ${roomFor(classId)} file=${broadcast.fileType ?? "none"}`,
        );
        if (cb) cb({ ok: true, relayed: true });
      } catch (e) {
        console.error("[chat-service] relay_message error:", e);
        const err: ErrorResponse = { message: "خطای سرور هنگام بازپخش پیام" };
        socket.emit("error", err);
        if (cb) cb({ ok: false, error: err });
      }
    },
  );

  // ===========================================================================
  // typing
  // ===========================================================================
  socket.on("typing", (payload: { classId?: string; isTyping?: boolean }) => {
    try {
      const classId = payload?.classId;
      const isTyping = Boolean(payload?.isTyping);
      if (!classId || typeof classId !== "string") return;
      socket.to(roomFor(classId)).emit("user_typing", {
        userId: data.userId,
        fullName: data.fullName || data.username,
        isTyping,
      });
    } catch (e) {
      console.error("[chat-service] typing error:", e);
    }
  });

  // ===========================================================================
  // delete_message  (NEW — soft-delete with permission rules)
  // ===========================================================================
  // Client emits: { messageId }
  // Permission rules (mirror REST API in Task 2-a):
  //   - ADMIN or TEACHER of the class → can delete any message.
  //   - STUDENT → can delete ONLY their own message AND only within 12h of send.
  //   - Idempotent: if already deleted, treat as success (no broadcast).
  // On success: broadcast message_deleted { id, classId, deletedBy, deletedAt }.
  socket.on(
    "delete_message",
    async (payload: { messageId?: string }, cb?: (res: unknown) => void) => {
      try {
        const messageId = payload?.messageId;
        if (!messageId || typeof messageId !== "string") {
          const err: ErrorResponse = { message: "messageId الزامی است" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }

        const message = await prisma.message.findUnique({
          where: { id: messageId },
          select: { id: true, classId: true, senderId: true, createdAt: true, deletedAt: true },
        });
        if (!message) {
          const err: ErrorResponse = { message: "پیام یافت نشد" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }

        // Verify membership of the message's class.
        const membership = await getMembership(data.userId, message.classId);
        if (!membership && !isAdmin(data.role)) {
          const err: ErrorResponse = { message: "شما عضو این کلاس نیستید" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }

        // Idempotent: already deleted → success without re-broadcasting.
        if (message.deletedAt) {
          const deletedBy: PublicUser = {
            id: data.userId,
            fullName: data.fullName || data.username,
            role: data.role,
          };
          const ack: MessageDeletedPayload = {
            id: message.id,
            classId: message.classId,
            deletedBy,
            deletedAt: message.deletedAt.toISOString(),
          };
          if (cb) cb({ ok: true, deleted: ack });
          return;
        }

        // Permission check.
        const canModerate = await canModerateClass(data, message.classId);
        const isOwn = message.senderId === data.userId;
        const within12h = Date.now() - message.createdAt.getTime() <= TWELVE_HOURS_MS;

        if (!canModerate) {
          if (!isStudent(data.role) || !isOwn || !within12h) {
            const err: ErrorResponse = {
              message: "شما فقط تا ۱۲ ساعت پس از ارسال می‌توانید پیام خود را حذف کنید",
            };
            socket.emit("error", err);
            if (cb) cb({ ok: false, error: err });
            return;
          }
        }

        const now = new Date();
        await prisma.message.update({
          where: { id: messageId },
          data: { deletedAt: now, deletedById: data.userId },
        });

        const deletedBy: PublicUser = {
          id: data.userId,
          fullName: data.fullName || data.username,
          role: data.role,
        };
        const broadcast: MessageDeletedPayload = {
          id: message.id,
          classId: message.classId,
          deletedBy,
          deletedAt: now.toISOString(),
        };
        io.to(roomFor(message.classId)).emit("message_deleted", broadcast);
        console.log(
          `[chat-service] message ${message.id} deleted in ${roomFor(message.classId)} by ${data.username}`,
        );
        if (cb) cb({ ok: true, deleted: broadcast });
      } catch (e) {
        console.error("[chat-service] delete_message error:", e);
        const err: ErrorResponse = { message: "خطای سرور هنگام حذف پیام" };
        socket.emit("error", err);
        if (cb) cb({ ok: false, error: err });
      }
    },
  );

  // ===========================================================================
  // edit_message  (NEW — phase 17: edit the content of a message)
  // ===========================================================================
  // Client emits: { messageId, content }
  // Server:
  //   1. Validates content (non-empty, <= 2000 chars).
  //   2. Loads the message + its class; verifies the socket user is a member
  //      OR principal of the school OR SUPERADMIN.
  //   3. Permission gate (mirrors PATCH /api/messages/[id]):
  //        - ADMIN/TEACHER of the class OR principal of the school OR SUPERADMIN
  //          → can edit ANY message anytime.
  //        - STUDENT → can edit ONLY their own message, within 12h of createdAt.
  //   4. Persists the new content + sets `editedAt = now()`.
  //   5. Broadcasts `message_edited { id, classId, content, editedAt, editedBy }`
  //      to room "class:<classId>" (incl. sender — the sender's optimistic UI
  //      already shows the new text, but the broadcast is harmless because the
  //      client applies the same text).
  //   6. Acks the editor with `{ ok: true, edited: <MessageEditedPayload> }`.
  socket.on(
    "edit_message",
    async (
      payload: { messageId?: string; content?: string },
      cb?: (res: unknown) => void,
    ) => {
      try {
        const messageId = payload?.messageId;
        const rawContent =
          typeof payload?.content === "string" ? payload.content : "";
        const content = rawContent.trim();

        if (!messageId || typeof messageId !== "string") {
          const err: ErrorResponse = { message: "messageId الزامی است" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }
        if (!content) {
          const err: ErrorResponse = { message: "محتوای پیام خالی است" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }
        if (content.length > MAX_CONTENT_LEN) {
          const err: ErrorResponse = { message: "پیام نباید بیش از ۲۰۰۰ کاراکتر باشد" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }

        const message = await prisma.message.findUnique({
          where: { id: messageId },
          select: {
            id: true,
            classId: true,
            senderId: true,
            createdAt: true,
            deletedAt: true,
          },
        });
        if (!message) {
          const err: ErrorResponse = { message: "پیام یافت نشد" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }
        if (message.deletedAt) {
          const err: ErrorResponse = { message: "این پیام حذف شده و قابل ویرایش نیست" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }

        // Access check: member of the class OR principal of the school OR
        // SUPERADMIN.
        const membership = await getMembership(data.userId, message.classId);
        const cls = await prisma.classRoom.findUnique({
          where: { id: message.classId },
          select: { schoolId: true },
        });
        const isPrincipalOfClass =
          isAdmin(data.role) &&
          !!data.schoolId &&
          cls?.schoolId === data.schoolId;
        const isSuperAdmin = data.role === "SUPERADMIN";

        if (!membership && !isPrincipalOfClass && !isSuperAdmin) {
          const err: ErrorResponse = { message: "شما عضو این کلاس نیستید" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }

        // Permission gate: moderators (teachers/admins/super-admins/principals)
        // can edit any message anytime. Students only their own + within 12h.
        const canModerate =
          isSuperAdmin ||
          isPrincipalOfClass ||
          membership?.role === "TEACHER" ||
          isAdmin(data.role);
        if (!canModerate) {
          if (message.senderId !== data.userId) {
            const err: ErrorResponse = {
              message: "شما فقط می‌توانید پیام خود را ویرایش کنید",
            };
            socket.emit("error", err);
            if (cb) cb({ ok: false, error: err });
            return;
          }
          const elapsed = Date.now() - message.createdAt.getTime();
          if (elapsed > TWELVE_HOURS_MS) {
            const err: ErrorResponse = {
              message:
                "شما فقط تا ۱۲ ساعت پس از ارسال می‌توانید پیام خود را ویرایش کنید",
            };
            socket.emit("error", err);
            if (cb) cb({ ok: false, error: err });
            return;
          }
        }

        const now = new Date();
        await prisma.message.update({
          where: { id: messageId },
          data: { content, editedAt: now },
        });

        const editedBy: PublicUser = {
          id: data.userId,
          fullName: data.fullName || data.username,
          role: data.role,
        };
        const broadcast: MessageEditedPayload = {
          id: message.id,
          classId: message.classId,
          content,
          editedAt: now.toISOString(),
          editedBy,
        };
        io.to(roomFor(message.classId)).emit("message_edited", broadcast);
        console.log(
          `[chat-service] message ${message.id} edited in ${roomFor(message.classId)} by ${data.username}`,
        );
        if (cb) cb({ ok: true, edited: broadcast });
      } catch (e) {
        console.error("[chat-service] edit_message error:", e);
        const err: ErrorResponse = { message: "خطای سرور هنگام ویرایش پیام" };
        socket.emit("error", err);
        if (cb) cb({ ok: false, error: err });
      }
    },
  );

  // ===========================================================================
  // mark_read  (NEW — phase 17: mark all unread class messages as read)
  // ===========================================================================
  // Client emits: { classId }
  // Server:
  //   1. Verifies the socket user can access the class (member OR principal
  //      OR SUPERADMIN) — mirrors `join_class`.
  //   2. Finds every message in the class sent by SOMEONE ELSE that isn't
  //      soft-deleted AND has no existing MessageRead row for this user.
  //   3. Creates MessageRead rows for them in one round trip.
  //   4. No broadcast — read receipts are PER-USER (each user has their own
  //      read state; the SENDER of those messages will see the read count
  //      climb when they next GET /api/messages or open the readers sheet).
  //   5. Acks the reader with `{ ok: true, markedRead: <count> }`.
  socket.on(
    "mark_read",
    async (payload: { classId?: string }, cb?: (res: unknown) => void) => {
      try {
        const classId = payload?.classId;
        if (!classId || typeof classId !== "string") {
          const err: ErrorResponse = { message: "classId الزامی است" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }

        // Access check (same rule as join_class / send_message).
        const allowed = await canPostToClass(data, classId);
        if (!allowed) {
          const err: ErrorResponse = { message: "شما عضو این کلاس نیستید" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }

        // Step 1: candidate messages — sent by someone else, not deleted.
        const candidates = await prisma.message.findMany({
          where: {
            classId,
            senderId: { not: data.userId },
            deletedAt: null,
          },
          select: { id: true },
        });
        const candidateIds = candidates.map((m) => m.id);
        if (candidateIds.length === 0) {
          if (cb) cb({ ok: true, markedRead: 0 });
          return;
        }

        // Step 2: subtract the ones we've already read.
        const alreadyRead = await prisma.messageRead.findMany({
          where: {
            userId: data.userId,
            messageId: { in: candidateIds },
          },
          select: { messageId: true },
        });
        const alreadyReadSet = new Set(alreadyRead.map((r) => r.messageId));
        const toCreate = candidateIds.filter((id) => !alreadyReadSet.has(id));
        if (toCreate.length === 0) {
          if (cb) cb({ ok: true, markedRead: 0 });
          return;
        }

        // Step 3: insert the missing rows. NOTE: Prisma's
        // `createMany({ skipDuplicates: true })` is NOT supported on SQLite
        // (only Postgres/MySQL). Step 2 already subtracted the existing
        // MessageRead rows for this user, so `toCreate` contains only
        // message ids with no existing receipt — `skipDuplicates` would be
        // redundant anyway.
        const result = await prisma.messageRead.createMany({
          data: toCreate.map((messageId) => ({
            messageId,
            userId: data.userId,
          })),
        });

        console.log(
          `[chat-service] mark_read by ${data.username} in ${roomFor(classId)} (count=${result.count})`,
        );
        if (cb) cb({ ok: true, markedRead: result.count });
      } catch (e) {
        console.error("[chat-service] mark_read error:", e);
        const err: ErrorResponse = {
          message: "خطای سرور هنگام ثبت خوانده‌شدن پیام‌ها",
        };
        socket.emit("error", err);
        if (cb) cb({ ok: false, error: err });
      }
    },
  );

  // ===========================================================================
  // create_poll  (NEW — teacher/admin creates a poll)
  // ===========================================================================
  // Client emits: { classId, question, options: string[], multipleChoice? }
  // Validates: question non-empty, options 2-10 non-empty strings.
  // Broadcasts poll_created to room "class:<classId>" with full poll shape.
  socket.on(
    "create_poll",
    async (
      payload: {
        classId?: string;
        question?: string;
        options?: string[];
        multipleChoice?: boolean;
      },
      cb?: (res: unknown) => void,
    ) => {
      try {
        const classId = payload?.classId;
        const question = typeof payload?.question === "string" ? payload.question.trim() : "";
        const multipleChoice = Boolean(payload?.multipleChoice);

        if (!classId || typeof classId !== "string") {
          const err: ErrorResponse = { message: "classId الزامی است" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }
        if (!question) {
          const err: ErrorResponse = { message: "سوال نظرسنجی خالی است" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }

        // Normalize options: trim + filter empties.
        const rawOptions = Array.isArray(payload?.options) ? (payload!.options as string[]) : [];
        const options = rawOptions
          .map((o) => (typeof o === "string" ? o.trim() : ""))
          .filter((o) => o.length > 0);

        if (options.length < 2 || options.length > 10) {
          const err: ErrorResponse = {
            message: "نظرسنجی باید بین ۲ تا ۱۰ گزینه معتبر داشته باشد",
          };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }

        // Permission: TEACHER of the class OR ADMIN.
        if (!(await canModerateClass(data, classId))) {
          const err: ErrorResponse = { message: "فقط معلم/مدیر می‌تواند نظرسنجی بسازد" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }

        const poll = await prisma.poll.create({
          data: {
            classId,
            question,
            options: JSON.stringify(options),
            multipleChoice,
            createdById: data.userId,
          },
        });

        const serialized = await serializePoll(poll, data.userId);
        io.to(roomFor(classId)).emit("poll_created", serialized);
        console.log(
          `[chat-service] poll ${poll.id} created in ${roomFor(classId)} by ${data.username} (options=${options.length}, multi=${multipleChoice})`,
        );
        if (cb) cb({ ok: true, poll: serialized });
      } catch (e) {
        console.error("[chat-service] create_poll error:", e);
        const err: ErrorResponse = { message: "خطای سرور هنگام ساخت نظرسنجی" };
        socket.emit("error", err);
        if (cb) cb({ ok: false, error: err });
      }
    },
  );

  // ===========================================================================
  // vote_poll  (NEW — single-choice vote)
  // ===========================================================================
  // Client emits: { pollId, optionIndex }
  // Server: verifies membership of poll's class; rejects if poll closed or user
  // already voted (unless multipleChoice). Upserts PollVote, recomputes tallies,
  // broadcasts poll_updated. Acks the voter with { pollId, voted, myVote }.
  socket.on(
    "vote_poll",
    async (payload: { pollId?: string; optionIndex?: number }, cb?: (res: unknown) => void) => {
      try {
        const pollId = payload?.pollId;
        const optionIndex = typeof payload?.optionIndex === "number" ? payload.optionIndex : NaN;
        if (!pollId || typeof pollId !== "string" || !Number.isInteger(optionIndex)) {
          const err: ErrorResponse = { message: "pollId و optionIndex الزامی است" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }

        const poll = await prisma.poll.findUnique({
          where: { id: pollId },
          select: {
            id: true,
            classId: true,
            options: true,
            multipleChoice: true,
            closedAt: true,
          },
        });
        if (!poll) {
          const err: ErrorResponse = { message: "نظرسنجی یافت نشد" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }

        const membership = await getMembership(data.userId, poll.classId);
        if (!membership && !isAdmin(data.role)) {
          const err: ErrorResponse = { message: "شما عضو این کلاس نیستید" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }

        if (poll.closedAt) {
          const err: ErrorResponse = { message: "این نظرسنجی بسته شده است" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }

        const options = parsePollOptions(poll.options);
        if (optionIndex < 0 || optionIndex >= options.length) {
          const err: ErrorResponse = { message: "گزینه نامعتبر است" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }

        if (poll.multipleChoice) {
          // Multiple-choice poll via single vote — upsert the single option index
          // (unique [pollId, userId, optionIndex] makes this idempotent per option).
          await prisma.pollVote.upsert({
            where: {
              pollId_userId_optionIndex: { pollId, userId: data.userId, optionIndex },
            },
            create: { pollId, userId: data.userId, optionIndex },
            update: {},
          });
        } else {
          // Single-choice poll: reject if user already voted.
          const existing = await prisma.pollVote.findMany({
            where: { pollId, userId: data.userId },
            select: { optionIndex: true },
          });
          if (existing.length > 0) {
            const err: ErrorResponse = { message: "شما قبلاً رای داده‌اید" };
            socket.emit("error", err);
            if (cb) cb({ ok: false, error: err });
            return;
          }
          try {
            await prisma.pollVote.create({
              data: { pollId, userId: data.userId, optionIndex },
            });
          } catch (e) {
            // P2002 = unique constraint violation (race) — treat as already voted.
            const code = (e as { code?: string })?.code;
            if (code === "P2002") {
              const err: ErrorResponse = { message: "شما قبلاً رای داده‌اید" };
              socket.emit("error", err);
              if (cb) cb({ ok: false, error: err });
              return;
            }
            throw e;
          }
        }

        const updated = await talliesForBroadcast(poll.id, options);
        io.to(roomFor(poll.classId)).emit("poll_updated", updated);
        console.log(
          `[chat-service] vote on poll ${poll.id} by ${data.username} (option=${optionIndex})`,
        );
        if (cb) cb({ ok: true, pollId, voted: true, myVote: optionIndex });
      } catch (e) {
        console.error("[chat-service] vote_poll error:", e);
        const err: ErrorResponse = { message: "خطای سرور هنگام ثبت رای" };
        socket.emit("error", err);
        if (cb) cb({ ok: false, error: err });
      }
    },
  );

  // ===========================================================================
  // vote_poll_multiple  (NEW — multiple-choice vote)
  // ===========================================================================
  // Client emits: { pollId, optionIndexes: number[] }
  // Server: deletes user's existing votes for this poll and inserts the new set
  // (so multiple-choice voting is "replace my votes with these"). Then recomputes
  // tallies and broadcasts poll_updated. Acks voter with the new myVote set.
  socket.on(
    "vote_poll_multiple",
    async (
      payload: { pollId?: string; optionIndexes?: number[] },
      cb?: (res: unknown) => void,
    ) => {
      try {
        const pollId = payload?.pollId;
        const raw = Array.isArray(payload?.optionIndexes) ? (payload!.optionIndexes as number[]) : [];
        const optionIndexes = Array.from(
          new Set(raw.filter((n) => Number.isInteger(n)).map((n) => Number(n))),
        ).sort((a, b) => a - b);

        if (!pollId || typeof pollId !== "string") {
          const err: ErrorResponse = { message: "pollId الزامی است" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }

        const poll = await prisma.poll.findUnique({
          where: { id: pollId },
          select: { id: true, classId: true, options: true, closedAt: true },
        });
        if (!poll) {
          const err: ErrorResponse = { message: "نظرسنجی یافت نشد" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }

        const membership = await getMembership(data.userId, poll.classId);
        if (!membership && !isAdmin(data.role)) {
          const err: ErrorResponse = { message: "شما عضو این کلاس نیستید" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }

        if (poll.closedAt) {
          const err: ErrorResponse = { message: "این نظرسنجی بسته شده است" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }

        const options = parsePollOptions(poll.options);
        const valid = optionIndexes.filter((i) => i >= 0 && i < options.length);
        if (valid.length === 0) {
          const err: ErrorResponse = { message: "گزینه‌های نامعتبر است" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }

        // Replace the user's existing votes for this poll with the new set.
        // (optionIndexes already de-duped, and we delete existing votes first,
        //  so no skipDuplicates needed — which SQLite doesn't support anyway.)
        await prisma.$transaction([
          prisma.pollVote.deleteMany({ where: { pollId, userId: data.userId } }),
          prisma.pollVote.createMany({
            data: valid.map((optionIndex) => ({
              pollId,
              userId: data.userId,
              optionIndex,
            })),
          }),
        ]);

        const updated = await talliesForBroadcast(poll.id, options);
        io.to(roomFor(poll.classId)).emit("poll_updated", updated);
        console.log(
          `[chat-service] multi-vote on poll ${poll.id} by ${data.username} (options=${valid.join(",")})`,
        );
        if (cb) cb({ ok: true, pollId, voted: true, myVote: valid });
      } catch (e) {
        console.error("[chat-service] vote_poll_multiple error:", e);
        const err: ErrorResponse = { message: "خطای سرور هنگام ثبت رای" };
        socket.emit("error", err);
        if (cb) cb({ ok: false, error: err });
      }
    },
  );

  // ===========================================================================
  // close_poll  (NEW — creator/teacher/admin closes a poll)
  // ===========================================================================
  // Client emits: { pollId }
  // Verifies the user is the poll creator OR a TEACHER of the class OR ADMIN.
  // Sets closedAt = now(). Broadcasts poll_closed { id, closedAt }.
  socket.on(
    "close_poll",
    async (payload: { pollId?: string }, cb?: (res: unknown) => void) => {
      try {
        const pollId = payload?.pollId;
        if (!pollId || typeof pollId !== "string") {
          const err: ErrorResponse = { message: "pollId الزامی است" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }

        const poll = await prisma.poll.findUnique({
          where: { id: pollId },
          select: { id: true, classId: true, createdById: true, closedAt: true },
        });
        if (!poll) {
          const err: ErrorResponse = { message: "نظرسنجی یافت نشد" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }

        const isCreator = poll.createdById === data.userId;
        const canModerate = await canModerateClass(data, poll.classId);
        if (!isCreator && !canModerate) {
          const err: ErrorResponse = { message: "شما اجازه بستن این نظرسنجی را ندارید" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }

        // Idempotent: already closed → ack with existing closedAt.
        if (poll.closedAt) {
          const ack: PollClosedPayload = { id: poll.id, closedAt: poll.closedAt.toISOString() };
          if (cb) cb({ ok: true, poll: ack });
          return;
        }

        const now = new Date();
        await prisma.poll.update({
          where: { id: pollId },
          data: { closedAt: now },
        });

        const broadcast: PollClosedPayload = { id: poll.id, closedAt: now.toISOString() };
        io.to(roomFor(poll.classId)).emit("poll_closed", broadcast);
        console.log(
          `[chat-service] poll ${poll.id} closed by ${data.username} in ${roomFor(poll.classId)}`,
        );
        if (cb) cb({ ok: true, poll: broadcast });
      } catch (e) {
        console.error("[chat-service] close_poll error:", e);
        const err: ErrorResponse = { message: "خطای سرور هنگام بستن نظرسنجی" };
        socket.emit("error", err);
        if (cb) cb({ ok: false, error: err });
      }
    },
  );

  // ===========================================================================
  // close_chat  (NEW — teacher/admin closes the class chat)
  // ===========================================================================
  // Client emits: { classId }
  // Verifies TEACHER of class OR ADMIN. Sets chatClosed=true, chatClosedAt=now,
  // chatClosedById=userId on the ClassRoom. Broadcasts chat_closed to the room.
  // Students receiving this should disable their input locally.
  socket.on(
    "close_chat",
    async (payload: { classId?: string }, cb?: (res: unknown) => void) => {
      try {
        const classId = payload?.classId;
        if (!classId || typeof classId !== "string") {
          const err: ErrorResponse = { message: "classId الزامی است" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }

        if (!(await canModerateClass(data, classId))) {
          const err: ErrorResponse = { message: "فقط معلم/مدیر می‌تواند گفتگو را ببندد" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }

        const now = new Date();
        await prisma.classRoom.update({
          where: { id: classId },
          data: {
            chatClosed: true,
            chatClosedAt: now,
            chatClosedById: data.userId,
          },
        });

        const closedBy: PublicUser = {
          id: data.userId,
          fullName: data.fullName || data.username,
          role: data.role,
        };
        const broadcast: ChatClosedPayload = {
          classId,
          chatClosed: true,
          closedBy,
          closedAt: now.toISOString(),
        };
        io.to(roomFor(classId)).emit("chat_closed", broadcast);
        console.log(`[chat-service] chat ${roomFor(classId)} closed by ${data.username}`);
        if (cb) cb({ ok: true, ...broadcast });
      } catch (e) {
        console.error("[chat-service] close_chat error:", e);
        const err: ErrorResponse = { message: "خطای سرور هنگام بستن گفتگو" };
        socket.emit("error", err);
        if (cb) cb({ ok: false, error: err });
      }
    },
  );

  // ===========================================================================
  // open_chat  (NEW — teacher/admin reopens the class chat)
  // ===========================================================================
  // Client emits: { classId }
  // Verifies TEACHER of class OR ADMIN. Clears chatClosed, chatClosedAt,
  // chatClosedById. Broadcasts chat_opened to the room.
  socket.on(
    "open_chat",
    async (payload: { classId?: string }, cb?: (res: unknown) => void) => {
      try {
        const classId = payload?.classId;
        if (!classId || typeof classId !== "string") {
          const err: ErrorResponse = { message: "classId الزامی است" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }

        if (!(await canModerateClass(data, classId))) {
          const err: ErrorResponse = { message: "فقط معلم/مدیر می‌تواند گفتگو را باز کند" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }

        await prisma.classRoom.update({
          where: { id: classId },
          data: {
            chatClosed: false,
            chatClosedAt: null,
            chatClosedById: null,
          },
        });

        const broadcast: ChatOpenedPayload = { classId, chatClosed: false };
        io.to(roomFor(classId)).emit("chat_opened", broadcast);
        console.log(`[chat-service] chat ${roomFor(classId)} opened by ${data.username}`);
        if (cb) cb({ ok: true, ...broadcast });
      } catch (e) {
        console.error("[chat-service] open_chat error:", e);
        const err: ErrorResponse = { message: "خطای سرور هنگام باز کردن گفتگو" };
        socket.emit("error", err);
        if (cb) cb({ ok: false, error: err });
      }
    },
  );

  // ===========================================================================
  // bulk_broadcast  (NEW — teacher/admin sends the same message to all their classes)
  // ===========================================================================
  // Client emits: { content, classIds?: string[] }
  // If classIds omitted: TEACHER → all classes they teach; ADMIN → all classes.
  // For each target class: create a Message, broadcast new_message to that room.
  // Teachers/admins CAN send to closed chats (they're the closers).
  socket.on(
    "bulk_broadcast",
    async (
      payload: { content?: string; classIds?: string[] },
      cb?: (res: unknown) => void,
    ) => {
      try {
        // Only teachers or admins may bulk-broadcast.
        if (!isTeacher(data.role) && !isAdmin(data.role)) {
          const err: ErrorResponse = { message: "فقط معلم/مدیر می‌تواند پیام گروهی بفرستد" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }

        const rawContent = typeof payload?.content === "string" ? payload.content : "";
        const content = rawContent.trim();
        if (!content) {
          const err: ErrorResponse = { message: "محتوای پیام خالی است" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }
        if (content.length > MAX_CONTENT_LEN) {
          const err: ErrorResponse = { message: "پیام نباید بیش از ۲۰۰۰ کاراکتر باشد" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }

        const classIds = Array.isArray(payload?.classIds)
          ? (payload!.classIds as string[]).filter((s) => typeof s === "string" && s.length > 0)
          : undefined;

        const targets = await getModeratedClasses(data, classIds);
        if (targets.length === 0) {
          const err: ErrorResponse = { message: "هیچ کلاسی برای ارسال پیام یافت نشد" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }

        const now = new Date();
        let count = 0;
        const sentClassIds: string[] = [];
        for (const cls of targets) {
          const msg = await prisma.message.create({
            data: {
              classId: cls.id,
              senderId: data.userId,
              content,
            },
          });
          const broadcast: NewMessagePayload = {
            id: msg.id,
            classId: cls.id,
            senderId: data.userId,
            senderName: data.fullName || data.username,
            senderRole: data.role,
            senderAvatar: data.avatar,
            content: msg.content,
            createdAt: msg.createdAt.toISOString(),
            // Bulk broadcasts are plain-text only — no file attachment.
            fileUrl: null,
            fileName: null,
            fileType: null,
            fileSize: null,
            mimeType: null,
            // Phase-17 reply / forward / edit metadata — bulk-broadcast creates
            // fresh top-level messages, so all three are null.
            replyToId: null,
            forwardedFromId: null,
            editedAt: null,
          };
          io.to(roomFor(cls.id)).emit("new_message", broadcast);
          count++;
          sentClassIds.push(cls.id);
        }

        console.log(
          `[chat-service] bulk_broadcast by ${data.username} to ${count} classes (${sentClassIds.join(",")})`,
        );
        if (cb) cb({ ok: true, count, classIds: sentClassIds, sentAt: now.toISOString() });
      } catch (e) {
        console.error("[chat-service] bulk_broadcast error:", e);
        const err: ErrorResponse = { message: "خطای سرور هنگام ارسال گروهی پیام" };
        socket.emit("error", err);
        if (cb) cb({ ok: false, error: err });
      }
    },
  );

  // ===========================================================================
  // bulk_close_chats  (NEW — teacher/admin closes ALL their chats at once)
  // ===========================================================================
  // Client emits: { classIds?: string[] }
  // For TEACHER: all classes they teach (or the provided subset).
  // For ADMIN: all classes (or subset).
  // Sets chatClosed=true on each. Emits chat_closed to each room.
  socket.on(
    "bulk_close_chats",
    async (payload: { classIds?: string[] }, cb?: (res: unknown) => void) => {
      try {
        if (!isTeacher(data.role) && !isAdmin(data.role)) {
          const err: ErrorResponse = { message: "فقط معلم/مدیر می‌تواند گفتگوها را ببندد" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }

        const classIds = Array.isArray(payload?.classIds)
          ? (payload!.classIds as string[]).filter((s) => typeof s === "string" && s.length > 0)
          : undefined;

        const targets = await getModeratedClasses(data, classIds);
        if (targets.length === 0) {
          const err: ErrorResponse = { message: "هیچ کلاسی برای بستن یافت نشد" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }

        const now = new Date();
        const closedClassIds: string[] = [];
        const closedBy: PublicUser = {
          id: data.userId,
          fullName: data.fullName || data.username,
          role: data.role,
        };

        for (const cls of targets) {
          await prisma.classRoom.update({
            where: { id: cls.id },
            data: {
              chatClosed: true,
              chatClosedAt: now,
              chatClosedById: data.userId,
            },
          });
          const broadcast: ChatClosedPayload = {
            classId: cls.id,
            chatClosed: true,
            closedBy,
            closedAt: now.toISOString(),
          };
          io.to(roomFor(cls.id)).emit("chat_closed", broadcast);
          closedClassIds.push(cls.id);
        }

        console.log(
          `[chat-service] bulk_close_chats by ${data.username} closed ${closedClassIds.length} classes`,
        );
        if (cb) cb({ ok: true, count: closedClassIds.length, classIds: closedClassIds });
      } catch (e) {
        console.error("[chat-service] bulk_close_chats error:", e);
        const err: ErrorResponse = { message: "خطای سرور هنگام بستن گروهی گفتگوها" };
        socket.emit("error", err);
        if (cb) cb({ ok: false, error: err });
      }
    },
  );

  // ===========================================================================
  // join_direct  (NEW — direct chat room join)
  // ===========================================================================
  // Client emits: { chatId }
  // Server: verifies the socket user is a participant (userA or userB) of the
  // DirectChat. SUPERADMIN bypasses (they can join any DM for moderation).
  // Joins room "direct:<chatId>". Acks { ok: true }.
  socket.on(
    "join_direct",
    async (payload: { chatId?: string }, cb?: (res: unknown) => void) => {
      try {
        const chatId = payload?.chatId;
        if (!chatId || typeof chatId !== "string") {
          const err: ErrorResponse = { message: "chatId الزامی است" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }
        const allowed = await canAccessDirectChat(data, chatId);
        if (!allowed) {
          const err: ErrorResponse = { message: "دسترسی به این گفتگو مجاز نیست" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }
        await socket.join(directRoomFor(chatId));
        console.log(
          `[chat-service] ${data.username} joined ${directRoomFor(chatId)}`,
        );
        if (cb) cb({ ok: true });
      } catch (e) {
        console.error("[chat-service] join_direct error:", e);
        const err: ErrorResponse = { message: "خطای سرور هنگام پیوستن به گفتگو" };
        socket.emit("error", err);
        if (cb) cb({ ok: false, error: err });
      }
    },
  );

  // ===========================================================================
  // leave_direct  (NEW — direct chat room leave)
  // ===========================================================================
  socket.on(
    "leave_direct",
    async (payload: { chatId?: string }, cb?: (res: unknown) => void) => {
      try {
        const chatId = payload?.chatId;
        if (chatId && typeof chatId === "string") {
          await socket.leave(directRoomFor(chatId));
          console.log(
            `[chat-service] ${data.username} left ${directRoomFor(chatId)}`,
          );
        }
        if (cb) cb({ ok: true });
      } catch (e) {
        console.error("[chat-service] leave_direct error:", e);
        if (cb) cb({ ok: false, error: { message: "خطای سرور" } });
      }
    },
  );

  // ===========================================================================
  // send_direct_message  (NEW — text-only direct message)
  // ===========================================================================
  // Client emits: { chatId, content }
  // Server:
  //   1. Validates content (non-empty, <= 2000 chars).
  //   2. Verifies the socket user is a participant of the DirectChat.
  //   3. Persists a DirectMessage row (text-only — no file path here; file
  //      uploads go through the REST API + relay_direct_message event).
  //   4. Updates DirectChat.lastMessageAt.
  //   5. Broadcasts "new_direct_message" to room "direct:<chatId>" INCLUDING
  //      the sender. Acks the sender with { ok, message }.
  socket.on(
    "send_direct_message",
    async (
      payload: { chatId?: string; content?: string },
      cb?: (res: unknown) => void,
    ) => {
      try {
        const chatId = payload?.chatId;
        const rawContent = typeof payload?.content === "string" ? payload.content : "";
        const content = rawContent.trim();

        if (!chatId || typeof chatId !== "string") {
          const err: ErrorResponse = { message: "chatId الزامی است" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }
        if (!content) {
          const err: ErrorResponse = { message: "محتوای پیام خالی است" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }
        if (content.length > MAX_CONTENT_LEN) {
          const err: ErrorResponse = { message: "پیام نباید بیش از ۲۰۰۰ کاراکتر باشد" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }

        // Verify participant (or SUPERADMIN bypass).
        const allowed = await canAccessDirectChat(data, chatId);
        if (!allowed) {
          const err: ErrorResponse = { message: "دسترسی به این گفتگو مجاز نیست" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }

        // Persist direct message.
        const msg = await prisma.directMessage.create({
          data: {
            chatId,
            senderId: data.userId,
            content,
          },
        });

        // Bump the chat's lastMessageAt so the inbox list sorts correctly.
        await prisma.directChat.update({
          where: { id: chatId },
          data: { lastMessageAt: msg.createdAt },
        });

        const broadcast: NewDirectMessagePayload = {
          id: msg.id,
          chatId,
          senderId: data.userId,
          senderName: data.fullName || data.username,
          senderRole: data.role,
          senderAvatar: data.avatar,
          content: msg.content,
          createdAt: msg.createdAt.toISOString(),
          // New outgoing message — recipient hasn't seen it yet.
          readAt: null,
          fileUrl: null,
          fileName: null,
          fileType: null,
          fileSize: null,
          mimeType: null,
        };
        io.to(directRoomFor(chatId)).emit("new_direct_message", broadcast);
        console.log(
          `[chat-service] direct message ${msg.id} from ${data.username} in ${directRoomFor(chatId)} len=${content.length}`,
        );
        if (cb) cb({ ok: true, message: broadcast });
      } catch (e) {
        console.error("[chat-service] send_direct_message error:", e);
        const err: ErrorResponse = { message: "خطای سرور هنگام ارسال پیام خصوصی" };
        socket.emit("error", err);
        if (cb) cb({ ok: false, error: err });
      }
    },
  );

  // ===========================================================================
  // relay_direct_message  (NEW — relay a REST-created direct message)
  // ===========================================================================
  // Client emits: { chatId, message }
  //   - `message` is the FULL message object created & persisted by the REST
  //     direct-message upload API (POST /api/direct-messages, multipart). The
  //     REST route already validated everything (auth, participant check, file
  //     size/type) and wrote the DirectMessage row including fileUrl/fileName/
  //     fileType/fileSize/mimeType. The socket's ONLY job is to relay that
  //     exact object to the rest of the direct-chat room — we do NOT create a
  //     new DB row here.
  // Server:
  //   1. Verifies the socket user is a participant of the DirectChat.
  //   2. Trusts the message payload AS-IS and broadcasts "new_direct_message"
  //      to room "direct:<chatId>" (including the sender — the client dedupes
  //      by id so the sender's optimistic append + the broadcast don't double-
  //      render).
  //   3. Acks the sender with { ok: true, relayed: true }.
  socket.on(
    "relay_direct_message",
    async (
      payload: {
        chatId?: string;
        message?: NewDirectMessagePayload & {
          sender?: { id?: string; fullName?: string; role?: string; username?: string; avatar?: string | null };
          senderAvatar?: string | null;
        };
      },
      cb?: (res: unknown) => void,
    ) => {
      try {
        const chatId = payload?.chatId;
        const incoming = payload?.message;

        if (!chatId || typeof chatId !== "string") {
          const err: ErrorResponse = { message: "chatId الزامی است" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }
        if (
          !incoming ||
          typeof incoming !== "object" ||
          typeof incoming.id !== "string" ||
          typeof incoming.chatId !== "string" ||
          typeof incoming.senderId !== "string" ||
          typeof incoming.content !== "string" ||
          typeof incoming.createdAt !== "string"
        ) {
          const err: ErrorResponse = { message: "پیام نامعتبر است" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }

        // Verify participant (defence in depth — REST API already enforced).
        const allowed = await canAccessDirectChat(data, chatId);
        if (!allowed) {
          const err: ErrorResponse = { message: "دسترسی به این گفتگو مجاز نیست" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }

        // Normalize the relayed payload to the canonical
        // NewDirectMessagePayload shape.
        const broadcast: NewDirectMessagePayload = {
          id: incoming.id,
          chatId: incoming.chatId,
          senderId: incoming.senderId,
          senderName:
            incoming.senderName ??
            incoming.sender?.fullName ??
            incoming.sender?.username ??
            data.fullName ??
            data.username,
          senderRole: incoming.senderRole ?? incoming.sender?.role ?? data.role,
          senderAvatar:
            incoming.senderAvatar ??
            incoming.sender?.avatar ??
            data.avatar ??
            null,
          content: incoming.content,
          createdAt: incoming.createdAt,
          // Brand-new outgoing message: readAt is null. If the relayed
          // payload happens to carry a string (it shouldn't — REST returns
          // null for fresh rows), trust it; otherwise default to null.
          readAt:
            typeof incoming.readAt === "string" ? incoming.readAt : null,
          fileUrl: incoming.fileUrl ?? null,
          fileName: incoming.fileName ?? null,
          fileType: incoming.fileType ?? null,
          fileSize: typeof incoming.fileSize === "number" ? incoming.fileSize : null,
          mimeType: incoming.mimeType ?? null,
        };

        io.to(directRoomFor(chatId)).emit("new_direct_message", broadcast);
        console.log(
          `[chat-service] relay_direct_message ${broadcast.id} from ${data.username} in ${directRoomFor(chatId)} file=${broadcast.fileType ?? "none"}`,
        );
        if (cb) cb({ ok: true, relayed: true });
      } catch (e) {
        console.error("[chat-service] relay_direct_message error:", e);
        const err: ErrorResponse = { message: "خطای سرور هنگام بازپخش پیام خصوصی" };
        socket.emit("error", err);
        if (cb) cb({ ok: false, error: err });
      }
    },
  );

  // ===========================================================================
  // delete_direct_message  (NEW — soft-delete a direct message)
  // ===========================================================================
  // Client emits: { messageId }
  // Permission rules (mirror REST API):
  //   - SUPERADMIN → can delete anytime.
  //   - The SENDER of the message → only within 12h of createdAt.
  //   - The OTHER participant of the chat → anytime.
  //   - Idempotent: if already deleted, ack with existing info.
  // On success: broadcast direct_message_deleted { id, chatId, deletedBy, deletedAt }.
  socket.on(
    "delete_direct_message",
    async (payload: { messageId?: string }, cb?: (res: unknown) => void) => {
      try {
        const messageId = payload?.messageId;
        if (!messageId || typeof messageId !== "string") {
          const err: ErrorResponse = { message: "messageId الزامی است" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }

        const message = await prisma.directMessage.findUnique({
          where: { id: messageId },
          select: {
            id: true,
            chatId: true,
            senderId: true,
            createdAt: true,
            deletedAt: true,
          },
        });
        if (!message) {
          const err: ErrorResponse = { message: "پیام یافت نشد" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }

        // Verify the socket user is a participant of the message's chat.
        const chat = await prisma.directChat.findUnique({
          where: { id: message.chatId },
          select: { id: true, userAId: true, userBId: true },
        });
        if (!chat) {
          const err: ErrorResponse = { message: "گفتگو یافت نشد" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }

        const isParticipant =
          chat.userAId === data.userId || chat.userBId === data.userId;
        if (!isParticipant && data.role !== "SUPERADMIN") {
          const err: ErrorResponse = { message: "دسترسی به این گفتگو مجاز نیست" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }

        // Idempotent: already deleted → ack with existing info, no rebroadcast.
        if (message.deletedAt) {
          const deletedBy: PublicUser = {
            id: data.userId,
            fullName: data.fullName || data.username,
            role: data.role,
          };
          const ack: DirectMessageDeletedPayload = {
            id: message.id,
            chatId: message.chatId,
            deletedBy,
            deletedAt: message.deletedAt.toISOString(),
          };
          if (cb) cb({ ok: true, deleted: ack });
          return;
        }

        // Permission check.
        const isSender = message.senderId === data.userId;
        const isOther =
          (chat.userAId === data.userId || chat.userBId === data.userId) &&
          !isSender;
        const within12h =
          Date.now() - message.createdAt.getTime() <= TWELVE_HOURS_MS;

        if (data.role !== "SUPERADMIN") {
          if (isSender) {
            if (!within12h) {
              const err: ErrorResponse = {
                message:
                  "شما فقط تا ۱۲ ساعت پس از ارسال می‌توانید پیام خود را حذف کنید",
              };
              socket.emit("error", err);
              if (cb) cb({ ok: false, error: err });
              return;
            }
          } else if (!isOther) {
            const err: ErrorResponse = {
              message: "شما اجازه حذف این پیام را ندارید",
            };
            socket.emit("error", err);
            if (cb) cb({ ok: false, error: err });
            return;
          }
        }

        const now = new Date();
        await prisma.directMessage.update({
          where: { id: messageId },
          data: { deletedAt: now, deletedById: data.userId },
        });

        const deletedBy: PublicUser = {
          id: data.userId,
          fullName: data.fullName || data.username,
          role: data.role,
        };
        const broadcast: DirectMessageDeletedPayload = {
          id: message.id,
          chatId: message.chatId,
          deletedBy,
          deletedAt: now.toISOString(),
        };
        io.to(directRoomFor(message.chatId)).emit(
          "direct_message_deleted",
          broadcast,
        );
        console.log(
          `[chat-service] direct message ${message.id} deleted in ${directRoomFor(message.chatId)} by ${data.username}`,
        );
        if (cb) cb({ ok: true, deleted: broadcast });
      } catch (e) {
        console.error("[chat-service] delete_direct_message error:", e);
        const err: ErrorResponse = { message: "خطای سرور هنگام حذف پیام خصوصی" };
        socket.emit("error", err);
        if (cb) cb({ ok: false, error: err });
      }
    },
  );

  // ===========================================================================
  // mark_direct_read  (NEW — read receipts for direct messages)
  // ===========================================================================
  // Client emits: { chatId }
  // Server:
  //   1. Verifies the socket user is a participant of the DirectChat
  //      (SUPERADMIN bypasses).
  //   2. Marks as read every message in this chat whose senderId is NOT
  //      the socket user's AND whose readAt is still NULL (i.e. unread
  //      messages FROM THE OTHER participant — we never mark our own).
  //   3. Broadcasts "direct_messages_read" { chatId, readAt, readerId }
  //      to room "direct:<chatId>" so the OTHER participant (the sender of
  //      those messages) can flip their ticks to blue.
  //   4. Acks the reader with { ok: true, markedRead: <count> }.
  //
  // This is the real-time path; the matching REST endpoint
  // POST /api/direct-chats/[id]/read does the same DB write for the
  // initial chat-open case (so the client can recover unread state even
  // when the socket is still connecting).
  socket.on(
    "mark_direct_read",
    async (payload: { chatId?: string }, cb?: (res: unknown) => void) => {
      try {
        const chatId = payload?.chatId;
        if (!chatId || typeof chatId !== "string") {
          const err: ErrorResponse = { message: "chatId الزامی است" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }

        // Verify participant (or SUPERADMIN bypass).
        const allowed = await canAccessDirectChat(data, chatId);
        if (!allowed) {
          const err: ErrorResponse = { message: "دسترسی به این گفتگو مجاز نیست" };
          socket.emit("error", err);
          if (cb) cb({ ok: false, error: err });
          return;
        }

        const now = new Date();
        // Bulk-update all unread messages FROM THE OTHER USER as read.
        // We never mark our own messages — `readAt` represents "the
        // recipient opened the chat", and from this caller's perspective
        // the "other user's messages" are the ones they're reading.
        const result = await prisma.directMessage.updateMany({
          where: {
            chatId,
            senderId: { not: data.userId },
            readAt: null,
            deletedAt: null,
          },
          data: { readAt: now },
        });

        const readBroadcast: DirectMessagesReadPayload = {
          chatId,
          readAt: now.toISOString(),
          readerId: data.userId,
        };
        io.to(directRoomFor(chatId)).emit(
          "direct_messages_read",
          readBroadcast,
        );
        console.log(
          `[chat-service] direct messages in ${directRoomFor(chatId)} marked read by ${data.username} (count=${result.count})`,
        );
        if (cb) cb({ ok: true, markedRead: result.count });
      } catch (e) {
        console.error("[chat-service] mark_direct_read error:", e);
        const err: ErrorResponse = { message: "خطای سرور هنگام ثبت خوانده‌شدن پیام" };
        socket.emit("error", err);
        if (cb) cb({ ok: false, error: err });
      }
    },
  );

  // ===========================================================================
  // disconnect / socket-level error
  // ===========================================================================
  socket.on("disconnect", (reason) => {
    console.log(
      `[chat-service] disconnected socket=${socket.id} user=${data.userId} reason=${reason}`,
    );
  });

  socket.on("error", (err) => {
    console.error(`[chat-service] socket error (${socket.id}):`, err);
  });
});

// ---------- Start ----------
httpServer.listen(PORT, () => {
  console.log(`[chat-service] listening on port ${PORT}`);
});

// ---------- Graceful shutdown ----------
async function shutdown(signal: string) {
  console.log(`[chat-service] ${signal} received, shutting down...`);
  io.close(() => {
    prisma
      .$disconnect()
      .catch(() => {})
      .finally(() => process.exit(0));
  });
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
