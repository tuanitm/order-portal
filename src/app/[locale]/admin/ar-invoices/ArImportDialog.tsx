"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import * as XLSX from "xlsx";
import { styles, btn } from "../adminUi";
import { money } from "./arUi";

/**
 * AR Invoice (CK) — Import Excel. Download the template, drop the filled file:
 * one draft AR Invoice per Brand + Warehouse + Customer Code. The server checks every invoice the
 * same way Save does on New AR Invoice (preview first), then creates the valid
 * ones as drafts — nothing is sent to SAP until each is posted.
 */

const COLUMNS = ["Brand", "Warehouse", "Customer Code", "Customer Name", "Item Code", "Invoice Text", "Qty", "Unit Price", "Disc %", "VAT", "Total (excl. VAT)", "Remarks"] as const;
type Col = "brandCode" | "warehouseCode" | "cardCode" | "cardName" | "itemCode" | "description" | "quantity" | "unitPrice" | "discountPct" | "vat" | "total" | "remarks";
const HEADER_KEYS: Record<string, Col> = {
  brand: "brandCode", brandcode: "brandCode", nhanhang: "brandCode",
  warehouse: "warehouseCode", warehousecode: "warehouseCode", whs: "warehouseCode", kho: "warehouseCode",
  remarks: "remarks", remark: "remarks", comments: "remarks", ghichu: "remarks",
  customercode: "cardCode", cardcode: "cardCode", customer: "cardCode", makhachhang: "cardCode",
  customername: "cardName", cardname: "cardName", tenkhachhang: "cardName",
  itemcode: "itemCode", itemno: "itemCode", item: "itemCode", mahang: "itemCode",
  invoicetext: "description", description: "description", text: "description", diengiai: "description",
  qty: "quantity", quantity: "quantity", soluong: "quantity",
  unitprice: "unitPrice", price: "unitPrice", dongia: "unitPrice",
  disc: "discountPct", discount: "discountPct", discpct: "discountPct", discountpct: "discountPct", chietkhau: "discountPct",
  vat: "vat", vatgroup: "vat", thue: "vat",
  totalexclvat: "total", total: "total", totalbeforevat: "total", thanhtien: "total",
};

interface ImportRow {
  row: number; brandCode: string | null; warehouseCode: string | null; remarks: string | null; cardCode: string; cardName: string | null; itemCode: string; description: string | null;
  quantity: number | string | null; unitPrice: number | string | null; discountPct: number | string | null; vat: string | null; total: number | string | null;
}
interface ImportResult {
  brandCode: string | null; warehouseCode: string | null; comments: string | null;
  cardCode: string; cardName: string | null; rows: number[];
  lines: { row: number; itemCode: string; itemName: string | null; description: string | null; quantity: number; unitPrice: number; discountPct: number; vatGroup: string | null; lineTotal: number }[];
  totalBefore: number; vatSum: number; docTotal: number; errors: string[]; id?: number; docNumber?: string | null;
}

const today = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const norm = (s: unknown) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9]/g, "");
const text = (v: unknown) => { const s = String(v ?? "").trim(); return s || null; };
/** "1,500,000" / "-1" / "10%" → number; blank → null; not a number → the text itself (the server check reports it by row). */
const numOf = (v: unknown): number | string | null => {
  if (typeof v === "number") return v;
  const raw = String(v ?? "").trim();
  const s = raw.replace(/[\s,₫]/g, "").replace(/%$/, "");
  if (s === "") return null;
  return Number.isFinite(Number(s)) ? Number(s) : raw;
};

export function downloadArImportTemplate() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([[...COLUMNS]]);
  ws["!cols"] = [8, 11, 14, 30, 16, 40, 8, 14, 8, 8, 18, 40].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, ws, "AR Invoices");
  const help = XLSX.utils.aoa_to_sheet([
    ["How to fill the \"AR Invoices\" sheet"],
    [],
    ["Column", "Required", "Notes"],
    ["Brand", "No", "Product Brand (e.g. D1). Every item of the invoice must be of this brand. Empty = taken from the items."],
    ["Warehouse", "No", "Warehouse code (e.g. 1001) — one of your warehouses. Empty = the customer's default warehouse."],
    ["Customer Code", "Yes", "SAP customer code. Each Brand + Warehouse + Customer becomes one draft AR Invoice (CK); its rows are that invoice's lines."],
    ["Customer Name", "No", "For your reference only — the name from SAP is used."],
    ["Item Code", "Yes", "A sellable service (non-inventory) item within your brands."],
    ["Invoice Text", "No", "The line's text on the invoice (up to 254 characters)."],
    ["Qty", "Yes", "Not 0. A decrease / discount (CKTM) line is a negative quantity, e.g. -1."],
    ["Unit Price", "Yes*", "0 or more. *May be left empty when Total (excl. VAT) is filled — it is then worked out from the total."],
    ["Disc %", "No", "0–100. Empty = 0."],
    ["VAT", "No", "A VAT group (S08, S10, S00) or a rate (8, 8%). Empty = the item's own VAT group."],
    ["Total (excl. VAT)", "No", "Empty = Qty × Unit Price × (1 − Disc %), calculated by the system. If filled together with Unit Price, both must agree."],
    ["Remarks", "No", "The invoice's remarks (header). Different remarks on rows of one invoice are joined with \" / \"."],
    [],
    ["The imported invoices are saved as Drafts on the portal. Open each one and press Post to SAP; if an approval template applies it waits for the accountant (Adm Confirmed)."],
    [],
    ["Example"],
    [...COLUMNS],
    ["D1", "1001", "C000123", "Customer A", "SERVICE-ITEM", "Chiết khấu thương mại tháng 11", -1, 1500000, 0, "S08", "", "CKTM T11/2026"],
    ["D1", "1001", "C000123", "Customer A", "SERVICE-ITEM", "Hỗ trợ trưng bày", -1, "", 0, "8%", -2200000, "CKTM T11/2026"],
    ["D1", "", "C000456", "Customer B", "SERVICE-ITEM", "Chiết khấu thương mại tháng 11", -1, 2200000, 0, "", "", ""],
  ]);
  help["!cols"] = [{ wch: 18 }, { wch: 10 }, { wch: 100 }];
  XLSX.utils.book_append_sheet(wb, help, "Instructions");
  XLSX.writeFile(wb, "AR_Invoice_Import_Template.xlsx");
}

/** The first sheet with a "Customer Code" header (looked for in the first 15 rows). */
function parseWorkbook(buf: ArrayBuffer): ImportRow[] {
  const wb = XLSX.read(buf, { type: "array" });
  for (const name of wb.SheetNames) {
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: false, defval: "", blankrows: true });
    const hi = aoa.slice(0, 15).findIndex((r) => r.some((c) => HEADER_KEYS[norm(c)] === "cardCode"));
    if (hi < 0) continue;
    const map = new Map<Col, number>();
    aoa[hi].forEach((c, i) => { const k = HEADER_KEYS[norm(c)]; if (k && !map.has(k)) map.set(k, i); });
    if (!map.has("itemCode")) throw new Error(`Sheet "${name}": no "Item Code" column`);
    const at = (r: unknown[], k: Col) => (map.has(k) ? r[map.get(k)!] : "");
    const rows: ImportRow[] = [];
    aoa.slice(hi + 1).forEach((r, i) => {
      if (!r.some((c) => String(c ?? "").trim())) return;
      rows.push({
        row: hi + 2 + i,
        brandCode: text(at(r, "brandCode"))?.toUpperCase() ?? null, warehouseCode: text(at(r, "warehouseCode")), remarks: text(at(r, "remarks")),
        cardCode: String(at(r, "cardCode") ?? "").trim(), cardName: text(at(r, "cardName")),
        itemCode: String(at(r, "itemCode") ?? "").trim(), description: text(at(r, "description")),
        quantity: numOf(at(r, "quantity")), unitPrice: numOf(at(r, "unitPrice")), discountPct: numOf(at(r, "discountPct")),
        vat: text(at(r, "vat")), total: numOf(at(r, "total")),
      });
    });
    if (!rows.length) throw new Error(`Sheet "${name}" has no lines under the header`);
    return rows;
  }
  throw new Error(`No sheet with a "Customer Code" column — use the template (${COLUMNS.join(", ")})`);
}

export function ArImportDialog({ base, onClose, onCreated }: { base: string; onClose: () => void; onCreated: () => void }) {
  const [docDate, setDocDate] = useState(today());
  const [dueDate, setDueDate] = useState(today());
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [check, setCheck] = useState<ImportResult[] | null>(null);
  const [created, setCreated] = useState<ImportResult[] | null>(null);
  const [busy, setBusy] = useState<"" | "check" | "create">("");
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  const call = async (dryRun: boolean): Promise<ImportResult[] | null> => {
    if (!rows) return null;
    setBusy(dryRun ? "check" : "create");
    setError("");
    try {
      const res = await fetch("/api/admin/ar-invoices/import", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ docDate, dueDate, rows, dryRun }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Import failed");
      return j.invoices as ImportResult[];
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
      return null;
    } finally {
      setBusy("");
    }
  };

  // Check (preview) whenever the file or the dates change.
  useEffect(() => {
    if (!rows || created) return;
    let stale = false;
    const t = setTimeout(() => { call(true).then((r) => { if (!stale) setCheck(r); }); }, 300);
    return () => { stale = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, docDate, dueDate]);

  const readFile = async (f: File | undefined) => {
    if (!f) return;
    setError("");
    setCheck(null);
    setCreated(null);
    setOpen(new Set());
    if (!/\.(xlsx|xls|csv)$/i.test(f.name)) { setError("Choose an Excel file (.xlsx, .xls or .csv)"); return; }
    try {
      setFileName(f.name);
      setRows(parseWorkbook(await f.arrayBuffer()));
    } catch (e) {
      setRows(null);
      setError(e instanceof Error ? e.message : "Can't read the file");
    }
  };

  const ready = (check ?? []).filter((r) => r.errors.length === 0);
  const withErrors = (check ?? []).filter((r) => r.errors.length > 0);
  const create = async () => {
    if (!ready.length) return;
    if (!confirm(`Create ${ready.length} draft AR Invoice${ready.length > 1 ? "s" : ""}?${withErrors.length ? `\n\n${withErrors.length} customer${withErrors.length > 1 ? "s" : ""} with errors will be skipped.` : ""}\n\nNothing is sent to SAP until you post each invoice.`)) return;
    const r = await call(false);
    if (r) { setCreated(r); onCreated(); }
  };

  const th: CSSProperties = { ...styles.th, padding: "0.5rem 0.6rem", whiteSpace: "nowrap" };
  const td: CSSProperties = { ...styles.td, padding: "0.45rem 0.6rem", verticalAlign: "top" };
  const right: CSSProperties = { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
  const list = created ?? check;

  return (
    <div role="dialog" aria-modal="true" aria-label="Import Excel" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 900, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "4vh 16px", overflowY: "auto" }}>
      <div style={{ background: "var(--bg-primary, #fff)", borderRadius: 12, width: "min(1100px, 100%)", boxShadow: "0 20px 60px rgba(15,23,42,0.3)", display: "flex", flexDirection: "column", maxHeight: "92vh" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1rem 1.25rem", borderBottom: "1px solid var(--color-gray-200, #E2E8F0)" }}>
          <div>
            <div style={{ fontSize: "1.05rem", fontWeight: 800 }}>Import Excel — AR Invoices (CK)</div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-secondary, #64748B)" }}>One draft AR Invoice per Brand + Warehouse + Customer Code. Drafts are not sent to SAP until you post them.</div>
          </div>
          <button type="button" onClick={onClose} disabled={!!busy} aria-label="Close" style={{ border: "none", background: "none", fontSize: "1.2rem", cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ padding: "1rem 1.25rem", overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.9rem" }}>
          {!created && (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end" }}>
                <button type="button" style={btn("secondary")} onClick={downloadArImportTemplate}>⬇ Download template</button>
                <label style={{ fontSize: "0.75rem", fontWeight: 600 }}>Posting date<br />
                  <input type="date" style={styles.input} value={docDate} onChange={(e) => { setDocDate(e.target.value); if (dueDate < e.target.value) setDueDate(e.target.value); }} />
                </label>
                <label style={{ fontSize: "0.75rem", fontWeight: 600 }}>Due date<br />
                  <input type="date" style={styles.input} value={dueDate} min={docDate} onChange={(e) => setDueDate(e.target.value)} />
                </label>
                <span style={{ fontSize: "0.75rem", color: "var(--text-tertiary, #94A3B8)" }}>Bill-to, ship-to and invoice details (and the warehouse, when the Warehouse column is empty) come from each customer's defaults; open a draft to change them.</span>
              </div>

              <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
                onDrop={(e) => { e.preventDefault(); setDrag(false); readFile(e.dataTransfer.files?.[0]); }}
                onClick={() => fileRef.current?.click()} role="button" tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileRef.current?.click(); }}
                style={{ border: `2px dashed ${drag ? "var(--color-primary, #2BBCB3)" : "var(--color-gray-300, #CBD5E1)"}`, borderRadius: 10, padding: "1.4rem", textAlign: "center", cursor: "pointer",
                  background: drag ? "rgba(43,188,179,0.06)" : "var(--bg-secondary, #F8FAFC)" }}>
                <div style={{ fontSize: "1.6rem" }}>📄</div>
                <div style={{ fontWeight: 700 }}>{fileName ? fileName : "Drag & drop the Excel file here"}</div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-secondary, #64748B)" }}>{fileName ? `${rows?.length ?? 0} lines read — drop another file to replace it` : "or click to choose (.xlsx, .xls, .csv)"}</div>
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }}
                  onChange={(e) => { readFile(e.target.files?.[0]); e.target.value = ""; }} />
              </div>
            </>
          )}

          {error && <div style={{ color: "#B91C1C", background: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: 8, padding: "0.6rem 0.9rem", fontSize: "0.8125rem" }}>{error}</div>}
          {busy === "check" && <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary, #64748B)" }}>Checking…</div>}

          {list && (
            <>
              <div style={{ fontSize: "0.8125rem" }}>
                {created
                  ? <b style={{ color: "#065F46" }}>✅ Created {created.filter((r) => r.id).length} draft AR Invoice{created.filter((r) => r.id).length === 1 ? "" : "s"}{created.some((r) => !r.id) ? ` · ${created.filter((r) => !r.id).length} skipped` : ""}</b>
                  : <><b>{list.length}</b> AR Invoice{list.length === 1 ? "" : "s"} · {list.reduce((t, r) => t + r.rows.length, 0)} lines · <span style={{ color: "#065F46", fontWeight: 700 }}>{ready.length} ready</span>
                    {withErrors.length > 0 && <> · <span style={{ color: "#B91C1C", fontWeight: 700 }}>{withErrors.length} with errors (skipped)</span></>}</>}
              </div>
              <div style={{ overflowX: "auto", border: "1px solid var(--color-gray-200, #E2E8F0)", borderRadius: 8 }}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={th}></th><th style={th}>Customer</th><th style={th}>Brand · Whs</th><th style={{ ...th, ...right }}>Lines</th>
                      <th style={{ ...th, ...right }}>Total (excl. VAT)</th><th style={{ ...th, ...right }}>VAT</th><th style={{ ...th, ...right }}>Total</th><th style={th}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r, i) => {
                      const isOpen = open.has(i);
                      const ok = r.errors.length === 0;
                      return [
                        <tr key={`h${i}`} onClick={() => ok && r.lines.length && setOpen((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; })}
                          style={{ cursor: ok && r.lines.length ? "pointer" : undefined, background: ok ? undefined : "#FEF2F2" }}>
                          <td style={{ ...td, width: 24, color: "var(--text-tertiary, #94A3B8)" }}>{ok && r.lines.length ? (isOpen ? "▾" : "▸") : ""}</td>
                          <td style={td}>
                            <div style={{ fontWeight: 700 }}>{r.cardCode || "—"}</div><div style={{ fontSize: "0.75rem", color: "var(--text-secondary, #64748B)" }}>{r.cardName}</div>
                            {r.comments && <div style={{ fontSize: "0.7rem", color: "var(--text-tertiary, #94A3B8)" }}>📝 {r.comments}</div>}
                          </td>
                          <td style={{ ...td, whiteSpace: "nowrap" }}>{r.brandCode ?? "—"} · {r.warehouseCode ?? "—"}</td>
                          <td style={{ ...td, ...right }}>{r.rows.length}</td>
                          <td style={{ ...td, ...right }}>{ok ? money(r.totalBefore) : "—"}</td>
                          <td style={{ ...td, ...right }}>{ok ? money(r.vatSum) : "—"}</td>
                          <td style={{ ...td, ...right, fontWeight: 700 }}>{ok ? money(r.docTotal) : "—"}</td>
                          <td style={{ ...td, fontSize: "0.75rem" }}>
                            {r.id ? <a href={`${base}/ar-invoices/${r.id}`} onClick={(e) => e.stopPropagation()} style={{ fontWeight: 700 }}>{r.docNumber ?? `#${r.id}`} ↗</a>
                              : ok ? <span style={{ color: "#065F46", fontWeight: 700 }}>{created ? "Not created" : "✓ Ready"}</span>
                              : <ul style={{ margin: 0, paddingLeft: "1rem", color: "#B91C1C" }}>{r.errors.map((m) => <li key={m}>{m}</li>)}</ul>}
                          </td>
                        </tr>,
                        isOpen && (
                          <tr key={`l${i}`}>
                            <td style={td}></td>
                            <td colSpan={7} style={{ ...td, background: "var(--bg-secondary, #F8FAFC)" }}>
                              <table style={{ ...styles.table, fontSize: "0.75rem" }}>
                                <thead><tr>{["Row", "Item", "Invoice text", "Qty", "Unit price", "Disc %", "VAT", "Total (excl. VAT)"].map((h, k) =>
                                  <th key={h} style={{ ...th, ...(k >= 3 && k !== 6 ? right : {}) }}>{h}</th>)}</tr></thead>
                                <tbody>
                                  {r.lines.map((l) => (
                                    <tr key={l.row}>
                                      <td style={td}>{l.row}</td>
                                      <td style={td}><b>{l.itemCode}</b><div style={{ color: "var(--text-secondary, #64748B)" }}>{l.itemName}</div></td>
                                      <td style={{ ...td, maxWidth: 280 }}>{l.description}</td>
                                      <td style={{ ...td, ...right }}>{l.quantity}</td>
                                      <td style={{ ...td, ...right }}>{money(l.unitPrice)}</td>
                                      <td style={{ ...td, ...right }}>{l.discountPct}</td>
                                      <td style={td}>{l.vatGroup}</td>
                                      <td style={{ ...td, ...right, fontWeight: 700 }}>{money(l.lineTotal)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        ),
                      ];
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", padding: "0.85rem 1.25rem", borderTop: "1px solid var(--color-gray-200, #E2E8F0)" }}>
          {created ? (
            <button type="button" style={btn("primary")} onClick={onClose}>Close</button>
          ) : (
            <>
              <button type="button" style={btn("secondary", !!busy)} disabled={!!busy} onClick={onClose}>Cancel</button>
              <button type="button" style={btn("primary", !!busy || ready.length === 0)} disabled={!!busy || ready.length === 0} onClick={create}>
                {busy === "create" ? "Creating…" : `Create ${ready.length || ""} draft AR Invoice${ready.length === 1 ? "" : "s"}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
