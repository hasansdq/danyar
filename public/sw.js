// Danyar Push Notification Service Worker
const CACHE_NAME = "danyar-v1";

// Install — skip waiting
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

// Activate — claim clients immediately
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Push event — display notification
self.addEventListener("push", (event) => {
  let payload;
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "دانیار", body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "دانیار";
  const options = {
    body: payload.body || "",
    icon: payload.icon || "/logo.svg",
    badge: payload.badge || "/logo.svg",
    tag: payload.tag || "default",
    data: { url: payload.url || "/" },
    requireInteraction: false,
    vibrate: [200, 100, 200],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Notification click — navigate to URL
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // Focus existing window if available
      for (const client of clientList) {
        if (client.url.includes(url) || "focus" in client) {
          return client.focus();
        }
      }
      // Open new window
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
    }),
  );
});
