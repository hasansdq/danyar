/**
 * Persian/RTL formatting helpers used across messenger feature views.
 */

const PERSIAN_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];

/** Convert Western digits in a string to Persian digits. */
export function toPersianDigits(input: string | number): string {
  return String(input).replace(/\d/g, (d) => PERSIAN_DIGITS[Number(d)]);
}

/** Format an ISO date as a Persian (Jalali) date-time string.
 * Handles null/undefined/empty-string inputs gracefully — returns "".
 * (Phase 35c fix: previously, passing `undefined` caused a crash
 * because `date.getTime()` was called on `undefined`.) */
export function formatPersianDate(iso: string | Date | null | undefined): string {
  if (iso == null || iso === "") return "";
  const date = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("fa-IR", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

/** Format an ISO date as a Persian (Jalali) date (no time).
 * Handles null/undefined/empty-string inputs gracefully — returns "". */
export function formatPersianDay(iso: string | Date | null | undefined): string {
  if (iso == null || iso === "") return "";
  const date = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("fa-IR", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(date);
  } catch {
    return date.toLocaleDateString();
  }
}

/** Format a number as a Persian-localized string. */
export function formatPersianNumber(n: number): string {
  try {
    return new Intl.NumberFormat("fa-IR").format(n);
  } catch {
    return toPersianDigits(n);
  }
}

/** Returns a Persian "x روز مانده" / "x روز گذشته" label relative to now.
 * Handles null/undefined/empty-string inputs gracefully — returns a
 * neutral "—" label. */
export function formatPersianCountdown(iso: string | Date | null | undefined): {
  text: string;
  overdue: boolean;
  soon: boolean;
} {
  if (iso == null || iso === "") return { text: "—", overdue: false, soon: false };
  const date = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return { text: "—", overdue: false, soon: false };
  const now = Date.now();
  const diffMs = date.getTime() - now;
  const overdue = diffMs < 0;
  const soon = !overdue && diffMs < 3 * 24 * 60 * 60 * 1000; // < 3 days

  const days = Math.floor(Math.abs(diffMs) / (24 * 60 * 60 * 1000));
  const hours = Math.floor(
    (Math.abs(diffMs) % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000),
  );

  let text: string;
  if (overdue) {
    if (days > 0) text = `${formatPersianNumber(days)} روز گذشته`;
    else text = `${formatPersianNumber(hours)} ساعت گذشته`;
  } else {
    if (days > 0) text = `${formatPersianNumber(days)} روز مانده`;
    else text = `${formatPersianNumber(hours)} ساعت مانده`;
  }
  return { text, overdue, soon };
}

/** Convert a role code to a Persian label. */
export function roleLabel(role: string): string {
  switch (role) {
    case "SUPERADMIN":
      return "مدیر کل";
    case "ADMIN":
      return "مدیر مدرسه";
    case "TEACHER":
      return "استاد";
    case "STUDENT":
      return "دانش‌آموز";
    default:
      return role;
  }
}

/** Convert a membership role to a Persian label (used in the class selector badge). */
export function membershipRoleLabel(role: string): string {
  switch (role) {
    case "ADMIN":
      return "مدیر مدرسه";
    case "TEACHER":
      return "استاد کلاس";
    case "STUDENT":
      return "دانش‌آموز";
    default:
      return role;
  }
}
