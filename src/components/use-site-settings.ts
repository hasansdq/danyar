"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { SiteSettings } from "@/lib/site-settings";

/**
 * TanStack Query hook that fetches the global site settings (the
 * lazy-loading + navigation-progress toggles) from GET /api/settings.
 *
 * The result is cached for 1 minute per browser session; optimistic
 * helpers below return `true` (the on-by-default) before the first fetch
 * resolves so the very first paint never blanks the page.
 */
export function useSiteSettings() {
  const qc = useQueryClient();
  const query = useQuery<SiteSettings>({
    queryKey: ["site-settings"],
    queryFn: async () => {
      const res = await fetch("/api/settings", { credentials: "include" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `خطای سرور (${res.status})`);
      return json.data as SiteSettings;
    },
    staleTime: 60 * 1000, // 1 min cache
  });

  // Keep the cache fresh after the SUPERADMIN updates a setting —
  // the settings manager invalidates this key after every PATCH, but
  // also refetch on window focus as a safety net.
  useEffect(() => {
    function onFocus() {
      void qc.invalidateQueries({ queryKey: ["site-settings"] });
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [qc]);

  return query;
}

/**
 * Returns whether shimmer <Skeleton> placeholders should render during
 * data fetching. Defaults to `true` (optimistic) before the settings
 * fetch resolves — disabling lazy-loading is the opt-out path.
 */
export function useLazyLoading(): boolean {
  const { data } = useSiteSettings();
  return data?.lazyLoading ?? true;
}

/**
 * Returns whether the top navigation progress bar should render during
 * page transitions. Defaults to `true` (optimistic).
 */
export function useNavigationProgress(): boolean {
  const { data } = useSiteSettings();
  return data?.navigationProgress ?? true;
}
