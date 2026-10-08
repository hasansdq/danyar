/**
 * Frontend fetch helper for calling the app's REST API from client components.
 *
 * - Always uses relative paths (required by the gateway/Caddy).
 * - Defaults Content-Type to application/json; callers can override.
 * - Throws a Persian-friendly Error when the response is not ok, using the
 *   `error` field returned by the API routes or a generic fallback.
 *
 * NOTE: If you are uploading a File / FormData, pass an options object with
 * `body: FormData` and DO NOT set Content-Type — the browser will set the
 * multipart boundary automatically.
 */
export async function apiFetch<T>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  const isFormData =
    typeof FormData !== "undefined" && options?.body instanceof FormData;

  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string> | undefined),
  };
  if (!isFormData) {
    headers["Content-Type"] = headers["Content-Type"] || "application/json";
  }

  const res = await fetch(url, {
    ...options,
    headers,
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

  // API routes return { data: ... } on success. Unwrap automatically.
  if (payload && typeof payload === "object" && "data" in payload) {
    return payload.data as T;
  }
  return payload as T;
}

/**
 * Like `apiFetch` but does NOT unwrap the `{ data: ... }` envelope.
 * Use this for endpoints that return extra top-level fields alongside
 * `data` (e.g. paginated responses with `nextCursor` / `hasMore`).
 */
export async function apiFetchRaw<T>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  const isFormData =
    typeof FormData !== "undefined" && options?.body instanceof FormData;

  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string> | undefined),
  };
  if (!isFormData) {
    headers["Content-Type"] = headers["Content-Type"] || "application/json";
  }

  const res = await fetch(url, {
    ...options,
    headers,
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

  return payload as T;
}

/**
 * Build a relative URL with query params from a Record.
 * Skips null/undefined/empty values. Returns just `pathname?query`
 * (relative to the origin so it works through the Caddy gateway).
 */
export function withQuery(
  base: string,
  params?: Record<string, string | number | null | undefined>,
): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v === null || v === undefined || v === "") continue;
    search.set(k, String(v));
  }
  const qs = search.toString();
  return qs ? `${base}?${qs}` : base;
}

