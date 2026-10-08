"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Loader2, MessageCircleOff, Check, Lock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fetchDMSettings, patchDMSettings } from "@/lib/messenger-api";
import type { DMSettings } from "@/components/messenger/types";

/**
 * Principal-side dialog to toggle per-school DM permissions.
 *
 * Three switches map to the three School fields:
 *   - معلم ↔ دانش‌آموز        → dmTeacherStudent
 *   - دانش‌آموز ↔ دانش‌آموز    → dmStudentStudent
 *   - مدیر ↔ دانش‌آموز        → dmPrincipalStudent
 *
 * `principal↔teacher` is always enabled (no field) — surfaced as a
 * locked "always on" row with a "همیشه فعال" badge.
 *
 * On open: fetches the current snapshot via GET /api/teacher/dm-settings
 * (falls back to all-true on 404/network so the dialog still renders).
 * On toggle: PATCHes the changed field immediately and toasts the result.
 * The close button always works (no save needed — each switch is its
 * own atomic PATCH).
 */
export function DMSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [settings, setSettings] = React.useState<DMSettings>({
    dmTeacherStudent: true,
    dmStudentStudent: true,
    dmPrincipalStudent: true,
  });
  const [loaded, setLoaded] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  // Tracks which switch is currently in-flight (so we can show a spinner
  // on the matching switch's row, similar to the bulk-edit pattern).
  const [savingKey, setSavingKey] = React.useState<keyof DMSettings | null>(
    null,
  );

  // Fetch the principal's current DM-settings snapshot whenever the
  // dialog opens. We intentionally re-fetch on every open so the dialog
  // never shows a stale snapshot if the principal toggled from another tab.
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const data = await fetchDMSettings();
      if (cancelled) return;
      if (data) {
        setSettings(data);
        setLoaded(true);
      } else {
        // Endpoint not yet available — leave defaults (all on). The
        // principal can still toggle and the PATCH will be sent on click.
        setLoaded(true);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function toggleSetting(key: keyof DMSettings, next: boolean) {
    setSavingKey(key);
    // Optimistically flip the switch so the UI feels instant; revert on
    // failure (same pattern as the appearance dialog).
    const prev = settings[key];
    setSettings((s) => ({ ...s, [key]: next }));
    try {
      const updated = await patchDMSettings({ [key]: next });
      if (updated) {
        // Server is the source of truth — sync the full snapshot back.
        setSettings(updated);
      }
      toast({
        title: next ? "گفتگو خصوصی فعال شد" : "گفتگو خصوصی غیرفعال شد",
        description: SETTING_LABELS[key].label,
      });
    } catch (err) {
      // Revert on failure.
      setSettings((s) => ({ ...s, [key]: prev }));
      toast({
        title: "ذخیره‌سازی ناموفق بود",
        description: err instanceof Error ? err.message : "خطای غیرمنتظره",
        variant: "destructive",
      });
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
              <MessageCircleOff className="size-4" />
            </span>
            تنظیمات چت خصوصی
          </DialogTitle>
          <DialogDescription>
            می‌توانید دسترسی به گفتگوی خصوصی بین گروه‌های مختلف را برای
            مدرسه خود فعال یا غیرفعال کنید.
          </DialogDescription>
        </DialogHeader>

        {loading && !loaded ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            در حال بارگذاری تنظیمات…
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-2.5">
              <DMSettingRow
                label="معلم ↔ دانش‌آموز"
                description="اجازه گفتگو خصوصی بین معلم‌ها و دانش‌آموزان"
                checked={settings.dmTeacherStudent}
                disabled={savingKey === "dmTeacherStudent"}
                onToggle={(next) => toggleSetting("dmTeacherStudent", next)}
              />
              <DMSettingRow
                label="دانش‌آموز ↔ دانش‌آموز"
                description="اجازه گفتگو خصوصی بین دانش‌آموزان با یکدیگر"
                checked={settings.dmStudentStudent}
                disabled={savingKey === "dmStudentStudent"}
                onToggle={(next) => toggleSetting("dmStudentStudent", next)}
              />
              <DMSettingRow
                label="مدیر ↔ دانش‌آموز"
                description="اجازه گفتگو خصوصی بین مدیر مدرسه و دانش‌آموزان"
                checked={settings.dmPrincipalStudent}
                disabled={savingKey === "dmPrincipalStudent"}
                onToggle={(next) => toggleSetting("dmPrincipalStudent", next)}
              />
              <Separator />
              {/* Always-on row — locked. */}
              <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-300/60 bg-emerald-50 p-2.5 dark:border-emerald-700/40 dark:bg-emerald-950/40">
                <div className="flex flex-col">
                  <Label className="flex items-center gap-1.5 text-sm">
                    مدیر ↔ معلم
                    <Badge
                      variant="secondary"
                      className="gap-1 bg-emerald-500/10 px-1.5 py-0 text-[10px] text-emerald-700 dark:text-emerald-300"
                    >
                      <Lock className="size-3" />
                      همیشه فعال
                    </Badge>
                  </Label>
                  <span className="text-[11px] text-muted-foreground">
                    گفتگو خصوصی مدیر و معلم همیشه فعال است.
                  </span>
                </div>
                <Switch checked disabled aria-label="همیشه فعال" />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              تغییرات بلافاصله اعمال می‌شوند — نیازی به دکمه ذخیره نیست.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            بستن
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const SETTING_LABELS: Record<keyof DMSettings, { label: string }> = {
  dmTeacherStudent: { label: "معلم ↔ دانش‌آموز" },
  dmStudentStudent: { label: "دانش‌آموز ↔ دانش‌آموز" },
  dmPrincipalStudent: { label: "مدیر ↔ دانش‌آموز" },
};

function DMSettingRow({
  label,
  description,
  checked,
  disabled,
  onToggle,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border p-2.5">
      <div className="flex flex-col">
        <Label className="flex items-center gap-1.5 text-sm">
          {checked ? (
            <Check className="size-3.5 text-emerald-600" />
          ) : null}
          {label}
        </Label>
        <span className="text-[11px] text-muted-foreground">
          {description}
        </span>
      </div>
      {disabled ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      ) : (
        <Switch
          checked={checked}
          onCheckedChange={(v) => onToggle(Boolean(v))}
          disabled={disabled}
          aria-label={label}
        />
      )}
    </div>
  );
}
