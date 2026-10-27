"use client";

import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, type CSSProperties, type KeyboardEvent } from "react";
import { styles, btn, Badge } from "../adminUi";
import type { ProductWithPricing } from "@/types/product";

/**
 * "Self create" sales order dialog (Admin → Orders): an admin creates an
 * order on behalf of a SAP customer or distributor. Prices shown here are
 * the customer's own storefront prices and are only a preview — the server
 * recomputes every line on Create (POST /api/admin/orders/create). The new
 * order(s) then follow the normal review flow ("Confirm & Push to SAP").
 */

interface CustomerRow {
  sap_card_code: string;
  card_name: string | null;
  mst_code: string | null;
  price_list_num: number | null;
  cus_grp01: string | null;
  cus_grp02: string | null;
  cus_grp03: string | null;
  phone: string | null;
  email: string | null;
  is_enabled: number;
  bill_to_default: string | null;
  ship_to_default: string | null;
  supervisor_code: string | null;
}

interface CustomerDetail {
  customer: CustomerRow;
  billTo: { name: string; address: string | null }[];
  shipTo: { name: string; address: string | null }[];
  warehouses: { code: string; name: string | null }[];
  supervisors: { code: string; name: string | null }[];
  login: { id: number; email: string | null } | null;
}

interface Line {
  product: ProductWithPricing;
  qty: number;
  promotionCode: string | null;
  giveawayKey: string | null;
  /** Set when re-pricing (customer/warehouse change) no longer finds the item. */
  unavailable?: boolean;
}

interface CreatedOrder { orderId: number; orderNumber: string; grandTotal: number; brandCode: string | null }

/** An existing order to copy into the dialog ("Duplicate" on the admin order page). */
export interface DuplicateSource {
  orderNumber: string;
  customerCode: string;
  billTo: string | null;
  shipTo: string | null;
  warehouse: string | null;
  supervisor: string | null;
  remark: string | null;
  /** Buy lines only — gift lines are rebuilt from giveawayKey. */
  lines: { sapItemCode: string; quantity: number; promotionCode: string | null; giveawayKey: string | null }[];
}

const giveawayKeyOf = (o: { code: string | null; giveItemCode: string }) => `${o.code ?? ""}::${o.giveItemCode}`;
const money = (v: number) => new Intl.NumberFormat("vi-VN").format(Math.round(v)) + "₫";
const num = (v: number | null | undefined) => (v == null ? "—" : new Intl.NumberFormat("vi-VN").format(v));
const pct = (v: number) => (v ? `${Number(v.toFixed(2))}%` : "—");
const itemName = (p: ProductWithPricing) => p.itemNameVi || p.itemNameEn || p.sapItemCode;

/** Same formula as the server (buildOrderLines) and the storefront — preview only. */
function priceLine(line: Line) {
  const p = line.product;
  const promo = p.promotionOptions.find((o) => o.code === line.promotionCode) ?? p.promotionOptions[0];
  const promoPct = promo ? Number(promo.pct) : 0;
  const unit = Math.max(0, p.basePrice * (1 - (p.contractDiscPct + promoPct) / 100));
  const giveaway = p.giveawayOptions.find((o) => giveawayKeyOf(o) === line.giveawayKey) ?? p.giveawayOptions[0];
  const freeQty = giveaway && giveaway.buyQty && giveaway.giveQty ? Math.floor(line.qty / giveaway.buyQty) * giveaway.giveQty : 0;
  return { promoPct, unit, total: unit * line.qty, base: p.basePrice * line.qty, giveaway, freeQty };
}

const label: CSSProperties = { fontSize: "0.6875rem", fontWeight: 700, color: "var(--text-secondary, #64748B)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "0.25rem", display: "block" };
const field: CSSProperties = { ...styles.input, width: "100%", boxSizing: "border-box" };
const hint: CSSProperties = { fontSize: "0.75rem", color: "var(--text-tertiary, #94A3B8)", marginTop: "0.25rem", lineHeight: 1.35 };
// Headers may wrap ("STD / DISC %") so they stay inside the fixed column widths.
const th: CSSProperties = { ...styles.th, padding: "0.5rem 0.625rem", position: "sticky", top: 0, background: "var(--bg-primary, #fff)", zIndex: 1, whiteSpace: "normal", lineHeight: 1.25, verticalAlign: "bottom" };
const td: CSSProperties = { ...styles.td, padding: "0.5rem 0.625rem", verticalAlign: "top" };
const num_: CSSProperties = { ...td, textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };
const dropdown: CSSProperties = {
  position: "absolute", top: "100%", left: 0, right: 0, zIndex: 20, marginTop: 4, maxHeight: 320, overflowY: "auto",
  background: "var(--bg-primary, #fff)", border: "1px solid var(--color-gray-200, #E2E8F0)",
  borderRadius: "var(--radius-lg, 8px)", boxShadow: "0 12px 32px rgba(15,23,42,0.18)",
};

/**
 * An item name kept to 2 lines with "…" so every row has the same height.
 * The full name shows on hover (title) and a click expands it in place —
 * only offered when the name really is cut off.
 */
function ClampedName({ text, expanded, onToggle, style }: { text: string; expanded: boolean; onToggle: () => void; style?: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const [clipped, setClipped] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setClipped(!expanded && el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, expanded]);
  const clickable = clipped || expanded;
  return (
    <div
      ref={ref}
      title={text}
      onClick={clickable ? onToggle : undefined}
      style={{
        ...style,
        lineHeight: 1.35,
        cursor: clickable ? "pointer" : undefined,
        overflowWrap: "anywhere",
        ...(expanded ? {} : { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }),
      }}
    >
      {text}
    </div>
  );
}

interface ChipOption { key: string; short: string; full: string }

/**
 * A compact program chip (🏷 promotion / 🎁 gift) showing only the program
 * code and its value; with several programs it opens a list that shows each
 * one's full name. The list is position: fixed so the table's scroll area
 * can't clip it.
 */
function ProgramChip({ icon, options, value, onChange }: { icon: string; options: ChipOption[]; value: string | null; onChange: (key: string) => void }) {
  const [menu, setMenu] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const current = options.find((o) => o.key === value) ?? options[0];
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (e.type === "mousedown" && (e.target as HTMLElement).closest?.("[data-program-menu]")) return;
      setMenu(null);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu]);
  if (!current) return null;

  const chip: CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 4, maxWidth: "100%", padding: "1px 8px",
    borderRadius: 999, fontSize: "0.75rem", lineHeight: 1.6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
    background: "var(--bg-secondary, #F1F5F9)", border: "1px solid var(--color-gray-200, #E2E8F0)", color: "var(--text-secondary, #475569)",
  };
  if (options.length === 1) return <span style={chip} title={current.full}>{icon} {current.short}</span>;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        title={`${current.full} — ${options.length} programs, click to change`}
        onClick={() => {
          if (menu) { setMenu(null); return; }
          const r = btnRef.current!.getBoundingClientRect();
          setMenu({ top: r.bottom + 4, left: Math.min(r.left, window.innerWidth - 500) });
        }}
        style={{ ...chip, cursor: "pointer", borderColor: "var(--color-primary, #2BBCB3)", color: "var(--text-primary, #0F172A)" }}
      >
        {icon} {current.short} <span aria-hidden>▾</span>
      </button>
      {menu && (
        <div data-program-menu role="listbox" style={{
          position: "fixed", top: menu.top, left: Math.max(8, menu.left), width: 480, maxWidth: "calc(100vw - 16px)", maxHeight: 320, overflowY: "auto", zIndex: 400,
          background: "var(--bg-primary, #fff)", border: "1px solid var(--color-gray-200, #E2E8F0)", borderRadius: "var(--radius-lg, 8px)",
          boxShadow: "0 12px 32px rgba(15,23,42,0.18)",
        }}>
          {options.map((o) => (
            <div
              key={o.key}
              role="option"
              aria-selected={o.key === current.key}
              onMouseDown={(e) => { e.preventDefault(); onChange(o.key); setMenu(null); }}
              style={{
                padding: "0.5rem 0.75rem", cursor: "pointer", fontSize: "0.8125rem", borderBottom: "1px solid var(--color-gray-100, #F1F5F9)",
                background: o.key === current.key ? "rgba(43,188,179,0.10)" : undefined,
              }}
            >
              <div style={{ fontWeight: 700 }}>{o.key === current.key ? "✓ " : ""}{icon} {o.short}</div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-secondary, #64748B)", lineHeight: 1.35 }}>{o.full}</div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export default function SelfCreateOrderDialog({ locale, onClose, onCreated, initial }: {
  locale: string;
  onClose: () => void;
  onCreated: () => void;
  /** Pre-fill from an existing order (Duplicate); everything stays editable. */
  initial?: DuplicateSource;
}) {
  // ── Header ──
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerResults, setCustomerResults] = useState<CustomerRow[]>([]);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customerActive, setCustomerActive] = useState(0);
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [billTo, setBillTo] = useState("");
  const [shipTo, setShipTo] = useState("");
  const [warehouse, setWarehouse] = useState("");
  const [supervisor, setSupervisor] = useState("");

  // ── Lines ──
  const [lines, setLines] = useState<Line[]>([]);
  const [itemQuery, setItemQuery] = useState("");
  const [itemResults, setItemResults] = useState<ProductWithPricing[]>([]);
  const [itemOpen, setItemOpen] = useState(false);
  const [itemActive, setItemActive] = useState(0);
  const [itemLoading, setItemLoading] = useState(false);
  const [repricing, setRepricing] = useState(false);

  // ── Footer ──
  const [remark, setRemark] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ text: string; problems?: string[] } | null>(null);
  const [created, setCreated] = useState<CreatedOrder[] | null>(null);
  /** What a Duplicate couldn't carry over as it was (shown in the footer). */
  const [notice, setNotice] = useState<string[]>([]);
  /** Rows whose long item name is expanded (clicked) — keyed "code" / "code-gift". */
  const [expandedNames, setExpandedNames] = useState<Set<string>>(new Set());
  const toggleName = (key: string) =>
    setExpandedNames((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });

  const customerInputRef = useRef<HTMLInputElement>(null);
  const itemInputRef = useRef<HTMLInputElement>(null);
  const qtyRefs = useRef(new Map<string, HTMLInputElement>());
  const focusQtyOf = useRef<string | null>(null);

  const dirty = !!detail || lines.length > 0 || remark.trim() !== "";
  const requestClose = useCallback(() => {
    if (saving) return;
    if (!created && dirty && !confirm("Discard this sales order?")) return;
    onClose();
  }, [saving, created, dirty, onClose]);

  useEffect(() => { if (!initial) customerInputRef.current?.focus(); }, [initial]);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") requestClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose]);

  // Customer search (debounced)
  useEffect(() => {
    if (!customerOpen) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/orders/create/customers?search=${encodeURIComponent(customerQuery)}`, { signal: ctl.signal });
        const data = await res.json();
        setCustomerResults(data.customers || []);
        setCustomerActive(0);
      } catch { /* aborted */ }
    }, 250);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [customerQuery, customerOpen]);

  const reprice = useCallback(async (cardCode: string, wh: string, current: Line[]) => {
    if (current.length === 0) return current;
    setRepricing(true);
    try {
      const res = await fetch("/api/admin/orders/create/pricing", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer: cardCode, warehouse: wh, codes: current.map((l) => l.product.sapItemCode) }),
      });
      const data = await res.json();
      const byCode = new Map<string, ProductWithPricing>((data.items || []).map((p: ProductWithPricing) => [p.sapItemCode, p]));
      return current.map((l) => {
        const p = byCode.get(l.product.sapItemCode);
        if (!p) return { ...l, unavailable: true };
        return {
          ...l, product: p, unavailable: false,
          promotionCode: p.promotionOptions.some((o) => o.code === l.promotionCode) ? l.promotionCode : p.promotionOptions[0]?.code ?? null,
          giveawayKey: p.giveawayOptions.some((o) => giveawayKeyOf(o) === l.giveawayKey) ? l.giveawayKey : (p.giveawayOptions[0] ? giveawayKeyOf(p.giveawayOptions[0]) : null),
        };
      });
    } finally {
      setRepricing(false);
    }
  }, []);

  /**
   * Loads a customer's addresses, warehouses and supervisors and applies
   * them. `prefer` (from a duplicated order) wins where it's still valid;
   * otherwise the customer's SAP defaults are used. Returns the chosen
   * warehouse, or null if the customer can't be used.
   */
  const loadCustomer = async (cardCode: string, prefer?: Partial<Pick<DuplicateSource, "billTo" | "shipTo" | "warehouse" | "supervisor">>) => {
    setError(null);
    const res = await fetch(`/api/admin/orders/create/customers/${encodeURIComponent(cardCode)}`);
    const d: CustomerDetail = await res.json();
    if (!res.ok) {
      setError({ text: res.status === 404
        ? `Customer ${cardCode} is not in your customer groups or no longer synced from SAP — pick a customer.`
        : (d as unknown as { error: string }).error || "Failed to load customer" });
      return null;
    }
    const c = d.customer;
    if (!c.is_enabled) {
      setError({ text: `${c.sap_card_code} is blocked (SAP Customers → Enable) — pick another customer.` });
      return null;
    }
    setDetail(d);
    setCustomerQuery(`${c.sap_card_code} · ${c.card_name ?? ""}`);
    const choose = (list: { name: string }[], wanted: string | null | undefined, def: string | null) =>
      (list.find((a) => a.name === wanted) ?? list.find((a) => a.name === def) ?? list[0])?.name ?? "";
    setBillTo(choose(d.billTo, prefer?.billTo, c.bill_to_default));
    setShipTo(choose(d.shipTo, prefer?.shipTo, c.ship_to_default));
    const wh = (d.warehouses.find((w) => w.code === prefer?.warehouse) ?? d.warehouses[0])?.code ?? "";
    setWarehouse(wh);
    const sup = [prefer?.supervisor, c.supervisor_code].find((code) => code && d.supervisors.some((x) => x.code === code));
    setSupervisor(sup ?? "");
    return wh;
  };

  const pickCustomer = async (c: CustomerRow) => {
    if (!c.is_enabled) return;
    setCustomerOpen(false);
    setCustomerQuery(`${c.sap_card_code} · ${c.card_name ?? ""}`);
    const wh = await loadCustomer(c.sap_card_code);
    if (wh) setLines(await reprice(c.sap_card_code, wh, lines));
    setTimeout(() => itemInputRef.current?.focus(), 0);
  };

  // Duplicate: load the source order's customer and header, then its items at today's prices.
  const initialApplied = useRef(false);
  useEffect(() => {
    if (!initial || initialApplied.current) return;
    initialApplied.current = true;
    (async () => {
      setCustomerQuery(initial.customerCode);
      setRemark(initial.remark ?? "");
      const wh = await loadCustomer(initial.customerCode, initial);
      if (!wh) return;
      const notes: string[] = [];
      if (initial.warehouse && initial.warehouse !== wh) {
        notes.push(`Warehouse ${initial.warehouse} isn't available to this customer any more — using ${wh}.`);
      }

      // One row per item (the storefront allows the same item twice with different gifts).
      const merged = new Map<string, DuplicateSource["lines"][number]>();
      for (const l of initial.lines) {
        const prev = merged.get(l.sapItemCode);
        if (prev) {
          prev.quantity += l.quantity;
          notes.push(`${l.sapItemCode} was on the order twice — merged into one line.`);
        } else {
          merged.set(l.sapItemCode, { ...l });
        }
      }
      setRepricing(true);
      try {
        const res = await fetch("/api/admin/orders/create/pricing", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customer: initial.customerCode, warehouse: wh, codes: [...merged.keys()] }),
        });
        const data = await res.json();
        const byCode = new Map<string, ProductWithPricing>((data.items || []).map((p: ProductWithPricing) => [p.sapItemCode, p]));
        const copied: Line[] = [];
        const missing: string[] = [];
        for (const l of merged.values()) {
          const p = byCode.get(l.sapItemCode);
          if (!p) { missing.push(l.sapItemCode); continue; }
          const promoKept = p.promotionOptions.some((o) => o.code === l.promotionCode);
          const giftKept = p.giveawayOptions.some((o) => giveawayKeyOf(o) === l.giveawayKey);
          if (l.promotionCode && !promoKept) {
            notes.push(`${p.sapItemCode}: promotion ${l.promotionCode} has ended — using ${p.promotionOptions[0]?.code ?? "no promotion"}.`);
          }
          if (l.giveawayKey && !giftKept) {
            notes.push(`${p.sapItemCode}: the gift program has ended — ${p.giveawayOptions.length ? "using the current one" : "no gift now"}.`);
          }
          copied.push({
            product: p, qty: l.quantity,
            promotionCode: promoKept ? l.promotionCode : p.promotionOptions[0]?.code ?? null,
            giveawayKey: giftKept ? l.giveawayKey : (p.giveawayOptions[0] ? giveawayKeyOf(p.giveawayOptions[0]) : null),
          });
        }
        if (missing.length) notes.push(`Not copied — not available for this customer in ${wh} now: ${missing.join(", ")}.`);
        setLines(copied);
      } finally {
        setRepricing(false);
      }
      setNotice(notes);
      setTimeout(() => itemInputRef.current?.focus(), 0);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once for the given source order
  }, [initial]);

  const changeWarehouse = async (wh: string) => {
    setWarehouse(wh);
    if (detail) setLines(await reprice(detail.customer.sap_card_code, wh, lines));
  };

  // Item search (debounced)
  useEffect(() => {
    if (!detail || !warehouse || !itemOpen) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setItemLoading(true);
      try {
        const res = await fetch("/api/admin/orders/create/pricing", {
          method: "POST", headers: { "Content-Type": "application/json" }, signal: ctl.signal,
          body: JSON.stringify({ customer: detail.customer.sap_card_code, warehouse, search: itemQuery }),
        });
        const data = await res.json();
        setItemResults(data.items || []);
        setItemActive(0);
      } catch { /* aborted */ } finally { setItemLoading(false); }
    }, 250);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [itemQuery, itemOpen, detail, warehouse]);

  const addItem = (p: ProductWithPricing) => {
    setItemOpen(false);
    setItemQuery("");
    const existing = lines.find((l) => l.product.sapItemCode === p.sapItemCode);
    if (existing) {
      setLines(lines.map((l) => (l === existing ? { ...l, qty: l.qty + 1 } : l)));
    } else {
      setLines([...lines, {
        product: p, qty: 1,
        promotionCode: p.promotionOptions[0]?.code ?? null,
        giveawayKey: p.giveawayOptions[0] ? giveawayKeyOf(p.giveawayOptions[0]) : null,
      }]);
    }
    focusQtyOf.current = p.sapItemCode;
  };
  useEffect(() => {
    if (!focusQtyOf.current) return;
    const el = qtyRefs.current.get(focusQtyOf.current);
    focusQtyOf.current = null;
    el?.focus(); el?.select();
  }, [lines]);

  const updateLine = (code: string, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l) => (l.product.sapItemCode === code ? { ...l, ...patch } : l)));
  const removeLine = (code: string) => setLines((prev) => prev.filter((l) => l.product.sapItemCode !== code));

  const listKeys = <T,>(e: KeyboardEvent, items: T[], active: number, setActive: (n: number) => void, choose: (t: T) => void) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(Math.min(items.length - 1, active + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(Math.max(0, active - 1)); }
    else if (e.key === "Enter" && items[active]) { e.preventDefault(); choose(items[active]); }
  };

  // ── Totals & checks ──
  const priced = useMemo(() => lines.map((l) => ({ line: l, ...priceLine(l) })), [lines]);
  const subtotal = priced.reduce((s, x) => s + x.base, 0);
  const total = priced.reduce((s, x) => s + x.total, 0);
  const brands = [...new Set(lines.map((l) => l.product.brandName || l.product.brandCode || "No brand"))];
  const overStock = priced.filter((x) => x.line.product.availableQty != null && x.line.qty > (x.line.product.availableQty ?? 0));
  const unavailable = lines.filter((l) => l.unavailable);
  const canCreate = !!detail && !!warehouse && lines.length > 0 && unavailable.length === 0 && lines.every((l) => l.qty > 0) && !saving && !repricing;

  const create = async () => {
    if (!detail || !canCreate) return;
    if (overStock.length > 0 && !confirm(
      `${overStock.length} line(s) order more than the available quantity in ${warehouse}:\n` +
      overStock.map((x) => `• ${x.line.product.sapItemCode}: ${x.line.qty} > ${x.line.product.availableQty}`).join("\n") +
      "\n\nCreate the order anyway?"
    )) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/orders/create", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer: detail.customer.sap_card_code, warehouse, billTo: billTo || null, shipTo: shipTo || null,
          supervisor: supervisor || null, remark,
          lines: lines.map((l) => ({ sapItemCode: l.product.sapItemCode, quantity: l.qty, promotionCode: l.promotionCode, giveawayKey: l.giveawayKey })),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError({ text: data.error || "Failed to create the order", problems: data.problems }); return; }
      setCreated(data.orders);
      onCreated();
    } catch {
      setError({ text: "Network error — the order was not created" });
    } finally {
      setSaving(false);
    }
  };

  const c = detail?.customer;
  const addressOf = (list: { name: string; address: string | null }[], name: string) => list.find((a) => a.name === name)?.address;

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: "2vh 1rem" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) requestClose(); }}
    >
      <div role="dialog" aria-modal="true" aria-label="Create sales order" style={{
        width: "min(1280px, 100%)", height: "96vh", display: "flex", flexDirection: "column",
        background: "var(--bg-primary, #fff)", borderRadius: "var(--radius-xl, 12px)", overflow: "hidden",
        boxShadow: "0 24px 64px rgba(15,23,42,0.35)",
      }}>
        {/* ── Title bar ── */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.875rem 1.25rem", borderBottom: "1px solid var(--color-gray-200, #E2E8F0)" }}>
          <div>
            <h2 style={{ fontSize: "1.125rem", fontWeight: 800, color: "var(--text-primary, #0F172A)" }}>
              Create sales order
              {initial && (
                <span style={{ fontWeight: 500, fontSize: "0.875rem", color: "var(--text-secondary, #64748B)", marginLeft: "0.5rem" }}>
                  — copy of {initial.orderNumber}
                </span>
              )}
            </h2>
            <p style={{ ...hint, marginTop: 2 }}>Prices follow the customer&apos;s own price list, contract and promotions. The order is reviewed and pushed to SAP from its order page.</p>
          </div>
          <button onClick={requestClose} aria-label="Close" style={{ ...btn("secondary"), padding: "0.375rem 0.625rem" }}>✕</button>
        </div>

        {created ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1rem", padding: "2rem" }}>
            <div style={{ fontSize: "2.5rem" }}>✅</div>
            <h3 style={{ fontSize: "1.125rem", fontWeight: 800 }}>{created.length > 1 ? `${created.length} orders created (one per brand)` : "Order created"}</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", minWidth: 360 }}>
              {created.map((o) => (
                <a key={o.orderId} href={`/${locale}/admin/orders/${o.orderId}`} style={{ ...styles.cardPadded, marginBottom: 0, padding: "0.75rem 1rem", display: "flex", justifyContent: "space-between", textDecoration: "none", color: "inherit" }}>
                  <span style={{ fontFamily: "monospace", fontWeight: 700 }}>{o.orderNumber}</span>
                  <span>{money(o.grandTotal)} →</span>
                </a>
              ))}
            </div>
            <p style={hint}>Status: Submitted — open an order to check stock and use &quot;Confirm &amp; Push to SAP&quot;.</p>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button style={btn("secondary")} onClick={onClose}>Close</button>
              <button style={btn("primary")} onClick={() => { setCreated(null); setLines([]); setRemark(""); setTimeout(() => itemInputRef.current?.focus(), 0); }}>
                New order for the same customer
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* ── Header ── */}
            <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid var(--color-gray-200, #E2E8F0)", background: "var(--bg-secondary, #F8FAFC)" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "0.875rem 1rem" }}>
                {/* Customer */}
                <div style={{ position: "relative", gridColumn: "span 2", minWidth: 0 }}>
                  <span style={label}>Customer *</span>
                  <input
                    ref={customerInputRef}
                    style={field}
                    placeholder="🔍 Customer code, name or tax code"
                    value={customerQuery}
                    onChange={(e) => { setCustomerQuery(e.target.value); setCustomerOpen(true); }}
                    onFocus={(e) => { e.target.select(); setCustomerOpen(true); }}
                    onBlur={() => setTimeout(() => setCustomerOpen(false), 150)}
                    onKeyDown={(e) => listKeys(e, customerResults, customerActive, setCustomerActive, pickCustomer)}
                  />
                  {customerOpen && customerResults.length > 0 && (
                    <div style={dropdown}>
                      {customerResults.map((r, i) => (
                        <div
                          key={r.sap_card_code}
                          onMouseDown={(e) => { e.preventDefault(); pickCustomer(r); }}
                          onMouseEnter={() => setCustomerActive(i)}
                          style={{
                            padding: "0.5rem 0.75rem", cursor: r.is_enabled ? "pointer" : "not-allowed", opacity: r.is_enabled ? 1 : 0.55,
                            background: i === customerActive ? "rgba(43,188,179,0.10)" : undefined,
                            borderBottom: "1px solid var(--color-gray-100, #F1F5F9)",
                          }}
                        >
                          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                            <span style={{ fontFamily: "monospace", fontWeight: 700 }}>{r.sap_card_code}</span>
                            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.card_name}</span>
                            {!r.is_enabled && <Badge label="Blocked" tone="error" />}
                          </div>
                          <div style={{ ...hint, marginTop: 0 }}>
                            MST {r.mst_code || "—"} · Price list {r.price_list_num ?? "base"} · {[r.cus_grp01, r.cus_grp02, r.cus_grp03].filter(Boolean).join(" / ")}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {c && (
                    <div style={hint}>
                      Price list {c.price_list_num ?? "base"} · {[c.cus_grp01, c.cus_grp02, c.cus_grp03].filter(Boolean).join(" / ")}
                      {c.phone ? ` · ☎ ${c.phone}` : ""}
                      {detail?.login
                        ? <> · <span style={{ color: "#059669" }}>visible in the customer&apos;s portal ({detail.login.email})</span></>
                        : <> · <span style={{ color: "#B45309" }}>no portal login — only admins will see this order</span></>}
                    </div>
                  )}
                </div>

                {/* Warehouse */}
                <div>
                  <span style={label}>Warehouse *</span>
                  <select style={field} value={warehouse} disabled={!detail} onChange={(e) => changeWarehouse(e.target.value)}>
                    {!detail && <option value="">Select a customer first</option>}
                    {detail?.warehouses.map((w) => <option key={w.code} value={w.code}>{w.code}{w.name ? ` – ${w.name}` : ""}</option>)}
                  </select>
                  <div style={hint}>Avail Qty is this warehouse&apos;s stock (last inventory sync).</div>
                </div>

                {/* Supervisor */}
                <div>
                  <span style={label}>Sales supervisor</span>
                  <select style={field} value={supervisor} disabled={!detail} onChange={(e) => setSupervisor(e.target.value)}>
                    <option value="">— None —</option>
                    {detail?.supervisors.map((s) => <option key={s.code} value={s.code}>{s.name || s.code}</option>)}
                  </select>
                  {c && c.supervisor_code && supervisor === c.supervisor_code && <div style={hint}>Customer&apos;s default in SAP</div>}
                </div>

                {/* Bill to */}
                <div style={{ gridColumn: "span 2", minWidth: 0 }}>
                  <span style={label}>Bill to</span>
                  <select style={field} value={billTo} disabled={!detail || detail.billTo.length === 0} onChange={(e) => setBillTo(e.target.value)}>
                    {detail && detail.billTo.length === 0 && <option value="">No bill-to address in SAP</option>}
                    {!detail && <option value="">—</option>}
                    {detail?.billTo.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
                  </select>
                  {detail && billTo && <div style={hint}>{addressOf(detail.billTo, billTo) || "—"}</div>}
                </div>

                {/* Ship to */}
                <div style={{ gridColumn: "span 2", minWidth: 0 }}>
                  <span style={label}>Ship to</span>
                  <select style={field} value={shipTo} disabled={!detail || detail.shipTo.length === 0} onChange={(e) => setShipTo(e.target.value)}>
                    {detail && detail.shipTo.length === 0 && <option value="">No ship-to address in SAP</option>}
                    {!detail && <option value="">—</option>}
                    {detail?.shipTo.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
                  </select>
                  {detail && shipTo && <div style={hint}>{addressOf(detail.shipTo, shipTo) || "—"}</div>}
                </div>
              </div>
            </div>

            {/* ── Add item ── */}
            <div style={{ padding: "0.75rem 1.25rem", borderBottom: "1px solid var(--color-gray-200, #E2E8F0)", display: "flex", gap: "0.75rem", alignItems: "center" }}>
              <div style={{ position: "relative", flex: 1, maxWidth: 640 }}>
                <input
                  ref={itemInputRef}
                  style={field}
                  disabled={!detail || !warehouse}
                  placeholder={detail ? "➕ Add item: type a code or name, then Enter" : "Select a customer to add items"}
                  value={itemQuery}
                  onChange={(e) => { setItemQuery(e.target.value); setItemOpen(true); }}
                  onFocus={() => setItemOpen(true)}
                  onBlur={() => setTimeout(() => setItemOpen(false), 150)}
                  onKeyDown={(e) => listKeys(e, itemResults, itemActive, setItemActive, addItem)}
                />
                {itemOpen && detail && (itemResults.length > 0 || itemLoading) && (
                  <div style={dropdown}>
                    {itemLoading && itemResults.length === 0 && <div style={{ padding: "0.75rem", ...hint }}>Searching…</div>}
                    {itemResults.map((p, i) => {
                      const inOrder = lines.some((l) => l.product.sapItemCode === p.sapItemCode);
                      return (
                        <div
                          key={p.sapItemCode}
                          onMouseDown={(e) => { e.preventDefault(); addItem(p); }}
                          onMouseEnter={() => setItemActive(i)}
                          style={{ padding: "0.5rem 0.75rem", cursor: "pointer", display: "grid", gridTemplateColumns: "110px 1fr auto", gap: "0.75rem", alignItems: "center",
                            background: i === itemActive ? "rgba(43,188,179,0.10)" : undefined, borderBottom: "1px solid var(--color-gray-100, #F1F5F9)" }}
                        >
                          <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: "0.75rem" }}>{p.sapItemCode}</span>
                          <span style={{ minWidth: 0 }}>
                            <span title={itemName(p)} style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{itemName(p)}</span>
                            <span style={{ ...hint, marginTop: 0 }}>
                              Avail {num(p.availableQty)} {p.uom}
                              {p.promotionOptions.length > 0 && p.promoDiscPct > 0 ? ` · 🏷 ${p.promoDiscPct}%` : ""}
                              {p.giveawayOptions.length > 0 ? ` · 🎁 ${p.giveawayOptions.length} gift program${p.giveawayOptions.length > 1 ? "s" : ""}` : ""}
                              {inOrder ? " · already on the order (+1)" : ""}
                            </span>
                          </span>
                          <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                            <strong>{money(p.displayPrice)}</strong>
                            {p.displayPrice < p.basePrice && <span style={{ display: "block", ...hint, marginTop: 0, textDecoration: "line-through" }}>{money(p.basePrice)}</span>}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <span style={hint}>
                {repricing ? "Updating prices…" : lines.length > 0 ? `${lines.length} item${lines.length > 1 ? "s" : ""}` : ""}
              </span>
            </div>

            {/* ── Lines ── */}
            <div style={{ flex: 1, overflow: "auto" }}>
              {lines.length === 0 ? (
                <div style={{ ...styles.empty, padding: "4rem 1rem" }}>
                  <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>🧾</div>
                  <p style={{ fontWeight: 600 }}>{detail ? "No items yet" : "Start by choosing the customer"}</p>
                  <p style={hint}>{detail ? "Search above — Enter adds the highlighted item and moves to its quantity." : "Their addresses, warehouse and supervisor fill in automatically."}</p>
                </div>
              ) : (
                <table style={{ ...styles.table, tableLayout: "fixed", minWidth: 1040 }}>
                  {/* Fixed widths for everything but the name, which takes the rest —
                      a long name can never push the numbers out of view. */}
                  <colgroup>
                    <col style={{ width: 112 }} />
                    <col />
                    <col style={{ width: 84 }} />
                    <col style={{ width: 100 }} />
                    <col style={{ width: 60 }} />
                    <col style={{ width: 104 }} />
                    <col style={{ width: 66 }} />
                    <col style={{ width: 66 }} />
                    <col style={{ width: 66 }} />
                    <col style={{ width: 104 }} />
                    <col style={{ width: 120 }} />
                    <col style={{ width: 48 }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th style={th}>Item Code</th>
                      <th style={th}>Item Name</th>
                      <th style={{ ...th, textAlign: "right" }}>Avail Qty</th>
                      <th style={{ ...th, textAlign: "right" }}>Qty</th>
                      <th style={th}>UoM</th>
                      <th style={{ ...th, textAlign: "right" }} title="Price after STD (period) discount">Base Price</th>
                      <th style={{ ...th, textAlign: "right" }}>STD Disc %</th>
                      <th style={{ ...th, textAlign: "right" }}>CT Disc %</th>
                      <th style={{ ...th, textAlign: "right" }}>PM Disc %</th>
                      <th style={{ ...th, textAlign: "right" }}>Unit Price</th>
                      <th style={{ ...th, textAlign: "right" }}>Line Total</th>
                      <th style={th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {priced.map(({ line, promoPct, unit, total: lineTotal, giveaway, freeQty }) => {
                      const p = line.product;
                      const over = p.availableQty != null && line.qty > (p.availableQty ?? 0);
                      const giftSame = giveaway && giveaway.giveItemCode === p.sapItemCode;
                      return [
                        <tr key={p.sapItemCode} style={{ background: line.unavailable ? "#FEF2F2" : undefined }}>
                          <td style={{ ...td, fontFamily: "monospace", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={p.sapItemCode}>{p.sapItemCode}</td>
                          <td style={td}>
                            <ClampedName text={itemName(p)} expanded={expandedNames.has(p.sapItemCode)} onToggle={() => toggleName(p.sapItemCode)} />
                            {line.unavailable && <div style={{ ...hint, color: "#DC2626" }}>Not available for this customer in {warehouse} — remove it or pick another warehouse.</div>}
                            {(p.promotionOptions.length > 0 && (promoPct > 0 || p.promotionOptions.length > 1) || p.giveawayOptions.length > 0) && (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4, minWidth: 0 }}>
                                {p.promotionOptions.length > 0 && (promoPct > 0 || p.promotionOptions.length > 1) && (
                                  <ProgramChip
                                    icon="🏷"
                                    value={line.promotionCode ?? ""}
                                    onChange={(key) => updateLine(p.sapItemCode, { promotionCode: key || null })}
                                    options={p.promotionOptions.map((o) => ({
                                      key: o.code ?? "",
                                      short: `${o.code ?? "—"} · ${Number(o.pct)}%`,
                                      full: o.name || o.code || "",
                                    }))}
                                  />
                                )}
                                {p.giveawayOptions.length > 0 && (
                                  <ProgramChip
                                    icon="🎁"
                                    value={line.giveawayKey}
                                    onChange={(key) => updateLine(p.sapItemCode, { giveawayKey: key })}
                                    options={p.giveawayOptions.map((o) => ({
                                      key: giveawayKeyOf(o),
                                      short: `Buy ${o.buyQty} get ${o.giveQty} · ${o.giveItemCode === p.sapItemCode ? "same item" : o.giveItemCode}`,
                                      full: `${o.giveItemCode === p.sapItemCode ? "Same item" : o.giveItemName || o.giveItemCode} — ${o.name || o.code || ""}`,
                                    }))}
                                  />
                                )}
                              </div>
                            )}
                          </td>
                          <td style={{ ...num_, color: over ? "#DC2626" : undefined, fontWeight: over ? 700 : undefined }}>{num(p.availableQty)}</td>
                          <td style={num_}>
                            <input
                              ref={(el) => { if (el) qtyRefs.current.set(p.sapItemCode, el); else qtyRefs.current.delete(p.sapItemCode); }}
                              type="number" min={1} step={1} value={line.qty || ""}
                              onChange={(e) => updateLine(p.sapItemCode, { qty: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); itemInputRef.current?.focus(); } }}
                              style={{ ...styles.input, width: "100%", boxSizing: "border-box", textAlign: "right", padding: "0.3rem 0.5rem", borderColor: over || !line.qty ? "#F87171" : undefined }}
                            />
                          </td>
                          <td style={td}>{p.uom}</td>
                          <td style={num_}>{money(p.basePrice)}</td>
                          <td style={num_}>{pct(p.periodDiscPct)}</td>
                          <td style={num_}>{pct(p.contractDiscPct)}</td>
                          <td style={num_}>{pct(promoPct)}</td>
                          <td style={{ ...num_, fontWeight: 700 }}>{money(unit)}</td>
                          <td style={{ ...num_, fontWeight: 700 }}>{money(lineTotal)}</td>
                          <td style={td}>
                            <button onClick={() => removeLine(p.sapItemCode)} aria-label={`Remove ${p.sapItemCode}`} title="Remove" style={{ ...btn("secondary"), padding: "0.25rem 0.5rem" }}>🗑</button>
                          </td>
                        </tr>,
                        freeQty > 0 && giveaway ? (
                          <tr key={`${p.sapItemCode}-gift`} style={{ background: "rgba(16,185,129,0.06)" }}>
                            <td style={{ ...td, fontFamily: "monospace", paddingLeft: "1rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "var(--text-secondary, #64748B)" }} title={giveaway.giveItemCode}>└ {giveaway.giveItemCode}</td>
                            <td style={td}>
                              <div style={{ display: "flex", gap: 6, alignItems: "flex-start", minWidth: 0 }}>
                                <Badge label="Gift" tone="success" />
                                <ClampedName
                                  text={giftSame ? itemName(p) : giveaway.giveItemName || giveaway.giveItemCode}
                                  expanded={expandedNames.has(`${p.sapItemCode}-gift`)}
                                  onToggle={() => toggleName(`${p.sapItemCode}-gift`)}
                                  style={{ minWidth: 0, flex: 1 }}
                                />
                              </div>
                            </td>
                            <td style={num_}></td>
                            <td style={num_}>{num(freeQty)}</td>
                            <td style={td}>{p.uom}</td>
                            <td style={num_}>0₫</td>
                            <td style={num_}></td><td style={num_}></td><td style={num_}></td>
                            <td style={num_}>0₫</td>
                            <td style={num_}>0₫</td>
                            <td style={td}></td>
                          </tr>
                        ) : null,
                      ];
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* ── Footer ── */}
            <div style={{ borderTop: "1px solid var(--color-gray-200, #E2E8F0)", padding: "0.875rem 1.25rem", display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: "1rem", alignItems: "end", background: "var(--bg-secondary, #F8FAFC)" }}>
              <div style={{ minWidth: 0 }}>
                <span style={label}>Remark</span>
                <textarea style={{ ...field, minHeight: 56, resize: "vertical", fontFamily: "inherit" }} value={remark}
                  onChange={(e) => setRemark(e.target.value)} placeholder="Delivery instructions or a note for SAP (sent as the order's Comments)" />
                {brands.length > 1 && (
                  <div style={{ ...hint, color: "#B45309" }}>ⓘ This creates {brands.length} orders, one per brand: {brands.join(", ")}.</div>
                )}
                {notice.length > 0 && (
                  <div style={{ ...hint, color: "#B45309" }}>
                    ⓘ Copied at today&apos;s prices. Changed while copying:
                    <ul style={{ margin: "0.125rem 0 0 1rem" }}>{notice.map((n) => <li key={n}>{n}</li>)}</ul>
                  </div>
                )}
                {overStock.length > 0 && (
                  <div style={{ ...hint, color: "#DC2626" }}>⚠ {overStock.length} line(s) exceed the available quantity in {warehouse}.</div>
                )}
                {error && (
                  <div style={{ ...hint, color: "#DC2626", fontWeight: 600 }}>
                    {error.text}
                    {error.problems && <ul style={{ margin: "0.25rem 0 0 1rem" }}>{error.problems.map((pr) => <li key={pr}>{pr}</li>)}</ul>}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.5rem" }}>
                <table style={{ fontSize: "0.8125rem", fontVariantNumeric: "tabular-nums" }}>
                  <tbody>
                    <tr><td style={{ paddingRight: "1.5rem", color: "var(--text-secondary, #64748B)" }}>Subtotal</td><td style={{ textAlign: "right" }}>{money(subtotal)}</td></tr>
                    <tr><td style={{ paddingRight: "1.5rem", color: "var(--text-secondary, #64748B)" }}>Discount</td><td style={{ textAlign: "right" }}>{subtotal - total > 0 ? `−${money(subtotal - total)}` : money(0)}</td></tr>
                    <tr><td style={{ paddingRight: "1.5rem", fontWeight: 800 }}>Total</td><td style={{ textAlign: "right", fontWeight: 800, fontSize: "1rem" }}>{money(total)}</td></tr>
                  </tbody>
                </table>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button style={btn("secondary", saving)} onClick={requestClose} disabled={saving}>Cancel</button>
                  <button style={btn("primary", !canCreate)} onClick={create} disabled={!canCreate}>
                    {saving ? "Creating…" : brands.length > 1 ? `Create ${brands.length} orders` : "Create order"}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
