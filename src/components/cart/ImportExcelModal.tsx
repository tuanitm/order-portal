"use client";

import { useState, useRef } from "react";
import { useTranslations, useLocale } from "next-intl";
import * as XLSX from "xlsx";
import { useCart, calculateExtraFreeQty, type CartItem, type ExtraGift } from "@/hooks/useCart";
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
    // The program whose free item is the bought item itself starts with the
    // Excel quantity (first such one, in best-match order); none → the best match.
    const sameIdx = giveawayOptions.findIndex((g) => g.giveItemCode === product.sapItemCode);
    const defaultIdx = sameIdx >= 0 ? sameIdx : 0;
    return giveawayOptions.map((g, idx) => ({
      key: `${product.sapItemCode}::give::${g.code ?? g.giveItemCode ?? idx}`,
      product,
      quantity: idx === defaultIdx ? quantity : 0,
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
  extra?: ExtraGift;
} {
  if (line.giveawayOverride) {
    const g = line.giveawayOverride;
    return {
      code: g.code ?? undefined, name: g.name, buyQty: Number(g.buyQty), giveQty: Number(g.giveQty), giveItemCode: g.giveItemCode, giveItemName: g.giveItemName,
      extra: g.extra ? { code: g.extra.code, name: g.extra.name, buyQty: g.extra.buyQty, giveQty: g.extra.giveQty } : undefined,
    };
  }
  const { product } = line;
  const first = product.giveawayOptions?.[0];
  return {
    code: product.giveawayCode, name: first?.name,
    buyQty: product.promoBuyQty, giveQty: product.promoGiveQty,
    giveItemCode: product.promoGiveItemCode, giveItemName: product.promoGiveItemName,
    extra: first?.extra ? { code: first.extra.code, name: first.extra.name, buyQty: first.extra.buyQty, giveQty: first.extra.giveQty } : undefined,
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
  // Program chooser (popup) for items with more than one promotion program:
  // draft quantities per program line; OK copies them into `lines`.
  // `initial` = opened right after the upload (Cancel goes back to upload).
  const [choosing, setChoosing] = useState<{ draft: Record<string, number>; initial: boolean } | null>(null);
  // Program lines kept in the preview after OK (those with qty > 0); null = show all lines.
  const [shownKeys, setShownKeys] = useState<Set<string> | null>(null);
  const [excelQty, setExcelQty] = useState<Record<string, number>>({});
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
    setChoosing(null);
    setShownKeys(null);
    setExcelQty({});
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
      setExcelQty(Object.fromEntries(data.items.map((p) => [p.sapItemCode, byCode.get(p.sapItemCode.toUpperCase())?.quantity ?? 1])));
      setShownKeys(null);
      setStep("preview");
      if (allLines.some(isProgramLine)) openChooser(allLines, true);
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

  const openChooser = (ls: ImportLine[], initial: boolean) => {
    setChoosing({ draft: Object.fromEntries(ls.filter(isProgramLine).map((l) => [l.key, l.quantity])), initial });
  };

  const applyChoice = () => {
    if (!choosing) return;
    const { draft } = choosing;
    const next = lines.map((l) => (l.key in draft ? { ...l, quantity: draft[l.key] } : l));
    setLines(next);
    // The preview shows what was picked: program lines left at 0 are hidden.
    setShownKeys(new Set(next.filter((l) => !(l.key in draft) || l.quantity > 0).map((l) => l.key)));
    setConfirmingReplace(false);
    setChoosing(null);
  };

  const cancelChoice = () => {
    if (choosing?.initial) reset();
    else setChoosing(null);
  };

  const setDraftQty = (key: string, value: number) => {
    const qty = Math.max(0, Math.floor(value) || 0);
    setChoosing((c) => (c ? { ...c, draft: { ...c.draft, [key]: qty } } : c));
  };

  const programLabelOf = (line: ImportLine): string | null =>
    line.promoOverride
      ? `${line.promoOverride.name || line.promoOverride.code || t("product.promotion")} (-${line.promoOverride.pct}%)`
      : line.giveawayOverride
      ? `🎁 ${line.giveawayOverride.name || line.giveawayOverride.code || t("product.promotion")}`
      : null;

  /** Free-item lines of `line` at its quantity (same item / other item). */
  const freeInfo = (line: ImportLine) => {
    const giveaway = effectiveGiveaway(line);
    const extraFree = calculateExtraFreeQty({ quantity: line.quantity, extraGift: giveaway.extra });
    const freeQty = freeQtyFor(line, giveaway);
    return (
      <>
        {extraFree > 0 && (
          <div style={{ fontSize: "0.7rem", color: "var(--color-success, #059669)" }}>
            🎁 {t.rich("cart.freeGiftSame", { qty: extraFree, ...boldRed })}
          </div>
        )}
        {freeQty > 0 && (
          <div style={{ fontSize: "0.7rem", color: "var(--color-success, #059669)" }}>
            🎁{" "}
            {giveaway.giveItemCode === line.product.sapItemCode
              ? t.rich("cart.freeGiftSame", { qty: freeQty, ...boldRed })
              : t.rich("cart.freeGift", { qty: freeQty, item: giveaway.giveItemName || giveaway.giveItemCode || "", ...boldRed })}
          </div>
        )}
      </>
    );
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
      extraGift: giveaway.extra,
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

  const visibleLines = shownKeys ? lines.filter((l) => shownKeys.has(l.key)) : lines;
  const matchedItemCount = new Set(visibleLines.map((l) => l.product.sapItemCode)).size;
  const hasProgramChoice = lines.some(isProgramLine);

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

        {step === "preview" && !choosing?.initial && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem" }}>
              <p style={{ fontWeight: 600 }}>
                {t("import.matchedCount", { count: matchedItemCount })}
              </p>
              {hasProgramChoice && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => openChooser(lines, false)}>
                  🏷 {t("import.changePrograms")}
                </button>
              )}
            </div>

            {visibleLines.length > 0 && (
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
                    {visibleLines.map((line, idx) => {
                      const { product } = line;
                      const isFirstOfGroup = idx === 0 || visibleLines[idx - 1].product.sapItemCode !== product.sapItemCode;
                      const name = (locale === "vi" ? product.itemNameVi : product.itemNameEn) || product.itemNameVi || product.itemNameEn;
                      const promoPct = effectivePromoPct(line);
                      const { displayPrice, discountPercent } = priceForPromoPct(product, promoPct);
                      // Only shown for a line generated by a promo/giveaway
                      // CHOICE (more than one program available) — labels
                      // which specific program this particular line is
                      // priced on, so the customer can tell the rows apart.
                      const programLabel = programLabelOf(line);
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
                            {/* Promotion "case c": the bought item's own free qty first, then the other free item. */}
                            {freeInfo(line)}
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
              {visibleLines.length > 0 && (
                <button className="btn btn-primary" onClick={handleConfirmClick} disabled={!hasAnyQuantity}>
                  {confirmingReplace ? t("import.replaceCartConfirm") : t("import.confirmImport")}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {choosing && (
        <ProgramChooser
          lines={lines}
          draft={choosing.draft}
          excelQty={excelQty}
          locale={locale}
          onQty={setDraftQty}
          programLabelOf={programLabelOf}
          freeInfo={(l) => freeInfo(l)}
          onCancel={cancelChoice}
          onOk={applyChoice}
        />
      )}
    </div>
  );
}

function isProgramLine(l: ImportLine): boolean {
  return !!(l.promoOverride || l.giveawayOverride);
}

/**
 * Popup listing every promotion program of each imported item that has more
 * than one. Each program has its own buy quantity: the same-item free-gift
 * program (or the best match) starts at the Excel quantity, the others at 0;
 * the customer moves quantity between them. OK → the preview shows exactly
 * the programs given a quantity.
 */
function ProgramChooser({ lines, draft, excelQty, locale, onQty, programLabelOf, freeInfo, onCancel, onOk }: {
  lines: ImportLine[];
  draft: Record<string, number>;
  excelQty: Record<string, number>;
  locale: string;
  onQty: (key: string, qty: number) => void;
  programLabelOf: (l: ImportLine) => string | null;
  freeInfo: (l: ImportLine) => React.ReactNode;
  onCancel: () => void;
  onOk: () => void;
}) {
  const t = useTranslations();
  const groups: { code: string; lines: ImportLine[] }[] = [];
  for (const l of lines) {
    if (!(l.key in draft)) continue;
    const g = groups.find((x) => x.code === l.product.sapItemCode);
    if (g) g.lines.push(l);
    else groups.push({ code: l.product.sapItemCode, lines: [l] });
  }
  const cell: React.CSSProperties = { padding: "0.4rem 0.5rem", verticalAlign: "top" };
  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 950, background: "rgba(15, 23, 42, 0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}
      onClick={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("import.chooseTitle")}
        style={{
          width: "min(820px, 100%)", maxHeight: "88vh", display: "flex", flexDirection: "column",
          background: "var(--bg-primary, #fff)", borderRadius: "var(--radius-xl, 12px)", boxShadow: "0 24px 64px rgba(15,23,42,0.35)", overflow: "hidden",
        }}
      >
        <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid var(--color-gray-200, #E2E8F0)" }}>
          <h3 style={{ fontSize: "1.0625rem", fontWeight: 800 }}>{t("import.chooseTitle")}</h3>
          <p style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", marginTop: 4 }}>{t("import.chooseHint", { count: groups.length })}</p>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "0.75rem 1.25rem" }}>
          {groups.map((g) => {
            const p = g.lines[0].product;
            const name = (locale === "vi" ? p.itemNameVi : p.itemNameEn) || p.itemNameVi || p.itemNameEn;
            const chosen = g.lines.reduce((s, l) => s + (draft[l.key] ?? 0), 0);
            const fromExcel = excelQty[g.code] ?? 0;
            return (
              <div key={g.code} style={{ border: "1px solid var(--color-gray-200, #E2E8F0)", borderRadius: 8, padding: "0.625rem 0.75rem", marginBottom: "0.75rem" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", marginBottom: 6 }}>
                  <span style={{ fontFamily: "monospace", fontWeight: 700 }}>{g.code}</span>
                  <span style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>{name}</span>
                  <span style={{ fontSize: "0.8125rem", whiteSpace: "nowrap" }}>
                    {t("import.excelQty")}: <b>{fromExcel}</b> · {t("import.chosenQty")}:{" "}
                    <b style={{ color: chosen === fromExcel ? "var(--color-success, #059669)" : "var(--color-warning-dark, #B45309)" }}>{chosen}</b>
                  </span>
                </div>
                <table style={{ width: "100%", fontSize: "0.8125rem", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--color-gray-200, #E2E8F0)", color: "var(--text-secondary)" }}>
                      <th style={{ ...cell, textAlign: "left" }}>{t("import.program")}</th>
                      <th style={{ ...cell, textAlign: "right" }}>Price</th>
                      <th style={{ ...cell, textAlign: "right" }}>%</th>
                      <th style={{ ...cell, textAlign: "right" }}>{t("import.columnQuantity")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.lines.map((l) => {
                      const qty = draft[l.key] ?? 0;
                      const at = { ...l, quantity: qty };
                      const { displayPrice, discountPercent } = priceForPromoPct(p, effectivePromoPct(l));
                      const give = l.giveawayOverride;
                      return (
                        <tr key={l.key} style={{ borderBottom: "1px solid var(--color-gray-100, #F1F5F9)", background: qty > 0 ? "rgba(43,188,179,0.08)" : undefined }}>
                          <td style={cell}>
                            <div style={{ fontWeight: 600, color: "var(--color-primary, #2563EB)" }}>{programLabelOf(l)}</div>
                            {give && (
                              <div style={{ fontSize: "0.7rem", color: "var(--text-tertiary)" }}>
                                {t("import.buyGet", { buy: Number(give.buyQty), get: Number(give.giveQty) })}{" "}
                                {give.giveItemCode === p.sapItemCode ? t("import.sameItem") : `${give.giveItemCode ?? ""} ${give.giveItemName ?? ""}`}
                              </div>
                            )}
                            {freeInfo(at)}
                          </td>
                          <td style={{ ...cell, textAlign: "right", whiteSpace: "nowrap" }}>{formatPrice(displayPrice)}</td>
                          <td style={{ ...cell, textAlign: "right" }}>{discountPercent ? `-${discountPercent}%` : "—"}</td>
                          <td style={{ ...cell, textAlign: "right" }}>
                            <input
                              type="number"
                              min={0}
                              className="input"
                              style={{ width: "84px", padding: "0.25rem 0.375rem", fontSize: "0.8125rem", textAlign: "right" }}
                              value={qty}
                              onChange={(e) => onQty(l.key, parseInt(e.target.value, 10))}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
        <div style={{ padding: "0.75rem 1.25rem", borderTop: "1px solid var(--color-gray-200, #E2E8F0)", display: "flex", justifyContent: "flex-end", gap: "0.75rem", background: "var(--bg-secondary, #F8FAFC)" }}>
          <button type="button" className="btn btn-secondary" onClick={onCancel}>{t("import.cancel")}</button>
          <button type="button" className="btn btn-primary" onClick={onOk}>OK</button>
        </div>
      </div>
    </div>
  );
}
