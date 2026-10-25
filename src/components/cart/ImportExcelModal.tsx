"use client";

import { useState, useRef } from "react";
import { useTranslations, useLocale } from "next-intl";
import * as XLSX from "xlsx";
import { useCart, type CartItem } from "@/hooks/useCart";
import { IMPORT_TEMPLATE_COLUMNS_EN, IMPORT_TEMPLATE_COLUMNS_VI } from "@/lib/importTemplate";
import type { ProductWithPricing } from "@/types/product";

const MAX_CODES = 500;

function formatPrice(amount: number): string {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(amount) + "₫";
}

// Case-insensitive, trimmed header matching against both locales' template
// headers (see src/lib/importTemplate.ts — single source of truth, so a
// template downloaded in either language is always recognized here too).
const HEADER_ALIASES: Record<"itemCode" | "itemName" | "quantity" | "remark", string[]> = {
  itemCode: [IMPORT_TEMPLATE_COLUMNS_EN[0], IMPORT_TEMPLATE_COLUMNS_VI[0], "sap item code", "item code", "code"].map((s) => s.toLowerCase()),
  itemName: [IMPORT_TEMPLATE_COLUMNS_EN[1], IMPORT_TEMPLATE_COLUMNS_VI[1]].map((s) => s.toLowerCase()),
  quantity: [IMPORT_TEMPLATE_COLUMNS_EN[2], IMPORT_TEMPLATE_COLUMNS_VI[2], "qty"].map((s) => s.toLowerCase()),
  remark: [IMPORT_TEMPLATE_COLUMNS_EN[3], IMPORT_TEMPLATE_COLUMNS_VI[3], "note"].map((s) => s.toLowerCase()),
};

interface ParsedRow {
  code: string;
  quantity: number;
  remark: string;
}
interface InvalidRow {
  rowNumber: number;
  reason: "missingCode" | "invalidQuantity";
}

type PromoOption = NonNullable<ProductWithPricing["promotionOptions"]>[number];
type GiveawayOption = NonNullable<ProductWithPricing["giveawayOptions"]>[number];

/**
 * One editable row in the preview table. The common case is one line per
 * matched item (unchanged from before this feature); an item that
 * currently qualifies for more than one promotion program instead gets one
 * line PER PROGRAM, stacked together under the same item, so the customer
 * sees every option side by side and can freely move quantity between them
 * instead of being locked into the server's own best-match default — see
 * buildLinesForProduct. A single item is only ever split along ONE axis at
 * a time (either its percent-discount choices or its buy-give choices,
 * never the cross-product of both) — the same one-axis-at-a-time rule the
 * storefront's own ProductCard already follows (a <select> for percent
 * promos, separate cards for buy-give pairings).
 */
interface ImportLine {
  key: string;
  product: ProductWithPricing;
  quantity: number;
  remark: string;
  /** Set only on a line generated from product.promotionOptions (more than
   *  one program) — overrides product.promoDiscPct/promotionCode/
   *  promotionTitle for THIS line only. */
  promoOverride?: PromoOption;
  /** Set only on a line generated from product.giveawayOptions (more than
   *  one program) — overrides product.promoBuyQty/promoGiveQty/
   *  promoGiveItemCode/promoGiveItemName/giveawayCode for THIS line only. */
  giveawayOverride?: GiveawayOption;
}

/**
 * Splits one matched product into one or more editable lines. The system's
 * own best-match default (index 0 of whichever list is being split on, per
 * promotionOptions/giveawayOptions' own ordering) starts with the full
 * imported quantity; every other program starts at 0 — the customer
 * redistributes manually from there. An item with 0 or 1 program on both
 * axes is never split: one plain line, same as always.
 */
function buildLinesForProduct(product: ProductWithPricing, quantity: number, remark: string): ImportLine[] {
  const promoOptions = product.promotionOptions ?? [];
  const giveawayOptions = product.giveawayOptions ?? [];

  if (promoOptions.length > 1) {
    return promoOptions.map((opt, idx) => ({
      key: `${product.sapItemCode}::promo::${opt.code ?? opt.name ?? idx}`,
      product,
      quantity: idx === 0 ? quantity : 0,
      remark,
      promoOverride: opt,
    }));
  }
  if (giveawayOptions.length > 1) {
    return giveawayOptions.map((g, idx) => ({
      key: `${product.sapItemCode}::give::${g.code ?? g.giveItemCode ?? idx}`,
      product,
      quantity: idx === 0 ? quantity : 0,
      remark,
      giveawayOverride: g,
    }));
  }
  return [{ key: product.sapItemCode, product, quantity, remark }];
}

/** This line's own percent-discount %, after any promoOverride. */
function effectivePromoPct(line: ImportLine): number {
  return line.promoOverride ? Number(line.promoOverride.pct) : line.product.promoDiscPct;
}

/** This line's own promotion program identity (code/name), after any promoOverride. */
function effectivePromo(line: ImportLine): { code?: string; name?: string } {
  if (line.promoOverride) return { code: line.promoOverride.code ?? undefined, name: line.promoOverride.name ?? undefined };
  return { code: line.product.promotionCode, name: line.product.promotionTitle };
}

/** This line's own buy-give program, after any giveawayOverride — used to
 *  both price the line and recompute its free quantity live as the
 *  customer edits the ordered quantity. */
function effectiveGiveaway(line: ImportLine): {
  code?: string; name?: string | null; buyQty?: number; giveQty?: number; giveItemCode?: string | null; giveItemName?: string | null;
} {
  if (line.giveawayOverride) {
    const g = line.giveawayOverride;
    return { code: g.code ?? undefined, name: g.name, buyQty: Number(g.buyQty), giveQty: Number(g.giveQty), giveItemCode: g.giveItemCode, giveItemName: g.giveItemName };
  }
  const { product } = line;
  return {
    code: product.giveawayCode, name: product.giveawayOptions?.[0]?.name,
    buyQty: product.promoBuyQty, giveQty: product.promoGiveQty,
    giveItemCode: product.promoGiveItemCode, giveItemName: product.promoGiveItemName,
  };
}

/** product.basePrice is already net of Period Discount — Contract and a
 *  specific Promotion Discount % are each independently a % of THIS price,
 *  so their percentages simply add. Same formula as ProductCard's own live
 *  recompute, duplicated here for a line's own chosen promotion %. */
function priceForPromoPct(product: ProductWithPricing, promoPct: number): { displayPrice: number; discountPercent: number } {
  const combinedDiscPct = product.contractDiscPct + promoPct;
  const displayPrice = Math.max(0, product.basePrice * (1 - combinedDiscPct / 100));
  const discountPercent = displayPrice < product.basePrice ? Math.round(combinedDiscPct) : 0;
  return { displayPrice, discountPercent };
}

/** Free quantity THIS line currently earns at its own (editable) quantity —
 *  e.g. buy 2 get 1 at quantity 20 gives floor(20/2)*1 = 10, and updates
 *  live as the customer edits the quantity field. Same idea as useCart's
 *  calculateFreeQty, computed ahead of time here (before the line is even
 *  a cart item) for the preview table. */
function freeQtyFor(line: ImportLine, giveaway: ReturnType<typeof effectiveGiveaway>): number {
  if (!giveaway.buyQty || !giveaway.giveQty) return 0;
  return Math.floor(line.quantity / giveaway.buyQty) * giveaway.giveQty;
}

type Step = "upload" | "preview";

export default function ImportExcelModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const t = useTranslations();
  const locale = useLocale();
  // The free quantity itself (wrapped in <b> inside the translation
  // string) is rendered bold + red so it stands out from the surrounding
  // "free gift" sentence.
  const boldRed = { b: (chunks: React.ReactNode) => <strong style={{ color: "var(--color-error, #DC2626)" }}>{chunks}</strong> };
  const { items: cartItems, addItem, clearCart, openCart } = useCart();

  const [step, setStep] = useState<Step>("upload");
  const [isBusy, setIsBusy] = useState(false);
  const [parseError, setParseError] = useState("");
  const [lines, setLines] = useState<ImportLine[]>([]);
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [notVisible, setNotVisible] = useState<string[]>([]);
  const [invalidRows, setInvalidRows] = useState<InvalidRow[]>([]);
  const [confirmingReplace, setConfirmingReplace] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const reset = () => {
    setStep("upload");
    setParseError("");
    setLines([]);
    setUnavailable([]);
    setNotVisible([]);
    setInvalidRows([]);
    setConfirmingReplace(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const findColumnIndex = (headerRow: unknown[], key: keyof typeof HEADER_ALIASES): number => {
    return headerRow.findIndex(
      (cell) => typeof cell === "string" && HEADER_ALIASES[key].includes(cell.trim().toLowerCase())
    );
  };

  const handleFile = async (file: File) => {
    setIsBusy(true);
    setParseError("");
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      if (rows.length === 0) throw new Error("empty");

      const headerRow = rows[0];
      const codeIdx = findColumnIndex(headerRow, "itemCode");
      const qtyIdx = findColumnIndex(headerRow, "quantity");
      const remarkIdx = findColumnIndex(headerRow, "remark");
      if (codeIdx === -1 || qtyIdx === -1) {
        setParseError(t("import.parseError"));
        setIsBusy(false);
        return;
      }

      const byCode = new Map<string, ParsedRow>();
      const invalid: InvalidRow[] = [];
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.every((c) => c === undefined || c === null || c === "")) continue; // skip blank rows
        const rawCode = row[codeIdx];
        const code = typeof rawCode === "string" ? rawCode.trim() : rawCode != null ? String(rawCode).trim() : "";
        const rawQty = row[qtyIdx];
        const quantity = typeof rawQty === "number" ? rawQty : parseFloat(String(rawQty ?? "").trim());

        if (!code) {
          invalid.push({ rowNumber: i + 1, reason: "missingCode" });
          continue;
        }
        if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isInteger(quantity)) {
          invalid.push({ rowNumber: i + 1, reason: "invalidQuantity" });
          continue;
        }

        const remarkCell = remarkIdx !== -1 ? row[remarkIdx] : undefined;
        const remark = remarkCell != null ? String(remarkCell).trim() : "";

        // Keyed by the UPPERCASED code so the same item typed in a
        // different case across rows (e.g. "d11123501" and "D11123501")
        // still sums into one entry instead of silently splitting into two
        // — the stored `code` keeps whichever casing was typed first,
        // which is only used to query the batch lookup below.
        const key = code.toUpperCase();
        const existing = byCode.get(key);
        if (existing) {
          existing.quantity += quantity;
          if (remark && existing.remark && existing.remark !== remark) {
            existing.remark = `${existing.remark}; ${remark}`;
          } else if (remark && !existing.remark) {
            existing.remark = remark;
          }
        } else {
          byCode.set(key, { code, quantity, remark });
        }
      }
      setInvalidRows(invalid);

      const codes = [...byCode.values()].map((r) => r.code);
      if (codes.length === 0) {
        setLines([]);
        setUnavailable([]);
        setStep("preview");
        setIsBusy(false);
        return;
      }
      if (codes.length > MAX_CODES) {
        setParseError(t("import.tooManyCodes", { count: codes.length, max: MAX_CODES }));
        setIsBusy(false);
        return;
      }

      const res = await fetch("/api/products/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codes }),
      });
      if (!res.ok) throw new Error("lookup failed");
      const data: { items: ProductWithPricing[]; notFound: string[]; notVisible: string[] } = await res.json();

      const allLines: ImportLine[] = [];
      for (const product of data.items) {
        const parsed = byCode.get(product.sapItemCode.toUpperCase());
        allLines.push(...buildLinesForProduct(product, parsed?.quantity ?? 1, parsed?.remark || ""));
      }

      setLines(allLines);
      setUnavailable(data.notFound ?? []);
      setNotVisible(data.notVisible ?? []);
      setStep("preview");
    } catch {
      setParseError(t("import.parseError"));
    } finally {
      setIsBusy(false);
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const updateLineQuantity = (key: string, value: number) => {
    const qty = Math.max(0, Math.floor(value) || 0);
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, quantity: qty } : l)));
  };

  const buildCartItem = (line: ImportLine): CartItem => {
    const { product } = line;
    const name = (locale === "vi" ? product.itemNameVi : product.itemNameEn) || product.itemNameVi || product.itemNameEn || product.sapItemCode;
    const promoPct = effectivePromoPct(line);
    const promo = effectivePromo(line);
    const giveaway = effectiveGiveaway(line);
    const { displayPrice, discountPercent } = priceForPromoPct(product, promoPct);
    return {
      sapItemCode: product.sapItemCode,
      itemName: name,
      unitPrice: displayPrice,
      originalPrice: product.basePrice,
      quantity: line.quantity,
      uom: product.uom || "PCS",
      imageUrl: product.imageUrl,
      discountPercent,
      promoBuyQty: giveaway.buyQty,
      promoGiveQty: giveaway.giveQty,
      promoGiveItemCode: giveaway.giveItemCode ?? undefined,
      promoGiveItemName: giveaway.giveItemName ?? undefined,
      remark: line.remark || undefined,
      periodDiscPct: product.periodDiscPct,
      contractDiscPct: product.contractDiscPct,
      promoDiscPct: promoPct,
      promotionCode: promo.code,
      promotionName: promo.name,
      giveawayCode: giveaway.code,
      giveawayName: giveaway.name ?? undefined,
      brandCode: product.brandCode,
      brandName: product.brandName,
    };
  };

  const doImport = () => {
    if (cartItems.length > 0) clearCart();
    for (const line of lines) {
      if (line.quantity <= 0) continue; // an alternative-program line left at 0 contributes nothing
      addItem(buildCartItem(line));
    }
    openCart();
    handleClose();
  };

  const hasAnyQuantity = lines.some((l) => l.quantity > 0);

  const handleConfirmClick = () => {
    if (!hasAnyQuantity) return;
    if (cartItems.length > 0 && !confirmingReplace) {
      setConfirmingReplace(true);
      return;
    }
    doImport();
  };

  const matchedItemCount = new Set(lines.map((l) => l.product.sapItemCode)).size;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 900,
        background: "rgba(15, 23, 42, 0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem",
      }}
      onClick={handleClose}
    >
      <div
        role="dialog"
        aria-label={t("import.modalTitle")}
        style={{
          zIndex: 901,
          background: "var(--bg-primary, #fff)", borderRadius: "var(--radius-xl, 12px)",
          maxWidth: "720px", width: "100%", maxHeight: "85vh", overflowY: "auto",
          padding: "1.5rem",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 700 }}>{t("import.modalTitle")}</h2>
          <button onClick={handleClose} className="btn-icon" aria-label={t("common.close")} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.25rem" }}>
            ✕
          </button>
        </div>

        {step === "upload" && (
          <div>
            <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", marginBottom: "1rem" }}>
              {t("import.uploadLabel")}
            </p>
            <a
              href={`/api/products/template?locale=${locale}`}
              className="btn btn-secondary btn-sm"
              style={{ display: "inline-block", marginBottom: "1rem", textDecoration: "none" }}
            >
              📥 {t("import.downloadTemplate")}
            </a>
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={onFileChange}
                disabled={isBusy}
                id="import-excel-file-input"
              />
            </div>
            {isBusy && <p style={{ marginTop: "1rem", color: "var(--text-tertiary)" }}>{t("import.parsing")}</p>}
            {parseError && <p style={{ marginTop: "1rem", color: "var(--color-error, #DC2626)" }}>{parseError}</p>}
          </div>
        )}

        {step === "preview" && (
          <div>
            <p style={{ fontWeight: 600, marginBottom: "0.75rem" }}>
              {t("import.matchedCount", { count: matchedItemCount })}
            </p>

            {lines.length > 0 && (
              <div style={{ overflowX: "auto", marginBottom: "1rem" }}>
                <table style={{ width: "100%", fontSize: "0.8125rem", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid var(--color-gray-200, #E2E8F0)" }}>
                      <th style={{ textAlign: "left", padding: "0.5rem" }}>{t("import.columnItemCode")}</th>
                      <th style={{ textAlign: "left", padding: "0.5rem" }}>{t("import.columnItemName")}</th>
                      <th style={{ textAlign: "right", padding: "0.5rem" }}>{t("import.columnQuantity")}</th>
                      <th style={{ textAlign: "right", padding: "0.5rem" }}>Price</th>
                      <th style={{ textAlign: "right", padding: "0.5rem" }}>%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line, idx) => {
                      const { product } = line;
                      const isFirstOfGroup = idx === 0 || lines[idx - 1].product.sapItemCode !== product.sapItemCode;
                      const name = (locale === "vi" ? product.itemNameVi : product.itemNameEn) || product.itemNameVi || product.itemNameEn;
                      const promoPct = effectivePromoPct(line);
                      const giveaway = effectiveGiveaway(line);
                      const { displayPrice, discountPercent } = priceForPromoPct(product, promoPct);
                      const freeQty = freeQtyFor(line, giveaway);
                      // Only shown for a line generated by a promo/giveaway
                      // CHOICE (more than one program available) — labels
                      // which specific program this particular line is
                      // priced on, so the customer can tell the rows apart.
                      const programLabel = line.promoOverride
                        ? `${line.promoOverride.name || line.promoOverride.code || t("product.promotion")} (-${line.promoOverride.pct}%)`
                        : line.giveawayOverride
                        ? `🎁 ${line.giveawayOverride.name || line.giveawayOverride.code || t("product.promotion")}`
                        : null;
                      return (
                        <tr key={line.key} style={{ borderBottom: "1px solid var(--color-gray-100, #F1F5F9)" }}>
                          <td style={{ padding: "0.5rem", fontFamily: "monospace", fontSize: "0.75rem", color: isFirstOfGroup ? undefined : "var(--text-tertiary)" }}>
                            {isFirstOfGroup ? product.sapItemCode : "↳"}
                          </td>
                          <td style={{ padding: "0.5rem" }}>
                            {isFirstOfGroup && name}
                            {programLabel && (
                              <div style={{ fontSize: "0.7rem", color: "var(--color-primary, #2563EB)", fontWeight: 600 }}>{programLabel}</div>
                            )}
                            {isFirstOfGroup && line.remark && (
                              <div style={{ fontSize: "0.7rem", color: "var(--text-tertiary)" }}>📝 {line.remark}</div>
                            )}
                            {freeQty > 0 && (
                              <div style={{ fontSize: "0.7rem", color: "var(--color-success, #059669)" }}>
                                🎁{" "}
                                {giveaway.giveItemCode === product.sapItemCode
                                  ? t.rich("cart.freeGiftSame", { qty: freeQty, ...boldRed })
                                  : t.rich("cart.freeGift", { qty: freeQty, item: giveaway.giveItemName || giveaway.giveItemCode || "", ...boldRed })}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: "0.5rem", textAlign: "right" }}>
                            <input
                              type="number"
                              min={0}
                              className="input"
                              style={{ width: "76px", padding: "0.25rem 0.375rem", fontSize: "0.8125rem", textAlign: "right" }}
                              value={line.quantity}
                              onChange={(e) => updateLineQuantity(line.key, parseInt(e.target.value, 10))}
                            />
                          </td>
                          <td style={{ padding: "0.5rem", textAlign: "right" }}>{formatPrice(displayPrice)}</td>
                          <td style={{ padding: "0.5rem", textAlign: "right" }}>
                            {discountPercent ? `-${discountPercent}%` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Not visible — exists in system but blocked by catalog visibility */}
            {notVisible.length > 0 && (
              <div style={{ marginBottom: "1rem", padding: "0.75rem", background: "#FFF7ED", borderRadius: "var(--radius-md)", border: "1px solid #FED7AA" }}>
                <p style={{ fontWeight: 600, fontSize: "0.8125rem", color: "#9A3412", marginBottom: "0.25rem" }}>
                  ⚠️ {notVisible.length} item{notVisible.length > 1 ? "s" : ""} not available for your account
                </p>
                <p style={{ fontSize: "0.75rem", color: "#9A3412", marginBottom: "0.375rem" }}>
                  These items exist in the system but are not included in your catalog visibility. Please contact your sales representative.
                </p>
                <p style={{ fontSize: "0.75rem", fontFamily: "monospace", color: "#9A3412", wordBreak: "break-all" }}>{notVisible.join(", ")}</p>
              </div>
            )}

            {/* Not found — code not in system at all */}
            {unavailable.length > 0 && (
              <div style={{ marginBottom: "1rem", padding: "0.75rem", background: "#FEF2F2", borderRadius: "var(--radius-md)" }}>
                <p style={{ fontWeight: 600, fontSize: "0.8125rem", color: "#991B1B" }}>
                  {t("import.unavailableTitle", { count: unavailable.length })}
                </p>
                <p style={{ fontSize: "0.75rem", color: "#991B1B", marginBottom: "0.375rem" }}>{t("import.unavailableHint")}</p>
                <p style={{ fontSize: "0.75rem", fontFamily: "monospace", color: "#991B1B" }}>{unavailable.join(", ")}</p>
              </div>
            )}

            {invalidRows.length > 0 && (
              <div style={{ marginBottom: "1rem", padding: "0.75rem", background: "#FFFBEB", borderRadius: "var(--radius-md)" }}>
                <p style={{ fontWeight: 600, fontSize: "0.8125rem", color: "#92400E" }}>
                  {t("import.invalidTitle", { count: invalidRows.length })}
                </p>
                <ul style={{ fontSize: "0.75rem", color: "#92400E", paddingLeft: "1.25rem" }}>
                  {invalidRows.map((r, idx) => (
                    <li key={idx}>
                      {t("common.row", { n: r.rowNumber })}: {r.reason === "missingCode" ? t("import.invalidMissingCode") : t("import.invalidQuantity")}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {confirmingReplace && (
              <div style={{ marginBottom: "1rem", padding: "0.75rem", background: "#FFFBEB", borderRadius: "var(--radius-md)", fontSize: "0.8125rem", color: "#92400E" }}>
                {t("import.replaceCartWarning", { count: cartItems.length })}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem" }}>
              <button className="btn btn-secondary" onClick={() => { setConfirmingReplace(false); reset(); }}>
                {t("import.cancel")}
              </button>
              {lines.length > 0 && (
                <button className="btn btn-primary" onClick={handleConfirmClick} disabled={!hasAnyQuantity}>
                  {confirmingReplace ? t("import.replaceCartConfirm") : t("import.confirmImport")}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
