"use client";

import * as React from "react";
import { useMemo, useState } from "react";
import { jalaaliMonthLength, toJalaali, jalaaliToDateObject } from "jalaali-js";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { toPersianDigits } from "./persian";

/**
 * Persian (Jalali) month names — used in the calendar header + day grid.
 */
const PERSIAN_MONTHS = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
];

const PERSIAN_WEEKDAYS = [
  "شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه",
];

const PERSIAN_WEEKDAYS_SHORT = ["ش", "ی", "د", "س", "چ", "پ", "ج"];

/** Convert a JS Date to a Jalali "YYYY-MM-DD" string. */
function toJalaliDateStr(d: Date): string {
  const j = toJalaali(d);
  const mm = String(j.jm).padStart(2, "0");
  const dd = String(j.jd).padStart(2, "0");
  return `${j.jy}-${mm}-${dd}`;
}

/** Parse a Jalali "YYYY-MM-DD" string to { jy, jm, jd }. */
function parseJalaliDate(s: string | null | undefined): { jy: number; jm: number; jd: number } {
  const fallback = toJalaali(new Date());
  if (!s) return fallback;
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (!m) return fallback;
  return {
    jy: Number(m[1]),
    jm: Number(m[2]),
    jd: Number(m[3]),
  };
}

/** Convert a Jalali date to a JS Date at local midnight. */
function jalaliToDate(jy: number, jm: number, jd: number): Date {
  return jalaaliToDateObject(jy, jm, jd);
}

/** JS getDay(): 0=Sun..6=Sat. Jalali week starts on شنبه (Saturday). */
function jalaaliWeekday(d: Date): number {
  return (d.getDay() + 1) % 7; // Sat→0, Sun→1, ..., Fri→6
}

/**
 * Format an ISO date-time string as a Persian (Jalali) date + time string
 * suitable for the picker's trigger button.
 */
function formatJalaliDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const j = toJalaali(d);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${toPersianDigits(j.jy)}/${toPersianDigits(j.jm)}/${toPersianDigits(j.jd)} - ${toPersianDigits(hh)}:${toPersianDigits(mm)}`;
}

export type JalaliDateTimePickerProps = {
  /** ISO string of the selected date-time, or null when nothing is selected. */
  value: string | null;
  /** Called with the new ISO string, or null when the user clears the picker. */
  onChange: (value: string | null) => void;
  /** Optional placeholder shown when the value is empty. */
  placeholder?: string;
  /** Optional aria-label for the trigger button. */
  ariaLabel?: string;
  /** Whether the picker is disabled (submits while submitting, etc.). */
  disabled?: boolean;
  /** Optional id forwarded to the trigger button. */
  id?: string;
};

/**
 * JalaliDateTimePicker — a Persian (Jalali) date + time picker rendered
 * inside a Popover. Reuses the calendar-grid logic from attendance-view
 * (jalaali-js's `jalaaliMonthLength` + `toJalaali` + `jalaaliToDateObject`).
 *
 * Behaviour:
 *   - Trigger button shows the currently-selected date-time (or the
 *     placeholder when empty), with a calendar icon on the right.
 *   - Popover: month navigation chevrons (Sh/V/Q/Z...) + weekday header +
 *     a 7-column day grid. Clicking a day picks that day and keeps the
 *     currently-selected time (or default 23:59 when none selected yet).
 *   - Two `<Input type="time">` fields for hour + minute selection.
 *   - A "today" shortcut button + a "clear" button (sets value to null).
 *
 * The picker is self-contained — no shared state with the form. The parent
 * just controls `value` + `onChange`.
 */
export function JalaliDateTimePicker({
  value,
  onChange,
  placeholder = "انتخاب تاریخ و ساعت",
  ariaLabel,
  disabled = false,
  id,
}: JalaliDateTimePickerProps) {
  // ----- State: open + visible month + picked date/time -----
  const [open, setOpen] = useState(false);

  // Parse the current value into Jalali date + hour/minute so the
  // calendar + time inputs render the right initial state. We recompute
  // these on every render from `value` so external updates (e.g. parent
  // resets the form) are reflected.
  const initial = useMemo(() => {
    if (!value) {
      const now = new Date();
      const j = toJalaali(now);
      return {
        jy: j.jy,
        jm: j.jm,
        jd: j.jd,
        hh: String(now.getHours()).padStart(2, "0"),
        mm: String(now.getMinutes()).padStart(2, "0"),
      };
    }
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      const now = new Date();
      const j = toJalaali(now);
      return {
        jy: j.jy,
        jm: j.jm,
        jd: j.jd,
        hh: String(now.getHours()).padStart(2, "0"),
        mm: String(now.getMinutes()).padStart(2, "0"),
      };
    }
    const j = toJalaali(d);
    return {
      jy: j.jy,
      jm: j.jm,
      jd: j.jd,
      hh: String(d.getHours()).padStart(2, "0"),
      mm: String(d.getMinutes()).padStart(2, "0"),
    };
  }, [value]);

  // Visible calendar month — starts on the value's month, or today's
  // month when value is null. The user can flip months independently of
  // which day is selected.
  const [viewMonth, setViewMonth] = useState<{ jy: number; jm: number }>({
    jy: initial.jy,
    jm: initial.jm,
  });

  // Time inputs — local state so the user can type freely. We commit
  // back to `onChange` only when they blur OR pick a date.
  const [hourStr, setHourStr] = useState<string>(initial.hh);
  const [minuteStr, setMinuteStr] = useState<string>(initial.mm);

  // When the popover opens, re-sync the visible month + time inputs to
  // the current value (in case it changed while the popover was closed).
  React.useEffect(() => {
    if (!open) return;
    const v = value ? new Date(value) : new Date();
    if (!Number.isNaN(v.getTime())) {
      const j = toJalaali(v);
      setViewMonth({ jy: j.jy, jm: j.jm });
      setHourStr(String(v.getHours()).padStart(2, "0"));
      setMinuteStr(String(v.getMinutes()).padStart(2, "0"));
    }
  }, [open, value]);

  // ----- Calendar grid (visible month) -----
  const calendarCells = useMemo(() => {
    const daysInMonth = jalaaliMonthLength(viewMonth.jy, viewMonth.jm);
    const firstDate = jalaliToDate(viewMonth.jy, viewMonth.jm, 1);
    const firstWeekday = jalaaliWeekday(firstDate);
    const cells: Array<{ day: number | null; dateStr: string | null }> = [];
    for (let i = 0; i < firstWeekday; i++) {
      cells.push({ day: null, dateStr: null });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const mm = String(viewMonth.jm).padStart(2, "0");
      const dd = String(d).padStart(2, "0");
      cells.push({ day: d, dateStr: `${viewMonth.jy}-${mm}-${dd}` });
    }
    while (cells.length % 7 !== 0) {
      cells.push({ day: null, dateStr: null });
    }
    return cells;
  }, [viewMonth]);

  const todayStr = toJalaliDateStr(new Date());
  // The currently-selected Jalali date string (YYYY-MM-DD), or null.
  const selectedJalaliStr = value ? (() => {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : toJalaliDateStr(d);
  })() : null;

  function goPrevMonth() {
    setViewMonth((cur) => {
      let jm = cur.jm - 1;
      let jy = cur.jy;
      if (jm < 1) { jm = 12; jy -= 1; }
      return { jy, jm };
    });
  }
  function goNextMonth() {
    setViewMonth((cur) => {
      let jm = cur.jm + 1;
      let jy = cur.jy;
      if (jm > 12) { jm = 1; jy += 1; }
      return { jy, jm };
    });
  }

  /** Build a JS Date for the picked Jalali day + the current hour/minute. */
  function buildDateFor(jalaliStr: string): Date {
    const { jy, jm, jd } = parseJalaliDate(jalaliStr);
    const d = jalaliToDate(jy, jm, jd);
    const hh = parseInt(hourStr, 10);
    const mm = parseInt(minuteStr, 10);
    if (!Number.isNaN(hh)) d.setHours(hh);
    if (!Number.isNaN(mm)) d.setMinutes(mm);
    d.setSeconds(0);
    d.setMilliseconds(0);
    return d;
  }

  function handleDayClick(jalaliStr: string) {
    const d = buildDateFor(jalaliStr);
    onChange(d.toISOString());
    // Snap the visible month to the picked day's month (so the user
    // immediately sees the day they just picked).
    const { jy, jm } = parseJalaliDate(jalaliStr);
    setViewMonth({ jy, jm });
  }

  function handleTimeChange(nextHour: string, nextMinute: string) {
    setHourStr(nextHour);
    setMinuteStr(nextMinute);
    // If the user already picked a date, update the value's time too
    // so the trigger button reflects the new time immediately.
    if (value && selectedJalaliStr) {
      const d = buildDateFor(selectedJalaliStr);
      onChange(d.toISOString());
    }
  }

  function handleToday() {
    const now = new Date();
    const j = toJalaali(now);
    const jalaliStr = toJalaliDateStr(now);
    setHourStr(String(now.getHours()).padStart(2, "0"));
    setMinuteStr(String(now.getMinutes()).padStart(2, "0"));
    setViewMonth({ jy: j.jy, jm: j.jm });
    onChange(now.toISOString());
    // Snap the calendar to today's month (in case the user navigated
    // away) — wait, we already did setViewMonth above. The day grid will
    // re-render with the new month.
    handleDayClick(jalaliStr);
  }

  function handleClear() {
    onChange(null);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          disabled={disabled}
          dir="ltr"
          className="w-full justify-between font-normal"
        >
          <span className="flex items-center gap-2">
            <CalendarIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className={value ? "" : "text-muted-foreground"}>
              {value ? formatJalaliDateTime(value) : placeholder}
            </span>
          </span>
          {value && !disabled ? (
            <button
              type="button"
              aria-label="پاک کردن"
              className="ml-1 flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleClear();
              }}
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[320px] p-3"
        align="start"
        // Force RTL so the chevrons render in the correct visual order
        // (right = previous month, left = next month in Persian layout).
        dir="rtl"
      >
        {/* Month navigation header */}
        <div className="mb-3 flex items-center justify-between">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={goPrevMonth}
            aria-label="ماه قبل"
            type="button"
          >
            <ChevronRight className="size-4" />
          </Button>
          <div className="flex flex-col items-center">
            <span className="text-sm font-semibold">
              {PERSIAN_MONTHS[viewMonth.jm - 1]} {toPersianDigits(viewMonth.jy)}
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={goNextMonth}
            aria-label="ماه بعد"
            type="button"
          >
            <ChevronLeft className="size-4" />
          </Button>
        </div>

        {/* Weekday header */}
        <div className="grid grid-cols-7 gap-1">
          {PERSIAN_WEEKDAYS_SHORT.map((w, i) => (
            <div
              key={i}
              className="py-1 text-center text-[11px] font-medium text-muted-foreground"
              title={PERSIAN_WEEKDAYS[i]}
            >
              {w}
            </div>
          ))}
        </div>

        {/* Day grid */}
        <div className="grid grid-cols-7 gap-1">
          {calendarCells.map((cell, idx) => {
            if (!cell.day) {
              return <div key={idx} className="aspect-square" />;
            }
            const isToday = cell.dateStr === todayStr;
            const isSelected = cell.dateStr === selectedJalaliStr;
            return (
              <button
                key={idx}
                type="button"
                onClick={() => cell.dateStr && handleDayClick(cell.dateStr)}
                className={`flex aspect-square items-center justify-center rounded-md border text-sm transition-colors ${
                  isSelected
                    ? "border-primary bg-primary text-primary-foreground"
                    : isToday
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border bg-background hover:bg-accent"
                }`}
                aria-label={cell.dateStr ?? undefined}
                aria-pressed={isSelected}
              >
                {toPersianDigits(cell.day)}
              </button>
            );
          })}
        </div>

        {/* Time inputs */}
        <div className="mt-3 flex items-center gap-2 border-t pt-3">
          <span className="text-xs text-muted-foreground">ساعت:</span>
          <Input
            type="time"
            value={`${hourStr}:${minuteStr}`}
            onChange={(e) => {
              const [h, m] = e.target.value.split(":");
              handleTimeChange(h ?? "00", m ?? "00");
            }}
            dir="ltr"
            className="h-8 w-28 text-left text-xs"
            aria-label="ساعت"
            disabled={disabled}
          />
        </div>

        {/* Footer: today + clear */}
        <div className="mt-3 flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleToday}
            className="h-8 text-xs"
          >
            امروز
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOpen(false)}
            className="h-8 text-xs"
          >
            تأیید
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
