"use client";

import { SessionProvider, useSession } from "next-auth/react";
import { ThemeProvider } from "next-themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, ReactNode, useEffect } from "react";
import { usePushNotifications } from "@/hooks/use-push-notifications";

function PushSubscriptionManager() {
  const { data: session } = useSession();
  const { status, subscribe } = usePushNotifications(session?.user?.id);

  // Auto-subscribe when the user is logged in + permission not yet requested
  useEffect(() => {
    if (session?.user && status === "unsubscribed") {
      void subscribe();
    }
  }, [session?.user, status, subscribe]);

  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            retry: 1,
            staleTime: 30 * 1000,
          },
        },
      })
  );

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      disableTransitionOnChange
    >
      <SessionProvider
        // Phase 36h — disable periodic session refetching to prevent
        // CLIENT_FETCH_ERROR errors when the dev server is busy compiling.
        // The session is still checked on navigation + initial load (SSR).
        refetchInterval={0}
        refetchOnWindowFocus={false}
      >
        <QueryClientProvider client={client}>
          <PushSubscriptionManager />
          {children}
        </QueryClientProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}
