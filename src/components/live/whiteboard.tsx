'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowUpRight,
  Circle,
  Eraser,
  Maximize2,
  Minimize2,
  Minus,
  Pencil,
  Square,
  Trash2,
  Undo2,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useFullscreenElement } from '@/lib/use-fullscreen'

/**
 * تخته سفید حرفه‌ای کلاس آنلاین — فقط معلم ترسیم می‌کند، دانش‌آموزان مشاهده می‌کنند.
 * - ابزارها: مداد، پاک‌کن، خط، فلش، مستطیل، بیضی
 * - تنظیمات: رنگ + ضخامت + برگشت (undo) + پاک‌سازی کامل
 * - مختصات نرمال (۰..۱) — روی هر اندازه صفحه دقیقاً همان شکل دیده می‌شود
 * - دو لایه بوم: لایه پایه (عملیات تأییدشده) + لایه زنده (ترسیم جاری)
 */

export type WbTool = 'pen' | 'eraser' | 'line' | 'arrow' | 'rect' | 'ellipse'

export interface WbStrokeOp {
  type: 'stroke'
  tool: WbTool
  color: string
  width: number
  points: [number, number][]
}

export type WbOp = WbStrokeOp | { type: 'undo' } | { type: 'clear' }

const COLORS = ['#111827', '#dc2626', '#2563eb', '#16a34a', '#ea580c', '#9333ea']
const WIDTHS = [2, 4, 8]

const TOOL_ITEMS: { tool: WbTool; label: string; icon: React.ReactNode }[] = [
  { tool: 'pen', label: 'مداد', icon: <Pencil className="h-4 w-4" /> },
  { tool: 'eraser', label: 'پاک‌کن', icon: <Eraser className="h-4 w-4" /> },
  { tool: 'line', label: 'خط', icon: <Minus className="h-4 w-4" /> },
  { tool: 'arrow', label: 'فلش', icon: <ArrowUpRight className="h-4 w-4" /> },
  { tool: 'rect', label: 'مستطیل', icon: <Square className="h-4 w-4" /> },
  { tool: 'ellipse', label: 'بیضی', icon: <Circle className="h-4 w-4" /> },
]

/** بازپخش عملیات → ترسیم‌های مؤثر (undo و clear درجا اعمال می‌شوند) */
function effectiveStrokes(ops: WbOp[]): WbStrokeOp[] {
  const out: WbStrokeOp[] = []
  for (const op of ops) {
    if (op.type === 'stroke') out.push(op)
    else if (op.type === 'undo') out.pop()
    else if (op.type === 'clear') out.length = 0
  }
  return out
}

function drawStroke(
  ctx: CanvasRenderingContext2D,
  s: WbStrokeOp,
  w: number,
  h: number,
) {
  const pts = s.points.map(([x, y]) => [x * w, y * h] as [number, number])
  if (pts.length === 0) return
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = s.tool === 'eraser' ? '#ffffff' : s.color
  ctx.lineWidth = s.tool === 'eraser' ? Math.max(12, s.width * 6) : s.width
  ctx.beginPath()
  if (s.tool === 'pen' || s.tool === 'eraser') {
    ctx.moveTo(pts[0][0], pts[0][1])
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
    if (pts.length === 1) ctx.lineTo(pts[0][0] + 0.01, pts[0][1])
    ctx.stroke()
  } else if (s.tool === 'line' || s.tool === 'arrow') {
    const [x0, y0] = pts[0]
    const [x1, y1] = pts[pts.length - 1]
    ctx.moveTo(x0, y0)
    ctx.lineTo(x1, y1)
    ctx.stroke()
    if (s.tool === 'arrow') {
      const ang = Math.atan2(y1 - y0, x1 - x0)
      const head = Math.max(12, s.width * 4)
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x1 - head * Math.cos(ang - Math.PI / 6), y1 - head * Math.sin(ang - Math.PI / 6))
      ctx.moveTo(x1, y1)
      ctx.lineTo(x1 - head * Math.cos(ang + Math.PI / 6), y1 - head * Math.sin(ang + Math.PI / 6))
      ctx.stroke()
    }
  } else if (s.tool === 'rect') {
    const [x0, y0] = pts[0]
    const [x1, y1] = pts[pts.length - 1]
    ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0))
  } else if (s.tool === 'ellipse') {
    const [x0, y0] = pts[0]
    const [x1, y1] = pts[pts.length - 1]
    ctx.beginPath()
    ctx.ellipse(
      (x0 + x1) / 2,
      (y0 + y1) / 2,
      Math.abs(x1 - x0) / 2,
      Math.abs(y1 - y0) / 2,
      0,
      0,
      Math.PI * 2,
    )
    ctx.stroke()
  }
  ctx.restore()
}

/** اندازه‌گذاری بوم با devicePixelRatio و برگرداندن زمینه + ابعاد CSS */
function setupCanvas(canvas: HTMLCanvasElement, w: number, h: number) {
  const dpr = window.devicePixelRatio || 1
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return { ctx, w, h }
}

export function Whiteboard({
  ops,
  readOnly,
  onCommit,
  onClose,
  className,
}: {
  /** عملیات تأییدشده (همگام‌شده از سرور) */
  ops: WbOp[]
  /** دانش‌آموز فقط مشاهده می‌کند */
  readOnly: boolean
  /** ترسیم/undo/clear معلم — هم محلی و هم ارسال به سرور */
  onCommit: (op: WbOp) => void
  /** بستن تخته (فقط معلم) */
  onClose?: () => void
  className?: string
}) {
  const [tool, setTool] = useState<WbTool>('pen')
  const [color, setColor] = useState(COLORS[0])
  const [width, setWidth] = useState(WIDTHS[1])

  // تمام‌صفحه تخته — برای معلم و دانش‌آموز (همه نقش‌ها)
  const { attach: fsAttach, active: fsActive, fake: fsFake, toggle: fsToggle } =
    useFullscreenElement<HTMLDivElement>()

  const wrapRef = useRef<HTMLDivElement>(null)
  const baseRef = useRef<HTMLCanvasElement>(null)
  const liveRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef<WbStrokeOp | null>(null)

  /** بازترسیم لایه پایه — با تغییر عملیات یا اندازه */
  const redrawBase = useCallback(() => {
    const canvas = baseRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const size = setupCanvas(canvas, wrap.clientWidth, wrap.clientHeight)
    if (!size) return
    const { ctx, w, h } = size
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    for (const s of effectiveStrokes(ops)) drawStroke(ctx, s, w, h)
  }, [ops])

  useEffect(() => {
    redrawBase()
  }, [redrawBase])

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const ro = new ResizeObserver(() => redrawBase())
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [redrawBase])

  /** بازترسیم لایه زنده (فقط ترسیم جاری) */
  const redrawLive = useCallback(() => {
    const canvas = liveRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const size = setupCanvas(canvas, wrap.clientWidth, wrap.clientHeight)
    if (!size) return
    const { ctx, w, h } = size
    ctx.clearRect(0, 0, w, h)
    if (drawingRef.current) drawStroke(ctx, drawingRef.current, w, h)
  }, [])

  const toNorm = (e: React.PointerEvent): [number, number] => {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return [0, 0]
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))
    return [x, y]
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (readOnly) return
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    drawingRef.current = { type: 'stroke', tool, color, width, points: [toNorm(e)] }
    redrawLive()
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drawingRef.current
    if (!d) return
    const pt = toNorm(e)
    if (d.tool === 'pen' || d.tool === 'eraser') d.points.push(pt)
    else d.points[1] = pt
    redrawLive()
  }

  const onPointerUp = () => {
    const d = drawingRef.current
    drawingRef.current = null
    redrawLive()
    if (!d) return
    // نقطه‌زنی (تپ) برای مداد/پاک‌کن: همان نقطه دوبار تا اعتبارسنجی سرور (حداقل ۲ نقطه)
    const op: WbStrokeOp =
      d.points.length === 1
        ? { ...d, points: [d.points[0], [d.points[0][0] + 0.001, d.points[0][1] + 0.001]] }
        : d
    onCommit(op)
  }

  const fullscreenBtn = (
    <button
      type="button"
      title={fsActive ? 'خروج از تمام‌صفحه تخته' : 'نمایش تخته در تمام‌صفحه'}
      aria-label={fsActive ? 'خروج از تمام‌صفحه تخته' : 'نمایش تخته در تمام‌صفحه'}
      onClick={fsToggle}
      data-wb-fullscreen
      className="h-8 w-8 rounded-lg flex items-center justify-center border bg-background hover:bg-accent"
    >
      {fsActive ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
    </button>
  )

  return (
    <div
      ref={fsAttach}
      className={cn(
        fsFake
          ? 'fixed inset-0 z-[100] flex flex-col overflow-hidden bg-white dark:bg-white'
          : 'flex flex-col overflow-hidden rounded-xl border bg-white dark:bg-white',
        className,
      )}
      data-testid="whiteboard"
    >
      {/* نوار ابزار — فقط معلم */}
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-1.5 border-b bg-muted/40 px-2 py-1.5">
          {TOOL_ITEMS.map((t) => (
            <button
              key={t.tool}
              type="button"
              title={t.label}
              aria-label={t.label}
              aria-pressed={tool === t.tool}
              onClick={() => setTool(t.tool)}
              data-wb-tool={t.tool}
              className={cn(
                'h-8 w-8 rounded-lg flex items-center justify-center border transition-colors',
                tool === t.tool
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background hover:bg-accent',
              )}
            >
              {t.icon}
            </button>
          ))}
          <span className="w-px h-6 bg-border mx-0.5" />
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              title="رنگ"
              aria-label={`رنگ ${c}`}
              aria-pressed={color === c}
              onClick={() => setColor(c)}
              data-wb-color={c}
              className={cn(
                'h-6 w-6 rounded-full border-2 transition-transform',
                color === c ? 'border-primary scale-110' : 'border-transparent',
              )}
              style={{ backgroundColor: c }}
            />
          ))}
          <span className="w-px h-6 bg-border mx-0.5" />
          {WIDTHS.map((wd) => (
            <button
              key={wd}
              type="button"
              title="ضخامت"
              aria-label={`ضخامت ${wd}`}
              aria-pressed={width === wd}
              onClick={() => setWidth(wd)}
              data-wb-width={wd}
              className={cn(
                'h-8 w-8 rounded-lg flex items-center justify-center border transition-colors',
                width === wd
                  ? 'bg-primary/10 border-primary'
                  : 'bg-background hover:bg-accent',
              )}
            >
              <span
                className="rounded-full bg-foreground"
                style={{ width: wd + 3, height: wd + 3 }}
              />
            </button>
          ))}
          <span className="w-px h-6 bg-border mx-0.5" />
          <button
            type="button"
            title="برگشت آخرین ترسیم"
            aria-label="برگشت"
            onClick={() => onCommit({ type: 'undo' })}
            data-wb-undo
            className="h-8 w-8 rounded-lg flex items-center justify-center border bg-background hover:bg-accent"
          >
            <Undo2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="پاک‌سازی کامل تخته"
            aria-label="پاک‌سازی"
            onClick={() => onCommit({ type: 'clear' })}
            data-wb-clear
            className="h-8 w-8 rounded-lg flex items-center justify-center border text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          {fullscreenBtn}
          {onClose && (
            <button
              type="button"
              title="بستن تخته سفید"
              aria-label="بستن تخته سفید"
              onClick={onClose}
              data-wb-close
              className="h-8 w-8 rounded-lg flex items-center justify-center border bg-background hover:bg-accent ms-auto"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      {/* بوم */}
      <div ref={wrapRef} className="relative flex-1 min-h-0 w-full touch-none">
        <canvas ref={baseRef} className="absolute inset-0 h-full w-full" />
        <canvas
          ref={liveRef}
          className={cn('absolute inset-0 h-full w-full', readOnly && 'pointer-events-none')}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
        {readOnly && (
          <>
            <span className="absolute top-2 start-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-bold text-white pointer-events-none">
              تخته سفید معلم — مشاهده
            </span>
            {/* تمام‌صفحه برای مشاهده‌کننده (دانش‌آموز) */}
            <div className="absolute top-2 end-2">{fullscreenBtn}</div>
          </>
        )}
      </div>
    </div>
  )
}
