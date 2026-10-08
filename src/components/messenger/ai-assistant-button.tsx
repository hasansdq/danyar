"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCan } from "./use-permissions";
import { AIAssistantPanel } from "./ai-assistant-panel";

/**
 * Minimal user shape needed by the FAB. We accept the role as a string so
 * the same component can be mounted from the messenger (where
 * {@link MessengerUser} types role as `STUDENT | TEACHER | ADMIN`) AND
 * from the admin panel (where the session user.role can also be
 * `SUPERADMIN`). The role check is on the literal strings.
 */
interface AIAssistantUser {
  id: string;
  username: string;
  name: string;
  role: string;
}

interface AIAssistantButtonProps {
  /** Currently authenticated user — gates visibility on role. */
  user: AIAssistantUser;
  /**
   * When `true`, the floating button is hidden (but the component stays
   * mounted so its Sheet state persists). Used to hide the FAB inside an
   * open chat view per the task spec ("داخل گفتگوها نمایش داده نشود").
   */
  hidden?: boolean;
  /**
   * When `true`, the FAB uses `bottom-16` on all viewports to clear the
   * admin panel's sticky footer (instead of `bottom-20 md:bottom-4` which
   * is for the messenger).
   */
  adminMode?: boolean;
}

/**
 * Floating Action Button (FAB) for the principal's AI assistant.
 *
 * Only rendered for principals (ADMIN) + super-admins (SUPERADMIN) AND when
 * the calling user has the `ai_assistant` permission enabled (managed by
 * the SUPERADMIN via the role-permissions-manager). The FAB itself does
 * NOT render inside an open chat (pass `hidden` to suppress it there) per
 * the task spec.
 *
 * Clicking the FAB opens the {@link AIAssistantPanel} side sheet from the
 * right edge of the viewport.
 *
 * The button is `fixed` so its position in the React tree doesn't matter —
 * mount it anywhere it can be conditionally rendered.
 */
export function AIAssistantButton({
  user,
  hidden = false,
  adminMode = false,
}: AIAssistantButtonProps) {
  const canUseAI = useCan("ai_assistant");
  const [open, setOpen] = React.useState(false);

  const eligible =
    (user.role === "ADMIN" || user.role === "SUPERADMIN") && canUseAI;

  // When the FAB is hidden (e.g. user opened a chat), keep the sheet mounted
  // but the FAB suppressed. If the user is not eligible, render nothing.
  if (!eligible && !open) return null;

  return (
    <>
      <AnimatePresence>
        {!hidden && eligible ? (
          <motion.button
            type="button"
            aria-label="دستیار هوش مصنوعی"
            title="دستیار هوش مصنوعی مدیر"
            onClick={() => setOpen(true)}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            transition={{ type: "spring", stiffness: 360, damping: 22 }}
            className={cn(
              // 10% smaller: size-14 (56px) → size-[50px] (50px).
              // Position: in the messenger (default), `bottom-20` on mobile
              // (clears the ~64px bottom nav) + `bottom-4` on md+ (no nav).
              // In the admin panel (`adminMode`), the footer (~50px) is always
              // present, so use `bottom-16` on all viewports to clear it.
              adminMode
                ? "fixed bottom-16 right-4 z-50 flex size-[50px] items-center justify-center rounded-full"
                : "fixed bottom-20 right-4 z-50 flex size-[50px] items-center justify-center rounded-full md:bottom-4",
              "bg-primary text-primary-foreground shadow-lg",
              "ring-1 ring-primary/30 hover:shadow-xl",
              "transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <Sparkles className="size-5" />
            {/* Pulsing dot to call attention to the FAB on first mount. */}
            <span
              aria-hidden
              className="absolute -right-0.5 -top-0.5 size-3 rounded-full bg-emerald-400 ring-2 ring-background"
            />
          </motion.button>
        ) : null}
      </AnimatePresence>

      {/* The Sheet itself is always mounted when eligible so the user's
          chat history survives the FAB being hidden by `hidden={true}`. */}
      {eligible ? (
        <AIAssistantPanel open={open} onOpenChange={setOpen} />
      ) : null}
    </>
  );
}
