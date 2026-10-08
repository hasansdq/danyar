"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A small, deterministic avatar bubble for chat participants.
 *
 * - If `avatarColor` is supplied, use it as the background.
 * - Otherwise compute a deterministic emerald-ish color from the user id,
 *   so the same user always gets the same color across renders.
 * - Shows the first Persian-aware character of the user's full name.
 *
 * Sizes:
 *   - "sm"  → size-8  (mobile list rows)
 *   - "md"  → size-10 (default, chat messages)
 *   - "lg"  → size-12 (header / larger surfaces)
 */

export type ChatAvatarSize = "sm" | "md" | "lg";

const SIZE_CLASS: Record<ChatAvatarSize, string> = {
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-12 text-base",
};

// Emerald-ish palette — no indigo/blue.
const PALETTE = [
  "bg-emerald-500",
  "bg-teal-500",
  "bg-green-500",
  "bg-cyan-600",
  "bg-emerald-600",
  "bg-teal-600",
  "bg-green-600",
  "bg-emerald-700",
];

/** Simple deterministic hash → index into the palette. */
function colorFromString(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    // 32-bit FNV-1a-ish mix
    h = (h ^ input.charCodeAt(i)) >>> 0;
    h = (h * 16777619) >>> 0;
  }
  return PALETTE[h % PALETTE.length];
}

/** Get the first non-space character of a Persian-aware string. */
function firstChar(input: string): string {
  const trimmed = (input || "").trim();
  if (!trimmed) return "?";
  // Intl segmentation would be nicer, but for full names this is fine.
  // Strip leading zero-width chars / formatting that sometimes appears.
  const codePoint = trimmed.codePointAt(0);
  return codePoint ? String.fromCodePoint(codePoint) : trimmed[0];
}

export function ChatAvatar({
  fullName,
  userId,
  avatarColor,
  avatar,
  size = "md",
  className,
}: {
  fullName?: string;
  userId?: string;
  avatarColor?: string | null;
  avatar?: string | null;
  size?: ChatAvatarSize;
  className?: string;
}) {
  // If the user has uploaded a profile picture, render it as a circular image
  // instead of the letter-bubble. The image fills the same size slot so layout
  // doesn't shift between letter / image avatars.
  if (avatar) {
    return (
      <img
        src={avatar}
        alt={fullName ? fullName : "تصویر کاربر"}
        className={cn(
          "shrink-0 rounded-full object-cover shadow-sm",
          SIZE_CLASS[size],
          className,
        )}
      />
    );
  }

  const label = firstChar(fullName || "");
  // Prefer the user's explicit avatarColor; otherwise compute from id (or name fallback).
  const bg = avatarColor
    ? avatarColor
    : colorFromString(userId || fullName || "x");
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-semibold text-white shadow-sm",
        SIZE_CLASS[size],
        bg,
        className,
      )}
      aria-hidden="true"
    >
      {label}
    </div>
  );
}
