"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigationProgress } from "@/components/use-site-settings";

/**
 * Top-of-viewport progress bar that animates during client-side navigation.
 *
 * Trigger strategy (no router.instrumentation hook exists in App Router,
 * so we fall back to event interception):
 *  - Click on an internal <a href> (href starts with "/") → start.
 *  - Click on a submit button inside a <form> → start (form may trigger a
 *    server navigation if it doesn't preventDefault).
 *
 * Completion triggers:
 *  - usePathname() changes → animate to 100% then fade out.
 *  - Safety auto-hide after 3s (in case the click didn't actually cause a
 *    navigation — e.g. same-page anchor, preventDefault, etc.).
 *
 * The whole component renders null when the SUPERADMIN has disabled the
 * `navigationProgress` site setting (read via useNavigationProgress()).
 *
 * Visual: h-1 (4px) primary-tinted bar with a subtle glow, fixed to the
 * top of the viewport, z-[100] so it sits above the messenger header
 * (z-40), the dropdown menus (z-50), and the sheets/dialogs (z-50/60).
 * The bar grows left-to-right via a scaleX transform (origin-left).
 * In RTL mode the page flows right-to-left but the bar's origin stays
 * left so the "fill" still grows from the start edge — feels natural
 * for a progress indicator.
 */
export function NavigationProgress() {
  const enabled = useNavigationProgress();
  const pathname = usePathname();
  const [progress, setProgress] = React.useState<number | null>(null);
  // null = idle, 0..80 = in-flight, 100 = complete
  const startRef = React.useRef<number>(0);
  const rafRef = React.useRef<number | null>(null);
  const safetyTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const clearRaf = React.useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const clearSafety = React.useCallback(() => {
    if (safetyTimerRef.current != null) {
      clearTimeout(safetyTimerRef.current);
      safetyTimerRef.current = null;
    }
  }, []);

  // Begin a loading cycle: animate 0 -> 80% over ~800ms, then hold.
  const startLoading = React.useCallback(() => {
    if (!enabled) return;
    clearRaf();
    clearSafety();
    startRef.current = performance.now();
    setProgress(0);

    const tick = (now: number) => {
      const elapsed = now - startRef.current;
      // ~800ms to reach 80% — easing so it slows down near the cap.
      const t = Math.min(1, elapsed / 800);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      const next = eased * 80;
      setProgress(next);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    // Safety: if pathname doesn't change within 3s, complete + fade.
    safetyTimerRef.current = setTimeout(() => {
      clearRaf();
      setProgress(100);
      // Let the bar sit at 100% briefly, then reset to idle.
      setTimeout(() => setProgress(null), 300);
    }, 3000);
  }, [enabled, clearRaf, clearSafety]);

  // Global click listener — qualifies a click as "navigation" if the
  // target (or closest ancestor) is an internal <a> or a form's submit
  // button.
  React.useEffect(() => {
    if (!enabled) return;
    function onClick(e: MouseEvent) {
      const target = e.target as Element | null;
      if (!target) return;
      // Ignore modified clicks (new tab, etc.)
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (e.defaultPrevented) return;

      // Internal <a href>?
      const anchor = target.closest(
        'a[href]:not([href^="http://"]):not([href^="https://"]):not([href^="//"]):not([href^="mailto:"]):not([href^="tel:"])',
      ) as HTMLAnchorElement | null;
      if (anchor) {
        const href = anchor.getAttribute("href") ?? "";
        const targetAttr = anchor.getAttribute("target");
        if (targetAttr === "_blank") return;
        // Only internal routes qualify
        if (href.startsWith("/")) {
          startLoading();
          return;
        }
        return;
      }

      // Submit button inside a form?
      const button = target.closest("button");
      if (button) {
        const type = button.getAttribute("type") ?? "submit";
        if (type === "submit" && button.closest("form")) {
          startLoading();
          return;
        }
      }
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [enabled, startLoading]);

  // When the pathname changes (real navigation happened), complete the bar.
  // Using a ref to compare against the previous pathname so we don't fire
  // on the very first mount.
  const prevPathRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!enabled) {
      prevPathRef.current = pathname;
      return;
    }
    if (prevPathRef.current == null) {
      // First mount — don't flash the bar, just record.
      prevPathRef.current = pathname;
      return;
    }
    if (prevPathRef.current !== pathname) {
      prevPathRef.current = pathname;
      // If we were loading, complete the bar; otherwise stay idle.
      setProgress((cur) => (cur == null ? null : 100));
      clearRaf();
      clearSafety();
      // Reset to idle shortly after the completion animation.
      const t = setTimeout(() => setProgress(null), 300);
      return () => clearTimeout(t);
    }
  }, [pathname, enabled, clearRaf, clearSafety]);

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      clearRaf();
      clearSafety();
    };
  }, [clearRaf, clearSafety]);

  if (!enabled) return null;

  const visible = progress != null;
  // The bar's width = progress% during 0..80, then 100% during the
  // completion step. We use scaleX so the bar can shrink/grow without
  // layout thrash.
  const scaleX = progress == null ? 0 : Math.max(0, Math.min(100, progress)) / 100;

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          key="nav-progress"
          className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-1 origin-left"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          aria-hidden="true"
        >
          <motion.div
            className="h-full w-full bg-primary shadow-[0_0_8px_0_rgba(16,185,129,0.45)]"
            style={{ transformOrigin: "left center" }}
            initial={{ scaleX: 0 }}
            animate={{ scaleX }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
