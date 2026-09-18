"use client";

import { useState, useEffect, useCallback } from "react";
import { styles, btn, Badge, SyncButton, LoadingOrEmpty } from "../adminUi";

interface Agreement {
  id: number;
  doc_entry: number;
  doc_num: number;
  line_id: number;
  status: string | null;
  canceled: string | null;
  u_type_name_cust: string | null;
  u_code_cust: string | null;
  u_name_cust: string | null;
  u_valid_from: string | null;
  u_valid_to: string | null;
  u_type_name_item: string | null;
  u_code_item: string | null;
  u_name_item: string | null;
  u_base_disc_pct: string | null;
}

interface Discount {
  sap_item_code: string;
  item_name_vi: string | null;
  special_price: string;
  discount_percent: string | null;
  valid_from: string | null;
  valid_to: string | null;
  last_synced: string;
}

function formatPrice(v: string) {
  return new Intl.NumberFormat("vi-VN").format(Number(v)) + "₫";
}

export default function ContractDiscountsPage() {
  // ── Agreements (SAP CBD — the negotiated contracts) ──
  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [agreementsTotal, setAgreementsTotal] = useState(0);
  const [custCodeFilter, setCustCodeFilter] = useState("");
  const [validDate, setValidDate] = useState("");
  const [isLoadingAgreements, setIsLoadingAgreements] = useState(true);

  const loadAgreements = useCallback(async (filter: string, date: string) => {
    setIsLoadingAgreements(true);
    const params = new URLSearchParams({ limit: "100" });
    if (filter) params.set("custCode", filter);
    if (date) params.set("validDate", date);
    const res = await fetch(`/api/admin/contract-discounts/agreements?${params}`);
    const data = await res.json();
    setAgreements(data.agreements || []);
    setAgreementsTotal(data.total || 0);
    setIsLoadingAgreements(false);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => loadAgreements(custCodeFilter, validDate), 250);
    return () => clearTimeout(timer);
  }, [custCodeFilter, validDate, loadAgreements]);

  // ── Resolved SpecialPrices (per-customer lookup) ──
  const [cardCode, setCardCode] = useState("");
  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [isLoadingDiscounts, setIsLoadingDiscounts] = useState(false);
  const [searched, setSearched] = useState(false);

  const search = async () => {
    if (!cardCode.trim()) return;
    setIsLoadingDiscounts(true);
    setSearched(true);
    const res = await fetch(`/api/admin/contract-discounts?cardCode=${encodeURIComponent(cardCode.trim())}`);
    const data = await res.json();
    setDiscounts(data.discounts || []);
    setIsLoadingDiscounts(false);
  };

  const syncThisCard = async () => {
    if (!cardCode.trim()) return;
    setIsLoadingDiscounts(true);
    await fetch(`/api/admin/contract-discounts/sync/${encodeURIComponent(cardCode.trim())}`, { method: "POST" });
    await search();
  };

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>Contract Discounts</h1>
            <p style={styles.subtitle}>
              SAP CBD agreements — a customer (specific or a customer-group level 1-3) gets a discount % on items
              (specific or an item-category level 1-6). These are the negotiated contracts SAP resolves down into
              the concrete SpecialPrices below.
            </p>
          </div>
          <SyncButton
            url="/api/admin/contract-discounts/agreements/sync"
            label="Sync agreements from SAP"
            onDone={() => loadAgreements(custCodeFilter, validDate)}
          />
        </div>

        <div style={{ marginBottom: "1rem", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
          <input
            style={{ ...styles.input, width: "100%", maxWidth: "320px" }}
            placeholder="Filter by customer code (CardCode or group code)..."
            value={custCodeFilter}
            onChange={(e) => setCustCodeFilter(e.target.value)}
          />
          <label style={{ display: "flex", alignItems: "center", gap: "0.375rem", fontSize: "0.8125rem", color: "var(--text-secondary, #64748B)" }}>
            Valid date
            <input type="date" style={styles.input} value={validDate} onChange={(e) => setValidDate(e.target.value)} />
          </label>
        </div>

        <div style={{ ...styles.card, marginBottom: "2rem" }}>
          <LoadingOrEmpty
            isLoading={isLoadingAgreements}
            isEmpty={!isLoadingAgreements && agreements.length === 0}
            emptyLabel="No agreements synced yet"
          />
          {!isLoadingAgreements && agreements.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Doc #</th>
                    <th style={styles.th}>Customer Target</th>
                    <th style={styles.th}>Item Target</th>
                    <th style={styles.th}>Discount %</th>
                    <th style={styles.th}>Valid</th>
                    <th style={styles.th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {agreements.map((a) => (
                    <tr key={a.id}>
                      <td style={{ ...styles.td, fontFamily: "monospace" }}>{a.doc_num}</td>
                      <td style={styles.td}>
                        <span style={{ fontSize: "0.6875rem", color: "var(--text-tertiary, #94A3B8)" }}>{a.u_type_name_cust}</span>
                        <br />
                        <span style={{ fontFamily: "monospace" }}>{a.u_code_cust}</span> {a.u_name_cust ? `— ${a.u_name_cust}` : ""}
                      </td>
                      <td style={styles.td}>
                        <span style={{ fontSize: "0.6875rem", color: "var(--text-tertiary, #94A3B8)" }}>{a.u_type_name_item}</span>
                        <br />
                        <span style={{ fontFamily: "monospace" }}>{a.u_code_item}</span> {a.u_name_item ? `— ${a.u_name_item}` : ""}
                      </td>
                      <td style={styles.td}>{a.u_base_disc_pct ? `${a.u_base_disc_pct}%` : "—"}</td>
                      <td style={{ ...styles.td, fontSize: "0.75rem", color: "var(--text-tertiary, #94A3B8)" }}>
                        {a.u_valid_from?.slice(0, 10) || "…"} → {a.u_valid_to?.slice(0, 10) || "…"}
                      </td>
                      <td style={styles.td}>
                        <Badge
                          label={a.canceled === "Y" ? "Canceled" : a.status === "O" ? "Open" : a.status || "—"}
                          tone={a.canceled === "Y" ? "error" : a.status === "O" ? "success" : "neutral"}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Resolved per-customer SpecialPrices lookup */}
        <h2 style={{ fontSize: "1.125rem", fontWeight: 700, marginBottom: "0.5rem" }}>Resolved Prices (SpecialPrices)</h2>
        <p style={{ fontSize: "0.8125rem", color: "var(--text-tertiary, #94A3B8)", marginBottom: "1rem" }}>
          The concrete per-item prices SAP computes from the agreements above — what the pricing engine actually uses.
        </p>
        <div style={{ ...styles.cardPadded, marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <input
              style={{ ...styles.input, flex: 1, maxWidth: "320px" }}
              placeholder="SAP card code (e.g. GTCA0135)"
              value={cardCode}
              onChange={(e) => setCardCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search()}
            />
            <button onClick={search} style={btn("secondary")}>Search</button>
            <button onClick={syncThisCard} style={btn("primary")}>Sync this customer</button>
          </div>
        </div>

        {searched && (
          <div style={styles.card}>
            <LoadingOrEmpty isLoading={isLoadingDiscounts} isEmpty={!isLoadingDiscounts && discounts.length === 0} emptyLabel="No resolved prices for this customer" />
            {!isLoadingDiscounts && discounts.length > 0 && (
              <div style={{ overflowX: "auto" }}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Item Code</th>
                      <th style={styles.th}>Name</th>
                      <th style={styles.th}>Special Price</th>
                      <th style={styles.th}>Discount %</th>
                      <th style={styles.th}>Valid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {discounts.map((d) => (
                      <tr key={d.sap_item_code}>
                        <td style={{ ...styles.td, fontFamily: "monospace", fontSize: "0.75rem" }}>{d.sap_item_code}</td>
                        <td style={styles.td}>{d.item_name_vi || "—"}</td>
                        <td style={styles.td}>{formatPrice(d.special_price)}</td>
                        <td style={styles.td}>{d.discount_percent ? `${d.discount_percent}%` : "—"}</td>
                        <td style={{ ...styles.td, fontSize: "0.75rem", color: "var(--text-tertiary, #94A3B8)" }}>
                          {d.valid_from || "…"} → {d.valid_to || "…"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
