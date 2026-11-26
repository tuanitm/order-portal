"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import type { ProductWithPricing } from "@/types/product";
import { previewLine, giveawayKeyOf } from "@/lib/orderLinePreview";

/**
 * Customer storefront — Edit order (while it isn't confirmed / in SAP yet):
 * addresses, phone, remark, and the items — change quantity or program, add
 * a product of the order's brand, remove one (its free gifts go with it).
 * Prices shown are a preview; the server re-prices every line with today's
 * setup on save (PUT /api/orders/[id]/edit, lib/orderEdit.ts).
 */

export interface EditableCustomerOrder {
  id: number;
  order_number: string;
  grand_total: string | number;
  contact_phone: string | null;
  remark: string | null;
  bill_to_code: string | null;
  ship_to_code: string | null;
}
export interface EditableCustomerLine {
  id: number;
  sap_item_code: string;
  item_name: string;
  quantity: number;
  confirm_qty: number;
  customer_confirm_status: "pending" | "accepted" | "rejected";
  is_gift_line: number;
  source_line_id: number | null;
  promotion_code?: string | null;
  giveaway_promotion_code?: string | null;
}

interface Line { key: number; code: string; name: string; product: ProductWithPricing | null; qty: number; promotionCode: string | null; giveawayKey: string | null }
interface Address { name: string; address: string | null }

let seq = 1;
const money = (v: number) => new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(Math.round(v)) + "₫";

export default function CustomerOrderEditDialog({ order, lines: orderLines, beforeWithTax, onClose, onSaved }: {
  order: EditableCustomerOrder;
  lines: EditableCustomerLine[];
  /** The order's current total incl. VAT (as shown on the order page). */
  beforeWithTax: number;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const t = useTranslations("orderEdit");
  const locale = useLocale();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ text: string; problems?: string[] } | null>(null);
  const [brand, setBrand] = useState<string | null>(null);
  const [book, setBook] = useState<{ billTo: Address[]; shipTo: Address[] }>({ billTo: [], shipTo: [] });
  const [h, setH] = useState({ billTo: order.bill_to_code ?? "", shipTo: order.ship_to_code ?? "", contactPhone: order.contact_phone ?? "", remark: order.remark ?? "" });
  const [lines, setLines] = useState<Line[]>([]);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ProductWithPricing[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  /** Header section (addresses, phone, remark) — collapsed by default so the order lines get the room. */
  const [headerOpen, setHeaderOpen] = useState(!order.contact_phone?.trim()); // open when the required phone is missing
  const dirty = useRef(false);
  /** VAT % per item code (the item's SAP VAT group) — for the incl.-VAT totals. */
  const [rates, setRates] = useState<Record<string, number>>({});
  const name = (p: ProductWithPricing) => (locale === "en" ? p.itemNameEn || p.itemNameVi : p.itemNameVi || p.itemNameEn) || p.sapItemCode;

  // Load: addresses / brand, then today's prices of the products already on the order.
  useEffect(() => {
    (async () => {
      try {
        const meta = await (await fetch(`/api/orders/${order.id}/edit`)).json();
        if (meta.error) throw new Error(meta.error);
        if (!meta.editable) { setError({ text: t("locked") }); setLoading(false); return; }
        setBrand(meta.brand ?? null);
        setBook({ billTo: meta.billTo ?? [], shipTo: meta.shipTo ?? [] });
        const buy = orderLines.filter((l) => !l.is_gift_line);
        const codes = [...new Set(buy.map((l) => l.sap_item_code))];
        const priced = codes.length ? await (await fetch(`/api/orders/${order.id}/edit?codes=${encodeURIComponent(codes.join(","))}`)).json() : { items: [] };
        const byCode = new Map<string, ProductWithPricing>((priced.items ?? []).map((p: ProductWithPricing) => [p.sapItemCode, p]));
        const merged = new Map<string, Line>();
        for (const l of buy) {
          // Start from what will be delivered: the accepted (staff-suggested) quantity, else the ordered one.
          const qty = l.customer_confirm_status === "accepted" ? Number(l.confirm_qty) : Number(l.quantity);
          if (qty <= 0) continue;
          const prev = merged.get(l.sap_item_code);
          if (prev) { prev.qty += qty; continue; }
          const gifts = orderLines.filter((g) => g.is_gift_line && g.source_line_id === l.id);
          const gift = gifts.find((g) => g.sap_item_code !== l.sap_item_code) ?? gifts[0];
          const p = byCode.get(l.sap_item_code) ?? null;
          merged.set(l.sap_item_code, {
            key: seq++, code: l.sap_item_code, name: p ? name(p) : l.item_name, product: p, qty,
            promotionCode: p?.promotionOptions.some((o) => o.code === l.promotion_code) ? l.promotion_code ?? null : p?.promotionOptions[0]?.code ?? null,
            giveawayKey: gift && p?.giveawayOptions.some((o) => giveawayKeyOf(o) === `${l.giveaway_promotion_code ?? ""}::${gift.sap_item_code}`)
              ? `${l.giveaway_promotion_code ?? ""}::${gift.sap_item_code}` : (p?.giveawayOptions[0] ? giveawayKeyOf(p.giveawayOptions[0]) : null),
          });
        }
        setLines([...merged.values()]);
      } catch (e) {
        setError({ text: e instanceof Error && e.message ? e.message : t("loadFailed") });
      } finally {
        setLoading(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- loads once for this order
  }, [order.id]);

  // Product search (debounced) — this order's brand, the storefront's own rules.
  useEffect(() => {
    if (!open) return;
    const ctl = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const j = await (await fetch(`/api/orders/${order.id}/edit?search=${encodeURIComponent(q)}`, { signal: ctl.signal })).json();
        setResults(j.items ?? []);
      } catch { /* aborted */ } finally { setSearching(false); }
    }, 250);
    return () => { clearTimeout(timer); ctl.abort(); };
  }, [q, open, order.id]);

  const codesKey = [...new Set(lines.map((l) => l.code))].sort().join(",");
  useEffect(() => {
    const missing = codesKey.split(",").filter((c) => c && !(c in rates));
    if (!missing.length) return;
    fetch(`/api/orders/vat-rates?items=${encodeURIComponent(missing.join(","))}`)
      .then((r) => r.json()).then((j) => setRates((x) => ({ ...x, ...(j.rates ?? {}) }))).catch(() => undefined);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the set of products changes
  }, [codesKey]);

  const change = (fn: (ls: Line[]) => Line[]) => { dirty.current = true; setLines(fn); };
  const add = (p: ProductWithPricing) => {
    setOpen(false); setQ("");
    change((ls) => ls.some((l) => l.code === p.sapItemCode)
      ? ls.map((l) => (l.code === p.sapItemCode ? { ...l, qty: l.qty + 1 } : l))
      : [...ls, { key: seq++, code: p.sapItemCode, name: name(p), product: p, qty: 1, promotionCode: p.promotionOptions[0]?.code ?? null, giveawayKey: p.giveawayOptions[0] ? giveawayKeyOf(p.giveawayOptions[0]) : null }]);
  };

  const priced = useMemo(() => lines.map((l) => ({ l, x: l.product ? previewLine(l.product, l.qty, l.promotionCode, l.giveawayKey) : null })), [lines]);
  const total = priced.reduce((s, { x }) => s + (x?.total ?? 0), 0);
  // VAT per line, rounded to whole VND (same as the order page); free items are 0.
  const vat = priced.reduce((s, { l, x }) => s + (x && rates[l.code] !== undefined ? Math.round((x.total * rates[l.code]) / 100) : 0), 0);
  const totalWithTax = total + vat;
  const before = beforeWithTax;
  const blocked = lines.some((l) => !l.product);
  const canSave = !loading && !saving && lines.length > 0 && lines.every((l) => l.qty > 0) && !blocked && !!h.contactPhone.trim();

  const close = useCallback(() => {
    if (saving) return;
    if (dirty.current && !confirm(t("discard"))) return;
    onClose();
  }, [saving, onClose, t]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [close]);

  const save = async () => {
    if (!h.contactPhone.trim()) setHeaderOpen(true);
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${order.id}/edit`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          billTo: h.billTo || null, shipTo: h.shipTo || null, contactPhone: h.contactPhone, remark: h.remark,
          lines: lines.map((l) => ({ sapItemCode: l.code, quantity: l.qty, promotionCode: l.promotionCode, giveawayKey: l.giveawayKey })),
        }),
      });
      const j = await res.json();
      if (!res.ok) { setError({ text: j.error || "Failed", problems: j.problems }); return; }
      onSaved(t("saved"));
    } catch {
      setError({ text: "Network error" });
    } finally {
      setSaving(false);
    }
  };

  const label: React.CSSProperties = { fontSize: "0.75rem", color: "var(--text-tertiary)", marginBottom: "0.25rem", display: "block" };
  const sectionBar: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: "0.5rem", width: "100%", padding: "0.6rem 0.85rem", border: "none", cursor: "pointer", textAlign: "left",
    background: "var(--bg-secondary, #F8FAFC)", fontSize: "0.875rem", fontWeight: 700, color: "var(--text-primary)",
  };
  const box: React.CSSProperties = { border: "1px solid var(--color-gray-200, #E2E8F0)", borderRadius: 10, marginBottom: "1rem", overflow: "visible" };
  // The full address (customer_addresses.full_address) on one line — SAP stores it with line breaks; the address name if there's none.
  const flat = (a: Address) => (a.address ?? "").replace(/\s+/g, " ").trim() || a.name;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 900, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div role="dialog" aria-modal="true" aria-label={t("title", { number: order.order_number })} style={{
        background: "var(--bg-primary, #fff)", borderRadius: "var(--radius-xl, 12px)", width: "min(1250px, 100%)", height: "min(96vh, 1100px)", display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid var(--color-gray-200, #E2E8F0)", display: "flex", justifyContent: "space-between", gap: "1rem" }}>
          <div>
            <h2 style={{ fontSize: "1.125rem", fontWeight: 800 }}>{t("title", { number: order.order_number })}</h2>
          </div>
          <button onClick={close} aria-label={t("cancel")} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.25rem", alignSelf: "flex-start" }}>✕</button>
        </div>

        <div className="order-edit-scroll" style={{ flex: 1, overflowY: "auto", padding: "1rem 1.25rem" }}>
          {loading ? <p style={{ color: "var(--text-tertiary)" }}>…</p> : (
            <>
              {/* ── Section 1: Header (collapsed by default) ── */}
              <div style={box}>
                <button type="button" style={{ ...sectionBar, borderRadius: headerOpen ? "10px 10px 0 0" : 10 }} aria-expanded={headerOpen} onClick={() => setHeaderOpen((v) => !v)}>
                  <span aria-hidden style={{ display: "inline-block", width: 14, transition: "transform .15s", transform: headerOpen ? "rotate(90deg)" : "none" }}>▶</span>
                  <span>{t("headerSection")}</span>
                  {!headerOpen && (
                    <span style={{ flex: 1, minWidth: 0, fontWeight: 400, fontSize: "0.78rem", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {[flat(book.shipTo.find((a) => a.name === h.shipTo) ?? { name: h.shipTo, address: null }), h.contactPhone && `☎ ${h.contactPhone}`, h.remark && `📝 ${h.remark}`].filter(Boolean).join(" · ")}
                    </span>
                  )}
                  <span style={{ marginLeft: "auto", fontWeight: 400, fontSize: "0.75rem", color: "var(--color-primary, #2BBCB3)", whiteSpace: "nowrap" }}>{headerOpen ? t("collapse") : t("expand")}</span>
                </button>
                {headerOpen && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", padding: "0.85rem", alignItems: "flex-start" }}>
                <div style={{ width: 350 }}>
                  <span style={label}>{t("billTo")}</span>
                  <select className="input" style={{ width: "100%", textOverflow: "ellipsis" }} title={flat(book.billTo.find((a) => a.name === h.billTo) ?? { name: h.billTo, address: null })} value={h.billTo} onChange={(e) => { dirty.current = true; setH({ ...h, billTo: e.target.value }); }}>
                    {!book.billTo.some((a) => a.name === h.billTo) && <option value={h.billTo}>{h.billTo || "—"}</option>}
                    {book.billTo.map((a) => <option key={a.name} value={a.name}>{flat(a)}</option>)}
                  </select>
                </div>
                <div style={{ width: 350 }}>
                  <span style={label}>{t("shipTo")}</span>
                  <select className="input" style={{ width: "100%", textOverflow: "ellipsis" }} title={flat(book.shipTo.find((a) => a.name === h.shipTo) ?? { name: h.shipTo, address: null })} value={h.shipTo} onChange={(e) => { dirty.current = true; setH({ ...h, shipTo: e.target.value }); }}>
                    {!book.shipTo.some((a) => a.name === h.shipTo) && <option value={h.shipTo}>{h.shipTo || "—"}</option>}
                    {book.shipTo.map((a) => <option key={a.name} value={a.name}>{flat(a)}</option>)}
                  </select>
                </div>
                <div style={{ width: 250 }}>
                  <span style={label}>{t("phone")} *</span>
                  <input className="input" style={{ width: "100%" }} value={h.contactPhone} onChange={(e) => { dirty.current = true; setH({ ...h, contactPhone: e.target.value }); }} />
                </div>
                <div style={{ flexBasis: "100%" }}>
                  <span style={label}>{t("remark")}</span>
                  <input className="input" style={{ width: "100%" }} maxLength={1000} value={h.remark} onChange={(e) => { dirty.current = true; setH({ ...h, remark: e.target.value }); }} />
                </div>
              </div>
                )}
              </div>

              {/* ── Section 2: Order lines ── */}
              <div style={box}>
                <div style={{ ...sectionBar, cursor: "default", borderRadius: "10px 10px 0 0" }}>
                  <span>{t("linesSection")}</span>
                  <span style={{ fontWeight: 400, fontSize: "0.78rem", color: "var(--text-secondary)" }}>({lines.length})</span>
                </div>
                <div style={{ padding: "0.85rem" }}>

              {/* Add a product */}
              <div style={{ position: "relative", marginBottom: "0.5rem" }}>
                <input className="input" style={{ width: "100%" }} placeholder={t("addItem")} value={q}
                  onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
                {open && (results.length > 0 || searching) && (
                  <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 5, marginTop: 4, maxHeight: 300, overflowY: "auto", background: "var(--bg-primary, #fff)",
                    border: "1px solid var(--color-gray-200, #E2E8F0)", borderRadius: 8, boxShadow: "0 12px 32px rgba(15,23,42,0.18)" }}>
                    {searching && results.length === 0 && <div style={{ padding: "0.6rem", fontSize: "0.8rem", color: "var(--text-tertiary)" }}>{t("searching")}</div>}
                    {results.map((p) => (
                      <div key={p.sapItemCode} onMouseDown={(e) => { e.preventDefault(); add(p); }}
                        style={{ padding: "0.5rem 0.75rem", cursor: "pointer", display: "flex", gap: "0.75rem", borderBottom: "1px solid var(--color-gray-100, #F1F5F9)", fontSize: "0.8125rem" }}>
                        <span style={{ fontFamily: "monospace", fontWeight: 700, minWidth: 95 }}>{p.sapItemCode}</span>
                        <span style={{ flex: 1 }}>{name(p)}{lines.some((l) => l.code === p.sapItemCode) ? <span style={{ color: "var(--text-tertiary)" }}> · {t("onOrder")}</span> : null}
                          {p.giveawayOptions.length > 0 && <span style={{ color: "#059669" }}> · 🎁</span>}</span>
                        <strong style={{ whiteSpace: "nowrap" }}>{money(p.displayPrice)}</strong>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ marginBottom: "0.5rem" }} />

              {/* Lines */}
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid var(--color-gray-200, #E2E8F0)" }}>
                      <th style={{ textAlign: "left", padding: "0.5rem" }}>{t("items")}</th>
                      <th style={{ textAlign: "right", padding: "0.5rem", width: 90 }}>{t("qty")}</th>
                      <th style={{ textAlign: "right", padding: "0.5rem" }}>{t("unitPrice")}</th>
                      <th style={{ textAlign: "right", padding: "0.5rem" }}>{t("lineTotal")}</th>
                      <th style={{ width: 40 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {priced.map(({ l, x }) => {
                      const p = l.product;
                      return (
                        <tr key={l.key} style={{ borderBottom: "1px solid var(--color-gray-100, #F1F5F9)", background: p ? undefined : "#FEF2F2", verticalAlign: "top" }}>
                          <td style={{ padding: "0.5rem" }}>
                            <div><span style={{ fontFamily: "monospace", fontWeight: 700 }}>{l.code}</span> {l.name}</div>
                            {!p && <div style={{ color: "#DC2626", fontSize: "0.75rem" }}>{t("unavailable")}</div>}
                            {p && p.promotionOptions.length > 1 && (
                              <label style={{ display: "block", fontSize: "0.75rem", marginTop: 4 }}>{t("promotion")}:{" "}
                                <select value={l.promotionCode ?? ""} onChange={(e) => change((ls) => ls.map((y) => (y.key === l.key ? { ...y, promotionCode: e.target.value || null } : y)))}>
                                  {p.promotionOptions.map((o) => <option key={o.code ?? ""} value={o.code ?? ""}>{o.name || o.code} (−{Number(o.pct)}%)</option>)}
                                </select>
                              </label>
                            )}
                            {p && p.giveawayOptions.length > 1 && (
                              <label style={{ display: "block", fontSize: "0.75rem", marginTop: 4 }}>{t("gift")}:{" "}
                                <select value={l.giveawayKey ?? ""} onChange={(e) => change((ls) => ls.map((y) => (y.key === l.key ? { ...y, giveawayKey: e.target.value } : y)))}>
                                  {p.giveawayOptions.map((o) => <option key={giveawayKeyOf(o)} value={giveawayKeyOf(o)}>{o.name || o.code} — {o.buyQty}+{o.giveQty} {o.giveItemCode === p.sapItemCode ? t("sameItem") : o.giveItemName || o.giveItemCode}</option>)}
                                </select>
                              </label>
                            )}
                            {x && x.extraQty > 0 && <div style={{ fontSize: "0.75rem", color: "#059669", marginTop: 2 }}>{t("freeGift", { qty: x.extraQty, item: t("sameItem") })}</div>}
                            {x && x.freeQty > 0 && x.giveaway && (
                              <div style={{ fontSize: "0.75rem", color: "#059669", marginTop: 2 }}>
                                {t("freeGift", { qty: x.freeQty, item: x.giveaway.giveItemCode === l.code ? t("sameItem") : x.giveaway.giveItemName || x.giveaway.giveItemCode })}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: "0.5rem", textAlign: "right" }}>
                            <input type="number" min={1} className="input" style={{ width: 80, textAlign: "right", padding: "0.25rem 0.4rem", borderColor: l.qty > 0 ? undefined : "#F87171" }}
                              value={l.qty || ""} onChange={(e) => change((ls) => ls.map((y) => (y.key === l.key ? { ...y, qty: Math.max(0, Math.floor(Number(e.target.value) || 0)) } : y)))} />
                          </td>
                          <td style={{ padding: "0.5rem", textAlign: "right", whiteSpace: "nowrap" }}>{x ? money(x.unit) : "—"}</td>
                          <td style={{ padding: "0.5rem", textAlign: "right", whiteSpace: "nowrap", fontWeight: 700 }}>{x ? money(x.total) : "—"}</td>
                          <td style={{ padding: "0.5rem" }}>
                            <button type="button" title={`${t("remove")} — ${t("removeHint")}`} aria-label={t("remove")}
                              onClick={() => change((ls) => ls.filter((y) => y.key !== l.key))}
                              style={{ background: "none", border: "1px solid var(--color-gray-200, #E2E8F0)", borderRadius: 6, cursor: "pointer", padding: "0.2rem 0.45rem" }}>🗑</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {lines.length === 0 && <p style={{ color: "#B45309", fontSize: "0.8rem", marginTop: "0.5rem" }}>{t("needOne")}</p>}
                </div>
              </div>
            </>
          )}
          {error && (
            <div style={{ marginTop: "0.75rem", padding: "0.6rem 0.8rem", background: "#FEF2F2", color: "#B91C1C", borderRadius: 8, fontSize: "0.8125rem" }}>
              {error.text}
              {error.problems && <ul style={{ margin: "0.25rem 0 0 1rem" }}>{error.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
            </div>
          )}
        </div>

        <div style={{ borderTop: "1px solid var(--color-gray-200, #E2E8F0)", padding: "0.75rem 1.25rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
          <div style={{ fontSize: "0.85rem", display: "grid", gridTemplateColumns: "auto auto", columnGap: "1rem", rowGap: 2 }}>
            <span style={{ color: "var(--text-secondary)" }}>{t("beforeWithTax")}</span>
            <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(before)}</span>
            <strong>{t("totalWithTax")}</strong>
            <strong style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: totalWithTax === before ? undefined : "#B45309" }}>
              {money(totalWithTax)}{totalWithTax !== before ? ` (${totalWithTax > before ? "+" : "−"}${money(Math.abs(totalWithTax - before))})` : ""}
            </strong>
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button className="btn btn-secondary" onClick={close} disabled={saving}>{t("cancel")}</button>
            <button className="btn btn-primary" onClick={save} disabled={!canSave}>{saving ? t("saving") : t("save")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
