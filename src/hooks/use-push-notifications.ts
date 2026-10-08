"use client";

import { useEffect, useState, useCallback } from "react";

const SW_URL = "/sw.js";
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";

export type PushStatus = "unsupported" | "denied" | "subscribed" | "unsubscribed" | "loading";

/**
 * Hook that manages the service worker registration + push subscription lifecycle.
 * - Registers the SW on mount.
 * - If permission is granted and the user hasn't subscribed yet, auto-subscribes.
 * - Returns the current status + a `subscribe()` / `unsubscribe()` function.
 */
export function usePushNotifications(userId?: string) {
  const [status, setStatus] = useState<PushStatus>("loading");
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);

  const checkPermission = useCallback(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setStatus("unsupported");
      return;
    }
    const perm = Notification.permission;
    if (perm === "denied") {
      setStatus("denied");
      return;
    }
    setStatus(perm === "granted" ? "subscribed" : "unsubscribed");
  }, []);

  // Register the service worker
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return; // status stays "loading" — callers treat it as unsupported
    }
    let mounted = true;
    navigator.serviceWorker
      .register(SW_URL)
      .then((reg) => {
        if (!mounted) return;
        setRegistration(reg);
        checkPermission();
      })
      .catch(() => {
        if (mounted) setStatus("unsupported");
      });
    return () => { mounted = false; };
  }, [checkPermission]);

  async function subscribe() {
    if (!registration || !VAPID_PUBLIC_KEY) return;
    try {
      // Request permission
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setStatus("denied");
        return;
      }

      // Subscribe to push
      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        // Uint8Array<ArrayBufferLike> isn't assignable to BufferSource in
        // this TS lib version — cast to the expected BufferSource shape.
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      });

      // Send subscription to server
      // `PushSubscription.keys` exists at runtime in every push-capable
      // browser but is only typed on PushSubscriptionJSON — extend locally.
      const subWithKeys = sub as PushSubscription & {
        keys?: { p256dh?: string; auth?: string };
      };
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          endpoint: sub.endpoint,
          p256dh: subWithKeys.keys?.p256dh,
          auth: subWithKeys.keys?.auth,
          userAgent: navigator.userAgent,
        }),
      });

      if (res.ok) {
        setStatus("subscribed");
      }
    } catch {
      setStatus("unsubscribed");
    }
  }

  async function unsubscribe() {
    if (!registration) return;
    try {
      const sub = await registration.pushManager.getSubscription();
      if (sub) {
        await sub.unsubscribe();
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          credentials: "include",
        });
      }
      setStatus("unsubscribed");
    } catch {
      // ignore
    }
  }

  return { status, subscribe, unsubscribe };
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
