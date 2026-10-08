"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-fetch";

/**
 * Client-side role-permission snapshot.
 *
 * Wraps `GET /api/permissions/me` (which returns
 * `{ data: { role, permissions: Record<featureKey, boolean> } }`) in a
 * TanStack Query so the lookup is cached + deduped across the components
 * that need to gate UI on a feature toggle.
 *
 * SUPERADMIN short-circuits to `true` for every key (matches the backend
 * `loadPermissionsForRole` semantics — SUPERADMIN always passes).
 *
 * Missing keys default to `true` (everything-on-by-default — same convention
 * used by the backend `assertPermission` helper).
 */

export interface MyPermissionsResponse {
  role: string;
  permissions: Record<string, boolean>;
}

/**
 * Single-user permission map. Refetched on mount + on window focus so a
 * toggle flipped by the SUPERADMIN propagates within seconds. The query is
 * disabled when the caller passes `enabled: false` (e.g. when the calling
 * component already knows the user is unauthenticated).
 */
export function useMyPermissions() {
  return useQuery<MyPermissionsResponse>({
    queryKey: ["my-permissions"],
    queryFn: () => apiFetch<MyPermissionsResponse>("/api/permissions/me"),
    staleTime: 60 * 1000, // 1 min cache
    refetchOnWindowFocus: true,
    // Don't retry forever on 401 (unauthenticated) — just bail.
    retry: (failureCount, error: unknown) => {
      if (error instanceof Error && /401|Unauthorized|خطای سرور \(40/.test(error.message)) {
        return false;
      }
      return failureCount < 2;
    },
  });
}

/**
 * Single-feature permission gate.
 *
 * Returns `true` when the calling user may use the feature identified by
 * `featureKey`. SUPERADMIN always returns `true`. Missing keys default to
 * `true` (matches the backend's missing-row-implies-enabled convention).
 *
 * While the permissions fetch is still in flight, this returns `true`
 * (optimistic — same default as the backend) so the very first paint never
 * hides a feature the user actually has access to.
 */
export function useCan(featureKey: string): boolean {
  const { data } = useMyPermissions();
  if (!data) return true; // optimistic before the first fetch resolves
  if (data.role === "SUPERADMIN") return true;
  const v = data.permissions?.[featureKey];
  return v ?? true;
}
