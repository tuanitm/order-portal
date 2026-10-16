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
interface MatchedRow {
  product: ProductWithPricing;
  quantity: number;
  remark: string;
}

type Step = "upload" | "preview";

export default function ImportExcelModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const t = useTranslations();
  const locale = useLocale();
  const { items: cartItems, addItem, clearCart, openCart } = useCart();

  const [step, setStep] = useState<Step>("upload");
  const [isBusy, setIsBusy] = useState(false);
  const [parseError, setParseError] = useState("");
  const [matched, setMatched] = useState<MatchedRow[]>([]);
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [invalidRows, setInvalidRows] = useState<InvalidRow[]>([]);
  const [confirmingReplace, setConfirmingReplace] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const reset = () => {
    setStep("upload");
    setParseError("");
    setMatched([]);
    setUnavailable([]);
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

        const existing = byCode.get(code);
        if (existing) {
          existing.quantity += quantity;
          if (remark && existing.remark && existing.remark !== remark) {
            existing.remark = `${existing.remark}; ${remark}`;
          } else if (remark && !existing.remark) {
            existing.remark = remark;
          }
        } else {
          byCode.set(code, { code, quantity, remark });
        }
      }
      setInvalidRows(invalid);

      const codes = [...byCode.keys()];
      if (codes.length === 0) {
        setMatched([]);
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
      const data: { items: ProductWithPricing[]; notFound: string[] } = await res.json();

      const matchedRows: MatchedRow[] = data.items.map((product) => {
        const parsed = byCode.get(product.sapItemCode) ?? [...byCode.values()].find(
          (r) => r.code.toUpperCase() === product.sapItemCode.toUpperCase()
        );
        return { product, quantity: parsed?.quantity ?? 1, remark: parsed?.remark || "" };
      });

      setMatched(matchedRows);
      setUnavailable(data.notFound);
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

  const doImport = () => {
    if (cartItems.length > 0) clearCart();
    for (const row of matched) {
      const product = row.product;
      const name = (locale === "vi" ? product.itemNameVi : product.itemNameEn) || product.itemNameVi || product.itemNameEn || product.sapItemCode;
      const cartItem: CartItem = {
        sapItemCode: product.sapItemCode,
        itemName: name,
        unitPrice: product.displayPrice,
        originalPrice: product.basePrice,
        quantity: row.quantity,
        uom: product.uom || "PCS",
        imageUrl: product.imageUrl,
        discountPercent: product.discountPercent ?? 0,
        promoBuyQty: product.promoBuyQty,
        promoGiveQty: product.promoGiveQty,
        promoGiveItemCode: product.promoGiveItemCode,
        promoGiveItemName: product.promoGiveItemName,
        remark: row.remark || undefined,
        periodDiscPct: product.periodDiscPct,
        contractDiscPct: product.contractDiscPct,
        promoDiscPct: product.promoDiscPct,
        promotionCode: product.promotionCode,
        promotionName: product.promotionTitle,
        giveawayCode: product.giveawayCode,
        giveawayName: product.giveawayOptions?.[0]?.name ?? undefined,
        brandCode: product.brandCode,
        brandName: product.brandName,
      };
      addItem(cartItem);
    }
    openCart();
    handleClose();
  };

  const handleConfirmClick = () => {
    if (cartItems.length > 0 && !confirmingReplace) {
      setConfirmingReplace(true);
      return;
    }
    doImport();
  };

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
              {t("import.matchedCount", { count: matched.length })}
            </p>

            {matched.length > 0 && (
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
                    {matched.map((row) => {
                      const product = row.product;
                      const name = (locale === "vi" ? product.itemNameVi : product.itemNameEn) || product.itemNameVi || product.itemNameEn;
                      return (
                        <tr key={product.sapItemCode} style={{ borderBottom: "1px solid var(--color-gray-100, #F1F5F9)" }}>
                          <td style={{ padding: "0.5rem", fontFamily: "monospace", fontSize: "0.75rem" }}>{product.sapItemCode}</td>
                          <td style={{ padding: "0.5rem" }}>
                            {name}
                            {row.remark && (
                              <div style={{ fontSize: "0.7rem", color: "var(--text-tertiary)" }}>📝 {row.remark}</div>
                            )}
                            {product.hasBuyGivePromo && (
                              <div style={{ fontSize: "0.7rem", color: "var(--color-success, #059669)" }}>
                                🎁{" "}
                                {product.promoGiveItemCode === product.sapItemCode
                                  ? t("product.buyGetSamePromo", { buyQty: product.promoBuyQty ?? 1, giveQty: product.promoGiveQty ?? 1 })
                                  : t("product.buyGetPromo", {
                                      buyQty: product.promoBuyQty ?? 1,
                                      giveQty: product.promoGiveQty ?? 1,
                                      giveItem: product.promoGiveItemName || product.promoGiveItemCode || "",
                                    })}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: "0.5rem", textAlign: "right" }}>{row.quantity}</td>
                          <td style={{ padding: "0.5rem", textAlign: "right" }}>{formatPrice(product.displayPrice)}</td>
                          <td style={{ padding: "0.5rem", textAlign: "right" }}>
                            {product.discountPercent ? `-${product.discountPercent}%` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

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
              {matched.length > 0 && (
                <button className="btn btn-primary" onClick={handleConfirmClick}>
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
