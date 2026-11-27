"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useParams } from "next/navigation";
import { createPortal } from "react-dom";
import { styles, btn, BackLink } from "../../adminUi";
import { useStaffBase } from "../../layout";
import { ArStatusBadge, AR_STATUS, money, dmy } from "../arUi";

/**
 * One AR Invoice: the entry form (new / draft / failed / rejected) and, once
 * sent to SAP, its SAP approval progress, the approver's Approve / Reject and
 * "Add to SAP" after the final approval. Service (non-inventory) items only.
 */
interface Item { itemCode: string; itemName: string; uom: string | null; vatGroup: string | null; brandCode: string | null; itemTaxClass: string | null }
interface Line {
  key: number; itemCode: string; itemName: string; uom: string | null; brandCode: string | null; quantity: string; unitPrice: string; discountPct: string; vatGroup: string; description: string;
  /** SAP Rebate this CKTM line pays out (U_RBTRef). */
  rbtRef: number | null; rbtCode: string | null; rbtName: string | null; rbtAmount: number | null;
}
interface Rebate { docEntry: number; code: string; name: string; amount: number; validFrom: string | null; validTo: string | null; creator: string | null; usedBy: string | null; suggestedItem: string | null; suggestedText: string | null }
interface Customer { sap_card_code: string; card_name: string | null; mst_code: string | null; cus_grp01: string | null; bill_to_default: string | null; ship_to_default: string | null }
interface Address { name: string; address: string | null }
interface Approval {
  wddCode: number; templateName: string | null; status: string; currStep: number; draftEntry?: number | null;
  stages: { wstCode: number; name: string; maxReqr: number; lines: { userCode: string; userName: string | null; status: string; remarks: string | null; updatedAt: string | null }[] }[];
}
interface Detail {
  doc: Record<string, string | number | null> & { id: number; status: string };
  lines: { item_code: string; item_name: string | null; uom: string | null; brand_code: string | null; quantity: number; unit_price: number; discount_pct: number; vat_group: string | null; description: string | null; line_total: number; rbt_ref: number | null; rbt_code: string | null; rbt_name: string | null }[];
  events: { action: string; admin_label: string | null; sap_user_code: string | null; notes: string | null; created_at: string }[];
  approval: Approval | null;
  sapUser: string | null;
  can: { edit: boolean; post: boolean; delete: boolean; decide: boolean; generate: boolean; updateSap?: boolean };
}
interface Preview { name: string; applies: boolean | null; approvers: string[]; note?: string }

const today = () => { const d = new Date(Date.now() + 7 * 3600 * 1000); return d.toISOString().slice(0, 10); };
const rateOf = (code: string) => { const m = /^S(\d{2})$/i.exec(code.trim()); return m ? Number(m[1]) : 0; };
const n = (v: string) => (v.trim() === "" || v.trim() === "-" ? 0 : Number(v.replace(/,/g, "")));
/** Unit price as typed → "1,500,000" (thousand separators; keeps a leading "-" and a decimal part). */
const groupDigits = (v: string) => {
  const s = v.replace(/[^\d.-]/g, "");
  const neg = s.startsWith("-");
  const [int, ...rest] = s.replace(/-/g, "").split(".");
  const intFmt = int.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${intFmt}${rest.length ? `.${rest.join("")}` : ""}`;
};
const lineTotal = (l: Line) => Math.round(n(l.quantity) * n(l.unitPrice) * (1 - n(l.discountPct) / 100));
let keySeq = 1;
const emptyLine = (): Line => ({ key: keySeq++, itemCode: "", itemName: "", uom: null, brandCode: null, quantity: "-1", unitPrice: "", discountPct: "0", vatGroup: "", description: "", rbtRef: null, rbtCode: null, rbtName: null, rbtAmount: null });
const label: CSSProperties = { fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-tertiary, #94A3B8)" };

function Field({ title, children, width }: { title: string; children: ReactNode; width?: number | string }) {
  return <label style={{ display: "grid", gap: 4, width: width ?? 180 }}><span style={label}>{title}</span>{children}</label>;
}

/** A search box with a dropdown of results (customers / items). */
function Picker<T>({ value, placeholder, disabled, search, render, onPick, width }: {
  value: string; placeholder: string; disabled?: boolean; width?: number | string;
  search: (q: string, signal: AbortSignal) => Promise<T[]>; render: (x: T) => ReactNode; onPick: (x: T) => void;
}) {
  const [q, setQ] = useState(value);
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<T[]>([]);
  useEffect(() => setQ(value), [value]);
  useEffect(() => {
    if (!open) return;
    const ctl = new AbortController();
    const t = setTimeout(() => { search(q, ctl.signal).then(setList).catch(() => {}); }, 250);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q, open, search]);

  // The list is rendered on document.body (fixed position) so a scrolling / overflow-clipped
  // parent — e.g. the lines table — can't cut it off or draw over it.
  const anchorRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties | null>(null);
  const showList = open && list.length > 0;
  useEffect(() => {
    if (!showList) { setPos(null); return; }
    const place = () => {
      const r = anchorRef.current?.getBoundingClientRect();
      if (!r) return;
      const MAX = 300, GAP = 4;
      const below = window.innerHeight - r.bottom - GAP;
      const flip = below < 180 && r.top > below; // not enough room below → open upwards
      const w = Math.max(r.width, 320);
      setPos({
        position: "fixed", left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)), width: w,
        maxHeight: Math.min(MAX, Math.max(120, (flip ? r.top : below) - 8)),
        ...(flip ? { bottom: window.innerHeight - r.top + GAP } : { top: r.bottom + GAP }),
      });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => { window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
  }, [showList]);

  return (
    <div ref={anchorRef} style={{ position: "relative", width: width ?? "100%" }}>
      <input style={{ ...styles.input, width: "100%" }} value={q} placeholder={placeholder} disabled={disabled}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 200)} onChange={(e) => { setQ(e.target.value); setOpen(true); }} />
      {showList && pos && createPortal(
        <div style={{ ...pos, zIndex: 1000, overflowY: "auto", background: "var(--bg-primary, #fff)",
          border: "1px solid var(--color-gray-200, #E2E8F0)", borderRadius: 8, boxShadow: "0 8px 24px rgba(15,23,42,0.12)" }}>
          {list.map((x, i) => (
            <div key={i} onMouseDown={(e) => { e.preventDefault(); onPick(x); setOpen(false); }}
              style={{ padding: "0.45rem 0.7rem", cursor: "pointer", fontSize: "0.8rem", borderBottom: "1px solid var(--color-gray-100, #F1F5F9)" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-secondary, #F8FAFC)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = ""; }}>
              {render(x)}
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

export default function ArInvoicePage() {
  const { id } = useParams<{ id: string; locale: string }>();
  const isNew = id === "new";
  const base = useStaffBase();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [lookups, setLookups] = useState<{ departments: { code: string; name: string | null }[]; brands: { code: string; name: string | null }[]; vatGroups: { code: string; rate: number | null }[]; sapUser: string | null; myDepartment: string | null } | null>(null);

  // Form
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [addresses, setAddresses] = useState<{ billTo: Address[]; shipTo: Address[]; warehouses: { code: string; name?: string | null }[] }>({ billTo: [], shipTo: [], warehouses: [] });
  const [h, setH] = useState({ billToCode: "", shipToCode: "", invName: "", invTaxNo: "", invAddress: "", docDate: today(), dueDate: today(), taxDate: today(), numAtCard: "", comments: "", warehouseCode: "", departmentCode: "", brandCode: "" });
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [preview, setPreview] = useState<Preview[] | null>(null);
  const [remarks, setRemarks] = useState("");
  const [rebates, setRebates] = useState<Rebate[] | null>(null);
  const [rebateSel, setRebateSel] = useState<Set<number>>(new Set());

  useEffect(() => {
    fetch("/api/admin/ar-invoices/lookups").then((r) => r.json()).then((j) => {
      if (j.departments) {
        setLookups(j);
        // One brand only → preselected.
        if (isNew) setH((x) => ({ ...x, departmentCode: x.departmentCode || j.myDepartment || "", brandCode: x.brandCode || (j.brands?.length === 1 ? j.brands[0].code : "") }));
      }
    }).catch(() => {});
  }, [isNew]);

  const loadCustomer = useCallback(async (code: string, keepAddresses = false) => {
    const res = await fetch(`/api/admin/ar-invoices/lookups?customer=${encodeURIComponent(code)}`);
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || "Customer not found");
    setCustomer(j.customer);
    setAddresses({ billTo: j.billTo, shipTo: j.shipTo, warehouses: j.warehouses });
    if (!keepAddresses) {
      const bill = j.billTo.find((a: Address) => a.name === j.customer.bill_to_default) ?? j.billTo[0];
      setH((x) => ({
        ...x, billToCode: bill?.name ?? "", shipToCode: j.customer.ship_to_default ?? j.shipTo[0]?.name ?? "",
        invName: j.customer.card_name ?? "", invTaxNo: j.customer.mst_code ?? "", invAddress: (bill?.address ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
        warehouseCode: x.warehouseCode || j.warehouses[0]?.code || "",
      }));
    }
  }, []);

  const load = useCallback(async () => {
    if (isNew) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/ar-invoices/${id}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed to load");
      setDetail(j);
      const d = j.doc;
      setH({
        billToCode: d.bill_to_code ?? "", shipToCode: d.ship_to_code ?? "", invName: d.inv_name ?? "", invTaxNo: d.inv_tax_no ?? "", invAddress: d.inv_address ?? "",
        docDate: d.doc_date, dueDate: d.due_date, taxDate: d.tax_date, numAtCard: d.num_at_card ?? "", comments: d.comments ?? "",
        warehouseCode: d.warehouse_code ?? "", departmentCode: d.department_code ?? "", brandCode: String(d.brand_code ?? ""),
      });
      setLines(j.lines.map((l: Detail["lines"][number]) => ({
        key: keySeq++, itemCode: l.item_code, itemName: l.item_name ?? "", uom: l.uom, brandCode: l.brand_code,
        quantity: String(Number(l.quantity)), unitPrice: groupDigits(String(Number(l.unit_price))), discountPct: String(Number(l.discount_pct)), vatGroup: l.vat_group ?? "", description: l.description ?? "",
        rbtRef: l.rbt_ref, rbtCode: l.rbt_code, rbtName: l.rbt_name, rbtAmount: null,
      })));
      if (j.can.edit) loadCustomer(d.sap_card_code, true).catch(() => {});
      else setCustomer({ sap_card_code: d.sap_card_code, card_name: d.card_name, mst_code: d.inv_tax_no, cus_grp01: null, bill_to_default: null, ship_to_default: null });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [id, isNew, loadCustomer]);
  useEffect(() => { load(); }, [load]);

  const editable = isNew || !!detail?.can.edit;
  const itemCodes = useMemo(() => [...new Set(lines.map((l) => l.itemCode).filter(Boolean))].join(","), [lines]);

  // Which SAP approval templates would apply when you post (as SAP decides: originator + condition).
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!editable || !customer || !itemCodes) { setPreview(null); return; }
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => {
      fetch(`/api/admin/ar-invoices/lookups?preview=1&card=${encodeURIComponent(customer.sap_card_code)}&codes=${encodeURIComponent(itemCodes)}`)
        .then((r) => r.json()).then((j) => setPreview(j.templates ?? null)).catch(() => setPreview(null));
    }, 500);
  }, [editable, customer, itemCodes]);

  const searchCustomers = useCallback(async (q: string, signal: AbortSignal) =>
    (await (await fetch(`/api/admin/ar-invoices/lookups?customers=${encodeURIComponent(q)}`, { signal })).json()).customers ?? [], []);
  const searchItems = useCallback(async (q: string, signal: AbortSignal) =>
    (await (await fetch(`/api/admin/ar-invoices/lookups?items=${encodeURIComponent(q)}${h.brandCode ? `&brand=${encodeURIComponent(h.brandCode)}` : ""}`, { signal })).json()).items ?? [], [h.brandCode]);

  // The customer's open SAP rebates (CKTM programs) — each becomes one line: Qty −1, price = rebate amount.
  const cardCode = customer?.sap_card_code ?? "";
  useEffect(() => {
    if (!editable || !cardCode) { setRebates(null); return; }
    setRebateSel(new Set());
    fetch(`/api/admin/ar-invoices/lookups?rebates=${encodeURIComponent(cardCode)}${isNew ? "" : `&doc=${id}`}`)
      .then((r) => r.json()).then((j) => setRebates(j.rebates ?? [])).catch(() => setRebates([]));
  }, [editable, cardCode, id, isNew]);
  const addRebates = async () => {
    const picked = (rebates ?? []).filter((r) => rebateSel.has(r.docEntry));
    const codes = [...new Set(picked.map((r) => r.suggestedItem).filter((x): x is string => !!x))];
    const found = new Map<string, Item>();
    await Promise.all(codes.map(async (c) => {
      const j = await (await fetch(`/api/admin/ar-invoices/lookups?items=${encodeURIComponent(c)}`)).json().catch(() => ({}));
      const it = (j.items as Item[] | undefined)?.find((x) => x.itemCode === c);
      if (it) found.set(c, it);
    }));
    const added: Line[] = picked.map((r) => {
      const it = r.suggestedItem ? found.get(r.suggestedItem) : undefined;
      return {
        ...emptyLine(), itemCode: it?.itemCode ?? "", itemName: it?.itemName ?? "", uom: it?.uom ?? null, brandCode: it?.brandCode ?? null,
        quantity: "-1", unitPrice: groupDigits(String(r.amount)), vatGroup: it?.vatGroup ?? "S08", description: r.suggestedText ?? "",
        rbtRef: r.docEntry, rbtCode: r.code, rbtName: r.name, rbtAmount: r.amount,
      };
    });
    setLines((ls) => [...ls.filter((l) => l.itemCode || l.rbtRef), ...added]);
    if (!h.comments.trim()) {
      setH((x) => ({ ...x, comments: picked.map((r) => r.name.replace(/^[^-]*-\s*\d+%\s*-\s*/, "")).join(" + ").slice(0, 254) }));
    }
    setRebateSel(new Set());
  };

  const setLine = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const totals = useMemo(() => {
    const before = lines.reduce((t, l) => t + (l.itemCode ? lineTotal(l) : 0), 0);
    const vat = lines.reduce((t, l) => t + (l.itemCode ? Math.round((lineTotal(l) * rateOf(l.vatGroup)) / 100) : 0), 0);
    return { before, vat, total: before + vat };
  }, [lines]);

  const body = () => ({
    cardCode: customer?.sap_card_code ?? "", ...h,
    lines: lines.filter((l) => l.itemCode).map((l) => ({ itemCode: l.itemCode, quantity: n(l.quantity), unitPrice: n(l.unitPrice), discountPct: n(l.discountPct), vatGroup: l.vatGroup, description: l.description, rbtRef: l.rbtRef })),
  });

  const call = async (what: string, fn: () => Promise<Response>) => {
    setBusy(what);
    setError("");
    setNotice("");
    try {
      const res = await fn();
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (j.code === "sap_login_required" || j.code === "sap_password_invalid") throw new Error(`${j.error} — open My Profile to save your SAP user and password.`);
        throw new Error(j.error || "Failed");
      }
      return j;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      return null;
    } finally {
      setBusy("");
    }
  };

  const save = async (andPost: boolean) => {
    if (andPost && !confirm(`Post this AR Invoice to SAP as ${lookups?.sapUser ?? "your SAP user"}?\n\nTotal ${money(totals.total)} ₫ for ${customer?.sap_card_code}. ${preview?.some((p) => p.applies !== false) ? "It is saved in SAP as a Draft (Adm Confirmed) and waits for the approvers first." : "SAP adds it straight away (no approval template applies)."}`)) return;
    const saved = await call("save", () => fetch(isNew ? "/api/admin/ar-invoices" : `/api/admin/ar-invoices/${id}`, {
      method: isNew ? "POST" : "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body()),
    }));
    if (!saved) return;
    if (andPost) {
      const posted = await call("post", () => fetch(`/api/admin/ar-invoices/${saved.id}/post`, { method: "POST" }));
      if (posted) sessionStorageSet(`arNotice:${saved.id}`, posted.message);
    }
    if (isNew) window.location.href = `${base}/ar-invoices/${saved.id}`;
    else { await load(); if (!andPost) setNotice(saved.message || "Saved."); else setNotice(sessionStorageTake(`arNotice:${saved.id}`) ?? ""); }
  };

  useEffect(() => { if (!isNew) { const m = sessionStorageTake(`arNotice:${id}`); if (m) setNotice(m); } }, [id, isNew]);

  const decide = async (decision: "approved" | "rejected") => {
    if (decision === "rejected" && !remarks.trim()) { setError("Write the reason for rejecting"); return; }
    const j = await call(decision, () => fetch(`/api/admin/ar-invoices/${id}/decision`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, remarks }) }));
    if (j) { setRemarks(""); await load(); setNotice(j.message); }
  };
  const generate = async () => {
    const j = await call("generate", () => fetch(`/api/admin/ar-invoices/${id}/generate`, { method: "POST" }));
    if (j) { await load(); setNotice(j.message); }
  };
  const remove = async () => {
    if (!confirm("Delete this AR Invoice draft?")) return;
    const j = await call("delete", () => fetch(`/api/admin/ar-invoices/${id}`, { method: "DELETE" }));
    if (j) window.location.href = `${base}/ar-invoices`;
  };

  if (loading) return <div style={styles.page}><div style={styles.container}><div style={styles.empty}>Loading...</div></div></div>;
  const d = detail?.doc;
  const input = { ...styles.input, width: "100%" };
  const td: CSSProperties = { ...styles.td, padding: "0.35rem 0.4rem", verticalAlign: "top" };
  const th: CSSProperties = { ...styles.th, padding: "0.5rem 0.4rem" };
  const applies = preview?.filter((p) => p.applies) ?? [];
  const unknown = preview?.filter((p) => p.applies === null) ?? [];

  return (
    <div style={styles.page}>
      <div style={{ ...styles.container, maxWidth: 1400 }}>
        <div style={styles.header}>
          <div>
            <h1 style={{ ...styles.title, display: "flex", gap: 10, alignItems: "center" }}>
              {isNew ? "New AR Invoice" : `AR Invoice ${d?.sap_doc_no ?? d?.doc_number ?? id}`} {d && <ArStatusBadge status={d.status} />}
            </h1>
            {d && <div style={styles.subtitle}>{d.source === "sap" ? `Entered in SAP by ${d.posted_sap_user ?? "—"} — read-only here (change it in SAP) · ` : ""}{AR_STATUS[d.status]?.hint}{d.sap_doc_no && d.doc_number && d.sap_doc_no !== d.doc_number ? ` · Portal ref ${d.doc_number}` : ""}{d.sap_doc_num ? ` · SAP A/R Invoice ${d.sap_doc_num}` : ""}{d.posted_sap_user && d.source !== "sap" ? ` · as SAP user ${d.posted_sap_user}` : ""}</div>}
          </div>
          <BackLink href={`${base}/ar-invoices`} label="← AR Invoices" />
        </div>

        {error && <div style={{ ...styles.cardPadded, padding: "0.8rem 1.1rem", color: "#B91C1C", background: "#FEF2F2", borderColor: "#FCA5A5" }}>{error}</div>}
        {notice && <div style={{ ...styles.cardPadded, padding: "0.8rem 1.1rem", color: "#065F46", background: "#ECFDF5", borderColor: "#6EE7B7" }}>{notice}</div>}
        {d?.status === "failed" && d.last_error && <div style={{ ...styles.cardPadded, padding: "0.8rem 1.1rem", color: "#B91C1C" }}><b>SAP error:</b> {String(d.last_error)}</div>}

        {/* SAP approval */}
        {detail?.approval && (
          <div style={styles.cardPadded}>
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
              <div style={{ fontWeight: 800 }}>
                Approval · {detail.approval.templateName ?? "template"}{" "}
                <span style={{ fontWeight: 400, color: "var(--text-tertiary)" }}>
                  {detail.approval.wddCode ? `(SAP request #${detail.approval.wddCode})` : `(on the portal · SAP draft ${detail.approval.draftEntry ?? "—"})`}
                </span>
              </div>
              <button type="button" style={btn("secondary", !!busy)} disabled={!!busy} onClick={() => load()}>↻ Refresh from SAP</button>
            </div>
            {detail.approval.stages.map((st) => (
              <div key={st.wstCode} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "0.4rem 0", borderTop: "1px solid var(--color-gray-100, #F1F5F9)" }}>
                <div style={{ width: 180, fontWeight: 600, fontSize: "0.8125rem" }}>{st.name}{st.wstCode === detail.approval!.currStep && detail.approval!.status === "W" ? " ◀ now" : ""}</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {st.lines.length === 0 && <span style={{ fontSize: "0.8rem", color: "var(--text-tertiary)" }}>—</span>}
                  {st.lines.map((l) => (
                    <span key={l.userCode} title={l.remarks ?? ""} style={{ fontSize: "0.78rem", padding: "2px 8px", borderRadius: 999,
                      background: l.status === "Y" ? "#ECFDF5" : l.status === "N" ? "#FEF2F2" : "#FFFBEB", color: l.status === "Y" ? "#065F46" : l.status === "N" ? "#B91C1C" : "#92400E" }}>
                      {l.status === "Y" ? "✓" : l.status === "N" ? "✕" : "…"} {l.userCode}{l.userName ? ` (${l.userName})` : ""}{l.updatedAt && l.status !== "W" ? ` · ${dmy(l.updatedAt)}${l.updatedAt.slice(10)}` : ""}{l.remarks ? ` · “${l.remarks}”` : ""}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            {detail.can.decide && (
              <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <input style={{ ...styles.input, flex: "1 1 320px" }} placeholder="Remarks (required to reject)" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
                <button type="button" style={btn("success", !!busy)} disabled={!!busy} onClick={() => decide("approved")}>{busy === "approved" ? "Approving…" : "✅ AR Approve"}</button>
                <button type="button" style={btn("danger", !!busy)} disabled={!!busy} onClick={() => decide("rejected")}>{busy === "rejected" ? "Rejecting…" : "✕ Reject"}</button>
              </div>
            )}
            {detail.can.generate && (
              <div style={{ marginTop: 12 }}>
                <button type="button" style={btn("primary", !!busy)} disabled={!!busy} onClick={generate}>{busy === "generate" ? "Adding…" : "Add approved invoice to SAP"}</button>
              </div>
            )}
          </div>
        )}

        {/* Header */}
        <div style={styles.cardPadded}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.85rem" }}>
            <Field title="Customer" width={360}>
              {editable ? (
                <Picker<Customer> value={customer ? `${customer.sap_card_code} — ${customer.card_name ?? ""}` : ""} placeholder="Search code, name or tax code" search={searchCustomers}
                  render={(c) => <><b>{c.sap_card_code}</b> — {c.card_name} <span style={{ color: "var(--text-tertiary)" }}>{c.cus_grp01}</span></>}
                  onPick={(c) => { loadCustomer(c.sap_card_code).catch((e) => setError(e.message)); }} />
              ) : <div style={{ fontWeight: 700 }}>{d?.sap_card_code} — {d?.card_name}</div>}
            </Field>
            <Field title="Posting date" width={150}><input type="date" style={input} disabled={!editable} value={h.docDate} onChange={(e) => setH({ ...h, docDate: e.target.value, taxDate: h.taxDate === h.docDate ? e.target.value : h.taxDate, dueDate: h.dueDate < e.target.value ? e.target.value : h.dueDate })} /></Field>
            <Field title="Due date" width={150}><input type="date" style={input} disabled={!editable} value={h.dueDate} onChange={(e) => setH({ ...h, dueDate: e.target.value })} /></Field>
            <Field title="Document date" width={150}><input type="date" style={input} disabled={!editable} value={h.taxDate} onChange={(e) => setH({ ...h, taxDate: e.target.value })} /></Field>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.85rem", marginTop: "0.85rem" }}>
            <Field title="Bill to" width={200}>
              <select style={input} disabled={!editable} value={h.billToCode} onChange={(e) => {
                const a = addresses.billTo.find((x) => x.name === e.target.value);
                setH({ ...h, billToCode: e.target.value, invAddress: (a?.address ?? h.invAddress).replace(/\s+/g, " ").trim().slice(0, 200) });
              }}>
                {!addresses.billTo.some((a) => a.name === h.billToCode) && <option value={h.billToCode}>{h.billToCode || "—"}</option>}
                {addresses.billTo.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
              </select>
            </Field>
            <Field title="Ship to" width={200}>
              <select style={input} disabled={!editable} value={h.shipToCode} onChange={(e) => setH({ ...h, shipToCode: e.target.value })}>
                {!addresses.shipTo.some((a) => a.name === h.shipToCode) && <option value={h.shipToCode}>{h.shipToCode || "—"}</option>}
                {addresses.shipTo.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
              </select>
            </Field>
            <Field title="Warehouse" width={150}>
              <select style={input} disabled={!editable} value={h.warehouseCode} onChange={(e) => setH({ ...h, warehouseCode: e.target.value })}>
                <option value="">(item default)</option>
                {!addresses.warehouses.some((w) => w.code === h.warehouseCode) && h.warehouseCode && <option value={h.warehouseCode}>{h.warehouseCode}</option>}
                {addresses.warehouses.map((w) => <option key={w.code} value={w.code}>{w.code}{w.name ? ` — ${w.name}` : ""}</option>)}
              </select>
            </Field>
            <Field title="Brand" width={200}>
              <select style={input} disabled={!editable} value={h.brandCode} title="SAP U_ProdBrand — items are limited to this brand"
                onChange={(e) => {
                  const b = e.target.value;
                  const other = lines.filter((l) => l.itemCode && b && l.brandCode && l.brandCode !== b);
                  if (other.length && !confirm(`${other.length} line(s) are another brand (${[...new Set(other.map((l) => l.brandCode))].join(", ")}). Remove them?`)) return;
                  if (other.length) setLines((ls) => { const keep = ls.filter((l) => !other.includes(l)); return keep.length ? keep : [emptyLine()]; });
                  setH({ ...h, brandCode: b });
                }}>
                <option value="">(from the items)</option>
                {!lookups?.brands?.some((x) => x.code === h.brandCode) && h.brandCode && <option value={h.brandCode}>{h.brandCode}</option>}
                {lookups?.brands?.map((x) => <option key={x.code} value={x.code}>{x.code}{x.name ? ` — ${x.name}` : ""}</option>)}
              </select>
            </Field>
            <Field title="Department" width={230}>
              <select style={input} disabled={!editable} value={h.departmentCode} onChange={(e) => setH({ ...h, departmentCode: e.target.value })}>
                <option value="">(none)</option>
                {!lookups?.departments.some((x) => x.code === h.departmentCode) && h.departmentCode && <option value={h.departmentCode}>{h.departmentCode}</option>}
                {lookups?.departments.map((x) => <option key={x.code} value={x.code}>{x.code}{x.name ? ` — ${x.name}` : ""}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.85rem", marginTop: "0.85rem" }}>
            <Field title="Invoice name" width={330}><input style={input} disabled={!editable} maxLength={200} value={h.invName} onChange={(e) => setH({ ...h, invName: e.target.value })} /></Field>
            <Field title="Tax code (MST)" width={160}><input style={input} disabled={!editable} maxLength={20} value={h.invTaxNo} onChange={(e) => setH({ ...h, invTaxNo: e.target.value })} /></Field>
            <Field title="Invoice address" width={520}><input style={input} disabled={!editable} maxLength={200} value={h.invAddress} onChange={(e) => setH({ ...h, invAddress: e.target.value })} /></Field>
          </div>
          <div style={{ marginTop: "0.85rem" }}>
            <Field title="Remarks" width="100%"><input style={input} disabled={!editable} maxLength={254} value={h.comments} placeholder="e.g. CKTM T10.2026 CUỐI THÁNG" onChange={(e) => setH({ ...h, comments: e.target.value })} /></Field>
          </div>
        </div>

        {/* Open rebates of the customer */}
        {editable && customer && rebates && (
          <div style={{ ...styles.card, marginBottom: "1.5rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, padding: "0.75rem 1rem", borderBottom: "1px solid var(--color-gray-200, #E2E8F0)" }}>
              <div>
                <b>Open rebates (CKTM) of {customer.sap_card_code}</b>
                <span style={{ fontSize: "0.75rem", color: "var(--text-tertiary)" }}> · tick and add — each becomes a line: Qty −1, price = rebate amount, item and invoice text suggested from this customer&apos;s last CKTM invoice</span>
              </div>
              <button type="button" style={btn("primary", rebateSel.size === 0)} disabled={rebateSel.size === 0} onClick={addRebates}>+ Add {rebateSel.size || ""} as lines</button>
            </div>
            {rebates.length === 0 ? <div style={{ padding: "0.9rem 1rem", fontSize: "0.8rem", color: "var(--text-tertiary)" }}>No open rebate for this customer in SAP.</div> : (
              <div style={{ maxHeight: 260, overflowY: "auto" }}>
                <table style={styles.table}>
                  <thead><tr>{["", "Rebate", "Program", "Amount", "Valid", "Created by", ""].map((x, i) => <th key={i} style={{ ...th, textAlign: i === 3 ? "right" : "left" }}>{x}</th>)}</tr></thead>
                  <tbody>
                    {rebates.map((r) => {
                      const onLine = lines.some((l) => l.rbtRef === r.docEntry);
                      const blocked = !!r.usedBy || onLine;
                      return (
                        <tr key={r.docEntry} style={{ opacity: blocked ? 0.55 : 1 }}>
                          <td style={{ ...td, width: 30 }}>
                            <input type="checkbox" disabled={blocked} checked={rebateSel.has(r.docEntry)}
                              onChange={(e) => setRebateSel((x) => { const n2 = new Set(x); if (e.target.checked) n2.add(r.docEntry); else n2.delete(r.docEntry); return n2; })} />
                          </td>
                          <td style={{ ...td, whiteSpace: "nowrap", fontWeight: 600 }}>{r.code}</td>
                          <td style={td}>{r.name}</td>
                          <td style={{ ...td, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{money(r.amount)}</td>
                          <td style={{ ...td, whiteSpace: "nowrap", fontSize: "0.75rem" }}>{dmy(r.validFrom)} → {dmy(r.validTo)}</td>
                          <td style={{ ...td, fontSize: "0.75rem" }}>{r.creator}</td>
                          <td style={{ ...td, fontSize: "0.75rem", color: "#B45309" }}>{r.usedBy ? `on ${r.usedBy}` : onLine ? "on this invoice" : ""}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Lines */}
        <div style={{ ...styles.card, marginBottom: "1.5rem" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ ...styles.table, minWidth: 1150 }}>
              <thead>
                <tr>
                  {["#", "Item (service)", "Invoice text (U_INVDesc)", "Qty", "Unit price", "Disc %", "VAT", "Total (excl. VAT)", ""].map((x, i) =>
                    <th key={i} style={{ ...th, textAlign: [3, 4, 5, 7].includes(i) ? "right" : "left" }}>{x}</th>)}
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.key}>
                    <td style={{ ...td, width: 28, color: "var(--text-tertiary)" }}>{i + 1}</td>
                    <td style={{ ...td, width: 300 }}>
                      {editable ? (
                        <Picker<Item> value={l.itemCode ? `${l.itemCode} — ${l.itemName}` : ""} placeholder="Search item code or name" search={searchItems}
                          render={(it) => <><b>{it.itemCode}</b> — {it.itemName} <span style={{ color: "var(--text-tertiary)" }}>{it.brandCode} · {it.vatGroup}</span></>}
                          onPick={(it) => setLine(l.key, { itemCode: it.itemCode, itemName: it.itemName, uom: it.uom, brandCode: it.brandCode, vatGroup: it.vatGroup ?? "", description: l.description || it.itemName })} />
                      ) : <div><b>{l.itemCode}</b> — {l.itemName}</div>}
                      {l.itemCode && <div style={{ fontSize: "0.7rem", color: "var(--text-tertiary)", marginTop: 2 }}>Brand {l.brandCode ?? "—"} · {l.uom ?? ""}</div>}
                      {l.rbtRef && (
                        <div title={l.rbtName ?? ""} style={{ fontSize: "0.7rem", marginTop: 3, display: "inline-flex", gap: 4, alignItems: "center", padding: "1px 7px", borderRadius: 999, background: "#EEF2FF", color: "#3730A3" }}>
                          Rebate {l.rbtCode}{l.rbtAmount !== null ? ` · ${money(l.rbtAmount)}` : ""}
                          {editable && <button type="button" title="Unlink the rebate" onClick={() => setLine(l.key, { rbtRef: null, rbtCode: null, rbtName: null, rbtAmount: null })}
                            style={{ border: 0, background: "none", cursor: "pointer", color: "#3730A3", padding: 0 }}>×</button>}
                        </div>
                      )}
                    </td>
                    <td style={td}>
                      <textarea style={{ ...input, minHeight: 34, resize: "vertical", fontFamily: "inherit" }} rows={1} maxLength={254} disabled={!editable} value={l.description}
                        onChange={(e) => setLine(l.key, { description: e.target.value })} />
                    </td>
                    <td style={{ ...td, width: 80 }}><input style={{ ...input, textAlign: "right" }} disabled={!editable} value={l.quantity} title="Negative for a decrease (e.g. −1 for a commercial discount)" onChange={(e) => setLine(l.key, { quantity: e.target.value })} /></td>
                    <td style={{ ...td, width: 140 }}><input style={{ ...input, textAlign: "right" }} disabled={!editable} value={l.unitPrice} placeholder="0" inputMode="decimal" onChange={(e) => setLine(l.key, { unitPrice: groupDigits(e.target.value) })} /></td>
                    <td style={{ ...td, width: 70 }}><input style={{ ...input, textAlign: "right" }} disabled={!editable} value={l.discountPct} onChange={(e) => setLine(l.key, { discountPct: e.target.value })} /></td>
                    <td style={{ ...td, width: 90 }}>
                      <select style={input} disabled={!editable} value={l.vatGroup} onChange={(e) => setLine(l.key, { vatGroup: e.target.value })}>
                        {!lookups?.vatGroups.some((v) => v.code === l.vatGroup) && <option value={l.vatGroup}>{l.vatGroup || "—"}</option>}
                        {lookups?.vatGroups.map((v) => <option key={v.code} value={v.code}>{v.code}</option>)}
                      </select>
                    </td>
                    <td style={{ ...td, width: 130, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums", paddingTop: "0.6rem" }}>{l.itemCode ? money(lineTotal(l)) : ""}</td>
                    <td style={{ ...td, width: 34 }}>
                      {editable && <button type="button" title="Remove line" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [emptyLine()]))}
                        style={{ border: 0, background: "none", cursor: "pointer", color: "#DC2626", fontSize: "1rem" }}>✕</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12, padding: "0.75rem 1rem", borderTop: "1px solid var(--color-gray-200, #E2E8F0)" }}>
            <div>{editable && <button type="button" style={btn("secondary")} onClick={() => setLines((ls) => [...ls, emptyLine()])}>+ Add line</button>}</div>
            <div style={{ display: "grid", gridTemplateColumns: "auto auto", gap: "0.2rem 1.5rem", fontSize: "0.85rem", fontVariantNumeric: "tabular-nums" }}>
              <span>Total before VAT</span><b style={{ textAlign: "right" }}>{money(totals.before)}</b>
              <span>VAT</span><b style={{ textAlign: "right" }}>{money(totals.vat)}</b>
              <span style={{ fontWeight: 800 }}>Total</span><b style={{ textAlign: "right", fontSize: "1rem" }}>{money(totals.total)} ₫</b>
            </div>
          </div>
        </div>

        {/* Approval preview + actions */}
        {editable && (
          <div style={{ ...styles.cardPadded, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <div style={{ fontSize: "0.8125rem" }}>
              {!preview ? <span style={{ color: "var(--text-tertiary)" }}>Pick a customer and items to see whether SAP will ask for approval.</span>
                : applies.length ? <>🔒 Needs approval — Post to SAP saves it as a Draft (Adm Confirmed) for: {applies.map((p) => <b key={p.name}>{p.name} → {p.approvers.join(", ")}</b>).reduce<ReactNode[]>((a, x, i) => (i ? [...a, "; ", x] : [x]), [])}</>
                : unknown.length ? <>⚠ Couldn’t check {unknown.map((p) => p.name).join(", ")} ({unknown[0].note}) — it will go for approval to be safe.</>
                : <>✓ No approval template applies for {lookups?.sapUser ?? "you"} — SAP adds the invoice straight away.</>}
              <div style={{ fontSize: "0.72rem", color: "var(--text-tertiary)", marginTop: 3 }}>Posted as your SAP user {lookups?.sapUser ?? "(set it in My Profile)"} · totals are an estimate, SAP calculates the final VAT.</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {!isNew && detail?.can.delete && <button type="button" style={btn("danger", !!busy)} disabled={!!busy} onClick={remove}>Delete</button>}
              {detail?.can.updateSap ? (
                // Adm Confirmed, not approved yet: update the SAP draft; the approval starts over.
                <button type="button" style={btn("primary", !!busy || !customer || !itemCodes)} disabled={!!busy || !customer || !itemCodes}
                  onClick={() => { if (confirm("Save the changes and update the SAP draft?\n\nThe AR. No stays the same; the approval starts over and the approvers are notified again.")) save(false); }}>
                  {busy === "save" ? "Updating…" : "Save & Update SAP draft"}
                </button>
              ) : (
                <>
                  <button type="button" style={btn("secondary", !!busy || !customer)} disabled={!!busy || !customer} onClick={() => save(false)}>{busy === "save" ? "Saving…" : "Save draft"}</button>
                  <button type="button" style={btn("primary", !!busy || !customer || !itemCodes)} disabled={!!busy || !customer || !itemCodes} onClick={() => save(true)}>{busy === "post" ? "Posting…" : "Save & Post to SAP"}</button>
                </>
              )}
            </div>
          </div>
        )}

        {/* History */}
        {detail && detail.events.length > 0 && (
          <div style={styles.cardPadded}>
            <div style={{ ...label, marginBottom: 8 }}>History</div>
            {detail.events.map((e, i) => (
              <div key={i} style={{ fontSize: "0.8rem", padding: "0.25rem 0", borderTop: i ? "1px solid var(--color-gray-100, #F1F5F9)" : undefined }}>
                <span style={{ color: "var(--text-tertiary)" }}>{new Date(e.created_at).toLocaleString()}</span> · <b>{e.action.replace(/_/g, " ")}</b>
                {e.admin_label ? ` · ${e.admin_label}` : ""}{e.sap_user_code ? ` (SAP ${e.sap_user_code})` : ""}{e.notes ? ` — ${e.notes}` : ""}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function sessionStorageSet(k: string, v: string) { try { window.sessionStorage.setItem(k, v); } catch { /* not remembered */ } }
function sessionStorageTake(k: string): string | null {
  try { const v = window.sessionStorage.getItem(k); window.sessionStorage.removeItem(k); return v; } catch { return null; }
}
