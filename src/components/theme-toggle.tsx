"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Light/dark theme toggle.
 *
 * next-themes is mounted on `<html class="...">` via the ThemeProvider in
 * `src/components/providers.tsx` (`attribute="class"`, `defaultTheme="light"`,
 * `enableSystem={false}`). We toggle between `"light"` and `"dark"`.
 *
 * Because the resolved theme is only known after hydration (next-themes reads
 * from localStorage / class on the client), we MUST guard with `mounted` to
 * avoid SSR/CSR markup mismatch — otherwise Next.js will hydrate with a
 * different icon than what the server rendered.
 *
 * Convention:
 *   - In DARK mode we show the Sun (click → go light).
 *   - In LIGHT mode we show the Moon (click → go dark).
 */
export function ThemeToggle({
  className,
  size = "icon",
}: {
  className?: string;
  size?: "icon" | "sm" | "default";
}) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === "dark";

  function toggle() {
    setTheme(isDark ? "light" : "dark");
  }

  return (
    <Button
      variant="ghost"
      size={size}
      onClick={toggle}
      aria-label="تغییر حالت روشن/تیره"
      title={isDark ? "حالت روشن" : "حالت تیره"}
      className={className}
    >
      {/* Render a neutral placeholder until mounted to avoid hydration mismatch. */}
      {mounted ? (
        isDark ? (
          <Sun className="size-5" />
        ) : (
          <Moon className="size-5" />
        )
      ) : (
        <Sun className="size-5 opacity-0" aria-hidden="true" />
      )}
    </Button>
  );
}
