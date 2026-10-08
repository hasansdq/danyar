"use client";

import * as React from "react";
import { type FormEvent } from "react";
import { Loader2, Save, SlidersHorizontal } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { toPersianDigits } from "./persian";
import type { FileCategory, FileSettings } from "./types";

/**
 * The four file-category buckets users may toggle. Stored as a JSON array on
 * the ClassRoom.allowedFileTypes column; `null` (no checkboxes selected) means
 * ALL categories are allowed. Order matches the UI presentation order.
 */
const CATEGORY_OPTIONS: Array<{
  value: FileCategory;
  label: string;
  hint: string;
}> = [
  { value: "image", label: "تصویر", hint: "JPG, PNG, GIF, WEBP" },
  { value: "pdf", label: "PDF", hint: "فایل‌های PDF" },
  { value: "video", label: "ویدیو", hint: "MP4, WEBM, MOV" },
  { value: "file", label: "سایر فایل‌ها", hint: "فایل‌های دیگر" },
];

/**
 * Build the initial form state from the (possibly partial / undefined) settings
 * that the caller passes in. Falls back to the schema defaults:
 *   - fileUploadEnabled = true
 *   - maxFileSizeMb     = 10
 *   - allowedFileTypes  = null (=> all categories checked locally)
 */
function normalizeInitial(input?: Partial<FileSettings> | null): FileSettings {
  return {
    fileUploadEnabled: input?.fileUploadEnabled ?? true,
    maxFileSizeMb:
      typeof input?.maxFileSizeMb === "number" && input.maxFileSizeMb >= 0
        ? input.maxFileSizeMb
        : 10,
    allowedFileTypes:
      input?.allowedFileTypes === null ||
      (Array.isArray(input?.allowedFileTypes) &&
        (input!.allowedFileTypes as string[]).length === 0)
        ? null
        : (input?.allowedFileTypes as string[] | null) ?? null,
  };
}

/**
 * Read the JSON-encoded `allowedFileTypes` column into a Set of categories.
 * An empty array / null maps to "all" (every checkbox checked).
 */
function initialCheckedSet(settings: FileSettings): Set<FileCategory> {
  if (
    settings.allowedFileTypes === null ||
    (Array.isArray(settings.allowedFileTypes) &&
      settings.allowedFileTypes.length === 0)
  ) {
    return new Set<FileCategory>(
      CATEGORY_OPTIONS.map((o) => o.value),
    );
  }
  return new Set(
    (settings.allowedFileTypes ?? []).filter((v): v is FileCategory =>
      (["image", "pdf", "video", "file"] as string[]).includes(v),
    ),
  );
}

export type FileSettingsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Display label (class name) shown in the dialog header. */
  classLabel?: string;
  /** Initial values; refetched every time the dialog opens. */
  initialSettings?: Partial<FileSettings> | null;
  /**
   * Caller-supplied async save. The dialog does NOT call the API itself — it
   * hands the assembled values to this callback so the teacher path can hit
   * `/api/teacher/class-settings` and the admin path can hit
   * `/api/admin/classes/[id]`. Must resolve to the persisted settings (or
   * throw an Error whose .message is shown to the user).
   */
  onSave: (values: FileSettings) => Promise<FileSettings>;
  /** Fired after a successful save with the server-returned settings. */
  onSaved?: (settings: FileSettings) => void;
  /** Override the submit button label (defaults to "ذخیره تنظیمات"). */
  submitLabel?: string;
};

/**
 * Reusable shadcn Dialog for editing a class's per-class file-upload limits.
 *
 * The same dialog is reused by:
 *   - teachers from the chat header (`onSave` → `patchClassFileSettings`)
 *   - admins from the admin class detail page (`onSave` → PATCH /api/admin/classes/[id])
 *
 * On submit: toasts success/error, closes the dialog, and calls `onSaved`
 * with the server-returned settings so the caller can update its local state.
 */
export function FileSettingsDialog({
  open,
  onOpenChange,
  classLabel,
  initialSettings,
  onSave,
  onSaved,
  submitLabel,
}: FileSettingsDialogProps) {
  const { toast } = useToast();

  const [fileUploadEnabled, setFileUploadEnabled] = React.useState<boolean>(
    () => normalizeInitial(initialSettings).fileUploadEnabled,
  );
  const [maxFileSizeMb, setMaxFileSizeMb] = React.useState<string>(
    () => String(normalizeInitial(initialSettings).maxFileSizeMb),
  );
  const [checked, setChecked] = React.useState<Set<FileCategory>>(() =>
    initialCheckedSet(normalizeInitial(initialSettings)),
  );
  const [submitting, setSubmitting] = React.useState(false);

  // Reset the form whenever the dialog re-opens OR the initial settings
  // change. Uses the React-19-blessed "store previous value, reset during
  // render" pattern (see react-hooks/set-state-in-effect lint rule).
  const [prevOpen, setPrevOpen] = React.useState(open);
  const [prevInitial, setPrevInitial] = React.useState(initialSettings);
  const initialChanged = initialSettings !== prevInitial;
  if (open !== prevOpen || initialChanged) {
    setPrevOpen(open);
    setPrevInitial(initialSettings);
    if (open || initialChanged) {
      // (Re)seed the form from the latest initial settings every time the
      // dialog opens or the parent passes fresh data while it's open.
      const normalized = normalizeInitial(initialSettings);
      setFileUploadEnabled(normalized.fileUploadEnabled);
      setMaxFileSizeMb(String(normalized.maxFileSizeMb));
      setChecked(initialCheckedSet(normalized));
      setSubmitting(false);
    }
  }

  const parsedMaxSize = (() => {
    const n = Number(maxFileSizeMb);
    if (!Number.isFinite(n) || n < 0) return null;
    return n;
  })();

  const maxValid = parsedMaxSize !== null;
  const canSubmit = !submitting && maxValid;

  function toggleCategory(value: FileCategory) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    // Build the final settings object.
    // If NONE of the category checkboxes are checked → store `null` so the
    // backend treats it as "all categories allowed".
    const selectedCategories = CATEGORY_OPTIONS.filter((o) =>
      checked.has(o.value),
    ).map((o) => o.value);
    const allowedFileTypes: string[] | null =
      selectedCategories.length === 0 ||
      selectedCategories.length === CATEGORY_OPTIONS.length
        ? null
        : selectedCategories;

    const values: FileSettings = {
      fileUploadEnabled,
      maxFileSizeMb: parsedMaxSize ?? 0,
      allowedFileTypes,
    };

    setSubmitting(true);
    try {
      const saved = await onSave(values);
      toast({
        title: "تنظیمات ذخیره شد",
        description: "محدودیت‌های ارسال فایل برای این کلاس به‌روزرسانی شد.",
      });
      onOpenChange(false);
      onSaved?.(saved);
    } catch (err) {
      toast({
        title: "ذخیره تنظیمات ناموفق بود",
        description:
          (err as Error)?.message || "خطای غیرمنتظره — دوباره تلاش کنید.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="bg-primary/10 text-primary flex size-7 items-center justify-center rounded-md">
              <SlidersHorizontal className="size-4" />
            </span>
            تنظیمات ارسال فایل
          </DialogTitle>
          <DialogDescription>
            {classLabel
              ? `محدودیت‌های ارسال فایل برای کلاس «${classLabel}» را مدیریت کنید.`
              : "محدودیت‌های ارسال فایل این کلاس را مدیریت کنید."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Master toggle */}
          <div className="flex items-center justify-between gap-2 rounded-md border p-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <Label htmlFor="file-upload-enabled" className="text-sm">
                فعال‌سازی ارسال فایل
              </Label>
              <span className="text-[11px] text-muted-foreground">
                در صورت غیرفعال بودن، دانش‌آموزان نمی‌توانند فایل ارسال کنند.
              </span>
            </div>
            <Switch
              id="file-upload-enabled"
              checked={fileUploadEnabled}
              onCheckedChange={setFileUploadEnabled}
            />
          </div>

          {/* Max size */}
          <div className="space-y-1.5">
            <Label htmlFor="max-file-size">
              حداکثر حجم فایل (مگابایت)
            </Label>
            <Input
              id="max-file-size"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              dir="ltr"
              value={maxFileSizeMb}
              onChange={(e) => setMaxFileSizeMb(e.target.value)}
              disabled={!fileUploadEnabled || submitting}
              className="max-w-[140px]"
            />
            <p className="text-[11px] text-muted-foreground">
              ۰ = بدون محدودیت
              {!maxValid ? (
                <span className="text-destructive"> · عدد نامعتبر</span>
              ) : null}
            </p>
          </div>

          <Separator />

          {/* Allowed categories */}
          <div className="space-y-2">
            <Label>انواع مجاز فایل</Label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {CATEGORY_OPTIONS.map((opt) => {
                const id = `cat-${opt.value}`;
                const isChecked = checked.has(opt.value);
                return (
                  <label
                    key={opt.value}
                    htmlFor={id}
                    className={`flex cursor-pointer items-center gap-2 rounded-md border p-2.5 text-sm transition-colors ${
                      isChecked
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-accent/40"
                    } ${
                      !fileUploadEnabled || submitting
                        ? "pointer-events-none opacity-50"
                        : ""
                    }`}
                  >
                    <input
                      id={id}
                      type="checkbox"
                      className="sr-only"
                      checked={isChecked}
                      disabled={!fileUploadEnabled || submitting}
                      onChange={() => toggleCategory(opt.value)}
                    />
                    <span
                      className={`flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors ${
                        isChecked
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input bg-background"
                      }`}
                      aria-hidden="true"
                    >
                      {isChecked ? (
                        <svg
                          className="size-3"
                          viewBox="0 0 12 12"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M2.5 6.5 5 9l4.5-5" />
                        </svg>
                      ) : null}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="font-medium leading-tight">
                        {opt.label}
                      </span>
                      <span className="text-[10px] text-muted-foreground leading-tight">
                        {opt.hint}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground">
              اگر هیچ موردی انتخاب نشود، همه انواع فایل مجاز خواهد بود.
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              انصراف
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {submitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              {submitLabel ?? "ذخیره تنظیمات"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Compact read-only summary of the current file settings, for displaying next
 * to the "edit" trigger in the admin class-detail card. Shows the enabled
 * state, max size, and the list of allowed categories.
 */
export function FileSettingsSummary({
  settings,
}: {
  settings?: Partial<FileSettings> | null;
}) {
  const normalized = normalizeInitial(settings);
  const enabled = normalized.fileUploadEnabled;
  const maxSize = normalized.maxFileSizeMb;
  const all =
    normalized.allowedFileTypes === null ||
    (Array.isArray(normalized.allowedFileTypes) &&
      normalized.allowedFileTypes.length === 0);
  const labels = all
    ? "همه انواع"
    : (normalized.allowedFileTypes ?? [])
        .map(
          (v) =>
            CATEGORY_OPTIONS.find((o) => o.value === v)?.label ?? v,
        )
        .join("، ");

  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <span
        className={
          enabled
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-amber-600 dark:text-amber-400"
        }
      >
        {enabled ? "فعال" : "غیرفعال"}
      </span>
      <span>·</span>
      <span>
        حداکثر حجم: {toPersianDigits(maxSize)} مگابایت
        {maxSize === 0 ? " (بدون محدودیت)" : ""}
      </span>
      <span>·</span>
      <span>انواع مجاز: {labels}</span>
    </div>
  );
}
