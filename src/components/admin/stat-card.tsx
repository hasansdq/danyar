"use client";

import * as React from "react";
import { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface StatCardProps {
  title: string;
  value: number | string;
  icon: LucideIcon;
  description?: string;
  className?: string;
  iconClassName?: string;
}

export function StatCard({
  title,
  value,
  icon: Icon,
  description,
  className,
  iconClassName,
}: StatCardProps) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardContent className="flex items-center justify-between gap-4 p-4">
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-sm font-medium">
            {title}
          </span>
          <span className="text-2xl font-bold tracking-tight persian-nums">
            {value}
          </span>
          {description && (
            <span className="text-muted-foreground text-xs">{description}</span>
          )}
        </div>
        <div
          className={cn(
            "flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary",
            iconClassName,
          )}
        >
          <Icon className="size-6" />
        </div>
      </CardContent>
    </Card>
  );
}
