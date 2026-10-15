// Minimal service worker whose only job is Web Push: show a notification
// when one arrives, and focus/open the relevant order page on click.
// See src/lib/webPush.ts (server) and src/hooks/usePushNotifications.ts
// (client) for the rest of this feature.

self.addEventListener("push", (event) => {
  let data = { title: "Order Portal", body: "", url: "/" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // Non-JSON payload — fall back to the defaults above.
  }

  event.waitUntil(
    (async () => {
      await self.registration.showNotification(data.title, {
        body: data.body,
        icon: "/icon.png",
        badge: "/icon.png",
        data: { url: data.url },
      });

      // Also tell any already-open tab a push arrived, so it can refresh
      // its own data (order status, message thread, unread badge) instead
      // of only ever showing the native OS notification — see
      // src/hooks/usePushRefresh.ts on the client side.
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const win of windows) {
        win.postMessage({ type: "order-notification", url: data.url });
      }
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const win of windows) {
        if (win.url.includes(targetUrl) && "focus" in win) {
          return win.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    })()
  );
});
