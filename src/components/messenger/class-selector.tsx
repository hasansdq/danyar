"use client";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Users } from "lucide-react";
import { membershipRoleLabel, formatPersianNumber } from "./persian";
import type { ClassItem } from "./types";

/**
 * Class selector dropdown — used in the messenger header.
 *
 * Lists the user's classes; selecting one updates the parent's
 * `selectedClassId` state which triggers re-fetches across all
 * feature views.
 */
export function ClassSelector({
  classes,
  selectedClassId,
  onChange,
  disabled,
}: {
  classes: ClassItem[];
  selectedClassId: string | null;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const selected =
    classes.find((c) => c.id === selectedClassId) ?? classes[0] ?? null;

  if (classes.length === 0) {
    return (
      <div className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
        شما در هیچ کلاسی عضو نیستید.
      </div>
    );
  }

  return (
    <Select
      value={selectedClassId ?? undefined}
      onValueChange={onChange}
      disabled={disabled}
    >
      <SelectTrigger
        className="min-w-[200px] max-w-[320px] gap-2"
        aria-label="انتخاب کلاس"
      >
        <SelectValue placeholder="انتخاب کلاس">
          {selected ? (
            <span className="flex items-center gap-2">
              <span className="truncate font-medium">{selected.name}</span>
              <Badge variant="outline" className="text-[10px]">
                {membershipRoleLabel(selected.role)}
              </Badge>
            </span>
          ) : (
            "انتخاب کلاس"
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel className="text-xs">کلاس‌های من</SelectLabel>
          {classes.map((c) => (
            <SelectItem key={c.id} value={c.id} className="py-2">
              <span className="flex items-center gap-2">
                <span className="truncate">{c.name}</span>
                <span className="ms-2 flex items-center gap-1 text-xs text-muted-foreground">
                  <Users className="size-3" />
                  {formatPersianNumber(c.memberCount)}
                </span>
                <Badge variant="secondary" className="text-[10px]">
                  {membershipRoleLabel(c.role)}
                </Badge>
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
