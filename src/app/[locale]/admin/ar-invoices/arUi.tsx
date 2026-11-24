"use client";

import { Badge } from "../adminUi";

/** Shared bits of the AR Invoice screens. */
export const AR_STATUS: Record<string, { label: string; tone: "success" | "warning" | "error" | "neutral"; hint: string }> = {
  draft: { label: "Draft", tone: "neutral", hint: "Saved on the portal only — not in SAP yet" },
  pending_approval: { label: "Waiting approval", tone: "warning", hint: "SAP saved it as a Draft; its approval request is waiting" },
  approved: { label: "Approved", tone: "warning", hint: "Approved in SAP — the draft still has to be added as the invoice" },
  posted: { label: "Posted", tone: "success", hint: "A/R Invoice added in SAP" },
  rejected: { label: "Rejected", tone: "error", hint: "Not approved in SAP — edit and post again, or delete" },
  failed: { label: "Failed", tone: "error", hint: "SAP refused it — see the error, fix and post again" },
  cancelled: { label: "Cancelled", tone: "neutral", hint: "The SAP approval request was cancelled" },
};

export function ArStatusBadge({ status }: { status: string }) {
  const s = AR_STATUS[status] ?? { label: status, tone: "neutral" as const, hint: "" };
  return <Badge label={s.label} tone={s.tone} title={s.hint} />;
}

export const money = (v: number | string | null | undefined) =>
  v === null || v === undefined || v === "" ? "—" : Math.round(Number(v)).toLocaleString("en-US");

/** "2026-11-24" → "24/11/2026". */
export const dmy = (v: string | null | undefined) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}` : v ?? "—");
