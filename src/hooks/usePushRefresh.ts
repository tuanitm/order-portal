"use client";

import { useEffect } from "react";

/**
 * Calls `onNotification` whenever the service worker (public/sw.js)
 * reports that a push notification just arrived — lets an already-open
 * page refresh its own data (order status, message thread, unread badge)
 * instead of the customer only ever seeing the native OS notification and
 * having to manually reload. See usePushNotifications.ts for the
 * subscribe side of this feature.
 */
export function useOnPushNotification(onNotification: (data: { url: string }) => void): void {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const handler = (event: MessageEvent) => {
      if (event.data?.type === "order-notification") {
        onNotification({ url: event.data.url || "" });
      }
    };
    navigator.serviceWorker.addEventListener("message", handler);
    return () => navigator.serviceWorker.removeEventListener("message", handler);
  }, [onNotification]);
}
