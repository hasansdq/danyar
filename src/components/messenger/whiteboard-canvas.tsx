"use client";

import * as React from "react";
import {
  Eraser,
  Pencil,
  Square,
  Circle as CircleIcon,
  ArrowUpRight,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { WhiteboardStroke } from "./use-classroom-socket";

/* ========================================================================== */
/* Types + constants                                                          */
/* ========================================================================== */

type Tool = "pencil" | "eraser" | "rectangle" | "circle" | "arrow";

interface WhiteboardCanvasProps {
  /** true for teacher (can draw), false for students (view-only). */
  canDraw: boolean;
  /** true = transparent overlay on screen share; false = standalone full-size. */
  isOverlay: boolean;
  className?: string;
  /** Socket actions (from the classroom hook). */
  sendStroke: (stroke: WhiteboardStroke) => void;
  sendClear: () => void;
  sendFullState: (toUserId: string, strokes: WhiteboardStroke[]) => void;
  /** Socket listeners (register a callback, return an unsubscribe function). */
  onStroke: (cb: (stroke: WhiteboardStroke) => void) => () => void;
  onClear: (cb: () => void) => () => void;
  onRequestState: (cb: (fromUserId: string) => void) => () => void;
  onFullState: (cb: (strokes: WhiteboardStroke[]) => void) => () => void;
  /** Close whiteboard button handler. */
  onClose: () => void;
}

const COLORS = [
  { value: "#000000", label: "مشکی" },
  { value: "#ef4444", label: "قرمز" },
  { value: "#3b82f6", label: "آبی" },
  { value: "#10b981", label: "سبز" },
  { value: "#ffffff", label: "سفید" },
];

const SIZES = [2, 5, 10, 20];

/* ========================================================================== */
/* Component                                                                  */
/* ========================================================================== */

export function WhiteboardCanvas({
  canDraw,
  isOverlay,
  className,
  sendStroke,
  sendClear,
  sendFullState,
  onStroke,
  onClear,
  onRequestState,
  onFullState,
  onClose,
}: WhiteboardCanvasProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const ctxRef = React.useRef<CanvasRenderingContext2D | null>(null);

  // Committed strokes (already finalized). Kept in a ref so re-renders
  // don't lose drawing state.
  const strokesRef = React.useRef<WhiteboardStroke[]>([]);
  // The in-progress stroke (while the pointer is down). Null when idle.
  const currentStrokeRef = React.useRef<WhiteboardStroke | null>(null);

  // Current tool/color/size (toolbar state).
  const [tool, setTool] = React.useState<Tool>("pencil");
  const [color, setColor] = React.useState<string>("#000000");
  const [size, setSize] = React.useState<number>(5);
  // Refs mirroring the toolbar state so the (stable) pointer event handlers
  // can read the latest values without re-registering the listeners.
  const toolRef = React.useRef<Tool>(tool);
  const colorRef = React.useRef<string>(color);
  const sizeRef = React.useRef<number>(size);
  React.useEffect(() => { toolRef.current = tool; }, [tool]);
  React.useEffect(() => { colorRef.current = color; }, [color]);
  React.useEffect(() => { sizeRef.current = size; }, [size]);

  // Whether the user is currently drawing (pointer is down). Ref so the
  // stable pointer handlers can read it without re-registering.
  const isDrawingRef = React.useRef<boolean>(false);

  /* ---------- Drawing helpers ---------- */

  /** Draw a single stroke on the canvas. The stroke's points are normalized
   * (0..1); this function multiplies by the canvas's CSS pixel dimensions. */
  const drawStroke = React.useCallback(
    (ctx: CanvasRenderingContext2D, stroke: WhiteboardStroke) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w <= 0 || h <= 0) return;
      const pts = stroke.points.map((p) => ({ x: p.x * w, y: p.y * h }));
      ctx.strokeStyle = stroke.color;
      ctx.fillStyle = stroke.color;
      ctx.lineWidth = stroke.size;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      if (pts.length === 0) return;

      if (stroke.tool === "eraser") {
        ctx.save();
        ctx.globalCompositeOperation = "destination-out";
        if (pts.length === 1) {
          // Single point — draw a dot.
          ctx.beginPath();
          ctx.arc(pts[0].x, pts[0].y, stroke.size / 2, 0, 2 * Math.PI);
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
          ctx.stroke();
        }
        ctx.restore();
        return;
      }

      if (stroke.tool === "pencil") {
        if (pts.length === 1) {
          ctx.beginPath();
          ctx.arc(pts[0].x, pts[0].y, stroke.size / 2, 0, 2 * Math.PI);
          ctx.fill();
          return;
        }
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
        return;
      }

      if (stroke.tool === "rectangle") {
        if (pts.length < 2) return;
        const x = Math.min(pts[0].x, pts[1].x);
        const y = Math.min(pts[0].y, pts[1].y);
        const rw = Math.abs(pts[1].x - pts[0].x);
        const rh = Math.abs(pts[1].y - pts[0].y);
        ctx.strokeRect(x, y, rw, rh);
        return;
      }

      if (stroke.tool === "circle") {
        if (pts.length < 2) return;
        const cx = pts[0].x;
        const cy = pts[0].y;
        const dx = pts[1].x - cx;
        const dy = pts[1].y - cy;
        const r = Math.sqrt(dx * dx + dy * dy);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, 2 * Math.PI);
        ctx.stroke();
        return;
      }

      if (stroke.tool === "arrow") {
        if (pts.length < 2) return;
        const from = pts[0];
        const to = pts[1];
        // Line from start to end.
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
        // Arrowhead — two short lines at 30° angles from the line direction.
        const angle = Math.atan2(to.y - from.y, to.x - from.x);
        const arrowLen = Math.max(15, stroke.size * 4);
        // The arrowhead points BACK from `to` along the line direction.
        // angle1 = angle + 150° (180° - 30°), angle2 = angle + 210° (180° + 30°).
        const angle1 = angle + Math.PI - Math.PI / 6;
        const angle2 = angle + Math.PI + Math.PI / 6;
        ctx.beginPath();
        ctx.moveTo(to.x, to.y);
        ctx.lineTo(to.x + arrowLen * Math.cos(angle1), to.y + arrowLen * Math.sin(angle1));
        ctx.moveTo(to.x, to.y);
        ctx.lineTo(to.x + arrowLen * Math.cos(angle2), to.y + arrowLen * Math.sin(angle2));
        ctx.stroke();
        return;
      }
    },
    [],
  );

  /** Clear the canvas + redraw all committed strokes + the in-progress stroke. */
  const redrawAll = React.useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx) return;
    // Clear using the actual pixel dimensions (the transform is applied
    // for drawing, but clearing should cover the whole backing store).
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    for (const s of strokesRef.current) drawStroke(ctx, s);
    if (currentStrokeRef.current) drawStroke(ctx, currentStrokeRef.current);
  }, [drawStroke]);

  /* ---------- Canvas setup (high-DPI + ResizeObserver) ---------- */
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctxRef.current = ctx;

    const setup = () => {
      const c = canvasRef.current;
      const cx = ctxRef.current;
      if (!c || !cx) return;
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (w <= 0 || h <= 0) return;
      // High-DPI: set the backing store to actual pixel dimensions, scale
      // the context so we can draw in CSS pixel coordinates.
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      cx.setTransform(1, 0, 0, 1, 0, 0);
      cx.scale(dpr, dpr);
      redrawAll();
    };
    setup();

    // Re-setup + redraw on resize (so strokes stay correctly positioned).
    const ro = new ResizeObserver(() => setup());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [redrawAll]);

  /* ---------- Pointer event handlers (only when canDraw) ---------- */

  /** Get a normalized (0..1) point from a pointer event. */
  const getPoint = React.useCallback((e: PointerEvent | React.PointerEvent): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const w = rect.width || 1;
    const h = rect.height || 1;
    const x = (e.clientX - rect.left) / w;
    const y = (e.clientY - rect.top) / h;
    return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
  }, []);

  // Register native pointer event listeners on the canvas (so we can
  // preventDefault on touch events to avoid scrolling while drawing).
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !canDraw) return;

    const onDown = (e: PointerEvent) => {
      if (!canDraw) return;
      e.preventDefault();
      console.log("[whiteboard] pointerdown", e.clientX, e.clientY);
      // Capture the pointer so we keep getting move events even if the
      // pointer leaves the canvas.
      try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      const point = getPoint(e);
      console.log("[whiteboard] point", point, "tool", toolRef.current);
      const stroke: WhiteboardStroke = {
        tool: toolRef.current,
        color: colorRef.current,
        size: sizeRef.current,
        points: [point],
      };
      currentStrokeRef.current = stroke;
      isDrawingRef.current = true;
      redrawAll();
    };
    const onMove = (e: PointerEvent) => {
      if (!canDraw || !isDrawingRef.current) return;
      e.preventDefault();
      const stroke = currentStrokeRef.current;
      if (!stroke) return;
      const point = getPoint(e);
      if (stroke.tool === "pencil" || stroke.tool === "eraser") {
        stroke.points.push(point);
      } else {
        // For shapes — keep exactly 2 points (start + end).
        if (stroke.points.length < 2) stroke.points.push(point);
        else stroke.points[1] = point;
      }
      redrawAll();
    };
    const onUp = (e: PointerEvent) => {
      if (!canDraw || !isDrawingRef.current) return;
      e.preventDefault();
      console.log("[whiteboard] pointerup", e.clientX, e.clientY);
      try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      const stroke = currentStrokeRef.current;
      currentStrokeRef.current = null;
      isDrawingRef.current = false;
      if (!stroke || stroke.points.length === 0) return;
      // Commit the stroke locally + render it.
      strokesRef.current.push(stroke);
      // Emit to the server (teacher only — canDraw).
      sendStroke(stroke);
      redrawAll();
    };
    const onCancel = () => {
      currentStrokeRef.current = null;
      isDrawingRef.current = false;
      redrawAll();
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    // Prevent the browser's touch gestures (scroll/zoom) from interfering
    // with drawing on touch devices.
    const onTouchStart = (e: TouchEvent) => { if (canDraw && isDrawingRef.current) e.preventDefault(); };
    const onTouchMove = (e: TouchEvent) => { if (canDraw && isDrawingRef.current) e.preventDefault(); };
    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });

    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
    };
  }, [canDraw, getPoint, redrawAll, sendStroke]);

  /* ---------- Socket event listeners ---------- */
  // Subscribe to whiteboard_stroke + whiteboard_clear + whiteboard_full_state
  // events. For students (canDraw=false), these add/clear/replace the local
  // strokes list. For teachers (canDraw=true), we also listen for
  // whiteboard_request_state (a student just joined + the server asks us
  // for the current state) — we respond by sending the full list of strokes.
  React.useEffect(() => {
    const offStroke = onStroke?.((stroke) => {
      strokesRef.current.push(stroke);
      redrawAll();
    });
    const offClear = onClear?.(() => {
      strokesRef.current = [];
      currentStrokeRef.current = null;
      redrawAll();
    });
    const offFull = onFullState?.((strokes) => {
      strokesRef.current = Array.isArray(strokes) ? strokes.slice() : [];
      currentStrokeRef.current = null;
      redrawAll();
    });
    const offRequest = canDraw
      ? onRequestState?.((fromUserId) => {
          // A student just joined. Send them the current full list of strokes.
          sendFullState(fromUserId, strokesRef.current.slice());
        })
      : undefined;
    return () => {
      offStroke?.();
      offClear?.();
      offFull?.();
      offRequest?.();
    };
  }, [canDraw, onStroke, onClear, onFullState, onRequestState, sendFullState, redrawAll]);

  /* ---------- Clear button handler ---------- */
  const handleClear = React.useCallback(() => {
    if (!canDraw) return;
    strokesRef.current = [];
    currentStrokeRef.current = null;
    redrawAll();
    sendClear();
  }, [canDraw, redrawAll, sendClear]);

  /* ---------- Render ---------- */
  return (
    <div
      className={cn(
        "relative h-full w-full",
        isOverlay ? "bg-transparent" : "bg-white",
        className,
      )}
      dir="ltr" /* Drawing canvas always LTR — coordinates are absolute */
    >
      <canvas
        ref={canvasRef}
        className={cn(
          "absolute inset-0 h-full w-full touch-none",
          canDraw ? "cursor-crosshair" : "cursor-default",
        )}
        style={{ touchAction: "none" }}
      />

      {/* Floating toolbar — only for the teacher (canDraw). */}
      {canDraw && (
        <div
          className="pointer-events-none absolute inset-x-0 top-2 z-20 flex justify-center px-2"
          dir="rtl"
        >
          <div className="pointer-events-auto flex flex-wrap items-center gap-1 rounded-xl border border-zinc-700 bg-zinc-900/95 p-1.5 shadow-lg backdrop-blur">
            {/* Tool buttons */}
            <ToolButton
              active={tool === "pencil"}
              onClick={() => setTool("pencil")}
              title="مداد"
              icon={<Pencil className="size-4" />}
            />
            <ToolButton
              active={tool === "eraser"}
              onClick={() => setTool("eraser")}
              title="پاک‌کن"
              icon={<Eraser className="size-4" />}
            />
            <ToolButton
              active={tool === "rectangle"}
              onClick={() => setTool("rectangle")}
              title="مستطیل"
              icon={<Square className="size-4" />}
            />
            <ToolButton
              active={tool === "circle"}
              onClick={() => setTool("circle")}
              title="دایره"
              icon={<CircleIcon className="size-4" />}
            />
            <ToolButton
              active={tool === "arrow"}
              onClick={() => setTool("arrow")}
              title="فلش"
              icon={<ArrowUpRight className="size-4" />}
            />

            <div className="mx-1 h-6 w-px bg-zinc-700" />

            {/* Color swatches */}
            <div className="flex items-center gap-1">
              {COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setColor(c.value)}
                  title={c.label}
                  className={cn(
                    "size-6 rounded-full border transition-transform hover:scale-110",
                    color === c.value
                      ? "border-emerald-500 ring-2 ring-emerald-500/50"
                      : "border-zinc-500",
                  )}
                  style={{ backgroundColor: c.value }}
                />
              ))}
            </div>

            <div className="mx-1 h-6 w-px bg-zinc-700" />

            {/* Size selector */}
            <div className="flex items-center gap-1.5 px-1">
              <span className="text-[10px] text-zinc-400">اندازه</span>
              <div className="flex items-center gap-0.5">
                {SIZES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSize(s)}
                    title={`${s} پیکسل`}
                    className={cn(
                      "flex size-7 items-center justify-center rounded-md transition-colors",
                      size === s
                        ? "bg-emerald-600 text-white"
                        : "text-zinc-400 hover:bg-zinc-800 hover:text-white",
                    )}
                  >
                    <span
                      className="block rounded-full bg-current"
                      style={{
                        width: `${Math.min(s, 16)}px`,
                        height: `${Math.min(s, 16)}px`,
                      }}
                    />
                  </button>
                ))}
              </div>
            </div>

            <div className="mx-1 h-6 w-px bg-zinc-700" />

            {/* Clear button */}
            <button
              type="button"
              onClick={handleClear}
              title="پاک کردن تخته"
              className="flex items-center gap-1 rounded-md bg-red-600/90 px-2 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700"
            >
              <Trash2 className="size-3.5" />
              پاک کردن
            </button>

            {/* Close button */}
            <button
              type="button"
              onClick={onClose}
              title="بستن تخته سفید"
              className="flex items-center gap-1 rounded-md bg-zinc-700 px-2 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-600"
            >
              <X className="size-3.5" />
              بستن تخته
            </button>
          </div>
        </div>
      )}

      {/* View-only badge for students */}
      {!canDraw && (
        <div
          className="pointer-events-none absolute right-2 top-2 z-20 rounded-md bg-zinc-900/80 px-2 py-1 text-[10px] text-white backdrop-blur"
          dir="rtl"
        >
          نمایش فقط — فقط معلم می‌تواند رسم کند
        </div>
      )}
    </div>
  );
}

/* ========================================================================== */
/* Tool button                                                                */
/* ========================================================================== */

function ToolButton({
  active,
  onClick,
  title,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "flex size-8 items-center justify-center rounded-md transition-colors",
        active
          ? "bg-emerald-600 text-white"
          : "text-zinc-300 hover:bg-zinc-800 hover:text-white",
      )}
    >
      {icon}
    </button>
  );
}
