/**
 * Typed client wrappers for the SUPERADMIN CMS API.
 *
 * All calls go through `apiFetch` (auto-unwraps `{ data: ... }`, throws
 * Persian-friendly errors on non-OK, sends credentials).
 *
 * Backend (Task 3 rebuild) provides:
 *   GET    /api/permissions                       → { data: Permissions }
 *   GET    /api/permissions/me                     → { data: { role, permissions } }
 *   GET    /api/superadmin/stats                   → { data: SuperAdminStats }
 *   GET    /api/superadmin/users                   → { data: PaginatedUsers }
 *   POST   /api/superadmin/users                   → { data: UserDetail }
 *   GET    /api/superadmin/users/[id]              → { data: UserDetail }
 *   PATCH  /api/superadmin/users/[id]              → { data: UserDetail }
 *   DELETE /api/superadmin/users/[id]              → { data: { ok: true } }
 *   GET    /api/superadmin/classes                 → { data: PaginatedClasses }
 *   POST   /api/superadmin/classes                 → { data: ClassDetail }
 *   GET    /api/superadmin/classes/[id]            → { data: ClassDetail }
 *   PATCH  /api/superadmin/classes/[id]            → { data: ClassDetail }
 *   DELETE /api/superadmin/classes/[id]            → { data: { ok: true } }
 *   POST   /api/superadmin/enroll                  → { data: EnrollResult }
 *   DELETE /api/superadmin/enroll                   → { data: { removed: number } }
 *   GET    /api/superadmin/permissions             → { data: Permissions }
 *   PATCH  /api/superadmin/permissions             → { data: Permissions }
 *   POST   /api/superadmin/permissions/reset       → { data: Permissions }
 */
import { apiFetch, withQuery } from "@/lib/api-fetch";
import type { Permissions } from "@/lib/permissions";
import type { SiteSettings } from "@/lib/site-settings";

export type SuperAdminRole = "STUDENT" | "TEACHER" | "ADMIN" | "SUPERADMIN";

export interface SuperAdminUserListItem {
  id: string;
  username: string;
  fullName: string;
  role: SuperAdminRole;
  phone: string | null;
  avatar?: string | null;
  schoolId?: string | null;
  // Phase 36i — school info (for the school column in the users table).
  school?: { id: string; name: string } | null;
  createdAt: string;
  _count?: { memberships: number };
}

export interface PaginatedSuperAdminUsers {
  items: SuperAdminUserListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface SuperAdminUserInput {
  username: string;
  password?: string;
  fullName: string;
  role: SuperAdminRole;
  phone?: string;
}

export interface SuperAdminClassListItem {
  id: string;
  name: string;
  description: string | null;
  gradeLevel: string | null;
  section: string | null;
  createdAt: string;
  studentCount: number;
  teacherCount: number;
}

export interface PaginatedSuperAdminClasses {
  items: SuperAdminClassListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface SuperAdminClassMemberUser {
  id: string;
  username: string;
  fullName: string;
  role: string;
  phone: string | null;
}

export interface SuperAdminClassMember {
  id: string;
  userId: string;
  role: "STUDENT" | "TEACHER";
  createdAt: string;
  user: SuperAdminClassMemberUser;
}

export interface SuperAdminClassDetail {
  id: string;
  name: string;
  description: string | null;
  gradeLevel: string | null;
  section: string | null;
  createdAt: string;
  updatedAt: string;
  studentCount: number;
  teacherCount: number;
  memberships: SuperAdminClassMember[];
  fileUploadEnabled?: boolean;
  maxFileSizeMb?: number;
  allowedFileTypes?: string[] | null;
}

export interface SuperAdminClassInput {
  name: string;
  description?: string | null;
  gradeLevel?: string | null;
  section?: string | null;
}

export interface SuperAdminStats {
  totalUsers: number;
  totalStudents: number;
  totalTeachers: number;
  totalAdmins: number;
  totalSuperAdmins: number;
  totalClasses: number;
  totalSchools: number;
  totalMessages: number;
  totalAssignments: number;
  totalSampleQuestions: number;
  totalGrades: number;
  totalBehaviors: number;
  totalPolls: number;
  recentUsers: Array<{
    id: string;
    username: string;
    fullName: string;
    role: SuperAdminRole;
    createdAt: string;
  }>;
  recentClasses: Array<{
    id: string;
    name: string;
    gradeLevel: string | null;
    section: string | null;
    createdAt: string;
    _count: { memberships: number };
  }>;
}

export interface EnrollResult {
  newlyEnrolled: number;
  roleUpdated: number;
  alreadyEnrolled: number;
  invalidUserIds: string[];
}

export interface EnrollPayload {
  classId: string;
  userIds: string[];
  role: "STUDENT" | "TEACHER";
}

export interface MyPermissionsResponse {
  role: SuperAdminRole;
  permissions: Record<string, boolean>;
}

/* ------------------------------------------------------------------ */
/* Permissions /api/permissions + /api/permissions/me                  */
/* ------------------------------------------------------------------ */

export function getAllPermissions(): Promise<Permissions> {
  return apiFetch<Permissions>("/api/permissions");
}

export function getMyPermissions(): Promise<MyPermissionsResponse> {
  return apiFetch<MyPermissionsResponse>("/api/permissions/me");
}

/* ------------------------------------------------------------------ */
/* Stats                                                                */
/* ------------------------------------------------------------------ */

export function getSuperAdminStats(): Promise<SuperAdminStats> {
  return apiFetch<SuperAdminStats>("/api/superadmin/stats");
}

/* ------------------------------------------------------------------ */
/* Users                                                                */
/* ------------------------------------------------------------------ */

export interface ListUsersParams {
  page?: number;
  pageSize?: number;
  role?: "ALL" | SuperAdminRole;
  search?: string;
  schoolId?: string;
}

export function listSuperAdminUsers(params: ListUsersParams = {}) {
  const url = withQuery("/api/superadmin/users", {
    page: params.page ?? 1,
    pageSize: params.pageSize ?? 20,
    role: params.role === "ALL" ? undefined : params.role,
    search: params.search?.trim() || undefined,
    schoolId: params.schoolId || undefined,
  });
  return apiFetch<PaginatedSuperAdminUsers>(url);
}

export function createSuperAdminUser(input: SuperAdminUserInput) {
  return apiFetch<SuperAdminUserListItem>("/api/superadmin/users", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateSuperAdminUser(
  id: string,
  input: Partial<SuperAdminUserInput>,
) {
  return apiFetch<SuperAdminUserListItem>(`/api/superadmin/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteSuperAdminUser(id: string) {
  return apiFetch<{ ok: true }>(`/api/superadmin/users/${id}`, {
    method: "DELETE",
  });
}

/* ------------------------------------------------------------------ */
/* Classes                                                              */
/* ------------------------------------------------------------------ */

export interface ListClassesParams {
  page?: number;
  pageSize?: number;
  search?: string;
}

export function listSuperAdminClasses(params: ListClassesParams = {}) {
  const url = withQuery("/api/superadmin/classes", {
    page: params.page ?? 1,
    pageSize: params.pageSize ?? 20,
    search: params.search?.trim() || undefined,
  });
  return apiFetch<PaginatedSuperAdminClasses>(url);
}

export function createSuperAdminClass(input: SuperAdminClassInput) {
  return apiFetch<SuperAdminClassDetail>("/api/superadmin/classes", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateSuperAdminClass(
  id: string,
  input: Partial<SuperAdminClassInput>,
) {
  return apiFetch<SuperAdminClassDetail>(`/api/superadmin/classes/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteSuperAdminClass(id: string) {
  return apiFetch<{ ok: true }>(`/api/superadmin/classes/${id}`, {
    method: "DELETE",
  });
}

export function getSuperAdminClass(id: string) {
  return apiFetch<SuperAdminClassDetail>(`/api/superadmin/classes/${id}`);
}

/* ------------------------------------------------------------------ */
/* Enrollment                                                           */
/* ------------------------------------------------------------------ */

export function batchEnroll(payload: EnrollPayload) {
  return apiFetch<EnrollResult>("/api/superadmin/enroll", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function batchUnenroll(payload: {
  classId: string;
  userIds: string[];
}) {
  return apiFetch<{ removed: number }>("/api/superadmin/enroll", {
    method: "DELETE",
    body: JSON.stringify(payload),
  });
}

/* ------------------------------------------------------------------ */
/* Role permissions (the KEY feature — modular feature toggles)        */
/* ------------------------------------------------------------------ */

export function getSuperAdminPermissions(): Promise<Permissions> {
  return apiFetch<Permissions>("/api/superadmin/permissions");
}

export function patchSuperAdminPermission(input: {
  role: "STUDENT" | "TEACHER" | "ADMIN";
  featureKey: string;
  enabled: boolean;
}): Promise<Permissions> {
  return apiFetch<Permissions>("/api/superadmin/permissions", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function resetSuperAdminPermissions(): Promise<Permissions> {
  return apiFetch<Permissions>("/api/superadmin/permissions/reset", {
    method: "POST",
  });
}

/* ------------------------------------------------------------------ */
/* Schools (NEW — replace "کلاس‌ها" navigation in the superadmin panel) */
/* ------------------------------------------------------------------ */

export interface SuperAdminSchoolUserSummary {
  id: string;
  username: string;
  fullName: string;
  phone: string | null;
  role: string;
  createdAt: string;
}

export interface SuperAdminSchoolListItem {
  id: string;
  name: string;
  address: string | null;
  principalId: string | null;
  createdAt: string;
  updatedAt: string;
  principal: SuperAdminSchoolUserSummary | null;
  teacherCount: number;
  studentCount: number;
}

export interface PaginatedSuperAdminSchools {
  items: SuperAdminSchoolListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface SuperAdminSchoolDetail {
  id: string;
  name: string;
  address: string | null;
  principalId: string | null;
  // Phase 35b — per-school streaming (online class) flag.
  streamingEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  principal: SuperAdminSchoolUserSummary | null;
  teacherCount: number;
  studentCount: number;
}

export interface SuperAdminSchoolInput {
  name: string;
  address?: string | null;
  streamingEnabled?: boolean;
}

export interface SuperAdminSchoolMembers {
  principal: SuperAdminSchoolUserSummary | null;
  teachers: SuperAdminSchoolUserSummary[];
  students: SuperAdminSchoolUserSummary[];
}

export interface ListSchoolsParams {
  page?: number;
  pageSize?: number;
  search?: string;
}

export function fetchSchools(params: ListSchoolsParams = {}) {
  const url = withQuery("/api/superadmin/schools", {
    page: params.page ?? 1,
    pageSize: params.pageSize ?? 20,
    search: params.search?.trim() || undefined,
  });
  return apiFetch<PaginatedSuperAdminSchools>(url);
}

export function createSchool(input: SuperAdminSchoolInput) {
  return apiFetch<SuperAdminSchoolDetail>("/api/superadmin/schools", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function fetchSchool(id: string) {
  return apiFetch<SuperAdminSchoolDetail>(`/api/superadmin/schools/${id}`);
}

export function updateSchool(
  id: string,
  input: Partial<SuperAdminSchoolInput>,
) {
  return apiFetch<SuperAdminSchoolDetail>(`/api/superadmin/schools/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteSchool(id: string) {
  return apiFetch<{ ok: true; id: string }>(`/api/superadmin/schools/${id}`, {
    method: "DELETE",
  });
}

export function assignPrincipal(schoolId: string, userId: string) {
  return apiFetch<SuperAdminSchoolDetail>(
    `/api/superadmin/schools/${schoolId}/principal`,
    {
      method: "POST",
      body: JSON.stringify({ userId }),
    },
  );
}

export function fetchSchoolMembers(schoolId: string) {
  return apiFetch<SuperAdminSchoolMembers>(
    `/api/superadmin/schools/${schoolId}/members`,
  );
}

/* ------------------------------------------------------------------ */
/* Site settings (lazy-loading + navigation-progress toggles)          */
/* ------------------------------------------------------------------ */

/**
 * Fetch the full site settings map from the SUPERADMIN-only route.
 * Returns the same shape as the public /api/settings route but is gated
 * behind `requireSuperAdminApi()` so the SUPERADMIN UI can render the
 * raw values without racing the public hook's optimistic defaults.
 */
export function fetchSiteSettings(): Promise<SiteSettings> {
  return apiFetch<SiteSettings>("/api/superadmin/settings");
}

/**
 * Upsert a single site setting. Body shape: `{ key, value }`.
 *
 * `key` is the bare DB primary key (e.g. `"lazyLoading"` for the legacy UI
 * toggles, `"ai_access_stats"` / `"module_class_chat"` / … for the
 * phase-13 AI + module toggles). `value` MUST be a boolean for this helper
 * — for string / string[] settings (the AI welcome message + suggested
 * prompts) use {@link patchSettingValue} instead.
 *
 * Returns the refreshed full settings map.
 */
export function patchSiteSetting(
  key: string,
  value: boolean,
): Promise<SiteSettings> {
  return apiFetch<SiteSettings>("/api/superadmin/settings", {
    method: "PATCH",
    body: JSON.stringify({ key, value }),
  });
}

/**
 * Fetch the extended site-settings map from the PUBLIC `/api/settings`
 * route. After the phase-13 backend update, this includes the
 * AI-assistant content + access toggles + the platform-modules map
 * (under `modules`) alongside the legacy `lazyLoading`/
 * `navigationProgress` toggles — the shape mirrors {@link SiteSettings}.
 *
 * The route is readable by every authenticated user; the SUPERADMIN
 * pages use it because the AI-assistant panel also reads its config
 * from the same source (via the separate `/api/ai-assistant/config`
 * endpoint) — keeping the SUPERADMIN's view in sync with what the
 * principal actually sees in the panel.
 */
export function fetchExtendedSettings(): Promise<SiteSettings> {
  return apiFetch<SiteSettings>("/api/settings");
}

/**
 * Upsert a single site setting where the value is NOT a plain boolean
 * — used by the phase-13 SUPERADMIN pages for:
 *
 *  - `ai_welcome_message`      — `string` (welcome-message text)
 *  - `ai_suggested_prompts`   — `string[]` (array of quick-reply chips)
 *  - `ai_access_stats`        — `boolean` (read school stats)
 *  - `ai_access_student_info` — `boolean` (read individual student info)
 *  - `ai_access_password_change` — `boolean` (suggest + exec password change)
 *  - `module_class_chat` / `module_direct_chat` / … / `module_dark_mode`
 *    — `boolean` (per-feature module enable/disable; affects ALL roles)
 *
 * The backend's PATCH validator rejects values whose TypeScript type
 * doesn't match the key's declared `valueType` (see `validateValue` in
 * `src/app/api/superadmin/settings/route.ts`) — so we ship the value
 * as-is (NOT JSON-stringified for `string[]`; the backend handles
 * serialization via `formatSetting`).
 */
export function patchSettingValue(
  key: string,
  value: boolean | string | string[],
): Promise<SiteSettings> {
  return apiFetch<SiteSettings>("/api/superadmin/settings", {
    method: "PATCH",
    body: JSON.stringify({ key, value }),
  });
}

/* ------------------------------------------------------------------ */
/* AI conversations (phase 21 — principal AI chat history viewer)     */
/* ------------------------------------------------------------------ */

/**
 * One row of the SUPERADMIN's "users with AI conversations" list —
 * returned by `GET /api/superadmin/ai-conversations` (no `userId`).
 *
 * Sorted by `lastMessageAt` desc (most-recently-active principals first).
 */
export interface AiConversationUserSummary {
  userId: string;
  fullName: string;
  username: string;
  role: string;
  messageCount: number;
  lastMessageAt: string | null;
}

/**
 * One row of a specific user's persisted AI conversation — returned by
 * `GET /api/superadmin/ai-conversations?userId=<id>`. Sorted oldest-first
 * for top-to-bottom display.
 */
export interface AiConversationRow {
  id: string;
  role: "user" | "assistant";
  content: string;
  actionJson: string | null;
  createdAt: string;
}

/**
 * List every user that has at least one persisted AI conversation row,
 * with the total message count + the most-recent message timestamp.
 */
export function listAiConversationUsers(): Promise<AiConversationUserSummary[]> {
  return apiFetch<AiConversationUserSummary[]>(
    "/api/superadmin/ai-conversations",
  );
}

/**
 * Fetch a single user's persisted AI conversation (oldest-first), capped
 * at `limit` rows (default 100).
 */
export function fetchAiConversation(
  userId: string,
  limit = 100,
): Promise<AiConversationRow[]> {
  const url = withQuery("/api/superadmin/ai-conversations", { userId, limit });
  return apiFetch<AiConversationRow[]>(url);
}
