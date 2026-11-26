"use client";

import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, type CSSProperties, type KeyboardEvent } from "react";
import { styles, btn, Badge } from "../adminUi";
import { useStaffBase } from "../layout";
import type { ProductWithPricing } from "@/types/product";
import { IMPORT_TEMPLATE_COLUMNS_EN, IMPORT_TEMPLATE_COLUMNS_VI } from "@/lib/importTemplate";

/**
 * "Self create" sales order dialog (Admin → Orders): an admin creates an
 * order on behalf of a SAP customer or distributor. Prices shown here are
 * the customer's own storefront prices and are only a preview — the server
 * recomputes every line on Create (POST /api/admin/orders/create). The new
 * order(s) then follow the normal review flow ("Confirm & Push to SAP").
 *
 * Edit mode (`editOrder`): the same dialog edits an order that is not yet in
 * SAP — customer fixed, items limited to the order's brand, lines already on
 * the order priced even when out of stock; Save re-prices everything on the
 * server (PUT /api/admin/orders/[id]/edit, see lib/orderEdit.ts).
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
  /** Row id — the same item can be on the order twice with different programs (Import Excel split). */
  uid: string;
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
  /** Edit mode: the order's contact phone. */
  contactPhone?: string | null;
  /** Buy lines only — gift lines are rebuilt from giveawayKey. */
  lines: { sapItemCode: string; quantity: number; promotionCode: string | null; giveawayKey: string | null }[];
}

const giveawayKeyOf = (o: { code: string | null; giveItemCode: string }) => `${o.code ?? ""}::${o.giveItemCode}`;
let uidSeq = 0;
const newUid = () => `l${++uidSeq}`;
const programKey = (code: string, promotionCode: string | null, giveawayKey: string | null) => `${code.toUpperCase()}|${promotionCode ?? ""}|${giveawayKey ?? ""}`;
const money = (v: number) => new Intl.NumberFormat("vi-VN").format(Math.round(v)) + "₫";
const num = (v: number | null | undefined) => (v == null ? "—" : new Intl.NumberFormat("vi-VN").format(v));
const pct = (v: number) => (v ? `${Number(v.toFixed(2))}%` : "—");
const itemName = (p: ProductWithPricing) => p.itemNameVi || p.itemNameEn || p.sapItemCode;

// ── Import Excel — same template / columns as the storefront's Excel Import ──
const IMPORT_MAX_CODES = 500;
const HEADER_ALIASES = {
  itemCode: [IMPORT_TEMPLATE_COLUMNS_EN[0], IMPORT_TEMPLATE_COLUMNS_VI[0], "sap item code", "item code", "code"].map((x) => x.toLowerCase()),
  quantity: [IMPORT_TEMPLATE_COLUMNS_EN[2], IMPORT_TEMPLATE_COLUMNS_VI[2], "qty"].map((x) => x.toLowerCase()),
};
interface ImportResult { added: number; merged: number; notFound: string[]; invalid: string[] }
/**
 * Items from the file with more than one promotion / gift program: a buy
 * quantity per program (split along one axis — the gift programs when there
 * are several, else the promotion discounts; the other axis is one pick).
 */
interface ImportSplit {
  axis: "gift" | "promo";
  /** gift axis: the promotion discount for every row; promo axis: the gift program. */
  promotionCode: string | null;
  giveawayKey: string | null;
  /** Option key (giveawayKeyOf / promotion code) → buy quantity. */
  qty: Record<string, number>;
}
interface ImportChoice {
  found: ProductWithPricing[];
  qty: Map<string, number>;
  splits: Map<string, ImportSplit>;
  result: Omit<ImportResult, "added" | "merged">;
}

/** Default split: the gift program whose free item is the bought item itself gets the Excel qty
 *  (none → the best match); every other program starts at 0. */
function defaultSplit(p: ProductWithPricing, q: number): ImportSplit {
  if (p.giveawayOptions.length > 1) {
    const same = p.giveawayOptions.findIndex((o) => o.giveItemCode === p.sapItemCode);
    const def = same >= 0 ? same : 0;
    return {
      axis: "gift", promotionCode: p.promotionOptions[0]?.code ?? null, giveawayKey: null,
      qty: Object.fromEntries(p.giveawayOptions.map((o, i) => [giveawayKeyOf(o), i === def ? q : 0])),
    };
  }
  return {
    axis: "promo", promotionCode: null, giveawayKey: p.giveawayOptions[0] ? giveawayKeyOf(p.giveawayOptions[0]) : null,
    qty: Object.fromEntries(p.promotionOptions.map((o, i) => [o.code ?? "", i === 0 ? q : 0])),
  };
}

/** Excel rows → quantity per item code (summed, case-insensitive) + the rows that couldn't be read. */
async function readImportFile(file: File): Promise<{ qty: Map<string, { code: string; qty: number }>; invalid: string[] }> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const rows: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
  const head = rows[0] ?? [];
  const col = (k: keyof typeof HEADER_ALIASES) => head.findIndex((c) => typeof c === "string" && HEADER_ALIASES[k].includes(c.trim().toLowerCase()));
  const codeIdx = col("itemCode"), qtyIdx = col("quantity");
  if (codeIdx === -1 || qtyIdx === -1) throw new Error("The file needs an Item Code (Mã hàng) and a Quantity (Số lượng) column — use the template.");
  const qty = new Map<string, { code: string; qty: number }>();
  const invalid: string[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c) => c === undefined || c === null || c === "")) continue;
    const code = row[codeIdx] == null ? "" : String(row[codeIdx]).trim();
    const raw = row[qtyIdx];
    const q = typeof raw === "number" ? raw : parseFloat(String(raw ?? "").trim());
    if (!code) { invalid.push(`Row ${i + 1}: no item code`); continue; }
    if (!Number.isFinite(q) || q <= 0 || !Number.isInteger(q)) { invalid.push(`Row ${i + 1} (${code}): quantity must be a whole number above 0`); continue; }
    const k = code.toUpperCase();
    const prev = qty.get(k);
    if (prev) prev.qty += q; else qty.set(k, { code, qty: q });
  }
  return { qty, invalid };
}

/** Same formula as the server (buildOrderLines) and the storefront — preview only. */
function priceLine(line: Line) {
  const p = line.product;
  const promo = p.promotionOptions.find((o) => o.code === line.promotionCode) ?? p.promotionOptions[0];
  const promoPct = promo ? Number(promo.pct) : 0;
  const unit = Math.max(0, p.basePrice * (1 - (p.contractDiscPct + promoPct) / 100));
  const giveaway = p.giveawayOptions.find((o) => giveawayKeyOf(o) === line.giveawayKey) ?? p.giveawayOptions[0];
  const freeQty = giveaway && giveaway.buyQty && giveaway.giveQty ? Math.floor(line.qty / giveaway.buyQty) * giveaway.giveQty : 0;
  // Promotion "case c": the same program also gives the bought item itself.
  const extra = giveaway?.extra;
  const extraQty = extra && extra.buyQty && extra.giveQty ? Math.floor(line.qty / extra.buyQty) * extra.giveQty : 0;
  return { promoPct, unit, total: unit * line.qty, base: p.basePrice * line.qty, giveaway, freeQty, extraQty };
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
    // Shrinks (with "…") so the discount % and the buy / give chips stay on one line; full text on hover / in the list.
    display: "inline-flex", alignItems: "center", gap: 4, maxWidth: "100%", minWidth: 0, flexShrink: 1, padding: "1px 8px",
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

export default function SelfCreateOrderDialog({ locale, onClose, onCreated, initial, editOrder }: {
  locale: string;
  onClose: () => void;
  onCreated: () => void;
  /** Pre-fill from an existing order (Duplicate); everything stays editable. */
  initial?: DuplicateSource;
  /** Edit that order (with `initial` = its current content) instead of creating a new one. */
  editOrder?: { orderId: number; orderNumber: string; previousTotal: number };
}) {
  const editId = editOrder?.orderId;
  // /admin or /sales — links to the new order stay in the current area.
  const staffBase = useStaffBase();

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
  // 🔄 next to Warehouse: refresh that warehouse's stock from SAP, then re-price the lines (new Avail Qty).
  const [stockRefreshing, setStockRefreshing] = useState(false);
  const [stockRefreshNote, setStockRefreshNote] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importChoice, setImportChoice] = useState<ImportChoice | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Footer ──
  const [remark, setRemark] = useState("");
  // Edit mode: the order's contact phone, and the header section (collapsed by default so the lines get the room).
  const [contactPhone, setContactPhone] = useState(initial?.contactPhone ?? "");
  const [headerOpen, setHeaderOpen] = useState(false);
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
    if (!created && dirty && !confirm(editOrder ? "Discard your changes to this order?" : "Discard this sales order?")) return;
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
        body: JSON.stringify({ customer: cardCode, warehouse: wh, codes: [...new Set(current.map((l) => l.product.sapItemCode))], orderId: editId }),
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

      // One row per item + program (the same item twice with different programs stays two rows).
      const merged = new Map<string, DuplicateSource["lines"][number]>();
      for (const l of initial.lines) {
        const k = programKey(l.sapItemCode, l.promotionCode, l.giveawayKey);
        const prev = merged.get(k);
        if (prev) {
          prev.quantity += l.quantity;
          notes.push(`${l.sapItemCode} was on the order twice with the same programs — merged into one line.`);
        } else {
          merged.set(k, { ...l });
        }
      }
      setRepricing(true);
      try {
        const res = await fetch("/api/admin/orders/create/pricing", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customer: initial.customerCode, warehouse: wh, codes: [...new Set([...merged.values()].map((l) => l.sapItemCode))], orderId: editId }),
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
            uid: newUid(), product: p, qty: l.quantity,
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

  const refreshStock = async () => {
    if (!warehouse || !detail) return;
    setStockRefreshing(true);
    setStockRefreshNote("");
    try {
      const res = await fetch("/api/admin/orders/create/stock-refresh", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ warehouse }),
      });
      const data = await res.json();
      if (!res.ok) { setError({ text: data.error || "Stock refresh failed" }); return; }
      const at = new Date(data.refreshedAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      setStockRefreshNote(`${warehouse} stock refreshed from SAP at ${at}${data.cached ? " (just now)" : ` — ${data.rows} items`}`);
      setLines(await reprice(detail.customer.sap_card_code, warehouse, lines));
    } catch {
      setError({ text: "Network error — stock not refreshed" });
    } finally {
      setStockRefreshing(false);
    }
  };

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
          body: JSON.stringify({ customer: detail.customer.sap_card_code, warehouse, search: itemQuery, orderId: editId }),
        });
        const data = await res.json();
        setItemResults(data.items || []);
        setItemActive(0);
      } catch { /* aborted */ } finally { setItemLoading(false); }
    }, 250);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [itemQuery, itemOpen, detail, warehouse, editId]);

  const addItem = (p: ProductWithPricing) => {
    setItemOpen(false);
    setItemQuery("");
    const existing = lines.find((l) => l.product.sapItemCode === p.sapItemCode);
    if (existing) {
      setLines(lines.map((l) => (l === existing ? { ...l, qty: l.qty + 1 } : l)));
      focusQtyOf.current = existing.uid;
    } else {
      const uid = newUid();
      setLines([...lines, {
        uid, product: p, qty: 1,
        promotionCode: p.promotionOptions[0]?.code ?? null,
        giveawayKey: p.giveawayOptions[0] ? giveawayKeyOf(p.giveawayOptions[0]) : null,
      }]);
      focusQtyOf.current = uid;
    }
  };
  useEffect(() => {
    if (!focusQtyOf.current) return;
    const el = qtyRefs.current.get(focusQtyOf.current);
    focusQtyOf.current = null;
    el?.focus(); el?.select();
  }, [lines]);

  const updateLine = (uid: string, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l) => (l.uid === uid ? { ...l, ...patch } : l)));
  const removeLine = (uid: string) => setLines((prev) => prev.filter((l) => l.uid !== uid));

  /**
   * Put the imported items on the order. Each (item, programs) pair is one
   * line — an item split between programs in the popup becomes one line per
   * program given a quantity; a line already on the order with the same
   * programs gets the quantity added.
   */
  const applyImport = (found: ProductWithPricing[], qty: Map<string, number>, splits: ImportChoice["splits"], result: ImportChoice["result"]) => {
    const wanted: { p: ProductWithPricing; q: number; promotionCode: string | null; giveawayKey: string | null }[] = [];
    for (const p of found) {
      const split = splits.get(p.sapItemCode);
      if (split) {
        for (const [k, q] of Object.entries(split.qty)) {
          if (q <= 0) continue;
          wanted.push(split.axis === "gift"
            ? { p, q, promotionCode: split.promotionCode, giveawayKey: k }
            : { p, q, promotionCode: k || null, giveawayKey: split.giveawayKey });
        }
      } else {
        const q = qty.get(p.sapItemCode.toUpperCase()) ?? 0;
        if (q > 0) wanted.push({ p, q, promotionCode: p.promotionOptions[0]?.code ?? null, giveawayKey: p.giveawayOptions[0] ? giveawayKeyOf(p.giveawayOptions[0]) : null });
      }
    }
    const keyOf = (code: string, pc: string | null, gk: string | null) => programKey(code, pc, gk);
    const onOrder = new Set(lines.map((l) => keyOf(l.product.sapItemCode, l.promotionCode, l.giveawayKey)));
    const merged = wanted.filter((w) => onOrder.has(keyOf(w.p.sapItemCode, w.promotionCode, w.giveawayKey))).length;
    setLines((prev) => {
      const next = [...prev];
      for (const w of wanted) {
        const i = next.findIndex((l) => keyOf(l.product.sapItemCode, l.promotionCode, l.giveawayKey) === keyOf(w.p.sapItemCode, w.promotionCode, w.giveawayKey));
        if (i >= 0) next[i] = { ...next[i], product: w.p, unavailable: false, qty: next[i].qty + w.q };
        else next.push({ uid: newUid(), product: w.p, qty: w.q, promotionCode: w.promotionCode, giveawayKey: w.giveawayKey });
      }
      return next;
    });
    setImportResult({ ...result, added: wanted.length - merged, merged });
    setImportChoice(null);
  };

  const importExcel = async (file: File) => {
    if (!detail || !warehouse) return;
    setImporting(true);
    setImportResult(null);
    setError(null);
    try {
      const { qty, invalid } = await readImportFile(file);
      const codes = [...qty.values()].map((x) => x.code);
      if (codes.length === 0) { setImportResult({ added: 0, merged: 0, notFound: [], invalid }); return; }
      if (codes.length > IMPORT_MAX_CODES) throw new Error(`The file has ${codes.length} items — at most ${IMPORT_MAX_CODES} per import.`);
      const res = await fetch("/api/admin/orders/create/pricing", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer: detail.customer.sap_card_code, warehouse, codes, orderId: editId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to price the imported items");
      const found: ProductWithPricing[] = data.items || [];
      const foundKeys = new Set(found.map((p) => p.sapItemCode.toUpperCase()));
      const result = { notFound: codes.filter((c) => !foundKeys.has(c.toUpperCase())), invalid };
      const qtyByCode = new Map([...qty].map(([k, v]) => [k, v.qty]));
      const multi = found.filter((p) => p.promotionOptions.length > 1 || p.giveawayOptions.length > 1);
      if (multi.length === 0) { applyImport(found, qtyByCode, new Map(), result); return; }
      // Several programs → popup: a buy quantity per program (same-item gift program preselected with the Excel qty).
      const splits: ImportChoice["splits"] = new Map();
      for (const p of multi) splits.set(p.sapItemCode, defaultSplit(p, qtyByCode.get(p.sapItemCode.toUpperCase()) ?? 0));
      setImportChoice({ found, qty: qtyByCode, splits, result });
    } catch (e) {
      setError({ text: `Import Excel: ${e instanceof Error ? e.message : "could not read the file"}` });
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

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
      const payload = {
        customer: detail.customer.sap_card_code, warehouse, billTo: billTo || null, shipTo: shipTo || null,
        supervisor: supervisor || null, remark,
        ...(editOrder ? { contactPhone } : {}),
        lines: lines.map((l) => ({ sapItemCode: l.product.sapItemCode, quantity: l.qty, promotionCode: l.promotionCode, giveawayKey: l.giveawayKey })),
      };
      if (editOrder) {
        if (!contactPhone.trim()) { setHeaderOpen(true); setError({ text: "Enter a contact phone (Order header)" }); return; }
        const res = await fetch(`/api/admin/orders/${editOrder.orderId}/edit`, {
          method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) { setError({ text: data.error || "Failed to save the order", problems: data.problems }); return; }
        onCreated();
        onClose();
        return;
      }
      const res = await fetch("/api/admin/orders/create", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) { setError({ text: data.error || "Failed to create the order", problems: data.problems }); return; }
      setCreated(data.orders);
      onCreated();
    } catch {
      setError({ text: editOrder ? "Network error — the order was not saved" : "Network error — the order was not created" });
    } finally {
      setSaving(false);
    }
  };

  const c = detail?.customer;
  const addressOf = (list: { name: string; address: string | null }[], name: string) => list.find((a) => a.name === name)?.address;
  /** customer_addresses.full_address on one line (SAP stores it with line breaks); the address name when there's none. */
  const flatAddress = (list: { name: string; address: string | null }[], name: string) => (addressOf(list, name) ?? "").replace(/\s+/g, " ").trim() || name;

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
              {editOrder ? `Edit order ${editOrder.orderNumber}` : "Create sales order"}
              {initial && !editOrder && (
                <span style={{ fontWeight: 500, fontSize: "0.875rem", color: "var(--text-secondary, #64748B)", marginLeft: "0.5rem" }}>
                  — copy of {initial.orderNumber}
                </span>
              )}
            </h2>
            {!editOrder && <p style={{ ...hint, marginTop: 2 }}>Prices follow the customer&apos;s own price list, contract and promotions. The order is reviewed and pushed to SAP from its order page.</p>}
          </div>
          <button onClick={requestClose} aria-label="Close" style={{ ...btn("secondary"), padding: "0.375rem 0.625rem" }}>✕</button>
        </div>

        {created ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1rem", padding: "2rem" }}>
            <div style={{ fontSize: "2.5rem" }}>✅</div>
            <h3 style={{ fontSize: "1.125rem", fontWeight: 800 }}>{created.length > 1 ? `${created.length} orders created (one per brand)` : "Order created"}</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", minWidth: 360 }}>
              {created.map((o) => (
                <a key={o.orderId} href={`${staffBase || `/${locale}/admin`}/orders/${o.orderId}`} style={{ ...styles.cardPadded, marginBottom: 0, padding: "0.75rem 1rem", display: "flex", justifyContent: "space-between", textDecoration: "none", color: "inherit" }}>
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
            {/* ── Header ── (edit mode: a collapsible section, collapsed by default) */}
            <div style={{ borderBottom: "1px solid var(--color-gray-200, #E2E8F0)", background: "var(--bg-secondary, #F8FAFC)" }}>
              {editOrder && (
                <button type="button" aria-expanded={headerOpen} onClick={() => setHeaderOpen((v) => !v)} style={{
                  display: "flex", alignItems: "center", gap: "0.5rem", width: "100%", padding: "0.6rem 1.25rem", border: "none", background: "transparent",
                  cursor: "pointer", textAlign: "left", fontSize: "0.875rem", fontWeight: 700, color: "var(--text-primary, #0F172A)",
                }}>
                  <span aria-hidden style={{ display: "inline-block", width: 14, transition: "transform .15s", transform: headerOpen ? "rotate(90deg)" : "none" }}>▶</span>
                  <span>Order header</span>
                  {!headerOpen && (
                    <span style={{ flex: 1, minWidth: 0, fontWeight: 400, fontSize: "0.78rem", color: "var(--text-secondary, #64748B)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {[c && `${c.sap_card_code} · ${c.card_name ?? ""}`, warehouse && `WH ${warehouse}`, detail && shipTo && flatAddress(detail.shipTo, shipTo), contactPhone && `☎ ${contactPhone}`,
                        supervisor && `Sup. ${detail?.supervisors.find((x) => x.code === supervisor)?.name ?? supervisor}`].filter(Boolean).join(" · ")}
                    </span>
                  )}
                  <span style={{ marginLeft: "auto", fontWeight: 400, fontSize: "0.75rem", color: "var(--color-primary, #2BBCB3)", whiteSpace: "nowrap" }}>{headerOpen ? "Hide ▴" : "Show ▾"}</span>
                </button>
              )}
              <div style={{ padding: editOrder ? "0 1.25rem 1rem" : "1rem 1.25rem", display: !editOrder || headerOpen ? "block" : "none" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "0.875rem 1rem" }}>
                {/* Customer */}
                <div style={{ position: "relative", gridColumn: "span 2", minWidth: 0 }}>
                  <span style={label}>Customer *</span>
                  <input
                    ref={customerInputRef}
                    style={field}
                    placeholder="🔍 Customer code, name or tax code"
                    readOnly={!!editOrder}
                    title={editOrder ? "The customer of an order can't be changed" : undefined}
                    value={customerQuery}
                    onChange={(e) => { if (editOrder) return; setCustomerQuery(e.target.value); setCustomerOpen(true); }}
                    onFocus={(e) => { if (editOrder) return; e.target.select(); setCustomerOpen(true); }}
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
                  {c && !editOrder && (
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
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <select style={{ ...field, flex: 1, minWidth: 0 }} value={warehouse} disabled={!detail} onChange={(e) => changeWarehouse(e.target.value)}>
                      {!detail && <option value="">Select a customer first</option>}
                      {detail?.warehouses.map((w) => <option key={w.code} value={w.code}>{w.code}{w.name ? ` – ${w.name}` : ""}</option>)}
                    </select>
                    <button type="button" onClick={refreshStock} disabled={!warehouse || stockRefreshing || repricing}
                      aria-label="Refresh stock from SAP" title={stockRefreshNote || (warehouse ? `Refresh ${warehouse}'s stock from SAP (Avail Qty)` : "Select a warehouse first")}
                      style={{ ...btn("secondary", !warehouse || stockRefreshing || repricing), padding: "0.35rem 0.5rem", lineHeight: 1, flexShrink: 0 }}>
                      <span aria-hidden style={{ display: "inline-block", animation: stockRefreshing ? "spin 0.9s linear infinite" : undefined }}>🔄</span>
                    </button>
                  </div>
                  <style>{"@keyframes spin { to { transform: rotate(360deg); } }"}</style>
                  {!editOrder && <div style={hint}>Avail Qty is this warehouse&apos;s stock (last inventory sync).</div>}
                </div>

                {/* Supervisor */}
                <div>
                  <span style={label}>Sales supervisor</span>
                  <select style={field} value={supervisor} disabled={!detail} onChange={(e) => setSupervisor(e.target.value)}>
                    <option value="">— None —</option>
                    {detail?.supervisors.map((s) => <option key={s.code} value={s.code}>{s.name || s.code}</option>)}
                  </select>
                  {!editOrder && c && c.supervisor_code && supervisor === c.supervisor_code && <div style={hint}>Customer&apos;s default in SAP</div>}
                </div>

                {!editOrder && (<>
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
                </>)}
              </div>
              {editOrder && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.875rem 1rem", marginTop: "0.875rem", alignItems: "flex-start" }}>
                  <div style={{ width: 350 }}>
                    <span style={label}>Bill to</span>
                    <select style={{ ...field, textOverflow: "ellipsis" }} value={billTo} title={detail ? flatAddress(detail.billTo, billTo) : undefined}
                      disabled={!detail || detail.billTo.length === 0} onChange={(e) => setBillTo(e.target.value)}>
                      {detail && detail.billTo.length === 0 && <option value="">No bill-to address in SAP</option>}
                      {!detail && <option value="">—</option>}
                      {detail?.billTo.map((a) => <option key={a.name} value={a.name}>{flatAddress(detail.billTo, a.name)}</option>)}
                    </select>
                  </div>
                  <div style={{ width: 350 }}>
                    <span style={label}>Ship to</span>
                    <select style={{ ...field, textOverflow: "ellipsis" }} value={shipTo} title={detail ? flatAddress(detail.shipTo, shipTo) : undefined}
                      disabled={!detail || detail.shipTo.length === 0} onChange={(e) => setShipTo(e.target.value)}>
                      {detail && detail.shipTo.length === 0 && <option value="">No ship-to address in SAP</option>}
                      {!detail && <option value="">—</option>}
                      {detail?.shipTo.map((a) => <option key={a.name} value={a.name}>{flatAddress(detail.shipTo, a.name)}</option>)}
                    </select>
                  </div>
                  <div style={{ width: 250 }}>
                    <span style={label}>Phone number *</span>
                    <input style={{ ...field, borderColor: contactPhone.trim() ? undefined : "#F87171" }} value={contactPhone} maxLength={50} onChange={(e) => setContactPhone(e.target.value)} />
                  </div>
                </div>
              )}
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
              <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void importExcel(f); }} />
              <button type="button" style={btn("secondary", !detail || !warehouse || importing || repricing)} disabled={!detail || !warehouse || importing || repricing}
                onClick={() => fileRef.current?.click()} title="Add items from an Excel file (Item Code + Quantity columns)">
                {importing ? "Reading…" : "📥 Import Excel"}
              </button>
              <a href={`/api/products/template?locale=${locale === "en" ? "en" : "vi"}`} style={{ ...hint, marginTop: 0, color: "var(--color-primary, #2BBCB3)", whiteSpace: "nowrap" }}>Template</a>
              <span style={hint}>
                {repricing ? "Updating prices…" : lines.length > 0 ? `${lines.length} item${lines.length > 1 ? "s" : ""}` : ""}
              </span>
            </div>

            {/* ── Lines ── */}
            <div className={editOrder ? "order-edit-scroll" : undefined} style={{ flex: 1, overflow: "auto" }}>
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
                    {priced.map(({ line, promoPct, unit, total: lineTotal, giveaway, freeQty, extraQty }) => {
                      const p = line.product;
                      const over = p.availableQty != null && line.qty > (p.availableQty ?? 0);
                      const giftSame = giveaway && giveaway.giveItemCode === p.sapItemCode;
                      return [
                        <tr key={line.uid} style={{ background: line.unavailable ? "#FEF2F2" : undefined }}>
                          <td style={{ ...td, fontFamily: "monospace", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={p.sapItemCode}>{p.sapItemCode}</td>
                          <td style={td}>
                            <ClampedName text={itemName(p)} expanded={expandedNames.has(line.uid)} onToggle={() => toggleName(line.uid)} />
                            {line.unavailable && <div style={{ ...hint, color: "#DC2626" }}>Not available for this customer in {warehouse} — remove it or pick another warehouse.</div>}
                            {(p.promotionOptions.length > 0 && (promoPct > 0 || p.promotionOptions.length > 1) || p.giveawayOptions.length > 0) && (
                              <div style={{ display: "flex", flexWrap: "nowrap", gap: 4, marginTop: 4, minWidth: 0, overflow: "hidden" }}>
                                {p.promotionOptions.length > 0 && (promoPct > 0 || p.promotionOptions.length > 1) && (
                                  <ProgramChip
                                    icon="🏷"
                                    value={line.promotionCode ?? ""}
                                    onChange={(key) => updateLine(line.uid, { promotionCode: key || null })}
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
                                    onChange={(key) => updateLine(line.uid, { giveawayKey: key })}
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
                              ref={(el) => { if (el) qtyRefs.current.set(line.uid, el); else qtyRefs.current.delete(line.uid); }}
                              type="number" min={1} step={1} value={line.qty || ""}
                              onChange={(e) => updateLine(line.uid, { qty: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
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
                            <button onClick={() => removeLine(line.uid)} aria-label={`Remove ${p.sapItemCode}`} title="Remove" style={{ ...btn("secondary"), padding: "0.25rem 0.5rem" }}>🗑</button>
                          </td>
                        </tr>,
                        extraQty > 0 ? (
                          <tr key={`${line.uid}-gift-same`} style={{ background: "rgba(16,185,129,0.06)" }}>
                            <td style={{ ...td, fontFamily: "monospace", paddingLeft: "1rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "var(--text-secondary, #64748B)" }} title={p.sapItemCode}>└ {p.sapItemCode}</td>
                            <td style={td}>
                              <div style={{ display: "flex", gap: 6, alignItems: "flex-start", minWidth: 0 }}>
                                <Badge label="Gift" tone="success" />
                                <ClampedName
                                  text={itemName(p)}
                                  expanded={expandedNames.has(`${line.uid}-gift-same`)}
                                  onToggle={() => toggleName(`${line.uid}-gift-same`)}
                                  style={{ minWidth: 0, flex: 1 }}
                                />
                              </div>
                            </td>
                            <td style={num_}></td>
                            <td style={num_}>{num(extraQty)}</td>
                            <td style={td}>{p.uom}</td>
                            <td style={num_}>0₫</td>
                            <td style={num_}></td><td style={num_}></td><td style={num_}></td>
                            <td style={num_}>0₫</td>
                            <td style={num_}>0₫</td>
                            <td style={td}></td>
                          </tr>
                        ) : null,
                        freeQty > 0 && giveaway ? (
                          <tr key={`${line.uid}-gift`} style={{ background: "rgba(16,185,129,0.06)" }}>
                            <td style={{ ...td, fontFamily: "monospace", paddingLeft: "1rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "var(--text-secondary, #64748B)" }} title={giveaway.giveItemCode}>└ {giveaway.giveItemCode}</td>
                            <td style={td}>
                              <div style={{ display: "flex", gap: 6, alignItems: "flex-start", minWidth: 0 }}>
                                <Badge label="Gift" tone="success" />
                                <ClampedName
                                  text={giftSame ? itemName(p) : giveaway.giveItemName || giveaway.giveItemCode}
                                  expanded={expandedNames.has(`${line.uid}-gift`)}
                                  onToggle={() => toggleName(`${line.uid}-gift`)}
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
                  <tfoot>
                    {(() => {
                      // Row 1: the bought items; row 2 (only when there are any): the free items. Sticky at the bottom of the lines area.
                      const buyQty = priced.reduce((t, x) => t + x.line.qty, 0);
                      const freeQty = priced.reduce((t, x) => t + x.freeQty + x.extraQty, 0);
                      const rows = [
                        { key: "buy", label: "Total", qty: buyQty, total: money(total), bg: "var(--bg-secondary, #F8FAFC)" },
                        ...(freeQty > 0 ? [{ key: "free", label: "🎁 Free items", qty: freeQty, total: money(0), bg: "#ECFDF5" }] : []),
                      ];
                      return rows.map((r, i) => {
                        const cell: CSSProperties = {
                          ...td, fontWeight: 800, background: r.bg, position: "sticky", bottom: (rows.length - 1 - i) * 37, zIndex: 1,
                          borderTop: i === 0 ? "2px solid var(--color-gray-200, #E2E8F0)" : undefined, height: 37, boxSizing: "border-box",
                        };
                        const big: CSSProperties = { ...cell, textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }; // same style as the Line Total total
                        return (
                          <tr key={r.key}>
                            <td style={cell}></td>
                            <td style={cell}>{r.label}</td>
                            <td style={cell}></td>
                            <td style={big}>{num(r.qty)}</td>
                            <td style={cell}></td><td style={cell}></td><td style={cell}></td><td style={cell}></td><td style={cell}></td><td style={cell}></td>
                            <td style={{ ...cell, textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{r.total}</td>
                            <td style={cell}></td>
                          </tr>
                        );
                      });
                    })()}
                  </tfoot>
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
                    ⓘ {editOrder ? "Priced with today's setup. Changed while loading:" : "Copied at today's prices. Changed while copying:"}
                    <ul style={{ margin: "0.125rem 0 0 1rem" }}>{notice.map((n) => <li key={n}>{n}</li>)}</ul>
                  </div>
                )}
                {importResult && (
                  <div style={{ ...hint, color: importResult.notFound.length || importResult.invalid.length ? "#B45309" : "#059669" }}>
                    📥 Imported: {importResult.added} new item{importResult.added === 1 ? "" : "s"}{importResult.merged ? `, ${importResult.merged} added to lines already on the order` : ""}.
                    {importResult.notFound.length > 0 && <> Not available for this customer in {warehouse} (or not found): <span style={{ fontFamily: "monospace" }}>{importResult.notFound.join(", ")}</span>.</>}
                    {importResult.invalid.length > 0 && <ul style={{ margin: "0.125rem 0 0 1rem" }}>{importResult.invalid.map((n) => <li key={n}>{n}</li>)}</ul>}
                    <button type="button" onClick={() => setImportResult(null)} style={{ border: "none", background: "none", cursor: "pointer", color: "inherit", marginLeft: 6 }} aria-label="Dismiss">✕</button>
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
                    {editOrder && (
                      <tr><td style={{ paddingRight: "1.5rem", color: "var(--text-secondary, #64748B)" }}>Before edit</td>
                        <td style={{ textAlign: "right", color: total === editOrder.previousTotal ? "var(--text-secondary, #64748B)" : "#B45309" }}>
                          {money(editOrder.previousTotal)}{total !== editOrder.previousTotal ? ` (${total > editOrder.previousTotal ? "+" : "−"}${money(Math.abs(total - editOrder.previousTotal))})` : ""}
                        </td></tr>
                    )}
                  </tbody>
                </table>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button style={btn("secondary", saving)} onClick={requestClose} disabled={saving}>Cancel</button>
                  <button style={btn("primary", !canCreate)} onClick={create} disabled={!canCreate}>
                    {editOrder ? (saving ? "Saving…" : "💾 Save changes") : saving ? "Creating…" : brands.length > 1 ? `Create ${brands.length} orders` : "Create order"}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
      {importChoice && (
        <ImportProgramPrompt
          choice={importChoice}
          onChange={(code, patch) => setImportChoice((c) => {
            if (!c) return c;
            const splits = new Map(c.splits);
            const cur = splits.get(code)!;
            splits.set(code, { ...cur, ...patch, qty: { ...cur.qty, ...(patch.qty ?? {}) } });
            return { ...c, splits };
          })}
          onCancel={() => setImportChoice(null)}
          onApply={() => applyImport(importChoice.found, importChoice.qty, importChoice.splits, importChoice.result)}
        />
      )}
    </div>
  );
}

/**
 * Import Excel: items with more than one promotion program. Each program has
 * its own buy quantity — the gift program whose free item is the bought item
 * itself starts with the Excel quantity (none → the best match), the others
 * at 0; the admin moves quantity between them. OK puts one order line per
 * program given a quantity.
 */
function ImportProgramPrompt({ choice, onChange, onCancel, onApply }: {
  choice: ImportChoice;
  onChange: (code: string, patch: Partial<ImportSplit>) => void;
  onCancel: () => void;
  onApply: () => void;
}) {
  const multi = choice.found.filter((p) => choice.splits.has(p.sapItemCode));
  const cell: CSSProperties = { padding: "0.375rem 0.5rem", fontSize: "0.8125rem", verticalAlign: "top", borderBottom: "1px solid var(--color-gray-100, #F1F5F9)" };
  const head: CSSProperties = { ...cell, fontSize: "0.6875rem", fontWeight: 700, color: "var(--text-secondary, #64748B)", textTransform: "uppercase", borderBottom: "1px solid var(--color-gray-200, #E2E8F0)" };
  const qtyInput = (value: number, set: (n: number) => void) => (
    <input type="number" min={0} step={1} value={value}
      onChange={(e) => set(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
      style={{ ...styles.input, width: 90, boxSizing: "border-box", textAlign: "right", padding: "0.3rem 0.5rem" }} />
  );
  const totalLines = multi.reduce((n, p) => n + Object.values(choice.splits.get(p.sapItemCode)!.qty).filter((q) => q > 0).length, 0)
    + choice.found.filter((p) => !choice.splits.has(p.sapItemCode) && (choice.qty.get(p.sapItemCode.toUpperCase()) ?? 0) > 0).length;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 350, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div role="dialog" aria-modal="true" aria-label="Choose promotion programs" style={{
        width: "min(900px, 100%)", maxHeight: "88vh", display: "flex", flexDirection: "column", background: "var(--bg-primary, #fff)",
        borderRadius: "var(--radius-xl, 12px)", boxShadow: "0 24px 64px rgba(15,23,42,0.35)", overflow: "hidden",
      }}>
        <div style={{ padding: "0.875rem 1.25rem", borderBottom: "1px solid var(--color-gray-200, #E2E8F0)" }}>
          <h3 style={{ fontSize: "1rem", fontWeight: 800 }}>Promotion Programs</h3>
          <p style={{ ...hint, marginTop: 2 }}>
            {multi.length} imported item{multi.length > 1 ? "s have" : " has"} more than one program running now. Enter the buy quantity for each program —
            the program giving the same item free starts with the Excel quantity; you can split it between programs.
          </p>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "0.75rem 1.25rem" }}>
          {multi.map((p) => {
            const excel = choice.qty.get(p.sapItemCode.toUpperCase()) ?? 0;
            const split = choice.splits.get(p.sapItemCode)!;
            const chosen = Object.values(split.qty).reduce((s, q) => s + q, 0);
            const unitFor = (promoCode: string | null) => {
              const o = p.promotionOptions.find((x) => x.code === promoCode) ?? p.promotionOptions[0];
              return Math.max(0, p.basePrice * (1 - (p.contractDiscPct + (o ? Number(o.pct) : 0)) / 100));
            };
            return (
              <div key={p.sapItemCode} style={{ border: "1px solid var(--color-gray-200, #E2E8F0)", borderRadius: 8, padding: "0.625rem 0.75rem", marginBottom: "0.75rem" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", marginBottom: 6 }}>
                  <span style={{ fontFamily: "monospace", fontWeight: 700 }}>{p.sapItemCode}</span>
                  <span style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>{itemName(p)}</span>
                  <span style={{ whiteSpace: "nowrap", fontSize: "0.8125rem", fontVariantNumeric: "tabular-nums" }}>
                    Excel qty <b>{num(excel)}</b> · Chosen <b style={{ color: chosen === excel ? "#059669" : "#B45309" }}>{num(chosen)}</b> {p.uom}
                  </span>
                </div>
                {/* The other axis (one pick for all rows of this item) */}
                {split.axis === "gift" && p.promotionOptions.length > 1 && (
                  <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: "0.8125rem", marginBottom: 6 }}>
                    <span style={{ ...label, marginBottom: 0 }}>🏷 Promotion discount</span>
                    <select value={split.promotionCode ?? ""} onChange={(e) => onChange(p.sapItemCode, { promotionCode: e.target.value || null })}
                      style={{ ...styles.input, padding: "0.25rem 0.5rem" }}>
                      {p.promotionOptions.map((o) => <option key={o.code ?? ""} value={o.code ?? ""}>{o.code ?? "—"} · {Number(o.pct)}% {o.name ?? ""}</option>)}
                    </select>
                  </label>
                )}
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ ...head, textAlign: "left" }}>{split.axis === "gift" ? "🎁 Free-item program" : "🏷 Promotion discount"}</th>
                      <th style={{ ...head, textAlign: "left" }}>Free items</th>
                      <th style={{ ...head, textAlign: "right" }}>Unit price</th>
                      <th style={{ ...head, textAlign: "right" }}>Line total</th>
                      <th style={{ ...head, textAlign: "right" }}>Buy qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {split.axis === "gift"
                      ? p.giveawayOptions.map((o) => {
                          const key = giveawayKeyOf(o);
                          const q = split.qty[key] ?? 0;
                          const free = o.buyQty && o.giveQty ? Math.floor(q / o.buyQty) * o.giveQty : 0;
                          const extraFree = o.extra && o.extra.buyQty && o.extra.giveQty ? Math.floor(q / o.extra.buyQty) * o.extra.giveQty : 0;
                          const same = o.giveItemCode === p.sapItemCode;
                          const unit = unitFor(split.promotionCode);
                          return (
                            <tr key={key} style={{ background: q > 0 ? "rgba(43,188,179,0.08)" : undefined }}>
                              <td style={cell}>
                                <b>Buy {o.buyQty} get {o.giveQty} · {same ? "same item" : o.giveItemCode}</b>
                                <div style={{ ...hint, marginTop: 0 }}>{same ? "" : `${o.giveItemName ?? ""} — `}{o.name || o.code}</div>
                              </td>
                              <td style={{ ...cell, color: free + extraFree > 0 ? "#059669" : "var(--text-tertiary, #94A3B8)", fontWeight: 700, whiteSpace: "nowrap" }}>
                                {free + extraFree > 0
                                  ? [extraFree > 0 && `${num(extraFree)} same item`, free > 0 && `${num(free)} ${same ? "same item" : o.giveItemCode}`].filter(Boolean).join(" + ")
                                  : "—"}
                              </td>
                              <td style={{ ...cell, textAlign: "right", whiteSpace: "nowrap" }}>{money(unit)}</td>
                              <td style={{ ...cell, textAlign: "right", whiteSpace: "nowrap" }}>{money(unit * q)}</td>
                              <td style={{ ...cell, textAlign: "right" }}>{qtyInput(q, (n) => onChange(p.sapItemCode, { qty: { [key]: n } }))}</td>
                            </tr>
                          );
                        })
                      : p.promotionOptions.map((o) => {
                          const key = o.code ?? "";
                          const q = split.qty[key] ?? 0;
                          const unit = unitFor(o.code ?? null);
                          const g = p.giveawayOptions.find((x) => giveawayKeyOf(x) === split.giveawayKey);
                          const free = g && g.buyQty && g.giveQty ? Math.floor(q / g.buyQty) * g.giveQty : 0;
                          return (
                            <tr key={key} style={{ background: q > 0 ? "rgba(43,188,179,0.08)" : undefined }}>
                              <td style={cell}>
                                <b>{o.code ?? "—"} · {Number(o.pct)}%</b>
                                <div style={{ ...hint, marginTop: 0 }}>{o.name}</div>
                              </td>
                              <td style={{ ...cell, color: free > 0 ? "#059669" : "var(--text-tertiary, #94A3B8)", fontWeight: 700, whiteSpace: "nowrap" }}>
                                {free > 0 && g ? `${num(free)} ${g.giveItemCode === p.sapItemCode ? "same item" : g.giveItemCode}` : "—"}
                              </td>
                              <td style={{ ...cell, textAlign: "right", whiteSpace: "nowrap" }}>{money(unit)}</td>
                              <td style={{ ...cell, textAlign: "right", whiteSpace: "nowrap" }}>{money(unit * q)}</td>
                              <td style={{ ...cell, textAlign: "right" }}>{qtyInput(q, (n) => onChange(p.sapItemCode, { qty: { [key]: n } }))}</td>
                            </tr>
                          );
                        })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
        <div style={{ padding: "0.75rem 1.25rem", borderTop: "1px solid var(--color-gray-200, #E2E8F0)", display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "0.5rem", background: "var(--bg-secondary, #F8FAFC)" }}>
          <span style={{ ...hint, marginTop: 0, marginRight: "auto" }}>{totalLines} line{totalLines === 1 ? "" : "s"} will be added</span>
          <button type="button" style={btn("secondary")} onClick={onCancel}>Cancel import</button>
          <button type="button" style={btn("primary")} onClick={onApply}>OK</button>
        </div>
      </div>
    </div>
  );
}
