"use client";

import * as React from "react";
import { RefreshCw } from "lucide-react";

/**
 * Pull-to-refresh wrapper — detects a "pull down" gesture at the top of
 * a scroll container and triggers `onRefresh`. Works on both touch
 * (mobile) and mouse (desktop) devices.
 *
 * Usage: wrap the scrollable content. When the user pulls down at the
 * top (scrollTop < 0), a spinner appears. If they pull past the
 * threshold, `onRefresh` fires.
 */
export function PullToRefresh({
  children,
  onRefresh,
  threshold = 70,
  className = "",
}: {
  children: React.ReactNode;
  onRefresh: () => void | Promise<void>;
  threshold?: number;
  className?: string;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [pull, setPull] = React.useState(0);
  const [refreshing, setRefreshing] = React.useState(false);
  const startY = React.useRef(0);
  const pulling = React.useRef(false);

  function onStart(y: number) {
    const el = containerRef.current;
    if (!el || el.scrollTop > 0) {
      pulling.current = false;
      return;
    }
    startY.current = y;
    pulling.current = true;
  }

  function onMove(y: number) {
    if (!pulling.current) return;
    const delta = y - startY.current;
    if (delta > 0) {
      // Dampen the pull so it feels elastic
      setPull(Math.min(delta * 0.5, threshold * 1.5));
    }
  }

  function onEnd() {
    if (!pulling.current) return;
    pulling.current = false;
    if (pull >= threshold) {
      setRefreshing(true);
      setPull(0);
      Promise.resolve(onRefresh()).finally(() => setRefreshing(false));
    } else {
      setPull(0);
    }
  }

  return (
    <div
      ref={containerRef}
      className={`relative overflow-y-auto ${className}`}
      onTouchStart={(e) => onStart(e.touches[0].clientY)}
      onTouchMove={(e) => onMove(e.touches[0].clientY)}
      onTouchEnd={onEnd}
      onMouseDown={(e) => onStart(e.clientY)}
      onMouseMove={(e) => {
        if (pulling.current) onMove(e.clientY);
      }}
      onMouseUp={onEnd}
      onMouseLeave={onEnd}
      style={{ overscrollBehavior: "contain" }}
    >
      {/* Pull indicator */}
      {(pull > 0 || refreshing) && (
        <div
          className="flex items-center justify-center"
          style={{ height: pull || (refreshing ? 40 : 0) }}
        >
          <RefreshCw
            className={`size-5 text-primary transition-opacity ${
              refreshing ? "animate-spin" : ""
            }`}
            style={{
              opacity: Math.min(pull / threshold, 1),
            }}
          />
        </div>
      )}
      {children}
    </div>
  );
}
