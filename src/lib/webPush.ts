import webpush from "web-push";
import { query } from "@/lib/db/connection";
import { loadConfig, resolveEnvSecret } from "@/lib/config";

interface PushSubscriptionRow {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
}

let configured = false;

/** Sets VAPID details on the shared `web-push` module once (idempotent). */
function ensureConfigured(): void {
  if (configured) return;
  const cfg = loadConfig().webPush;
  const privateKey = cfg.privateKey.startsWith("ENV:")
    ? resolveEnvSecret(cfg.privateKey.replace("ENV:", ""))
    : cfg.privateKey;
  webpush.setVapidDetails(cfg.subject, cfg.publicKey, privateKey);
  configured = true;
}

/** `admin.webPush.publicKey` from config.json — safe to hand to the browser (see /api/app-info). */
export function getPublicKey(): string {
  return loadConfig().webPush.publicKey;
}

/** Upserts a browser's push subscription for a customer — see PushManager.subscribe() on the client. */
export async function saveSubscription(
  userId: number,
  endpoint: string,
  p256dh: string,
  auth: string
): Promise<void> {
  await query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), p256dh = VALUES(p256dh), auth = VALUES(auth)`,
    [userId, endpoint, p256dh, auth]
  );
}

/** Removes one subscription by its endpoint — called when the customer explicitly turns notifications off on that browser. */
export async function deleteSubscription(endpoint: string): Promise<void> {
  await query(`DELETE FROM push_subscriptions WHERE endpoint = ?`, [endpoint]);
}

/**
 * Sends a push notification to every browser/device this customer has
 * subscribed on (there can be several). A subscription whose push service
 * reports it gone (410) or not found (404) is deleted — it can never
 * succeed again, so there's no point keeping it around. Best-effort per
 * subscription: one failing never stops the others, and the caller (the
 * admin message POST route) never fails because of this either, same
 * pattern as the existing email notification.
 */
export async function sendPushToUser(
  userId: number,
  payload: { title: string; body: string; url: string }
): Promise<void> {
  ensureConfigured();

  const subscriptions = await query<PushSubscriptionRow[]>(
    `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?`,
    [userId]
  );
  if (subscriptions.length === 0) return;

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload)
        );
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await query(`DELETE FROM push_subscriptions WHERE id = ?`, [sub.id]);
        } else {
          console.error("[WebPush] Failed to send notification:", error);
        }
      }
    })
  );
}
