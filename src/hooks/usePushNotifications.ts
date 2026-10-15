"use client";

import { useEffect } from "react";

// Cached across calls within the page (not persisted) — avoids re-fetching
// /api/app-info every time this hook re-runs (e.g. a remount after a
// client-side navigation that happens to recreate the Navbar).
let cachedPublicKey: string | null = null;

/** VAPID public keys arrive as URL-safe base64; PushManager wants raw bytes. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

/**
 * Registers the service worker (public/sw.js), asks the browser for
 * Notification permission, and subscribes to Web Push — sending the
 * subscription to the server (see /api/push/subscribe and
 * src/lib/webPush.ts, which is what actually sends notifications, e.g.
 * when an admin posts a message on one of this customer's orders).
 *
 * Only runs once `enabled` is true (the customer is logged in — messages
 * are per-account, so there's nothing to subscribe to otherwise). Asking
 * for permission is itself a no-op if the browser already has an answer
 * (granted or denied) — `Notification.requestPermission()` resolves
 * immediately without showing anything in that case, so this is safe to
 * run on every login check, not just the very first one.
 */
export function usePushNotifications(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return;

    let cancelled = false;

    (async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js");

        if (Notification.permission === "default") {
          const permission = await Notification.requestPermission();
          if (cancelled) return;
          if (permission !== "granted") return;
        }
        if (Notification.permission !== "granted") return;

        let subscription = await registration.pushManager.getSubscription();
        if (!subscription) {
          if (!cachedPublicKey) {
            const res = await fetch("/api/app-info");
            const data = res.ok ? await res.json() : null;
            cachedPublicKey = data?.webPushPublicKey || null;
          }
          if (!cachedPublicKey || cancelled) return;

          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(cachedPublicKey) as BufferSource,
          });
        }
        if (cancelled) return;

        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(subscription.toJSON()),
        });
      } catch (error) {
        console.error("[Push] Setup failed:", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled]);
}
