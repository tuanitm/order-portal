"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Staff inbox — the 🔔 bell (top right, every staff area) for SO Approval
 * notifications: "SO … waits for your approval" (Accountants) and
 * approved / rejected / undone (whoever created / pushed the SO). Polls every
 * 30 s; a newly arrived one pops a short toast; the unread count shows on the
 * bell and in the browser tab title. Clicking an item marks it read and opens
 * the SO / order (which also clears its flashing NEW marker).
 */
interface Item {
  id: number; kind: string; title: string; body: string | null; url: string | null;
  docEntry: number | null; orderId: number | null; actor: string | null; createdAt: string; readAt: string | null;
  /** Waits for my approval — counted on the bell until the SO no longer waits for me. */
  toDo: boolean;
}

const ICON: Record<string, string> = {
  so_approval_request: "📝", so_approved: "✅", so_rejected: "⛔", so_stage_approved: "➡️", so_undone: "↶", ar_approval_request: "🧮",
};

/** Ask other components (SO Approval list, Orders list) to refresh their NEW markers. */
export const NOTIFICATIONS_EVENT = "imv:notifications-changed";

export function NewBadge({ title = "New" }: { title?: string }) {
  return (
    <span className="imv-new-badge" title={title}
      style={{ display: "inline-block", marginLeft: 6, padding: "0 6px", borderRadius: 999, background: "#DC2626", color: "#fff", fontSize: 10, fontWeight: 800, lineHeight: "16px", verticalAlign: "middle", letterSpacing: "0.04em" }}>
      NEW
    </span>
  );
}

/** The keyframes for NewBadge (rendered once by the staff shell). */
export function NewBadgeStyles() {
  return (
    <style>{`
      @keyframes imvNewPulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: .35; transform: scale(.92); } }
      .imv-new-badge { animation: imvNewPulse 1.2s ease-in-out infinite; }
      @media (prefers-reduced-motion: reduce) { .imv-new-badge { animation: none; } }
    `}</style>
  );
}

const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : new Date(iso).toLocaleDateString("en-GB");
};

export function StaffInboxBell({ locale, pathname, right }: { locale: string; pathname: string; right: string }) {
  const [items, setItems] = useState<Item[]>([]);
  // Red number on the bell: new (unread) + still to approve.
  const [unread, setUnread] = useState(0);
  const [toDo, setToDo] = useState(0);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<Item | null>(null);
  const lastTopId = useRef<number | null>(null);
  const baseTitle = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/notifications?limit=30", { cache: "no-store" });
      if (!r.ok) return;
      const j = await r.json() as { items: Item[]; unread: number; toDo: number };
      setItems(j.items);
      setUnread(j.unread);
      setToDo(j.toDo ?? 0);
      const top = j.items[0];
      // A notification that arrived since the last poll (not on first load) → short toast.
      if (top && lastTopId.current !== null && top.id > lastTopId.current && !top.readAt) {
        setToast(top);
        window.dispatchEvent(new Event(NOTIFICATIONS_EVENT));
      }
      lastTopId.current = top?.id ?? 0;
    } catch {
      // keep the last state
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 30000);
    const onChange = () => void load();
    window.addEventListener(NOTIFICATIONS_EVENT + ":reload", onChange);
    return () => { clearInterval(t); window.removeEventListener(NOTIFICATIONS_EVENT + ":reload", onChange); };
  }, [load]);
  // Opening an SO / order marks it read on the server — refresh soon after navigating.
  useEffect(() => { const t = setTimeout(load, 1500); return () => clearTimeout(t); }, [pathname, load]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 8000); return () => clearTimeout(t); }, [toast]);
  // Unread count in the tab title, e.g. "(3) Order Portal".
  useEffect(() => {
    if (baseTitle.current === null) baseTitle.current = document.title.replace(/^\(\d+\)\s*/, "");
    const base = document.title.replace(/^\(\d+\)\s*/, "") || baseTitle.current;
    document.title = unread > 0 ? `(${unread}) ${base}` : base;
  }, [unread, pathname]);

  const markRead = async (body: object) => {
    await fetch("/api/admin/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => undefined);
    await load();
    window.dispatchEvent(new Event(NOTIFICATIONS_EVENT));
  };
  const go = async (n: Item) => {
    setOpen(false);
    setToast(null);
    if (!n.readAt) await markRead({ ids: [n.id] });
    if (n.url) window.location.href = `/${locale}${n.url}`;
  };

  return (
    <div style={{ position: "fixed", top: "1rem", right, zIndex: 200 }}>
      <button onClick={() => setOpen((v) => !v)} aria-label={`Notifications${unread ? ` (${unread} new or to approve)` : ""}`}
        title={unread ? `${unread - toDo > 0 ? `${unread - toDo} new` : ""}${unread - toDo > 0 && toDo ? " · " : ""}${toDo ? `${toDo} SO${toDo > 1 ? "s" : ""} to approve` : ""}` : "No new notifications"}
        style={{
          position: "relative", display: "flex", alignItems: "center", justifyContent: "center", width: 40, height: 40,
          borderRadius: 999, border: "1px solid var(--color-gray-200, #E2E8F0)", background: "var(--bg-primary, #fff)",
          cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
        }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-secondary, #64748B)" }}>
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && (
          <span style={{
            position: "absolute", top: -6, right: -6, minWidth: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center",
            background: "#DC2626", color: "#fff", fontSize: 11, fontWeight: 800, borderRadius: 999, padding: "0 5px", lineHeight: 1,
            border: "2px solid var(--bg-primary, #fff)", boxShadow: "0 1px 3px rgba(220,38,38,0.5)",
          }}>{unread > 99 ? "99+" : unread}</span>
        )}
      </button>

      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 190 }} onClick={() => setOpen(false)} />
          <div style={{
            position: "absolute", right: 0, top: "calc(100% + 0.5rem)", background: "var(--bg-primary, #fff)", borderRadius: 8,
            boxShadow: "0 10px 40px rgba(0,0,0,0.12)", border: "1px solid var(--color-gray-200, #E2E8F0)",
            width: 380, maxWidth: "calc(100vw - 2rem)", maxHeight: 460, overflowY: "auto", padding: "0.375rem", zIndex: 201,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.5rem 0.75rem" }}>
              <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-tertiary, #94A3B8)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Notifications
                {unread > 0 && (
                  <span style={{ marginLeft: 6, textTransform: "none", letterSpacing: 0, color: "#DC2626" }}>
                    {[unread - toDo > 0 && `${unread - toDo} new`, toDo > 0 && `${toDo} to approve`].filter(Boolean).join(" · ")}
                  </span>
                )}
              </span>
              {unread - toDo > 0 && (
                <button onClick={() => void markRead({ all: true })}
                  style={{ border: "none", background: "none", color: "var(--color-primary, #2BBCB3)", fontSize: "0.75rem", fontWeight: 700, cursor: "pointer" }}>
                  Mark all read
                </button>
              )}
            </div>
            {items.length === 0 ? (
              <div style={{ padding: "0.75rem", fontSize: "0.8125rem", color: "var(--text-tertiary, #94A3B8)" }}>No notifications yet.</div>
            ) : items.map((n) => (
              <button key={n.id} onClick={() => void go(n)}
                style={{
                  display: "flex", gap: 10, width: "100%", textAlign: "left", padding: "0.6rem 0.75rem", borderRadius: 6, border: "none",
                  background: n.readAt && !n.toDo ? "transparent" : "rgba(43,188,179,0.08)", cursor: n.url || !n.readAt ? "pointer" : "default", marginBottom: 2,
                }}>
                <span style={{ fontSize: 16, lineHeight: "20px" }}>{ICON[n.kind] ?? "🔔"}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontSize: "0.8125rem", fontWeight: n.readAt ? 600 : 800, color: "var(--text-primary, #0F172A)" }}>{n.title}</span>
                    {n.toDo
                      ? <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 800, color: "#fff", background: "#DC2626", borderRadius: 999, padding: "1px 7px", height: 16, lineHeight: "14px" }}>To approve</span>
                      : !n.readAt && <span style={{ width: 8, height: 8, borderRadius: 999, background: "#DC2626", flexShrink: 0, marginTop: 5 }} />}
                  </span>
                  {n.body && <span style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary, #64748B)", marginTop: 2 }}>{n.body}</span>}
                  <span style={{ display: "block", fontSize: "0.6875rem", color: "var(--text-tertiary, #94A3B8)", marginTop: 3 }}>{ago(n.createdAt)}</span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {toast && !open && (
        <button onClick={() => void go(toast)}
          style={{
            position: "fixed", right: "1.5rem", top: "4.25rem", width: 340, maxWidth: "calc(100vw - 2rem)", textAlign: "left",
            background: "var(--bg-primary, #fff)", border: "1px solid var(--color-gray-200, #E2E8F0)", borderLeft: "4px solid #DC2626",
            borderRadius: 8, boxShadow: "0 10px 30px rgba(0,0,0,0.15)", padding: "0.75rem 0.9rem", cursor: "pointer", zIndex: 210,
          }}>
          <div style={{ fontSize: "0.8125rem", fontWeight: 800 }}>{ICON[toast.kind] ?? "🔔"} {toast.title}</div>
          {toast.body && <div style={{ fontSize: "0.75rem", color: "var(--text-secondary, #64748B)", marginTop: 3 }}>{toast.body}</div>}
        </button>
      )}
    </div>
  );
}
