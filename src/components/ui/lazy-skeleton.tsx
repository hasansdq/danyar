"use client";

import { cn } from "@/lib/utils";
import { useLazyLoading } from "@/components/use-site-settings";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * LazySkeleton — same props as <Skeleton>, but renders nothing when the
 * superadmin has disabled the global `lazyLoading` site setting.
 *
 * Use this anywhere you'd otherwise reach for <Skeleton> during an
 * isLoading state. When `lazyLoading` is on (default), the shimmer
 * placeholder shows as usual; when it's off, the component renders null
 * so the parent falls through to the empty/loaded branch immediately.
 *
 * The setting is read via TanStack Query — a single /api/settings call
 * is shared across every LazySkeleton on the page, so the cost is one
 * network round-trip per minute per session.
 *
 * Props: identical to <Skeleton> (className, ...rest) so this is a
 * drop-in replacement.
 */
function LazySkeleton({
  className,
  ...props
}: React.ComponentProps<typeof Skeleton>) {
  const enabled = useLazyLoading();
  if (!enabled) return null;
  return <Skeleton className={cn(className)} {...props} />;
}

export { LazySkeleton };
