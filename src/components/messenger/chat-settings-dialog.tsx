"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Palette,
  Check,
  RotateCcw,
  Smartphone,
  Tablet,
  Monitor,
  Type,
  Save,
  X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  BACKGROUND_CATALOG,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  FONT_SIZE_OPTIONS,
  getBackground,
  resolveBackgroundCss,
  useChatAppearance,
} from "./chat-appearance";
import { deviceLabelPersian } from "./use-device-type";
import { toPersianDigits } from "./persian";

/**
 * Settings dialog for the messenger chat appearance.
 *
 * Shows ONLY the current device's settings (mobile users edit the mobile
 * slot, desktop users edit the desktop slot, etc.) — powered by
 * {@link useChatAppearance} which reads `useDeviceType()` internally.
 *
 * All changes apply INSTANTLY (background + font-size mutate the live
 * `useChatAppearance()` state, which the chat root consumes via the same
 * hook — so the chat re-renders with the new appearance while the dialog is
 * still open). The Save button just closes the dialog + confirms with a
 * toast (we don't need to "buffer" changes because localStorage already
 * persists every change live).
 *
 * Phase-10 fix: the dialog was too big on desktop and some options were
 * getting cut off (background picker grid + font-size + preview all had
 * to fit in the viewport). Now the DialogContent is constrained to
 * `max-h-[85vh] max-w-md overflow-y-auto` so it never exceeds the viewport
 * height, and every option is reachable by scrolling inside the dialog.
 */
export function ChatSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { settings, device, setBackground, setFontSize, reset } =
    useChatAppearance();
  const { resolvedTheme } = useTheme();
  const { toast } = useToast();

  // next-themes resolves the theme only after hydration; default to "light"
  // to match the project's `defaultTheme="light"`.
  const theme = resolvedTheme ?? "light";

  const previewBackgroundCss = resolveBackgroundCss(
    settings.background,
    theme,
  );

  function handleReset() {
    reset();
    toast({
      title: "بازنشانی شد",
      description: `تنظیمات ظاهری برای ${deviceLabelPersian(
        device,
      )} به حالت پیش‌فرض بازگشت.`,
    });
  }

  function handleSave() {
    // Changes are already applied live (localStorage is kept in sync by the
    // hook's effect). Save just confirms + closes — this matches the
    // task-spec pattern (a) "show a confirmation toast + close the dialog".
    toast({
      title: "تنظیمات ذخیره شد",
      description: `ظاهر گفتگو برای ${deviceLabelPersian(
        device,
      )} ذخیره شد.`,
    });
    onOpenChange(false);
  }

  const DeviceIcon =
    device === "mobile"
      ? Smartphone
      : device === "tablet"
        ? Tablet
        : Monitor;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* ---------- Constrained + scrollable container ----------
          max-h-[85vh] → never taller than 85% of the viewport so the
            dialog header + footer always stay reachable on every screen.
          max-w-md → narrower than the previous max-w-lg so the swatches
            + slider + preview all fit comfortably without huge gaps.
          overflow-y-auto → the inner scroll area grows with content;
            background grid (8 entries) + font-size + preview never get
            clipped, regardless of viewport height.
          flex flex-col → header/footer stay pinned while the middle
            scrolls (the dialog body has its own overflow). */}
      <DialogContent className="flex max-h-[85vh] max-w-md flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
        {/* ---------- HEADER (pinned) ---------- */}
        <DialogHeader className="shrink-0 border-b px-4 py-3 text-right">
          <DialogTitle className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Palette className="size-4" />
              </span>
              تنظیمات ظاهری پیام‌رسان
            </span>
            <Badge
              variant="secondary"
              className="gap-1 bg-primary/10 text-primary"
              title={`در حال ویرایش تنظیمات برای ${deviceLabelPersian(
                device,
              )}`}
            >
              <DeviceIcon className="size-3.5" />
              {deviceLabelPersian(device)}
            </Badge>
          </DialogTitle>
          <DialogDescription className="text-xs">
            پس‌زمینه و اندازه فونت گفتگو را برای{" "}
            <span className="font-medium text-foreground">
              {deviceLabelPersian(device)}
            </span>{" "}
            تنظیم کنید. تغییرات بلافاصله اعمال می‌شوند و فقط برای همین نوع
            دستگاه ذخیره می‌شوند.
          </DialogDescription>
        </DialogHeader>

        {/* ---------- BODY (scrollable) ---------- */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <div className="space-y-5">
            {/* ---------- Background picker section ---------- */}
            <section
              className="space-y-2 rounded-lg border border-border/60 p-3"
              aria-labelledby="bg-section-title"
            >
              <header className="flex items-center justify-between">
                <h3
                  id="bg-section-title"
                  className="flex items-center gap-1.5 text-sm font-medium"
                >
                  <span className="flex size-5 items-center justify-center rounded bg-primary/10 text-primary">
                    <Palette className="size-3" />
                  </span>
                  پس‌زمینه گفتگو
                </h3>
                <span className="text-[10px] text-muted-foreground">
                  {toPersianDigits(BACKGROUND_CATALOG.length)} گزینه
                </span>
              </header>
              {/* Responsive grid: 2 cols on mobile, 3 cols on sm+.
                  Each swatch has a label under it so the user knows what
                  they're picking. */}
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                {BACKGROUND_CATALOG.map((bg) => {
                  const selected = settings.background === bg.key;
                  const css = theme === "dark" ? bg.dark : bg.light;
                  return (
                    <button
                      key={bg.key}
                      type="button"
                      onClick={() => setBackground(bg.key)}
                      aria-pressed={selected}
                      aria-label={bg.label}
                      title={bg.label}
                      className={`group relative flex flex-col items-stretch gap-1.5 rounded-lg border p-1.5 text-right transition-colors ${
                        selected
                          ? "border-primary ring-2 ring-primary/40"
                          : "border-border hover:border-primary/50 hover:bg-accent/40"
                      }`}
                    >
                      <div
                        className="aspect-[4/3] w-full overflow-hidden rounded-md border border-border/60"
                        style={{ background: css }}
                        aria-hidden="true"
                      />
                      <span className="flex items-center justify-center gap-1 text-[11px] font-medium leading-tight">
                        {selected ? (
                          <Check className="size-3 shrink-0 text-primary" />
                        ) : null}
                        <span className="truncate text-foreground">
                          {bg.label}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* ---------- Font size section ---------- */}
            <section
              className="space-y-3 rounded-lg border border-border/60 p-3"
              aria-labelledby="font-section-title"
            >
              <header className="flex items-center justify-between">
                <h3
                  id="font-section-title"
                  className="flex items-center gap-1.5 text-sm font-medium"
                >
                  <span className="flex size-5 items-center justify-center rounded bg-primary/10 text-primary">
                    <Type className="size-3" />
                  </span>
                  اندازه فونت
                </h3>
                <span className="text-[11px] text-muted-foreground">
                  {toPersianDigits(settings.fontSize)} پیکسل
                </span>
              </header>

              <div className="flex items-center gap-3">
                <span className="text-[10px] text-muted-foreground">کوچک</span>
                <Slider
                  min={FONT_SIZE_MIN}
                  max={FONT_SIZE_MAX}
                  step={1}
                  value={[settings.fontSize]}
                  onValueChange={(v) => {
                    const next = Array.isArray(v) ? v[0] : v;
                    if (typeof next === "number") setFontSize(next);
                  }}
                  className="flex-1"
                  aria-label="اندازه فونت پیام‌رسان"
                />
                <span className="text-[10px] text-muted-foreground">بزرگ</span>
              </div>

              <Select
                value={String(settings.fontSize)}
                onValueChange={(v) => setFontSize(Number(v))}
              >
                <SelectTrigger className="w-full" aria-label="اندازه فونت">
                  <span className="flex items-center gap-2">
                    <Type className="size-3.5 text-muted-foreground" />
                    <SelectValue />
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {FONT_SIZE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={String(opt.value)}>
                      {opt.label} · {toPersianDigits(opt.value)} پیکسل
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </section>

            {/* ---------- Live preview section ---------- */}
            <section
              className="space-y-2 rounded-lg border border-border/60 p-3"
              aria-labelledby="preview-section-title"
            >
              <header className="flex items-center justify-between">
                <h3
                  id="preview-section-title"
                  className="text-sm font-medium"
                >
                  پیش‌نمایش
                </h3>
                <Badge
                  variant="secondary"
                  className="bg-emerald-500/10 px-1.5 py-0 text-[10px] text-emerald-700 dark:text-emerald-300"
                >
                  زنده
                </Badge>
              </header>
              <div
                className="rounded-lg border border-border/60 p-3"
                style={{ background: previewBackgroundCss }}
              >
                <div className="flex items-end gap-2">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                    ع
                  </div>
                  <div className="flex max-w-[80%] flex-col gap-0.5">
                    <span className="px-1 text-[0.75em] font-medium text-foreground">
                      استاد نمونه
                    </span>
                    <div
                      className="inline-block rounded-2xl bg-primary px-2.5 py-1.5 leading-relaxed text-primary-foreground shadow-sm"
                      style={{ fontSize: `${settings.fontSize}px` }}
                    >
                      سلام! این یک پیام نمونه برای پیش‌نمایش ظاهر پیام‌رسان
                      است.
                    </div>
                    <span className="px-1 text-[0.7em] text-muted-foreground">
                      {toPersianDigits("08:30")}
                    </span>
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                پس‌زمینه و اندازه فونت در همین گفتگو به‌صورت زنده اعمال
                می‌شوند — نیازی به بستن این پنجره نیست.
              </p>
            </section>
          </div>
        </div>

        {/* ---------- FOOTER (pinned) ----------
            Reset on the start (RTL), Save + Close on the end. The Save
            button confirms with a toast AND closes the dialog; the Close
            button just closes (the live changes are already persisted by
            the hook's localStorage effect). */}
        <DialogFooter className="shrink-0 gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={handleReset}
            className="text-muted-foreground"
          >
            <RotateCcw className="size-4" />
            بازنشانی
          </Button>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              <X className="size-4" />
              بستن
            </Button>
            <Button type="button" onClick={handleSave}>
              <Save className="size-4" />
              ذخیره
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Convenience helper for callers that just need the catalog entry's CSS for
 * the currently-resolved theme (used by `class-chat.tsx` + `direct-chat.tsx`
 * to apply the live background to the messages scroll area).
 */
export function useResolvedChatBackground(): string {
  const { settings } = useChatAppearance();
  const { resolvedTheme } = useTheme();
  return resolveBackgroundCss(settings.background, resolvedTheme);
}

// Re-export so callers can grab the catalog without an extra import.
export { getBackground };
