"use client";

import * as React from "react";
import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SuperAdminStatCardProps {
  title: string;
  value: number | string;
  icon: LucideIcon;
  description?: string;
  className?: string;
  iconClassName?: string;
}

/**
 * Stat card variant for the SUPERADMIN panel — dark slate surface with
 * emerald-tinted icon. Mirrors the admin StatCard but themed for the
 * dark shell.
 */
export function SuperAdminStatCard({
  title,
  value,
  icon: Icon,
  description,
  className,
  iconClassName,
}: SuperAdminStatCardProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 rounded-xl border border-border bg-card/60 p-4",
        className,
      )}
    >
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-muted-foreground">{title}</span>
        <span className="text-2xl font-bold tracking-tight text-foreground persian-nums">
          {value}
        </span>
        {description && (
          <span className="text-xs text-muted-foreground">{description}</span>
        )}
      </div>
      <div
        className={cn(
          "flex size-12 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500 ring-1 ring-emerald-500/20",
          iconClassName,
        )}
      >
        <Icon className="size-6" />
      </div>
    </div>
  );
}
