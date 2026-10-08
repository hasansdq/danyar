/**
 * Typed wrappers around the messenger REST endpoints.
 *
 * This file lives in a `.ts` module (not `.tsx`) so generic function calls
 * like `apiFetch<ClassItem[]>(url)` are NOT subject to the JSX ambiguity
 * that breaks the same syntax inside `.tsx` files.
 *
 * Components should import these helpers instead of calling `apiFetch<T>`
 * inline.
 */
import { apiFetch, apiFetchRaw, withQuery } from "@/lib/api-fetch";
import type {
  AnnouncementRecord,
  AnnouncementsResponse,
  Assignment,
  AssignmentStudent,
  BehaviorMark,
  ChatMessageWithDelete,
  ClassItem,
  ClassMember,
  ClassStudent,
  CreatePollBody,
  DirectChat,
  DirectMessageWithDelete,
  DirectMessagesResponse,
  DMSettings,
  FileSettings,
  Grade,
  GroupInfo,
  MessagesResponse,
  MyProfile,
  Poll,
  SampleQuestion,
  UserSearchResult,
  VotePollBody,
} from "@/components/messenger/types";

// ----------------- Classes -----------------

export function fetchClasses() {
  return apiFetch<ClassItem[]>(withQuery("/api/classes"));
}

export function fetchClassMembers(classId: string) {
  return apiFetch<ClassMember[]>(`/api/classes/${classId}/members`);
}

// ----------------- Messages -----------------

export function fetchMessages(params: {
  classId: string;
  cursor?: string | null;
  limit?: number;
}) {
  // Use apiFetchRaw (not apiFetch) because the messages endpoint returns
  // extra top-level fields (nextCursor, hasMore) alongside `data` that we
  // need — apiFetch would unwrap and discard them.
  return apiFetchRaw<MessagesResponse>(
    withQuery("/api/messages", {
      classId: params.classId,
      cursor: params.cursor ?? undefined,
      limit: params.limit ?? 50,
    }),
  );
}

export function postMessage(body: {
  classId: string;
  content: string;
  /** Phase 17 — when set, persists the new message as a reply to this id. */
  replyToId?: string | null;
  /**
   * Phase 19 — when set, persists the new message as a "linked card"
   * (the chat renders an assignment card bubble instead of a text bubble).
   * The Assignment row must exist AND belong to the same `classId`.
   */
  linkedAssignmentId?: string | null;
  /**
   * Phase 19 — same as `linkedAssignmentId` but for a SampleQuestion row.
   */
  linkedSampleQuestionId?: string | null;
}) {
  return apiFetch<ChatMessageWithDelete>("/api/messages", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * Upload a chat message with a file attachment via multipart/form-data.
 *
 * The server (POST /api/messages, multipart path) validates the class's file
 * settings (fileUploadEnabled, maxFileSizeMb, allowedFileTypes), saves the
 * file to /uploads/, persists a Message row with fileUrl/fileName/fileType/
 * fileSize/mimeType, and returns the created message (with sender + file
 * fields) so the caller can optimistically render + emit `relay_message`
 * via socket.io.
 *
 * We use a raw `fetch` here (NOT apiFetch) because apiFetch defaults the
 * Content-Type header to application/json — for FormData the browser must
 * set the multipart boundary itself, so we must NOT pass any Content-Type
 * header.
 *
 * On non-OK responses, throws a Persian-localized Error using the `error`
 * field returned by the API route.
 */
export async function postMessageWithFile(body: {
  classId: string;
  content?: string;
  file: File;
  /** Phase 17 — when set, persists the file message as a reply to this id. */
  replyToId?: string | null;
}): Promise<ChatMessageWithDelete> {
  const fd = new FormData();
  fd.set("classId", body.classId);
  if (body.content && body.content.trim().length > 0) {
    fd.set("content", body.content);
  }
  if (body.replyToId) {
    fd.set("replyToId", body.replyToId);
  }
  fd.set("file", body.file);

  const res = await fetch("/api/messages", {
    method: "POST",
    body: fd,
    credentials: "include",
  });

  let payload: any = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }

  if (!res.ok) {
    const message =
      (payload && (payload.error || payload.message)) ||
      `خطای سرور (${res.status})`;
    throw new Error(message);
  }

  return (payload?.data ?? payload) as ChatMessageWithDelete;
}

/**
 * Soft-delete a message by id.
 * Backend rules (enforced by Task 2-a phase-2 route):
 *   - ADMIN or TEACHER of the class → can delete any message.
 *   - STUDENT → can delete only their own message AND within 12h of createdAt.
 * Returns the updated message record (with deletedAt / deletedById).
 */
export function deleteMessage(messageId: string) {
  return apiFetch<ChatMessageWithDelete>(`/api/messages/${messageId}`, {
    method: "DELETE",
  });
}

// ----------------- Phase 17: edit / forward / readers / mark-read -----------------

/**
 * Edit the content of an existing message.
 * PATCH /api/messages/[id] body { content } — replaces the message text and
 * stamps `editedAt = now` on the row. Authorization (enforced by the backend):
 * the SENDER can edit their own message within 12h of createdAt; ADMIN /
 * SUPERADMIN can edit any message anytime.
 *
 * Returns the updated message record (with `editedAt` set). The caller is
 * expected to emit the `edit_message { messageId, content }` socket event so
 * other connected clients receive `message_edited { id, content, editedAt }`
 * and live-update their timeline.
 */
export function patchMessage(
  messageId: string,
  content: string,
) {
  return apiFetch<ChatMessageWithDelete>(`/api/messages/${messageId}`, {
    method: "PATCH",
    body: JSON.stringify({ content }),
  });
}

/**
 * Forward a message to another class. POST /api/messages/[id]/forward body
 * `{ targetClassId }` — clones the source message (text + file) into the
 * target class with the caller as the new sender + `forwardedFromId` set to
 * the source message id. Authorization mirrors the regular message-send path
 * (membership or principal-of-class).
 *
 * Returns the created message record in the target class.
 */
export function forwardMessage(
  messageId: string,
  targetClassId: string,
) {
  return apiFetch<ChatMessageWithDelete>(
    `/api/messages/${messageId}/forward`,
    {
      method: "POST",
      body: JSON.stringify({ targetClassId }),
    },
  );
}

/**
 * The shape returned by `GET /api/messages/[id]/readers` — one row per user
 * who has opened the chat (and thus seen the message). `readAt` is the
 * ISO timestamp of the read.
 */
export type MessageReader = {
  userId: string;
  fullName: string;
  username: string;
  role: string;
  avatar?: string | null;
  readAt: string;
};

/**
 * Fetch the list of users who have seen a given message.
 * GET /api/messages/[id]/readers → `{ data: MessageReader[] }`.
 * The caller passes the full list to the seen-by dialog.
 */
export function fetchMessageReaders(messageId: string) {
  return apiFetch<MessageReader[]>(`/api/messages/${messageId}/readers`);
}

/**
 * Mark ALL unread messages in a class as read for the calling user.
 * POST /api/messages/read body `{ classId }` — upserts MessageRead rows for
 * every currently-unread message in the class. The caller is ALSO expected to
 * emit `mark_read { classId }` over the socket so other connected clients can
 * live-bump their `readCount` counters on messages they sent.
 *
 * Errors are swallowed intentionally — read receipts are best-effort. If the
 * endpoint is unavailable (e.g. backend Task-2 phase-17 hasn't shipped the
 * route yet) the chat still works; only the read-counters are degraded.
 */
export async function markClassRead(
  classId: string,
): Promise<{ classId: string; markedRead: number } | null> {
  try {
    return await apiFetch<{ classId: string; markedRead: number }>(
      "/api/messages/read",
      {
        method: "POST",
        body: JSON.stringify({ classId }),
      },
    );
  } catch {
    return null;
  }
}

// ----------------- Polls -----------------

/**
 * Fetch all polls for a class (newest-first per backend convention).
 * The endpoint returns `{ data: [...] }` so apiFetch unwraps it for us.
 */
export function fetchPolls(classId: string) {
  return apiFetch<Poll[]>(withQuery("/api/polls", { classId }));
}

export function createPoll(body: CreatePollBody) {
  return apiFetch<Poll>("/api/polls", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function votePoll(pollId: string, body: VotePollBody) {
  return apiFetch<Poll>(`/api/polls/${pollId}/vote`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function closePoll(pollId: string) {
  return apiFetch<Poll>(`/api/polls/${pollId}/close`, {
    method: "POST",
  });
}

// ----------------- Chat open/close (teacher/admin) -----------------

export function closeChat(classId: string) {
  return apiFetch<{ classId: string; chatClosed: boolean }>(
    "/api/teacher/close-chat",
    {
      method: "POST",
      body: JSON.stringify({ classId }),
    },
  );
}

export function openChat(classId: string) {
  return apiFetch<{ classId: string; chatClosed: boolean }>(
    "/api/teacher/open-chat",
    {
      method: "POST",
      body: JSON.stringify({ classId }),
    },
  );
}

// ----------------- Bulk broadcast (principal / teacher) -----------------

/**
 * Response shape for `POST /api/teacher/broadcast` (multipart path).
 * The backend creates one Message row per target class — when a file is
 * attached the bytes are saved once and referenced by every created row.
 */
export interface BroadcastResult {
  count: number;
  classIds: string[];
  messages: Array<{ id: string; classId: string }>;
}

/**
 * Broadcast the same text (and optional file attachment) to a specific
 * subset of the caller's classes via POST /api/teacher/broadcast.
 *
 * Builds multipart/form-data with:
 *   - `content`   — the message text (must be non-empty when no file is
 *                  attached; can be empty when only a file is being sent)
 *   - `classIds[]` — one form field per selected class id
 *   - `file`      — optional File attachment (image / PDF / video)
 *
 * The backend filters `classIds` to those the caller is allowed to post to
 * (TEACHER → classes they teach; ADMIN → classes in their school;
 * SUPERADMIN → unscoped) and persists one Message per surviving class.
 *
 * We use a raw `fetch` (NOT apiFetch) because apiFetch defaults the
 * Content-Type to application/json — for FormData the browser must set
 * the multipart boundary itself, so we must NOT pass any Content-Type
 * header.
 */
export async function broadcastToSelected(body: {
  content: string;
  classIds: string[];
  file?: File | null;
}): Promise<BroadcastResult> {
  const fd = new FormData();
  fd.set("content", body.content);
  for (const id of body.classIds) {
    fd.append("classIds[]", id);
  }
  if (body.file) {
    fd.set("file", body.file);
  }

  const res = await fetch("/api/teacher/broadcast", {
    method: "POST",
    body: fd,
    credentials: "include",
  });

  let payload: any = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }

  if (!res.ok) {
    const message =
      (payload && (payload.error || payload.message)) ||
      `خطای سرور (${res.status})`;
    throw new Error(message);
  }

  return (payload?.data ?? payload) as BroadcastResult;
}

// ----------------- Per-class file upload settings (phase 3) -----------------

/**
 * Update the per-class file-upload settings (teacher/admin only).
 * PATCH /api/teacher/class-settings
 * Body: { classId, fileUploadEnabled?, maxFileSizeMb?, allowedFileTypes? }
 * Returns the full updated settings object.
 */
export function patchClassFileSettings(body: {
  classId: string;
  fileUploadEnabled?: boolean;
  maxFileSizeMb?: number;
  allowedFileTypes?: string[] | null;
}) {
  return apiFetch<FileSettings>("/api/teacher/class-settings", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

// ----------------- Class students -----------------

/**
 * Fetch all STUDENT members of the given class.
 * GET /api/classes/[id]/students → returns { id, fullName, username, avatarColor }[]
 */
export function fetchClassStudents(classId: string) {
  return apiFetch<ClassStudent[]>(
    `/api/classes/${classId}/students`,
  );
}

// ----------------- Assignments -----------------

export function fetchAssignments(classId: string) {
  return apiFetch<Assignment[]>(withQuery("/api/assignments", { classId }));
}

export function postAssignment(form: FormData) {
  // Phase 29 — backend now creates one Assignment PER selected class
  // (FormData carries multiple `classId` entries). The response is
  // `{ data: Assignment[] }`. Callers that pass a single `classId`
  // get back a one-element array.
  return apiFetch<Assignment[]>("/api/teacher/assignments", {
    method: "POST",
    body: form,
  });
}

/**
 * Fetch the per-student status rows for one assignment (teacher/admin only).
 * GET /api/assignments/[id]/students → { data: AssignmentStudent[] }
 */
export function fetchAssignmentStudents(assignmentId: string) {
  return apiFetch<AssignmentStudent[]>(
    `/api/assignments/${assignmentId}/students`,
  );
}

/**
 * Set a single student's status (and optional note) for an assignment.
 * POST /api/teacher/assignments/[id]/status
 * Body: { studentId, status, note? }
 */
export function setAssignmentStatus(
  assignmentId: string,
  body: {
    studentId: string;
    status: "UNCHECKED" | "DONE" | "INCOMPLETE" | "NOT_DONE";
    note?: string;
  },
) {
  return apiFetch<{ studentId: string; status: string; note?: string | null }>(
    `/api/teacher/assignments/${assignmentId}/status`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

// ----------------- Sample Questions -----------------

export function fetchSampleQuestions(classId: string) {
  return apiFetch<SampleQuestion[]>(
    withQuery("/api/sample-questions", { classId }),
  );
}

export function postSampleQuestion(form: FormData) {
  return apiFetch<SampleQuestion>("/api/teacher/sample-questions", {
    method: "POST",
    body: form,
  });
}

// ----------------- Grades -----------------

export function fetchGrades(classId: string) {
  return apiFetch<Grade[]>(withQuery("/api/grades", { classId }));
}

export function postGrade(body: {
  classId: string;
  studentId: string;
  title: string;
  score: number;
  maxScore: number;
}) {
  return apiFetch<Grade>("/api/teacher/grades", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * Bulk-create grades for one exam across multiple students in a single
 * transaction. All entries share the same `examTitle` and `maxScore`.
 *
 * POST /api/teacher/grades/bulk
 * Body: { classId, examTitle, grades: [{ studentId, score, maxScore? }] }
 * Returns: { count, grades: Grade[] }
 */
export function bulkCreateGrades(body: {
  classId: string;
  examTitle: string;
  /**
   * Shared max score for the whole exam. Type-level only: the endpoint
   * currently reads `maxScore` from each grade entry (defaulting to 20),
   * so this top-level field is sent but ignored by the API.
   */
  maxScore?: number;
  grades: Array<{
    studentId: string;
    score: number;
    maxScore?: number;
  }>;
}) {
  return apiFetch<{ count: number; grades: Grade[] }>(
    "/api/teacher/grades/bulk",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

// ----------------- Behavior marks -----------------

/**
 * Fetch the behavior marks for a class.
 *
 * GET /api/behavior?classId=... — STUDENTs get only their own marks;
 * TEACHERs/ADMINs get every student's marks in the class.
 */
export function fetchBehavior(classId: string) {
  return apiFetch<BehaviorMark[]>(withQuery("/api/behavior", { classId }));
}

/**
 * Create a behavior mark (teacher/admin only).
 *
 * POST /api/teacher/behavior
 * Body: { classId, studentId, type: "POSITIVE" | "NEGATIVE", reason, value? }
 * Returns the created mark (same shape as fetchBehavior rows).
 */
export function postBehavior(body: {
  classId: string;
  studentId: string;
  type: "POSITIVE" | "NEGATIVE";
  reason: string;
  value?: number;
}) {
  return apiFetch<BehaviorMark>("/api/teacher/behavior", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ----------------- User profile / avatar -----------------

/**
 * Fetch the currently-authenticated user's full profile (including the
 * `avatar` URL, which the NextAuth `/api/auth/session` endpoint does NOT
 * expose). Used by the profile dialog + messenger header to render the
 * avatar bubble and the user-menu row.
 */
export function fetchMyProfile() {
  return apiFetch<MyProfile>("/api/user/me");
}

/**
 * Upload a new profile picture for the current user (multipart `file` field).
 * Returns `{ id, avatar }` from the backend (the new public URL of the
 * stored image). The caller is responsible for updating local state + any
 * cached queries.
 *
 * NOTE: We use a raw `fetch` here (NOT apiFetch) because apiFetch defaults
 * Content-Type to application/json — for FormData the browser must set the
 * multipart boundary itself.
 */
export async function uploadAvatar(
  file: File,
): Promise<{ id: string; avatar: string }> {
  const fd = new FormData();
  fd.set("file", file);

  const res = await fetch("/api/user/avatar", {
    method: "POST",
    body: fd,
    credentials: "include",
  });

  let payload: any = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }

  if (!res.ok) {
    const message =
      (payload && (payload.error || payload.message)) ||
      `خطای سرور (${res.status})`;
    throw new Error(message);
  }

  return (payload?.data ?? payload) as { id: string; avatar: string };
}

/**
 * Delete the current user's profile picture (sets `avatar = null`).
 * Returns `{ id, avatar: null }`.
 */
export async function deleteAvatar(): Promise<{
  id: string;
  avatar: null;
}> {
  return apiFetch<{ id: string; avatar: null }>("/api/user/avatar", {
    method: "DELETE",
  });
}

// ----------------- User search + Direct (private) chat (phase 10) -----------------

/**
 * Search users by full name. Returns same-school users only, excluding
 * the caller. Used by the messenger header search icon to start a 1:1 DM.
 *
 * `q` should be a non-empty trimmed query; the backend may enforce a
 * minimum length and return an empty array otherwise.
 */
export function searchUsers(q: string, limit = 20) {
  return apiFetch<UserSearchResult[]>(
    withQuery("/api/users/search", { q, limit }),
  );
}

/**
 * List the caller's existing direct chats (1:1 conversations), newest-by
 * lastMessage first. Each row carries the other participant + the latest
 * message preview (or null when the chat has no messages yet).
 */
export function fetchDirectChats() {
  return apiFetch<DirectChat[]>("/api/direct-chats");
}

/**
 * Create (or return, if it already exists) a 1:1 direct chat with the
 * given user. The backend canonicalises the pair (A<B by cuid sort) so
 * duplicates are impossible. The server returns 403 when DM permission
 * is denied by the principal's per-school toggles — apiFetch rethrows
 * the server's Persian error message in that case.
 */
export function createDirectChat(body: { userId: string }) {
  return apiFetch<DirectChat>("/api/direct-chats", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * Fetch the message history of a direct chat (newest-first, paginated by
 * cursor). Mirrors the class `fetchMessages` envelope so callers can use
 * the same `nextCursor`/`hasMore` pagination pattern.
 */
export function fetchDirectMessages(params: {
  chatId: string;
  cursor?: string | null;
  limit?: number;
}) {
  return apiFetchRaw<DirectMessagesResponse>(
    withQuery("/api/direct-messages", {
      chatId: params.chatId,
      cursor: params.cursor ?? undefined,
      limit: params.limit ?? 50,
    }),
  );
}

/**
 * Send a direct message with an optional file attachment (multipart/form-data).
 * Mirrors the class `postMessageWithFile` helper — but for DMs the file is
 * optional (text-only messages still go through the multipart path uniformly
 * so the server has one entry point). The server validates the school's
 * DM-permission toggles (server-side) and persists the DirectMessage row;
 * the caller is responsible for emitting `relay_direct_message` over
 * socket.io so the other participant gets it in real-time.
 *
 * We use a raw `fetch` (NOT apiFetch) because apiFetch defaults the
 * Content-Type to application/json — for FormData the browser must set
 * the multipart boundary itself, so we must NOT pass any Content-Type.
 *
 * On non-OK responses, throws a Persian-localized Error using the `error`
 * field returned by the API route.
 */
export async function postDirectMessageWithFile(body: {
  chatId: string;
  content?: string;
  file?: File | null;
}): Promise<DirectMessageWithDelete> {
  const fd = new FormData();
  fd.set("chatId", body.chatId);
  if (body.content && body.content.trim().length > 0) {
    fd.set("content", body.content);
  }
  if (body.file) {
    fd.set("file", body.file);
  }

  const res = await fetch("/api/direct-messages", {
    method: "POST",
    body: fd,
    credentials: "include",
  });

  let payload: any = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }

  if (!res.ok) {
    const message =
      (payload && (payload.error || payload.message)) ||
      `خطای سرور (${res.status})`;
    throw new Error(message);
  }

  // Phase 35c fix: the POST /api/direct-messages response shape is
  // { data: { message: DirectMessageWithDelete, chatId, otherUserId } }
  // — the message is nested inside `data.message`, not at `data` itself.
  // Previously we returned `payload.data` (the wrapper object) which caused
  // `created.id` / `created.createdAt` to be undefined downstream →
  // "Cannot read properties of undefined (reading 'getTime')" crash when
  // formatPersianDate received undefined.
  const data = payload?.data ?? payload;
  const message = data?.message ?? data;
  return message as DirectMessageWithDelete;
}

/**
 * Soft-delete a direct message by id.
 *
 * Backend rules (phase-10):
 *   - The SENDER can delete their own message within 12h of createdAt.
 *   - The OTHER participant can delete any message in their own DM
 *     (it's their private conversation — they own what shows in it).
 *   - SUPERADMIN can delete any direct message.
 *
 * Returns the updated message record (with deletedAt / deletedById).
 */
export function deleteDirectMessage(messageId: string) {
  return apiFetch<DirectMessageWithDelete>(
    `/api/direct-messages/${messageId}`,
    {
      method: "DELETE",
    },
  );
}

// ----------------- Principal DM-settings (phase 10) -----------------

/**
 * Read the principal's school-level DM-permission toggles. Falls back to
 * the schema defaults (all true) when the backend hasn't populated the
 * row yet — so the dialog can still render its switches as "on" without
 * a successful fetch.
 *
 * Returns `null` (instead of throwing) when the endpoint is unavailable
 * (404 / 403 / network) — the caller can render with defaults and only
 * PATCH on toggle.
 */
export async function fetchDMSettings(): Promise<DMSettings | null> {
  try {
    return await apiFetch<DMSettings>("/api/teacher/dm-settings");
  } catch {
    return null;
  }
}

/**
 * Update the principal's school-level DM-permission toggles. Sends only
 * the fields the caller passes (so toggling one switch doesn't clobber
 * the others). Returns the full updated snapshot.
 *
 * `principal↔teacher` is always enabled — no field, no toggle. The dialog
 * makes that visually clear with a "همیشه فعال" note.
 */
export function patchDMSettings(body: Partial<DMSettings>) {
  return apiFetch<DMSettings>("/api/teacher/dm-settings", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

// ----------------- Direct chat read receipts (phase 11) -----------------

/**
 * Mark all unread messages from the OTHER participant in a direct chat as
 * read. Called by the DirectChat view once when the chat is first viewed
 * (and optionally again when new messages arrive while viewing).
 *
 * POST /api/direct-chats/[id]/read → { data: { chatId, markedRead } }
 *
 * The caller is ALSO expected to emit the `mark_direct_read { chatId }`
 * socket event so the OTHER participant's open chat can live-flip the
 * SENDER's ticks to blue ✓✓.
 *
 * Errors are swallowed intentionally — read receipts are best-effort. If
 * the endpoint is unavailable (e.g. backend Task-2 not yet deployed) the
 * chat still works; only the blue-tick affordance is degraded.
 */
export async function markDirectChatRead(
  chatId: string,
): Promise<{ chatId: string; markedRead: number } | null> {
  try {
    return await apiFetch<{ chatId: string; markedRead: number }>(
      `/api/direct-chats/${chatId}/read`,
      { method: "POST" },
    );
  } catch {
    return null;
  }
}

// ----------------- Phase 18: save / unsave message -----------------

/**
 * Save (bookmark) a message for the calling user. POST
 * `/api/messages/[id]/save` (no body) — the backend creates a
 * `SavedMessage` row keyed by (messageId, userId) and returns the
 * updated message snapshot so the caller can flip its `isSaved` flag
 * and `savedCount` counter locally.
 *
 * Idempotent — saving an already-saved message is a no-op (the backend
 * returns 200 with the current snapshot rather than 409).
 */
export function saveMessage(messageId: string) {
  return apiFetch<ChatMessageWithDelete>(
    `/api/messages/${messageId}/save`,
    { method: "POST" },
  );
}

/**
 * Unsave (remove the bookmark) a message for the calling user. DELETE
 * `/api/messages/[id]/save` — the backend removes the `SavedMessage`
 * row and returns the updated message snapshot.
 *
 * Idempotent — unsaving a not-saved message is a no-op.
 */
export function unsaveMessage(messageId: string) {
  return apiFetch<ChatMessageWithDelete>(
    `/api/messages/${messageId}/save`,
    { method: "DELETE" },
  );
}

// ----------------- Phase 18: group info + avatar -----------------

/**
 * Fetch the full group info + members list. GET
 * `/api/classes/[id]/info` → `{ data: GroupInfo }`. Authorization:
 * the caller must be a member of the class OR a principal of the
 * school that owns it OR SUPERADMIN.
 *
 * Used by the GroupInfoDialog to render the avatar / name / description
 * editor + the members list + the add-member search (which uses the
 * same response's `members` to skip users already enrolled).
 */
export function fetchGroupInfo(classId: string) {
  return apiFetch<GroupInfo>(`/api/classes/${classId}/info`);
}

/**
 * Update the group's name and/or description. PATCH
 * `/api/classes/[id]/info` body `{ name?, description? }` → returns the
 * updated GroupInfo snapshot. Authorization: ADMIN (principal) of the
 * school that owns the class OR SUPERADMIN. Teachers / students can
 * view but not edit.
 *
 * The caller should pass only the fields the user actually changed so
 * a name edit doesn't clobber the description (and vice versa).
 */
export function patchGroupInfo(
  classId: string,
  body: { name?: string; description?: string | null },
) {
  return apiFetch<GroupInfo>(`/api/classes/${classId}/info`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

/**
 * Upload a new group avatar image (multipart `file` field). POST
 * `/api/classes/[id]/avatar` → returns `{ data: { id, avatar } }` with
 * the new public URL of the stored image. The caller is responsible
 * for updating local state + any cached queries.
 *
 * Uses a raw `fetch` (NOT apiFetch) because apiFetch defaults
 * Content-Type to application/json — for FormData the browser must set
 * the multipart boundary itself.
 */
export async function uploadGroupAvatar(
  classId: string,
  file: File,
): Promise<{ id: string; avatar: string }> {
  const fd = new FormData();
  fd.set("file", file);

  const res = await fetch(`/api/classes/${classId}/avatar`, {
    method: "POST",
    body: fd,
    credentials: "include",
  });

  let payload: any = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }

  if (!res.ok) {
    const message =
      (payload && (payload.error || payload.message)) ||
      `خطای سرور (${res.status})`;
    throw new Error(message);
  }

  return (payload?.data ?? payload) as { id: string; avatar: string };
}

/**
 * Delete the group's avatar image (sets `avatar = null`). DELETE
 * `/api/classes/[id]/avatar` → returns `{ data: { id, avatar: null } }`.
 */
export async function deleteGroupAvatar(
  classId: string,
): Promise<{ id: string; avatar: null }> {
  return apiFetch<{ id: string; avatar: null }>(
    `/api/classes/${classId}/avatar`,
    { method: "DELETE" },
  );
}

// ----------------- Phase 18: announcements list -----------------

/**
 * Fetch the principal's sent announcements (newest-first, paginated).
 * GET `/api/teacher/announcements` → `{ data: AnnouncementRecord[],
 * nextCursor?, hasMore? }`.
 *
 * Use `apiFetchRaw` (not apiFetch) because the response carries
 * `nextCursor` + `hasMore` alongside `data` that we need to read for
 * the "load more" affordance.
 *
 * Errors are caught by the TanStack Query consumer in the
 * AnnouncementsSheet — the sheet falls back to an empty list + a
 * "تلاش مجدد" button.
 */
export function fetchAnnouncements(params: {
  cursor?: string | null;
  limit?: number;
}) {
  return apiFetchRaw<AnnouncementsResponse>(
    withQuery("/api/teacher/announcements", {
      cursor: params.cursor ?? undefined,
      limit: params.limit ?? 30,
    }),
  );
}

/**
 * Send a new announcement to one or more classes (principal/teacher
 * only). POST `/api/teacher/announce` (multipart/form-data) with:
 *   - `content`   — the announcement text (must be non-empty when no
 *                  file is attached; can be empty when only a file is
 *                  being sent)
 *   - `classIds`  — one form field per selected class id (sent as
 *                  repeated `classIds` field for the backend's multer
 *                  array parser)
 *   - `file`      — optional File attachment (image / PDF / video)
 *
 * Returns the broadcast result so the caller can toast the count and
 * refresh the announcements list.
 *
 * Uses a raw `fetch` (NOT apiFetch) because apiFetch defaults
 * Content-Type to application/json — for FormData the browser must set
 * the multipart boundary itself.
 */
export async function postAnnouncement(body: {
  content: string;
  classIds: string[];
  file?: File | null;
}): Promise<{ count: number; classIds: string[] }> {
  const fd = new FormData();
  fd.set("content", body.content);
  for (const id of body.classIds) {
    fd.append("classIds", id);
  }
  if (body.file) {
    fd.set("file", body.file);
  }

  const res = await fetch("/api/teacher/announce", {
    method: "POST",
    body: fd,
    credentials: "include",
  });

  let payload: any = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }

  if (!res.ok) {
    const message =
      (payload && (payload.error || payload.message)) ||
      `خطای سرور (${res.status})`;
    throw new Error(message);
  }

  const data = payload?.data ?? payload;
  return {
    count: typeof data?.count === "number" ? data.count : (data?.classIds?.length ?? 0),
    classIds: Array.isArray(data?.classIds) ? data.classIds : [],
  };
}

/**
 * Re-export the AnnouncementRecord type so callers can import it from
 * the messenger-api module without a separate import line.
 */
export type { AnnouncementRecord };

// ----------------- Saved Messages -----------------

export type SavedMessage = {
  id: string;
  content: string;
  createdAt: string;
  sender: { id: string; fullName: string; role: string };
  class: { id: string; name: string };
  fileUrl?: string | null;
  fileName?: string | null;
  fileType?: string | null;
  savedAt: string;
};

export function fetchSavedMessages() {
  return apiFetch<SavedMessage[]>("/api/messages/saved");
}
