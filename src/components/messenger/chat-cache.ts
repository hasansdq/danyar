/**
 * Phase 40 — localStorage-backed cache for class-chat timelines.
 *
 * Goal: make opening a chat feel INSTANT. The first 100 messages + all
 * polls of every class the user opens are snapshotted to localStorage.
 * On the next open, the cached snapshot is hydrated synchronously
 * (loading = false, no skeleton) while the fresh page is fetched from
 * the REST API in the background. The server response then replaces /
 * merges with the cached view (server is the source of truth — deletions
 * and edits applied by others disappear on the revalidate).
 *
 * Storage rules:
 *   - Key: `dnyar:chatcache:v1:<classId>` (per-class, per-browser).
 *   - Only the NEWEST `MAX_CACHED_MESSAGES` messages are kept (chat is
 *     append-only — dropping the older tail only means those pages
 *     re-fetch via loadMore).
 *   - Optimistic/temp rows (ids starting with `__optim`) are NEVER cached.
 *   - A soft size cap + `try/catch` around JSON serialization keeps the
 *     app safe on browsers with a full/private-mode localStorage (quota
 *     errors are swallowed; caching is purely an enhancement).
 *   - `savedAt` lets consumers decide staleness (currently we always use
 *     the snapshot immediately and revalidate — messages are append-only
 *     so a stale snapshot is never *wrong*, just possibly outdated).
 */

import type { ChatMessageWithDelete, Poll } from "./types";

const PREFIX = "dnyar:chatcache:v1:";
const MAX_CACHED_MESSAGES = 120;
const MAX_CACHED_POLLS = 60;

export type CachedChatSnapshot = {
  messages: ChatMessageWithDelete[];
  polls: Poll[];
  hasMore: boolean;
  nextCursor: string | null;
  savedAt: number;
};

function isTempId(id: string | undefined | null): boolean {
  return !!id && id.startsWith("__optim");
}

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Quota exceeded / private mode — caching is best-effort.
  }
}

function safeRemove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Basic runtime shape guard so a corrupted/legacy entry never crashes the chat. */
function isValidSnapshot(value: unknown): value is CachedChatSnapshot {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<CachedChatSnapshot>;
  if (!Array.isArray(v.messages) || !Array.isArray(v.polls)) return false;
  return (
    v.messages.every(
      (m) => m && typeof m.id === "string" && typeof m.createdAt === "string",
    ) &&
    v.polls.every((p) => p && typeof p.id === "string" && typeof p.createdAt === "string")
  );
}

/** Read the cached snapshot for a class. Returns null when absent/corrupt. */
export function loadChatCache(classId: string): CachedChatSnapshot | null {
  if (typeof window === "undefined") return null;
  const raw = safeGet(PREFIX + classId);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!isValidSnapshot(parsed)) {
      safeRemove(PREFIX + classId);
      return null;
    }
    // Defensive: strip any temp ids that somehow got in.
    parsed.messages = parsed.messages.filter((m) => !isTempId(m.id));
    return parsed;
  } catch {
    safeRemove(PREFIX + classId);
    return null;
  }
}

/** Persist a snapshot (newest MAX_CACHED_MESSAGES messages kept). */
export function saveChatCache(
  classId: string,
  messages: ChatMessageWithDelete[],
  polls: Poll[],
  hasMore: boolean,
  nextCursor: string | null,
): void {
  if (typeof window === "undefined") return;
  const clean = messages.filter((m) => !isTempId(m.id));
  // Keep the NEWEST tail (messages are chronological — slice from the end).
  const kept =
    clean.length > MAX_CACHED_MESSAGES
      ? clean.slice(clean.length - MAX_CACHED_MESSAGES)
      : clean;
  const keptPolls =
    polls.length > MAX_CACHED_POLLS
      ? polls.slice(polls.length - MAX_CACHED_POLLS)
      : polls;
  const snapshot: CachedChatSnapshot = {
    messages: kept,
    polls: keptPolls,
    // When we truncated, there is definitely an older page available.
    hasMore: hasMore || clean.length > MAX_CACHED_MESSAGES,
    nextCursor,
    savedAt: Date.now(),
  };
  safeSet(PREFIX + classId, JSON.stringify(snapshot));
}

/** Drop the cache for one class (e.g. after a hard error). */
export function clearChatCache(classId: string): void {
  if (typeof window === "undefined") return;
  safeRemove(PREFIX + classId);
}

/** Drop every chat cache entry (used by the user menu "clear caches" action). */
export function clearAllChatCaches(): void {
  if (typeof window === "undefined") return;
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(PREFIX)) toRemove.push(key);
    }
    for (const key of toRemove) window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
