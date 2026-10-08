"use client";

import * as React from "react";

/**
 * useSwipeToReply — shared hook for the swipe-right-to-reply gesture on a
 * message row.
 *
 * Telegram/WhatsApp UX: drag a message row to the right (in LTR) / left
 * edge in RTL — a Reply icon slides in from the left with opacity; when
 * the drag distance crosses the threshold (60px), `onReply()` fires and
 * the gesture snaps back.
 *
 * Touch + mouse handlers. Axis lock: once a drag is recognised as
 * horizontal (delta X > 4px greater than delta Y), only horizontal
 * movement counts — vertical scrolling is left to the browser. The
 * click-vs-drag threshold (5px) prevents accidental reply triggers when
 * the user just taps a bubble.
 *
 * Returns:
 * {
 *   swipeX,           // number — current horizontal translateX (px). 0..MAX.
 *   isSwiping,        // bool — true while a drag is in progress.
 *   showReplyIcon,    // bool — true when swipeX > 0 (icon should render).
 *   replyIconOpacity, // number — 0..1, grows with swipeX / THRESHOLD.
 *   handlers,         // spread onto the row wrapper div:
 *                     //   onTouchStart, onTouchMove, onTouchEnd,
 *                     //   onMouseDown, onMouseMove, onMouseUp, onMouseLeave,
 *                     //   onClick
 * }
 *
 * USAGE:
 *   const swipe = useSwipeToReply(() => setReplyTo(message));
 *   <div style={{ transform: `translateX(${swipe.swipeX}px)` }} {...swipe.handlers}>
 *     {swipe.showReplyIcon ? <ReplyIcon style={{ opacity: swipe.replyIconOpacity }} /> : null}
 *     ...bubble...
 *   </div>
 */

// Thresholds (pixels). Exported so consumers can reference them in
// CSS / transition definitions.
export const SWIPE_REPLY_THRESHOLD = 60;
export const SWIPE_REPLY_MAX = 80;
export const SWIPE_AXIS_LOCK = 4;
export const SWIPE_CLICK_THRESHOLD = 5;

/** Tailwind transition classes for the bubble transform + icon opacity.
 *  Importing these keeps the row's transition definition in sync with the
 *  hook's measurement cadence. */
export const SWIPE_TRANSITION_BUBBLE = "transition-transform duration-200 ease-out";
export const SWIPE_TRANSITION_ICON = "transition-opacity duration-200 ease-out";

type Pointer = {
  startX: number;
  startY: number;
  curX: number;
  curY: number;
  axisLocked: "none" | "horizontal" | "vertical";
};

export function useSwipeToReply(onReply?: () => void) {
  const [swipeX, setSwipeX] = React.useState(0);
  const [isSwiping, setIsSwiping] = React.useState(false);

  // Mutable pointer state held in a ref so the move/end handlers can read
  // the latest values without re-creating the handler closures on every
  // state change.
  const pointerRef = React.useRef<Pointer | null>(null);
  // Track whether the gesture has been "fired" — we only invoke onReply
  // once per gesture (prevents double-fires when the user keeps dragging
  // past the threshold).
  const firedRef = React.useRef(false);
  // Whether a touch drag is being tracked. We use this to suppress the
  // click handler that fires right after touchend on touch devices.
  const wasDragRef = React.useRef(false);

  // Track long-press context menu — if a contextmenu fires mid-drag, we
  // cancel the drag so the menu opens cleanly without a stuck offset.
  const justFiredRef = React.useRef(false);

  const onReplyRef = React.useRef(onReply);
  React.useEffect(() => {
    onReplyRef.current = onReply;
  }, [onReply]);

  // ----- Internal helpers -----

  function clampSwipe(x: number): number {
    // Phase 35g: swipe LEFT — only negative values are tracked.
    if (x > 0) return 0;
    if (x < -SWIPE_REPLY_MAX) return -SWIPE_REPLY_MAX;
    return x;
  }

  function endSwipe(fireIfThreshold: boolean) {
    const pointer = pointerRef.current;
    pointerRef.current = null;
    const wasDrag = wasDragRef.current;
    wasDragRef.current = false;

    const finalX = swipeXRef.current;
    setIsSwiping(false);

    // If the drag crossed the threshold + we haven't fired yet, fire now.
    if (fireIfThreshold && Math.abs(finalX) >= SWIPE_REPLY_THRESHOLD && !firedRef.current) {
      firedRef.current = true;
      justFiredRef.current = true;
      // Defer the onReply call to the next microtask so the click event
      // (which fires immediately after touchend on touch devices) sees
      // `justFiredRef === true` and gets suppressed.
      setTimeout(() => {
        justFiredRef.current = false;
        onReplyRef.current?.();
      }, 0);
    } else if (!fireIfThreshold) {
      // Cancelled (e.g. pointercancel / contextmenu) — don't fire.
      firedRef.current = false;
    }

    // Snap back to 0 with the transition (the row's CSS transition handles
    // the animation — we just zero the value here).
    setSwipeX(0);

    // Reset the fired flag for the NEXT gesture. We do it on a timer so
    // the current gesture's "fire" can complete first.
    if (fireIfThreshold) {
      setTimeout(() => {
        firedRef.current = false;
      }, 50);
    }
    // Touch-only: clear the wasDrag flag after a tick so the synthetic
    // click event sees it.
    if (wasDrag) {
      setTimeout(() => {
        wasDragRef.current = false;
      }, 50);
    }
  }

  // Keep a ref to the latest swipeX so endSwipe can read it without
  // re-subscribing handlers on every render.
  const swipeXRef = React.useRef(0);
  React.useEffect(() => {
    swipeXRef.current = swipeX;
  }, [swipeX]);

  // ----- Touch handlers -----

  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    if (!t) return;
    pointerRef.current = {
      startX: t.clientX,
      startY: t.clientY,
      curX: t.clientX,
      curY: t.clientY,
      axisLocked: "none",
    };
    firedRef.current = false;
    setIsSwiping(true);
  }

  function onTouchMove(e: React.TouchEvent) {
    const pointer = pointerRef.current;
    if (!pointer) return;
    const t = e.touches[0];
    if (!t) return;
    pointer.curX = t.clientX;
    pointer.curY = t.clientY;
    const dx = t.clientX - pointer.startX;
    const dy = t.clientY - pointer.startY;

    if (pointer.axisLocked === "none") {
      // Axis-lock: only commit to horizontal once dx exceeds dy by >4px.
      if (Math.abs(dx) - Math.abs(dy) > SWIPE_AXIS_LOCK) {
        pointer.axisLocked = "horizontal";
      } else if (Math.abs(dy) - Math.abs(dx) > SWIPE_AXIS_LOCK) {
        pointer.axisLocked = "vertical";
        // Stop tracking — let the browser scroll vertically.
        pointerRef.current = null;
        setIsSwiping(false);
        setSwipeX(0);
        return;
      } else {
        return; // still ambiguous
      }
    }
    if (pointer.axisLocked !== "horizontal") return;

    // Prevent the browser from scrolling while we drag horizontally.
    if (e.cancelable) e.preventDefault();
    wasDragRef.current = true;
    // RTL note: in RTL, swiping RIGHT physically means the user is
    // dragging the bubble to the right. We translate by +dx (rightward
    // drag = positive swipeX). The Reply icon is positioned on the
    // START edge (right edge in RTL), so it appears as the bubble slides
    // to the right.
    // Phase 35g: swipe LEFT — track negative dx (leftward drag).
    setSwipeX(clampSwipe(Math.min(0, dx)));
  }

  function onTouchEnd() {
    endSwipe(true);
  }

  function onTouchCancel() {
    endSwipe(false);
  }

  // ----- Mouse handlers (desktop) -----

  function onMouseDown(e: React.MouseEvent) {
    // Only left button.
    if (e.button !== 0) return;
    pointerRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      curX: e.clientX,
      curY: e.clientY,
      axisLocked: "none",
    };
    firedRef.current = false;
    setIsSwiping(true);
  }

  function onMouseMove(e: React.MouseEvent) {
    const pointer = pointerRef.current;
    if (!pointer) return;
    pointer.curX = e.clientX;
    pointer.curY = e.clientY;
    const dx = e.clientX - pointer.startX;
    const dy = e.clientY - pointer.startY;

    if (pointer.axisLocked === "none") {
      if (Math.abs(dx) - Math.abs(dy) > SWIPE_AXIS_LOCK) {
        pointer.axisLocked = "horizontal";
      } else if (Math.abs(dy) - Math.abs(dx) > SWIPE_AXIS_LOCK) {
        pointer.axisLocked = "vertical";
        pointerRef.current = null;
        setIsSwiping(false);
        setSwipeX(0);
        return;
      } else {
        return;
      }
    }
    if (pointer.axisLocked !== "horizontal") return;
    wasDragRef.current = true;
    // Phase 35g: swipe LEFT — track negative dx (leftward drag).
    setSwipeX(clampSwipe(Math.min(0, dx)));
  }

  function onMouseUp() {
    endSwipe(true);
  }

  function onMouseLeave() {
    if (pointerRef.current) {
      endSwipe(true);
    }
  }

  // ----- Click handler — suppress when this gesture was a drag -----
  function onClick(e: React.MouseEvent) {
    if (justFiredRef.current) {
      // We just fired onReply — suppress the click that follows.
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (wasDragRef.current) {
      // The user dragged past the click threshold — don't trigger the
      // click handler (e.g. opening the bubble's link).
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // Otherwise: it was a tap/click under the threshold. Check that the
    // pointer didn't move more than SWIPE_CLICK_THRESHOLD — if it did,
    // treat as a drag and suppress.
    const pointer = pointerRef.current;
    if (pointer) {
      const dx = Math.abs(pointer.curX - pointer.startX);
      const dy = Math.abs(pointer.curY - pointer.startY);
      if (dx > SWIPE_CLICK_THRESHOLD || dy > SWIPE_CLICK_THRESHOLD) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
  }

  // ----- Derived render state -----
  // Phase 35g: swipeX is negative (leftward). showReplyIcon checks < 0.
  const showReplyIcon = swipeX < 0;
  const replyIconOpacity = Math.min(
    1,
    Math.abs(swipeX) / SWIPE_REPLY_THRESHOLD,
  );

  return {
    swipeX,
    isSwiping,
    showReplyIcon,
    replyIconOpacity,
    handlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onTouchCancel,
      onMouseDown,
      onMouseMove,
      onMouseUp,
      onMouseLeave,
      onClick,
    },
  };
}
