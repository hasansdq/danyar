"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  X,
  Users,
  GraduationCap,
  UserPlus,
  ClipboardList,
  FileQuestion,
  BarChart3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import type { MessengerUser } from "./types";
import { CreateGroupDialog } from "./create-menu";
import { CreateUserDialog } from "./create-menu";
import { CreateTeacherAssignmentDialog } from "./create-menu";
import { CreateTeacherSampleQuestionDialog } from "./create-menu";

/* ------------------------------------------------------------------ */
/* FloatingCreateButton — expandable FAB with smart scroll hide/show  */
/* ------------------------------------------------------------------ */

/**
 * A circular Floating Action Button (FAB) that replaces the header "+"
 * create-menu button. Lives in the bottom corner of the screen.
 *
 * Smart scroll behavior (Telegram/WhatsApp pattern):
 *   - Hides when the user scrolls DOWN (the FAB slides down off-screen).
 *   - Reappears when the user scrolls UP or stops scrolling (the FAB
 *     slides back up).
 *   - Uses a debounce: if no scroll event fires for 200ms, the FAB
 *     shows again (covers the "scroll stop" case).
 *
 * Expandable FAB (Telegram pattern):
 *   - The main FAB shows a Plus icon.
 *   - Click → the Plus rotates 45° (becomes an X) + a vertical stack of
 *     mini-FABs appears above the main FAB. Each mini-FAB has an icon +
 *     a label chip on the side.
 *   - Click again (or click outside) → the menu collapses + the X
 *     rotates back to a Plus.
 *   - Clicking a mini-FAB opens the corresponding create dialog.
 *
 * The items shown depend on the role:
 *   - ADMIN (principal): ایجاد گروه, ایجاد دانش‌آموز, ایجاد معلم
 *   - TEACHER: ایجاد تکلیف, نمونه سوال, ثبت نمره
 *
 * The FAB is hidden when the user is inside a chat (the chat has its own
 * composer at the bottom — the FAB would overlap).
 */

interface FloatingCreateButtonProps {
  user: MessengerUser;
  currentClassId?: string | null;
  onOpenGrades?: () => void;
  /** When true, the FAB is hidden entirely (e.g. when inside a chat —
   * the chat's composer is at the bottom + the FAB would overlap). */
  hidden?: boolean;
}

type DialogKind =
  | "group"
  | "student"
  | "teacher"
  | "assignment"
  | "sampleQuestion"
  | null;

const SCROLL_HIDE_THRESHOLD = 8; // px — ignore tiny scroll jitter
const SCROLL_STOP_MS = 200; // ms — show FAB again after scrolling stops

export function FloatingCreateButton({
  user,
  currentClassId,
  onOpenGrades,
  hidden = false,
}: FloatingCreateButtonProps) {
  const isTeacher = user.role === "TEACHER";
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [openDialog, setOpenDialog] = React.useState<DialogKind>(null);

  // ---- Smart scroll hide/show ----
  const [fabVisible, setFabVisible] = React.useState(true);
  const lastScrollTopRef = React.useRef(0);
  const scrollStopTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    if (hidden) return; // don't attach listeners when hidden

    // Find the scrollable container. The main content area is `<main>`
    // + its child (PullToRefresh div or the chat viewport). We attach
    // the scroll listener to the first scrollable ancestor of <main>.
    // As a fallback, we also listen to window scroll.
    const candidates: Array<EventTarget> = [window];
    const scrollableEls = document.querySelectorAll<HTMLElement>(
      '[class*="overflow-y-auto"], [class*="overflow-auto"]',
    );
    scrollableEls.forEach((el) => candidates.push(el));

    function handleScroll(e: Event) {
      const el = e.target instanceof HTMLElement ? e.target : null;
      const scrollTop = el
        ? el.scrollTop
        : window.scrollY || document.documentElement.scrollTop;

      const delta = scrollTop - lastScrollTopRef.current;
      lastScrollTopRef.current = scrollTop;

      // Scrolling DOWN → hide the FAB (only if the delta exceeds the
      // jitter threshold so tiny scroll adjustments don't flicker it).
      if (delta > SCROLL_HIDE_THRESHOLD) {
        setFabVisible(false);
        setMenuOpen(false); // close the expandable menu too
      } else if (delta < -SCROLL_HIDE_THRESHOLD) {
        // Scrolling UP → show the FAB immediately.
        setFabVisible(true);
      }

      // Reset the "scroll stop" timer — if no scroll event fires for
      // SCROLL_STOP_MS, show the FAB again (covers the "stopped scrolling"
      // case the user explicitly asked for).
      if (scrollStopTimerRef.current) clearTimeout(scrollStopTimerRef.current);
      scrollStopTimerRef.current = setTimeout(() => {
        setFabVisible(true);
      }, SCROLL_STOP_MS);
    }

    candidates.forEach((c) => c.addEventListener("scroll", handleScroll, { passive: true }));
    return () => {
      candidates.forEach((c) => c.removeEventListener("scroll", handleScroll));
      if (scrollStopTimerRef.current) clearTimeout(scrollStopTimerRef.current);
    };
  }, [hidden]);

  // Close the menu when clicking outside.
  React.useEffect(() => {
    if (!menuOpen) return;
    function handleOutside(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-fab-root]")) {
        setMenuOpen(false);
      }
    }
    // Defer attaching so the same click that opened the menu doesn't
    // immediately close it.
    const id = setTimeout(() => {
      document.addEventListener("click", handleOutside);
    }, 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener("click", handleOutside);
    };
  }, [menuOpen]);

  // ---- Menu items (role-dependent) ----
  // Phase 30 — FAB option labels renamed from "ایجاد ..." to "... جدید"
  //   form (cleaner, matches the user's request). The dialog titles +
  //   submit-button texts inside each dialog still say "ایجاد ..." for
  //   consistency with the admin panel — only the FAB chip labels changed.
  const items = isTeacher
    ? [
        {
          key: "assignment" as const,
          label: "ایجاد تکلیف",
          icon: ClipboardList,
          color: "bg-emerald-500/10 text-emerald-600",
          onClick: () => setOpenDialog("assignment"),
        },
        {
          key: "sampleQuestion" as const,
          label: "نمونه سوال",
          icon: FileQuestion,
          color: "bg-sky-500/10 text-sky-600",
          onClick: () => setOpenDialog("sampleQuestion"),
        },
        {
          key: "grades" as const,
          label: "ثبت نمره",
          icon: BarChart3,
          color: "bg-green-500/10 text-green-600",
          onClick: () => {
            setMenuOpen(false);
            onOpenGrades?.();
          },
        },
      ]
    : [
        {
          key: "group" as const,
          label: "گروه جدید",
          icon: Users,
          color: "bg-primary/10 text-primary",
          onClick: () => setOpenDialog("group"),
        },
        {
          key: "student" as const,
          label: "دانش‌آموز جدید",
          icon: GraduationCap,
          color: "bg-amber-500/10 text-amber-600",
          onClick: () => setOpenDialog("student"),
        },
        {
          key: "teacher" as const,
          label: "معلم جدید",
          icon: UserPlus,
          color: "bg-teal-500/10 text-teal-600",
          onClick: () => setOpenDialog("teacher"),
        },
      ];

  // Don't render anything when hidden (inside a chat) or for roles that
  // don't have create privileges.
  if (hidden || (user.role !== "ADMIN" && user.role !== "TEACHER")) return null;

  return (
    <>
      {/* Backdrop (dimmed overlay when the menu is open) */}
      <AnimatePresence>
        {menuOpen ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px]"
            onClick={() => setMenuOpen(false)}
            aria-hidden="true"
          />
        ) : null}
      </AnimatePresence>

      {/* The FAB root — fixed in the bottom corner, ABOVE the bottom nav
          (which is ~57px tall + shown on all screen sizes per Phase 20).
          Phase 36i — on desktop, the FAB is aligned with the max-w-5xl
          container (not the viewport edge). On mobile, it's at the
          viewport edge (left-4). The `sm:left-[calc((100vw-80rem)/2)]`
          calculates the container's left padding on wide screens. */}
      <div
        data-fab-root
        className={cn(
          "fixed z-50 flex flex-col items-end gap-3 transition-transform duration-300",
          // In RTL, the FAB goes in the bottom-LEFT corner (mirror of LTR's
          // bottom-right). This matches Telegram/WhatsApp in Persian.
          "left-4",
          // Phase 36i — on desktop (sm+), align with the max-w-5xl (64rem)
          // container. On viewports wider than 64rem, the container is
          // centered with (100vw - 64rem) / 2 padding. The FAB sits at
          // that left edge (so it's "inside the group bounds"). On
          // viewports ≤ 64rem, the container fills the width, so left-4
          // (the mobile value) is correct.
          "sm:left-[max(1rem,calc((100vw-64rem)/2))]",
          // Positioned above the bottom nav (bottom-16 ≈ 64px > nav's 57px).
          // On safe-area devices (iPhone X+), the nav respects the safe-area
          // inset so we add that too.
          "bottom-16",
          // Slide down off-screen when hidden (smart scroll behavior).
          fabVisible ? "translate-y-0" : "translate-y-[150%]",
        )}
      >
        {/* Expandable mini-FABs (appear above the main FAB, bottom-up) */}
        <AnimatePresence>
          {menuOpen
            ? items.map((item, idx) => {
                const Icon = item.icon;
                return (
                  <motion.button
                    key={item.key}
                    type="button"
                    initial={{ opacity: 0, scale: 0.5, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.5, y: 20 }}
                    transition={{ duration: 0.18, delay: idx * 0.04 }}
                    onClick={() => {
                      item.onClick();
                      setMenuOpen(false);
                    }}
                    className="flex items-center gap-2"
                  >
                    {/* Label chip — on the LEFT of the icon (RTL) */}
                    <span className="rounded-lg bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-md ring-1 ring-border/50">
                      {item.label}
                    </span>
                    {/* Mini-FAB circular button */}
                    <span
                      className={cn(
                        "flex size-12 items-center justify-center rounded-full shadow-lg ring-1 ring-border/30 transition-transform hover:scale-105 active:scale-95",
                        item.color,
                      )}
                    >
                      <Icon className="size-5" />
                    </span>
                  </motion.button>
                );
              })
            : null}
        </AnimatePresence>

        {/* Main FAB button */}
        <motion.button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          whileTap={{ scale: 0.9 }}
          aria-label={menuOpen ? "بستن منوی ایجاد" : "ایجاد مورد جدید"}
          title="ایجاد مورد جدید"
          aria-expanded={menuOpen}
          className="flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl ring-2 ring-primary/20 transition-colors hover:bg-primary/90"
        >
          <motion.span
            animate={{ rotate: menuOpen ? 135 : 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="flex items-center justify-center"
          >
            {menuOpen ? <X className="size-6" /> : <Plus className="size-6" />}
          </motion.span>
        </motion.button>
      </div>

      {/* ---- Dialogs (same as the old CreateMenu) ---- */}
      {isTeacher ? (
        <>
          <CreateTeacherAssignmentDialog
            user={user}
            currentClassId={currentClassId ?? null}
            open={openDialog === "assignment"}
            onOpenChange={(o) => setOpenDialog(o ? "assignment" : null)}
          />
          <CreateTeacherSampleQuestionDialog
            user={user}
            currentClassId={currentClassId ?? null}
            open={openDialog === "sampleQuestion"}
            onOpenChange={(o) => setOpenDialog(o ? "sampleQuestion" : null)}
          />
        </>
      ) : (
        <>
          <CreateGroupDialog
            user={user}
            open={openDialog === "group"}
            onOpenChange={(o) => setOpenDialog(o ? "group" : null)}
          />
          <CreateUserDialog
            user={user}
            role="STUDENT"
            open={openDialog === "student"}
            onOpenChange={(o) => setOpenDialog(o ? "student" : null)}
          />
          <CreateUserDialog
            user={user}
            role="TEACHER"
            open={openDialog === "teacher"}
            onOpenChange={(o) => setOpenDialog(o ? "teacher" : null)}
          />
        </>
      )}
    </>
  );
}
