"use client";

import * as React from "react";

/**
 * Coarse device class returned by {@link useDeviceType}.
 *
 * The thresholds intentionally match the Tailwind `sm`/`md`/`lg` breakpoints:
 *   - mobile  : < 768   (smaller than `md`)
 *   - tablet  : 768–1023 (between `md` and `lg`)
 *   - desktop : >= 1024 (`lg` and up)
 *
 * This way a "phone" user is genuinely on a viewport where the chat renders in
 * its mobile layout, a "tablet" user is on the md–lg middle ground, and only a
 * "desktop" user sees the wide multi-column layout — so each device class only
 * ever edits its OWN appearance slot in {@link useChatAppearance}.
 */
export type DeviceType = "mobile" | "tablet" | "desktop";

const TABLET_MIN = 768; // Tailwind `md`
const DESKTOP_MIN = 1024; // Tailwind `lg`

function resolveDevice(width: number | undefined): DeviceType {
  if (typeof width !== "number" || Number.isNaN(width)) return "desktop";
  if (width < TABLET_MIN) return "mobile";
  if (width < DESKTOP_MIN) return "tablet";
  return "desktop";
}

/**
 * SSR-safe device-class detection.
 *
 * On the server (and during the very first client render before
 * `useEffect` runs) we return `"desktop"` so the markup is stable. Once
 * mounted, we read `window.innerWidth` and re-evaluate on every `resize`
 * event (the listener is passive + cheap — just an integer compare).
 *
 * The hook ALSO re-evaluates on `orientationchange` (some tablets report a
 * different `innerWidth` after rotation without firing `resize`).
 */
export function useDeviceType(): DeviceType {
  // Start with the SSR-friendly default so server HTML and first client
  // paint agree (avoids React hydration mismatch warnings).
  const [device, setDevice] = React.useState<DeviceType>("desktop");

  React.useEffect(() => {
    const update = () => setDevice(resolveDevice(window.innerWidth));
    update(); // sync to the REAL viewport now that we're on the client

    window.addEventListener("resize", update, { passive: true });
    // `orientationchange` is deprecated but still fires on many mobile
    // browsers; harmless where unsupported.
    window.addEventListener("orientationchange", update, {
      passive: true,
    });

    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return device;
}

/**
 * Persian label for a device class — shown as a badge in the appearance
 * settings dialog so the user knows WHICH device's settings they're editing
 * (satisfies the "phone user shouldn't see desktop settings" requirement by
 * making it visually explicit).
 */
export function deviceLabelPersian(device: DeviceType): string {
  switch (device) {
    case "mobile":
      return "موبایل";
    case "tablet":
      return "تبلت";
    case "desktop":
      return "دسکتاپ";
    default:
      return device;
  }
}
