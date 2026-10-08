"use client";

import * as React from "react";
import { useDeviceType, type DeviceType } from "./use-device-type";

// ============================================================
// Types
// ============================================================

export type { DeviceType } from "./use-device-type";

/**
 * Appearance settings for ONE device class. Persisted separately for
 * mobile / tablet / desktop so a phone user only ever edits the "mobile"
 * slot (and the desktop slot doesn't leak into their UI — see
 * {@link useChatAppearance} which only exposes the CURRENT device's slot).
 */
export interface AppearanceSettings {
  /** Key into {@link BACKGROUND_CATALOG}. */
  background: string;
  /** Chat font-size in px. Range 13–18 (the slider/select bounds). */
  fontSize: number;
}

/**
 * The full persisted blob. Stored as a single JSON object in localStorage
 * under {@link STORAGE_KEY} so the per-device slots share one read/write.
 */
export interface AllAppearanceSettings {
  mobile: AppearanceSettings;
  tablet: AppearanceSettings;
  desktop: AppearanceSettings;
}

// ============================================================
// localStorage contract
// ============================================================

export const STORAGE_KEY = "chat-appearance";

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  background: "default",
  fontSize: 14,
};

export const DEFAULT_ALL_APPEARANCE: AllAppearanceSettings = {
  mobile: { ...DEFAULT_APPEARANCE },
  tablet: { ...DEFAULT_APPEARANCE },
  desktop: { ...DEFAULT_APPEARANCE },
};

/**
 * Font-size options exposed in the settings dialog. The user picks a Persian
 * label; the value is the px size that gets applied via inline style on the
 * messages container (and inherited by the bubbles + meta lines).
 */
export const FONT_SIZE_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 13, label: "کوچک" },
  { value: 14, label: "متوسط" },
  { value: 15, label: "بزرگ" },
  { value: 16, label: "خیلی بزرگ" },
  { value: 17, label: "نیمه‌بزرگ" },
  { value: 18, label: "بزرگ‌ترین" },
];

export const FONT_SIZE_MIN = 13;
export const FONT_SIZE_MAX = 18;

// ============================================================
// Background catalog (education-themed, Telegram-style)
// ============================================================

/**
 * Convert a raw SVG string into a `url("data:image/svg+xml,...")` CSS value
 * that's safe to embed inside a `background:` shorthand. We URL-encode the
 * SVG so quotes / angle-brackets don't break the CSS parser.
 *
 * Apostrophes inside the SVG (used for attribute quoting) survive
 * `encodeURIComponent` unchanged, which is what we want — they're legal
 * inside a double-quoted CSS string.
 */
function svgUrl(svg: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/**
 * One entry in the background picker. `light` / `dark` are full CSS
 * `background` shorthand values (color + optional image(s)). `thumb` is a
 * small-CSS-background used for the picker swatch — usually the same as the
 * light or dark variant depending on the user's current theme.
 */
export interface BackgroundEntry {
  /** Stable key — persisted in `AppearanceSettings.background`. */
  key: string;
  /** Persian label shown under the swatch. */
  label: string;
  /** CSS `background` value in LIGHT mode. */
  light: string;
  /** CSS `background` value in DARK mode. */
  dark: string;
}

/**
 * The catalog of chat backgrounds. Education/school motifs + Telegram-style
 * subtle patterns. All patterns are SVG data-URIs (no image files), kept
 * low-opacity so chat text stays readable.
 *
 * `default` is `transparent` so the chat root's `bg-muted` shows through —
 * that means the default look is exactly what users had BEFORE this feature.
 */
export const BACKGROUND_CATALOG: BackgroundEntry[] = [
  // 1. default — soft cream / soft dark slate (no pattern)
  {
    key: "default",
    label: "پیش‌فرض",
    light: "transparent",
    dark: "transparent",
  },

  // 2. notebook — lined paper (دفتر مشق)
  {
    key: "notebook",
    label: "دفتر مشق",
    light:
      "#fffdf5 repeating-linear-gradient(to bottom, transparent 0, transparent 27px, rgba(60,40,15,0.07) 27px, rgba(60,40,15,0.07) 28px)",
    dark:
      "#1b1813 repeating-linear-gradient(to bottom, transparent 0, transparent 27px, rgba(230,210,170,0.08) 27px, rgba(230,210,170,0.08) 28px)",
  },

  // 3. chalkboard — dark-green gradient with chalk-dust dots (تخته سیاه)
  {
    key: "chalkboard",
    label: "تخته سیاه",
    light: `#3f5a45 ${svgUrl(
      "<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'><circle cx='10' cy='15' r='1' fill='rgba(255,255,255,0.18)'/><circle cx='35' cy='40' r='1.5' fill='rgba(255,255,255,0.12)'/><circle cx='60' cy='20' r='0.8' fill='rgba(255,255,255,0.15)'/><circle cx='20' cy='65' r='1.2' fill='rgba(255,255,255,0.10)'/><circle cx='70' cy='70' r='1' fill='rgba(255,255,255,0.18)'/></svg>",
    )}`,
    dark: `#1f2d23 ${svgUrl(
      "<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'><circle cx='10' cy='15' r='1' fill='rgba(255,255,255,0.22)'/><circle cx='35' cy='40' r='1.5' fill='rgba(255,255,255,0.14)'/><circle cx='60' cy='20' r='0.8' fill='rgba(255,255,255,0.18)'/><circle cx='20' cy='65' r='1.2' fill='rgba(255,255,255,0.12)'/><circle cx='70' cy='70' r='1' fill='rgba(255,255,255,0.22)'/></svg>",
    )}`,
  },

  // 4. geometry — subtle repeating geometric shapes (math class)
  {
    key: "geometry",
    label: "اشکال هندسی",
    light: `#fafaf9 ${svgUrl(
      "<svg xmlns='http://www.w3.org/2000/svg' width='60' height='60'><circle cx='15' cy='15' r='8' stroke='rgba(15,40,30,0.07)' fill='none'/><polygon points='45,8 53,22 37,22' stroke='rgba(15,40,30,0.07)' fill='none'/><circle cx='45' cy='45' r='6' stroke='rgba(15,40,30,0.06)' fill='none'/><polygon points='15,38 23,52 7,52' stroke='rgba(15,40,30,0.06)' fill='none'/></svg>",
    )}`,
    dark: `#1c1917 ${svgUrl(
      "<svg xmlns='http://www.w3.org/2000/svg' width='60' height='60'><circle cx='15' cy='15' r='8' stroke='rgba(220,240,230,0.10)' fill='none'/><polygon points='45,8 53,22 37,22' stroke='rgba(220,240,230,0.10)' fill='none'/><circle cx='45' cy='45' r='6' stroke='rgba(220,240,230,0.08)' fill='none'/><polygon points='15,38 23,52 7,52' stroke='rgba(220,240,230,0.08)' fill='none'/></svg>",
    )}`,
  },

  // 5. books — soft gradient with faint book-stack silhouettes
  {
    key: "books",
    label: "کتاب",
    light: `#fdf6e3 ${svgUrl(
      "<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'><rect x='10' y='20' width='40' height='6' rx='1' fill='rgba(60,40,15,0.06)'/><rect x='15' y='28' width='35' height='6' rx='1' fill='rgba(60,40,15,0.05)'/><rect x='8' y='36' width='45' height='6' rx='1' fill='rgba(60,40,15,0.06)'/><rect x='12' y='44' width='38' height='6' rx='1' fill='rgba(60,40,15,0.05)'/></svg>",
    )}`,
    dark: `#1a1614 ${svgUrl(
      "<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'><rect x='10' y='20' width='40' height='6' rx='1' fill='rgba(230,210,170,0.08)'/><rect x='15' y='28' width='35' height='6' rx='1' fill='rgba(230,210,170,0.07)'/><rect x='8' y='36' width='45' height='6' rx='1' fill='rgba(230,210,170,0.08)'/><rect x='12' y='44' width='38' height='6' rx='1' fill='rgba(230,210,170,0.07)'/></svg>",
    )}`,
  },

  // 6. dots — subtle dotted grid (Telegram's default)
  {
    key: "dots",
    label: "نقاط",
    light: `#f5f5f4 ${svgUrl(
      "<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'><circle cx='2' cy='2' r='1.5' fill='rgba(0,0,0,0.08)'/></svg>",
    )}`,
    dark: `#1a1a1a ${svgUrl(
      "<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'><circle cx='2' cy='2' r='1.5' fill='rgba(255,255,255,0.10)'/></svg>",
    )}`,
  },

  // 7. waves — soft wavy gradient lines
  {
    key: "waves",
    label: "موج",
    light: `linear-gradient(180deg, #f3f8f5 0%, #e6f0ea 100%) ${svgUrl(
      "<svg xmlns='http://www.w3.org/2000/svg' width='80' height='40'><path d='M0,20 Q20,10 40,20 T80,20' stroke='rgba(15,80,55,0.08)' fill='none'/><path d='M0,30 Q20,20 40,30 T80,30' stroke='rgba(15,80,55,0.06)' fill='none'/></svg>",
    )}`,
    dark: `linear-gradient(180deg, #161b18 0%, #1c2520 100%) ${svgUrl(
      "<svg xmlns='http://www.w3.org/2000/svg' width='80' height='40'><path d='M0,20 Q20,10 40,20 T80,20' stroke='rgba(160,220,190,0.10)' fill='none'/><path d='M0,30 Q20,20 40,30 T80,30' stroke='rgba(160,220,190,0.08)' fill='none'/></svg>",
    )}`,
  },

  // 8. pencils — diagonal stripe pattern with pencil-like colors
  {
    key: "pencils",
    label: "مداد",
    light:
      "repeating-linear-gradient(45deg, #fdf6e3 0, #fdf6e3 8px, #f0e0b8 8px, #f0e0b8 16px)",
    dark:
      "repeating-linear-gradient(45deg, #1a1614 0, #1a1614 8px, #2a2418 8px, #2a2418 16px)",
  },
];

/**
 * Lookup helper — returns the catalog entry for `key`, or the `default` entry
 * if `key` is unknown (e.g. persisted from an older client version that
 * shipped a different catalog).
 */
export function getBackground(key: string): BackgroundEntry {
  return (
    BACKGROUND_CATALOG.find((b) => b.key === key) ??
    BACKGROUND_CATALOG[0]
  );
}

// ============================================================
// localStorage read/write helpers
// ============================================================

/**
 * Read the persisted blob. Returns the default if:
 *   - localStorage is unavailable (SSR / private-mode throw)
 *   - the JSON is corrupt or doesn't have all three device slots
 *
 * Always returns a fully-populated {@link AllAppearanceSettings} so callers
 * don't have to null-check.
 */
function readAll(): AllAppearanceSettings {
  if (typeof window === "undefined") return DEFAULT_ALL_APPEARANCE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_ALL_APPEARANCE;
    const parsed = JSON.parse(raw) as Partial<AllAppearanceSettings>;
    return {
      mobile: { ...DEFAULT_APPEARANCE, ...parsed.mobile },
      tablet: { ...DEFAULT_APPEARANCE, ...parsed.tablet },
      desktop: { ...DEFAULT_APPEARANCE, ...parsed.desktop },
    };
  } catch {
    return DEFAULT_ALL_APPEARANCE;
  }
}

/** Persist the full blob. Silent on failure (private-mode / quota). */
function writeAll(all: AllAppearanceSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* ignore — settings just won't persist this session */
  }
}

// ============================================================
// useChatAppearance hook
// ============================================================

export interface UseChatAppearanceResult {
  /** The CURRENT device's settings (the only slot the UI can see/edit). */
  settings: AppearanceSettings;
  /** The CURRENT device class (so the UI can show a badge). */
  device: DeviceType;
  /** Replace the CURRENT device's full settings object. */
  setAll: (next: AppearanceSettings) => void;
  /** Change just the background key for the CURRENT device. */
  setBackground: (key: string) => void;
  /** Change just the font-size for the CURRENT device. */
  setFontSize: (size: number) => void;
  /** Reset the CURRENT device back to defaults. */
  reset: () => void;
}

/**
 * Per-device chat appearance hook.
 *
 * Internally calls {@link useDeviceType} so the hook always reads/writes
 * ONLY the slot for the device the user is actually on. A phone user
 * editing their settings never touches `desktop` or `tablet` slots — they
 * simply aren't surfaced in the UI.
 *
 * State is held in a single React state object (the full blob) so a
 * settings update only re-renders the consumer once; persistence is a
 * fire-and-forget `useEffect` write.
 */
export function useChatAppearance(): UseChatAppearanceResult {
  const device = useDeviceType();

  // Hold the FULL blob in state so writes to one device don't lose the
  // others (e.g. switching from mobile → desktop mid-session).
  const [all, setAllState] = React.useState<AllAppearanceSettings>(
    DEFAULT_ALL_APPEARANCE,
  );
  const [hydrated, setHydrated] = React.useState(false);

  // On mount, read from localStorage. This runs once on the client — the
  // initial server render uses the in-memory defaults so SSR markup is
  // stable, then we sync to the persisted value after hydration.
  React.useEffect(() => {
    setAllState(readAll());
    setHydrated(true);
  }, []);

  // Persist on every change (after the initial hydration).
  React.useEffect(() => {
    if (!hydrated) return;
    writeAll(all);
  }, [all, hydrated]);

  // Helpers — each operates on the CURRENT device's slot only.
  const setAll = React.useCallback(
    (next: AppearanceSettings) => {
      setAllState((prev) => ({ ...prev, [device]: next }));
    },
    [device],
  );

  const setBackground = React.useCallback(
    (key: string) => {
      setAllState((prev) => ({
        ...prev,
        [device]: { ...prev[device], background: key },
      }));
    },
    [device],
  );

  const setFontSize = React.useCallback(
    (size: number) => {
      const clamped = Math.max(
        FONT_SIZE_MIN,
        Math.min(FONT_SIZE_MAX, Math.round(size)),
      );
      setAllState((prev) => ({
        ...prev,
        [device]: { ...prev[device], fontSize: clamped },
      }));
    },
    [device],
  );

  const reset = React.useCallback(() => {
    setAllState((prev) => ({
      ...prev,
      [device]: { ...DEFAULT_APPEARANCE },
    }));
  }, [device]);

  return {
    settings: all[device],
    device,
    setAll,
    setBackground,
    setFontSize,
    reset,
  };
}

/**
 * Resolve the CSS `background` value for a given settings + theme.
 *
 * `theme` is the value from `next-themes`'s `useTheme().resolvedTheme` (either
 * `"light"` or `"dark"`). Falls back to the light variant if unknown (which
 * matches the project's `defaultTheme="light"`).
 */
export function resolveBackgroundCss(
  backgroundKey: string,
  theme: string | undefined,
): string {
  const entry = getBackground(backgroundKey);
  return theme === "dark" ? entry.dark : entry.light;
}
