/**
 * Shared types for the messenger frontend.
 */

/**
 * Roles used across the messenger UI. SUPERADMIN is included because
 * superadmins can open the messenger (and join/start classroom sessions),
 * so role comparisons like `role === "SUPERADMIN"` must type-check.
 */
export type Role = "STUDENT" | "TEACHER" | "ADMIN" | "SUPERADMIN";

export type MessengerUser = {
  id: string;
  username: string;
  name: string;
  role: Role;
  avatarColor?: string | null;
  avatar?: string | null;
  /** School id (ADMIN principals / teachers / students) or null for SUPERADMIN. */
  schoolId?: string | null;
  /** School name for the "دانیار <schoolName>" branding in the header. */
  schoolName?: string | null;
};

export type ClassItem = {
  id: string;
  name: string;
  description?: string | null;
  gradeLevel?: string | null;
  /**
   * شعبه (e.g. "الف", "ب") — class section/branch. Returned by
   * `GET /api/classes`; optional so older backends / older consumers
   * keep working without it.
   */
  section?: string | null;
  createdAt: string;
  /**
   * Phase 16 — when set, this ClassRoom is a "group" (chat) inside the
   * parent class. `null` (or `undefined` for older backends) means a
   * top-level class. The create-group dialog uses this to filter the
   * parent-class dropdown to only top-level classes.
   */
  parentClassId?: string | null;
  /**
   * Phase 18 — public URL of the group's uploaded avatar image (or null
   * when no avatar is set). Returned by `GET /api/classes`. Optional
   * so older backends that haven't shipped the field keep working —
   * the renderer treats it as "no avatar" → falls back to the
   * letter-bubble ChatAvatar.
   */
  avatar?: string | null;
  /**
   * Per-class role of the calling user. STUDENT/TEACHER come from the
   * ClassMembership row; "ADMIN" is synthesized by the backend for a
   * school principal (so they can chat in any class in their school
   * without being a member there) — the messenger UI treats ADMIN the
   * same as a teacher/moderator.
   */
  role: "STUDENT" | "TEACHER" | "ADMIN";
  memberCount: number;
  chatClosed?: boolean;
  // Per-class file-upload settings (phase-3). Optional because older API
  // responses may not include them yet; consumers should fall back to the
  // schema defaults (enabled=true, maxFileSizeMb=10, allowedFileTypes=null).
  fileUploadEnabled?: boolean;
  maxFileSizeMb?: number;
  allowedFileTypes?: string[] | null;
  /** Phase 35b — per-group streaming (online class) toggle. Default false
   * — a TEACHER must explicitly enable it via the header icon before the
   * FAB appears. When false, the FAB + header toggle are hidden. */
  streamingEnabled?: boolean;
  /** Phase 36j — true when there's an active (live) ClassroomSession for
   * this class (a teacher has started the stream). The conversation list
   * shows a "کلاس ویدئویی فعال" icon on rows where this is true. */
  streamingActive?: boolean;
  /** Phase 35b — per-school streaming flag. When false, streaming is fully
   * disabled in the school — the FAB + header toggle are hidden from ALL
   * groups regardless of the per-group flag. Included on every class item
   * for convenience (it's the same for all classes of the same school). */
  schoolStreamingEnabled?: boolean;
  latestMessage?: {
    content: string;
    createdAt: string;
    sender: {
      id: string;
      fullName: string;
      username: string;
      role: string;
      avatar?: string | null;
    };
  } | null;
};

export type ApiUser = {
  id: string;
  fullName: string;
  username: string;
  role: string;
  avatar?: string | null;
};

/**
 * Shape returned by `GET /api/user/me` — the currently-authenticated
 * user's full public profile, including the uploaded `avatar` URL and the
 * deterministic `avatarColor` (for the letter-bubble fallback).
 */
export type MyProfile = {
  id: string;
  username: string;
  fullName: string;
  role: string;
  avatar: string | null;
  avatarColor: string | null;
  schoolId: string | null;
};

export type ChatMessage = {
  id: string;
  classId: string;
  content: string;
  createdAt: string;
  sender: {
    id: string;
    fullName: string;
    role: string;
    username: string;
    avatar?: string | null;
  };
  // senderId is present on socket new_message payloads + REST responses
  // (the socket shape flattens the sender to senderId/senderName/senderRole
  // instead of an object). Optional so plain JSON-only callers don't need it.
  senderId?: string;
  // File attachment fields. Present on every message from the REST/socket
  // API (null for plain text messages) so the renderer can use a single
  // shape. Optional so historical text-only messages still type-check.
  fileUrl?: string | null;
  fileName?: string | null;
  fileType?: string | null; // "image" | "pdf" | "video" | "file" | null
  fileSize?: number | null;
  mimeType?: string | null;
};

export type ChatMessageWithDelete = ChatMessage & {
  deletedAt?: string | null;
  deletedById?: string | null;
  isAnnouncement?: boolean;
  // ---- Phase 17: message options metadata ----
  /**
   * Id of the message this one is replying to (null/undefined when not a reply).
   * Populated by GET /api/messages. Socket `new_message` broadcasts may omit it
   * (the chat-service normalizes the payload); the renderer falls back to
   * undefined → no quote preview.
   */
  replyToId?: string | null;
  /**
   * Id of the original message this one was forwarded from
   * (null/undefined when not a forward).
   */
  forwardedFromId?: string | null;
  /**
   * ISO timestamp of when the message was last edited
   * (null/undefined when never edited).
   */
  editedAt?: string | null;
  /**
   * Preview of the replied-to message (sender + truncated content). Included
   * by GET /api/messages when `replyToId` is set; absent on socket broadcasts.
   */
  replyTo?: {
    id: string;
    content: string;
    sender: { id: string; fullName: string; role: string };
  } | null;
  /**
   * Number of MessageRead rows for this message (i.e. how many users have
   * seen it). Populated by GET /api/messages via Prisma's `_count.reads`.
   * Defaults to 0 on socket broadcasts.
   */
  readCount?: number;
  /**
   * Phase 18 — whether the calling user has SAVED this message (a
   * personal bookmark). Populated by GET /api/messages via a join on the
   * SavedMessage table. Optional so older backends that haven't shipped
   * the field keep working — the renderer treats `undefined` as "not
   * saved" so the menu item label / icon reflect that.
   */
  isSaved?: boolean;
  /**
   * Phase 18 — total number of users who have saved this message.
   * Populated by GET /api messages via `_count.savedBy`. Drives the
   * "N ذخیره" badge in the context-menu item label. Defaults to 0 on
   * socket broadcasts.
   */
  savedCount?: number;
  // ---- Phase 19: linked assignment / sample-question card metadata ----
  /**
   * Id of the Assignment this message is linked to (forward-to-chat flow).
   * When set, the chat renders a bordered "card" bubble (assignment icon +
   * title + due date + "مشاهده تکلیف" button) instead of a text bubble.
   * Null/undefined for plain text messages. Persisted on the Message row
   * via the `linkedAssignmentId` foreign key.
   */
  linkedAssignmentId?: string | null;
  /**
   * Id of the SampleQuestion this message is linked to. Same semantics
   * as `linkedAssignmentId` but for sample questions.
   */
  linkedSampleQuestionId?: string | null;
  /**
   * Nested Assignment snapshot joined by GET /api/messages (and POST's
   * created-message response). The chat card uses `title`, `dueDate`,
   * `fileUrl`, and `fileName` from this object. Optional so older
   * backends / socket broadcasts that haven't shipped the field keep
   * working — the renderer treats `null`/`undefined` as "no card".
   */
  linkedAssignment?: {
    id: string;
    title: string;
    dueDate?: string | null;
    fileUrl?: string | null;
    fileName?: string | null;
  } | null;
  /**
   * Nested SampleQuestion snapshot. Same shape idea as
   * `linkedAssignment` but without the `dueDate` field (sample questions
   * have no due date).
   */
  linkedSampleQuestion?: {
    id: string;
    title: string;
    fileUrl?: string | null;
    fileName?: string | null;
  } | null;
};

export type MessagesResponse = {
  data: ChatMessageWithDelete[];
  nextCursor: string | null;
  hasMore: boolean;
};

/**
 * Per-student status of an assignment, set by the teacher (or admin) per
 * student. Stored on the AssignmentSubmission row.
 *   - UNCHECKED  → بررسی نشده (default; teacher has not reviewed yet)
 *   - DONE       → انجام شده
 *   - INCOMPLETE → ناقص
 *   - NOT_DONE   → انجام نشده
 */
export type AssignmentStatus = "UNCHECKED" | "DONE" | "INCOMPLETE" | "NOT_DONE";

export type Assignment = {
  id: string;
  classId: string;
  title: string;
  description?: string | null;
  dueDate?: string | null;
  fileName?: string | null;
  fileUrl?: string | null;
  fileSize?: number | null;
  createdAt: string;
  createdBy: ApiUser;
  // Phase-4 additions:
  //  - `class` is included by the redesigned GET /api/assignments response
  //    (id / name / section). Optional so older clients keep working.
  //  - `myStatus` is the calling STUDENT's status on this assignment.
  //  - `submissionCounts` is the per-status tally for TEACHERS.
  class?: { id: string; name: string; section?: string | null };
  myStatus?: AssignmentStatus | null;
  submissionCounts?: {
    UNCHECKED: number;
    DONE: number;
    INCOMPLETE: number;
    NOT_DONE: number;
  };
};

/**
 * A student row in the teacher's per-assignment student-list dialog.
 * Returned by GET /api/assignments/[id]/students. `status` is the
 * student's current status on the assignment (defaults to UNCHECKED if
 * the student has no submission row yet).
 */
export type AssignmentStudent = {
  id: string;
  fullName: string;
  username: string;
  status: AssignmentStatus;
  note?: string | null;
  updatedAt?: string | null;
};

export type SampleQuestion = {
  id: string;
  classId: string;
  title: string;
  description?: string | null;
  fileName?: string | null;
  fileUrl?: string | null;
  createdAt: string;
  createdBy: ApiUser;
};

export type Grade = {
  id: string;
  classId: string;
  studentId: string;
  student: { id: string; fullName: string; username: string };
  title: string;
  score: number;
  maxScore: number;
  createdAt: string;
  createdBy?: ApiUser;
};

/**
 * A behavior mark row from `GET /api/behavior?classId=...` and the row
 * created by `POST /api/teacher/behavior`. Mirrors the API response shape:
 * { id, classId, studentId, student, type, reason, value, createdAt, createdBy }.
 */
export type BehaviorMark = {
  id: string;
  classId: string;
  studentId: string;
  student: { id: string; fullName: string; username: string };
  /** POSITIVE marks add points; NEGATIVE marks subtract them. */
  type: "POSITIVE" | "NEGATIVE";
  reason: string;
  value: number;
  createdAt: string;
  createdBy?: { id: string; fullName: string; username: string };
};

export type ClassMember = {
  id: string; // membership id
  classId?: string;
  userId: string;
  username: string;
  fullName: string;
  role: string; // membership role (STUDENT/TEACHER)
  userRole?: string; // user-level role (STUDENT/TEACHER/ADMIN)
  createdAt?: string;
};

// ----------------- Phase 18: Group info + announcements -----------------

/**
 * A member row in the `GET /api/classes/[id]/info` response. Mirrors the
 * ClassMember shape but with the user's avatar + avatarColor included so
 * the group-info dialog can render the member row without a second fetch.
 */
export type GroupMember = {
  userId: string;
  fullName: string;
  username: string;
  role: string; // membership role (STUDENT/TEACHER)
  userRole?: string; // user-level role (STUDENT/TEACHER/ADMIN)
  avatar?: string | null;
  avatarColor?: string | null;
  createdAt?: string;
};

/**
 * Response shape for `GET /api/classes/[id]/info`. Returns the full group
 * record (id / name / description / avatar / parent class info) + the
 * members list. Used by the GroupInfoDialog.
 */
export type GroupInfo = {
  id: string;
  name: string;
  description?: string | null;
  gradeLevel?: string | null;
  section?: string | null;
  parentClassId?: string | null;
  parentClassName?: string | null;
  avatar?: string | null;
  createdAt: string;
  memberCount: number;
  members: GroupMember[];
};

/**
 * A row in the `GET /api/teacher/announcements` response — one
 * announcement message (one per target class it was sent to). The same
 * `content` may appear multiple times (one per class). The list is
 * paginated + newest-first.
 *
 * Phase 22 update: now also carries `recipientCount` (members in the
 * target class — for the "X نفر دریافت کردند" badge) + `readCount`
 * (distinct members who have a MessageRead row for this message).
 */
export type AnnouncementRecord = {
  id: string;
  content: string;
  createdAt: string;
  classId: string;
  className: string;
  classSection?: string | null;
  senderId: string;
  senderFullName: string;
  senderRole?: string;
  senderUsername?: string;
  senderAvatar?: string | null;
  fileUrl?: string | null;
  fileName?: string | null;
  fileType?: string | null;
  fileSize?: number | null;
  recipientCount?: number;
  readCount?: number;
};

/** Paginated response shape returned by `GET /api/teacher/announcements`. */
export type AnnouncementsResponse = {
  data: AnnouncementRecord[];
  nextCursor?: string | null;
  hasMore?: boolean;
};

/**
 * A STUDENT user enrolled in a class. Returned by
 * GET /api/classes/[id]/students.
 */
export type ClassStudent = {
  id: string; // user id
  fullName: string;
  username: string;
  avatarColor?: string | null;
};

// ----------------- Polls -----------------

export type PollOption = { text: string; votes: number };

export type Poll = {
  id: string;
  classId: string;
  question: string;
  options: string[]; // the raw option texts
  multipleChoice: boolean;
  createdAt: string;
  createdBy: { id: string; fullName: string; role: string };
  closedAt: string | null;
  optionVotes: number[]; // votes per option index
  totalVotes: number;
  myVote: number | number[] | null; // optionIndex for single, array for multiple
};

export type CreatePollBody = {
  classId: string;
  question: string;
  options: string[];
  multipleChoice?: boolean;
};

export type VotePollBody =
  | { optionIndex: number }
  | { optionIndexes: number[] };

// ----------------- Per-class file upload settings (phase 3) -----------------

/**
 * The three file-category buckets a class may allow in chat uploads.
 * The backend stores a JSON array of these strings (or `null` = all allowed).
 */
export type FileCategory = "image" | "pdf" | "video" | "audio" | "file";

/**
 * Per-class file-upload settings. Mirrors the schema on ClassRoom:
 *   - fileUploadEnabled — master toggle
 *   - maxFileSizeMb     — 0 = unlimited
 *   - allowedFileTypes  — null = all categories allowed
 */
export type FileSettings = {
  fileUploadEnabled: boolean;
  maxFileSizeMb: number;
  allowedFileTypes: string[] | null;
};

// ----------------- Direct (private) chat (phase 10) -----------------

/**
 * A user row in the user-search results. Returned by
 * `GET /api/users/search?q=...`. Same-school only; excludes the caller.
 */
export type UserSearchResult = {
  id: string;
  fullName: string;
  username: string;
  role: string;
  avatar?: string | null;
  schoolId?: string | null;
};

/**
 * The "other user" summary embedded in a DirectChat record. Same shape as
 * the search result (so the search dialog can hand a result directly into
 * `setActiveDirectChat` without remapping).
 */
export type DirectChatUser = {
  id: string;
  fullName: string;
  username: string;
  role: string;
  avatar?: string | null;
};

/**
 * A direct (1:1) chat record. Returned by `GET /api/direct-chats` and
 * `POST /api/direct-chats`. The `otherUser` is the participant who is NOT
 * the calling user; `lastMessage` is null when the chat has no messages
 * yet (just-created).
 *
 * Phase 11 additions:
 *  - `unreadCount` — number of unread messages FROM the other user (0 when
 *    the chat is fully read or when the backend doesn't compute it yet).
 *    Optional so older API responses (without the field) default to 0.
 *  - `lastMessage.isRead` — true when the SENDER's own last message has
 *    been read by the other participant (drives the WhatsApp ✓✓ blue tick
 *    on the conversation list row). Optional — falls back to checking
 *    `readAt` when the backend didn't synthesize it.
 */
export type DirectChat = {
  id: string;
  otherUser: DirectChatUser;
  lastMessage: {
    content: string;
    createdAt: string;
    senderId: string;
    isRead?: boolean | null;
    readAt?: string | null;
  } | null;
  unreadCount?: number;
  createdAt?: string;
  lastMessageAt?: string;
};

/**
 * A direct-message row. Same shape as the class Message but with `chatId`
 * instead of `classId`, and an optional `senderId` flat field for the
 * socket payload shape.
 *
 * Phase 11: `readAt` is set by the backend when the recipient opens the
 * chat (POST /api/direct-chats/[id]/read). Null/undefined = unread by the
 * recipient; the SENDER's UI uses this to flip its single ✓ to a blue ✓✓.
 */
export type DirectMessage = {
  id: string;
  chatId: string;
  content: string;
  createdAt: string;
  sender: {
    id: string;
    fullName: string;
    role: string;
    username: string;
    avatar?: string | null;
  };
  senderId?: string;
  readAt?: string | null;
  fileUrl?: string | null;
  fileName?: string | null;
  fileType?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
};

export type DirectMessageWithDelete = DirectMessage & {
  deletedAt?: string | null;
  deletedById?: string | null;
};

export type DirectMessagesResponse = {
  data: DirectMessageWithDelete[];
  nextCursor: string | null;
  hasMore: boolean;
};

/**
 * Per-school DM-permission toggles managed by the principal. Returned by
 * the dm-settings endpoints. `principal↔teacher` is always enabled and
 * has no toggle.
 */
export type DMSettings = {
  dmTeacherStudent: boolean;
  dmStudentStudent: boolean;
  dmPrincipalStudent: boolean;
};
