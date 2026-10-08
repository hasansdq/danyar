"use client";

/**
 * Assignment-status helpers + small UI components used by the assignments
 * view. Kept in its own module so the (large) assignments-view.tsx stays
 * focused on layout/mutations.
 *
 * Status taxonomy (matches the backend AssignmentSubmission.status enum):
 *   - UNCHECKED  → بررسی نشده
 *   - DONE       → انجام شده
 *   - INCOMPLETE → ناقص
 *   - NOT_DONE   → انجام نشده
 *
 * Color mapping (Tailwind):
 *   - UNCHECKED  → neutral / white card  (no emphasis)
 *   - DONE       → emerald              (success)
 *   - INCOMPLETE → amber                (warning)
 *   - NOT_DONE   → rose                (danger)
 */
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AssignmentStatus } from "./types";

export const ASSIGNMENT_STATUSES: AssignmentStatus[] = [
  "UNCHECKED",
  "DONE",
  "INCOMPLETE",
  "NOT_DONE",
];

/** Persian label for a status code. */
export function statusLabel(status: AssignmentStatus | null | undefined): string {
  switch (status) {
    case "DONE":
      return "انجام شده";
    case "INCOMPLETE":
      return "ناقص";
    case "NOT_DONE":
      return "انجام نشده";
    case "UNCHECKED":
    default:
      return "بررسی نشده";
  }
}

/** lucide icon for a status code. */
export function statusIcon(status: AssignmentStatus | null | undefined): LucideIcon {
  switch (status) {
    case "DONE":
      return CheckCircle2;
    case "INCOMPLETE":
      return AlertCircle;
    case "NOT_DONE":
      return XCircle;
    case "UNCHECKED":
    default:
      return Circle;
  }
}

/**
 * Inline-switch icon renderer. Implemented as a switch (instead of a
 * pre-computed component map) so ESLint's "no nested component definitions
 * inside render" rule doesn't fire — each branch just picks the icon and
 * renders it inline.
 */
export function StatusIcon({
  status,
  className,
}: {
  status: AssignmentStatus | null | undefined;
  className?: string;
}) {
  switch (status) {
    case "DONE": {
      const Icon = CheckCircle2;
      return <Icon className={cn("size-4", className)} />;
    }
    case "INCOMPLETE": {
      const Icon = AlertCircle;
      return <Icon className={cn("size-4", className)} />;
    }
    case "NOT_DONE": {
      const Icon = XCircle;
      return <Icon className={cn("size-4", className)} />;
    }
    case "UNCHECKED":
    default: {
      const Icon = Circle;
      return <Icon className={cn("size-4", className)} />;
    }
  }
}

/**
 * Tailwind card-color classes per status. Used on student cards (where the
 * whole card is tinted by `myStatus`) and as accent borders.
 *
 * - UNCHECKED → plain white card (neutral border + bg-background).
 * - DONE      → emerald.
 * - INCOMPLETE → amber.
 * - NOT_DONE  → rose.
 */
export function statusCardColor(
  status: AssignmentStatus | null | undefined,
): string {
  switch (status) {
    case "DONE":
      return "border-emerald-300/70 bg-emerald-50/70 dark:border-emerald-700/60 dark:bg-emerald-950/40";
    case "INCOMPLETE":
      return "border-amber-300/70 bg-amber-50/70 dark:border-amber-700/60 dark:bg-amber-950/40";
    case "NOT_DONE":
      return "border-rose-300/70 bg-rose-50/70 dark:border-rose-700/60 dark:bg-rose-950/40";
    case "UNCHECKED":
    default:
      return "border-border bg-background";
  }
}

/** A small icon+label badge pill used to summarize a status inline. */
export function statusBadgeColor(
  status: AssignmentStatus | null | undefined,
): string {
  switch (status) {
    case "DONE":
      return "border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
    case "INCOMPLETE":
      return "border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-300";
    case "NOT_DONE":
      return "border-transparent bg-rose-500/15 text-rose-700 dark:text-rose-300";
    case "UNCHECKED":
    default:
      return "border-transparent bg-muted text-muted-foreground";
  }
}

/** Active-state color for the StatusSelector toggle buttons. */
export function statusActiveButtonColor(
  status: AssignmentStatus,
): string {
  switch (status) {
    case "DONE":
      return "border-emerald-500 bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300";
    case "INCOMPLETE":
      return "border-amber-500 bg-amber-500/15 text-amber-700 hover:bg-amber-500/20 dark:text-amber-300";
    case "NOT_DONE":
      return "border-rose-500 bg-rose-500/15 text-rose-700 hover:bg-rose-500/20 dark:text-rose-300";
    case "UNCHECKED":
    default:
      return "border-muted-foreground/40 bg-muted text-foreground hover:bg-muted/80";
  }
}

/** Icon+label pill summarizing a status. */
export function StatusBadge({
  status,
  className,
}: {
  status: AssignmentStatus | null | undefined;
  className?: string;
}) {
  return (
    <Badge className={cn(statusBadgeColor(status), className)}>
      <StatusIcon status={status} />
      {statusLabel(status)}
    </Badge>
  );
}

/**
 * Four toggle buttons — one per status. The currently-active status is
 * colored; the rest stay muted. Calls `onChange` with the new status when a
 * button is clicked. Used by the teacher's per-student status row in the
 * assignment-students dialog.
 *
 * Implemented with plain `<Button>` instead of `ToggleGroup` so we can color
 * each toggle differently per status.
 */
export function StatusSelector({
  value,
  onChange,
  disabled,
  className,
  size = "sm",
}: {
  value: AssignmentStatus;
  onChange: (next: AssignmentStatus) => void;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "default";
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1.5",
        className,
      )}
      role="group"
      aria-label="انتخاب وضعیت تکلیف"
    >
      {ASSIGNMENT_STATUSES.map((s) => {
        const active = s === value;
        const Icon = statusIcon(s);
        return (
          <Button
            key={s}
            type="button"
            size={size}
            variant="outline"
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onChange(s)}
            className={cn(
              "h-8 gap-1.5 px-2.5 text-xs",
              active
                ? cn("border-2 font-semibold", statusActiveButtonColor(s))
                : "text-muted-foreground",
            )}
          >
            <Icon className="size-3.5" />
            {statusLabel(s)}
          </Button>
        );
      })}
    </div>
  );
}
