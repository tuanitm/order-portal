"use client";

import { useState, useEffect, useCallback } from "react";
import { styles, btn, SyncButton, Toggle, LoadingOrEmpty } from "../adminUi";

interface PriceList {
  price_list_num: number;
  list_name: string;
  is_base: number;
  is_channel: number;
  last_synced: string | null;
}

interface PriceListItem {
  sap_item_code: string;
  item_name_vi: string | null;
  item_name_en: string | null;
  uom: string | null;
  category: string | null;
  base_price_list_num: number | null;
  base_price_list_name: string | null;
  base_price: string | null;
  factor: string | null;
  price: string;
  last_synced: string | null;
}

interface PeriodDiscountRow {
  sap_item_code: string;
  item_name_vi: string | null;
  item_name_en: string | null;
  uom: string | null;
  base_price: string | null;
  discount_percent: string | null;
  special_price: string;
  date_from: string | null;
  date_to: string | null;
  last_synced: string | null;
}

interface SpecialDiscountRow {
  sap_card_code: string;
  card_name: string | null;
  sap_item_code: string;
  item_name_vi: string | null;
  item_name_en: string | null;
  special_price: string;
  discount_percent: string | null;
  valid_from: string | null;
  valid_to: string | null;
  last_synced: string | null;
}

function formatPrice(v: string | null) {
  if (v === null) return "—";
  return new Intl.NumberFormat("vi-VN").format(Number(v)) + "₫";
}

export default function PriceListsPage() {
  const [lists, setLists] = useState<PriceList[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [savingNum, setSavingNum] = useState<number | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    const res = await fetch("/api/admin/price-lists");
    const data = await res.json();
    setLists(data.priceLists || []);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const update = async (num: number, body: { isBase?: boolean; isChannel?: boolean }) => {
    setSavingNum(num);
    await fetch(`/api/admin/price-lists/${num}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    await load();
    setSavingNum(null);
  };

  const activeLists = lists.filter((l) => l.is_base || l.is_channel);

  // Default view shows only active (Base/Channel) lists; this toggle reveals
  // every synced list so an admin can activate a new one when needed.
  const [showAllLists, setShowAllLists] = useState(false);
  const managedLists = showAllLists ? lists : activeLists;

  // ── Detail tab (item-level pricing for the selected active list) ──
  const [activeTab, setActiveTab] = useState<number | null>(null);
  const [items, setItems] = useState<PriceListItem[]>([]);
  const [itemsTotal, setItemsTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [isLoadingItems, setIsLoadingItems] = useState(false);

  useEffect(() => {
    if (activeTab === null && activeLists.length > 0) {
      setActiveTab(activeLists[0].price_list_num);
    }
    if (activeTab !== null && !activeLists.some((l) => l.price_list_num === activeTab)) {
      setActiveTab(activeLists[0]?.price_list_num ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lists]);

  const loadItems = useCallback(async (num: number, q: string) => {
    setIsLoadingItems(true);
    const params = new URLSearchParams({ limit: "50" });
    if (q) params.set("search", q);
    const res = await fetch(`/api/admin/price-lists/${num}?${params}`);
    const data = await res.json();
    setItems(data.items || []);
    setItemsTotal(data.total || 0);
    setIsLoadingItems(false);
  }, []);

  useEffect(() => {
    if (activeTab === null) return;
    const timer = setTimeout(() => loadItems(activeTab, search), 250);
    return () => clearTimeout(timer);
  }, [activeTab, search, loadItems]);

  // ── Period Discounts (SAP SpecialPrices scoped to this whole price list,
  // CardCode = '*NN') and Special Discounts (SAP SpecialPrices for every
  // customer currently on this list — "channel customers"), both for the
  // selected tab's price list. Sync/admin-visibility only for now — not yet
  // part of the live storefront price calculation.
  const [periodRows, setPeriodRows] = useState<PeriodDiscountRow[]>([]);
  const [isLoadingPeriod, setIsLoadingPeriod] = useState(false);
  const [specialRows, setSpecialRows] = useState<SpecialDiscountRow[]>([]);
  const [isLoadingSpecial, setIsLoadingSpecial] = useState(false);

  const loadPeriodDiscounts = useCallback(async (num: number) => {
    setIsLoadingPeriod(true);
    const res = await fetch(`/api/admin/price-lists/${num}/period-discounts`);
    const data = await res.json();
    setPeriodRows(data.rows || []);
    setIsLoadingPeriod(false);
  }, []);

  const loadSpecialDiscounts = useCallback(async (num: number) => {
    setIsLoadingSpecial(true);
    const res = await fetch(`/api/admin/price-lists/${num}/special-discounts`);
    const data = await res.json();
    setSpecialRows(data.rows || []);
    setIsLoadingSpecial(false);
  }, []);

  useEffect(() => {
    if (activeTab === null) return;
    loadPeriodDiscounts(activeTab);
    loadSpecialDiscounts(activeTab);
  }, [activeTab, loadPeriodDiscounts, loadSpecialDiscounts]);

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>Price Lists</h1>
            <p style={styles.subtitle}>
              Exactly one list should be marked <strong>Base</strong> (the &quot;original&quot; price shown crossed-out). Lists marked
              <strong> Channel</strong> are assignable to customers as their group/channel price.
            </p>
          </div>
          <SyncButton url="/api/admin/price-lists/sync" label="Sync from SAP" onDone={load} />
        </div>

        {!isLoading && lists.length > 0 && (
          <div style={{ marginBottom: "0.75rem" }}>
            <button onClick={() => setShowAllLists((v) => !v)} style={btn("secondary")}>
              {showAllLists ? "Show active only" : "Show all synced price lists"}
            </button>
          </div>
        )}

        {(isLoading || managedLists.length > 0) && (
          <div style={{ ...styles.card, marginBottom: "2rem" }}>
            <LoadingOrEmpty isLoading={isLoading} isEmpty={!isLoading && managedLists.length === 0} emptyLabel="No price lists synced yet" />
            {!isLoading && managedLists.length > 0 && (
              <div style={{ overflowX: "auto" }}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>#</th>
                      <th style={styles.th}>Name</th>
                      <th style={styles.th}>Base</th>
                      <th style={styles.th}>Channel</th>
                      <th style={styles.th}>Last Synced</th>
                    </tr>
                  </thead>
                  <tbody>
                    {managedLists.map((l) => (
                      <tr key={l.price_list_num}>
                        <td style={{ ...styles.td, fontFamily: "monospace" }}>{l.price_list_num}</td>
                        <td style={styles.td}>{l.list_name}</td>
                        <td style={styles.td}>
                          <Toggle
                            checked={!!l.is_base}
                            disabled={savingNum === l.price_list_num}
                            onChange={(v) => update(l.price_list_num, { isBase: v })}
                          />
                        </td>
                        <td style={styles.td}>
                          <Toggle
                            checked={!!l.is_channel}
                            disabled={savingNum === l.price_list_num}
                            onChange={(v) => update(l.price_list_num, { isChannel: v })}
                          />
                        </td>
                        <td style={{ ...styles.td, color: "var(--text-tertiary, #94A3B8)", fontSize: "0.75rem" }}>
                          {l.last_synced ? new Date(l.last_synced).toLocaleString() : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <h2 style={{ fontSize: "1.125rem", fontWeight: 700, marginBottom: "0.5rem" }}>Price List Details</h2>
        <p style={{ fontSize: "0.8125rem", color: "var(--text-tertiary, #94A3B8)", marginBottom: "1rem" }}>
          Item-level pricing for each active (Base or Channel) list, cached from SAP. Each item's <strong>Base Price List</strong> shows
          which list SAP derived this list&apos;s price from (itself = set directly here); <strong>Price</strong> = Base Price × Factor,
          already resolved by SAP.
        </p>

        {activeLists.length === 0 ? (
          <div style={styles.card}>
            <div style={styles.empty}>No active price lists yet — mark a list Base or Channel above.</div>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem", borderBottom: "1px solid var(--color-gray-200, #E2E8F0)" }}>
              {activeLists.map((l) => (
                <button
                  key={l.price_list_num}
                  onClick={() => setActiveTab(l.price_list_num)}
                  style={{
                    ...btn(activeTab === l.price_list_num ? "primary" : "secondary"),
                    borderRadius: "var(--radius-lg, 8px) var(--radius-lg, 8px) 0 0",
                    borderBottom: activeTab === l.price_list_num ? "none" : undefined,
                  }}
                >
                  {l.list_name || `#${l.price_list_num}`}
                  {l.is_base ? " (Base)" : ""}
                </button>
              ))}
            </div>

            <div style={{ marginBottom: "1rem", display: "flex", gap: "0.75rem", alignItems: "center" }}>
              <input
                style={{ ...styles.input, width: "280px" }}
                placeholder="Search item code or name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <span style={{ fontSize: "0.75rem", color: "var(--text-tertiary, #94A3B8)" }}>{itemsTotal} item(s)</span>
            </div>

            <div style={styles.card}>
              <LoadingOrEmpty
                isLoading={isLoadingItems}
                isEmpty={!isLoadingItems && items.length === 0}
                emptyLabel="No items priced on this list yet"
              />
              {!isLoadingItems && items.length > 0 && (
                <div style={{ overflowX: "auto" }}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.th}>Item Code</th>
                        <th style={styles.th}>Item Name</th>
                        <th style={styles.th}>UOM</th>
                        <th style={styles.th}>Category</th>
                        <th style={styles.th}>Base Price List</th>
                        <th style={styles.th}>Factor</th>
                        <th style={styles.th}>Base Price</th>
                        <th style={styles.th}>Price</th>
                        <th style={styles.th}>Last Synced</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it) => (
                        <tr key={it.sap_item_code}>
                          <td style={{ ...styles.td, fontFamily: "monospace", fontSize: "0.75rem" }}>{it.sap_item_code}</td>
                          <td style={styles.td}>{it.item_name_vi || it.item_name_en || "—"}</td>
                          <td style={styles.td}>{it.uom || "—"}</td>
                          <td style={styles.td}>{it.category || "—"}</td>
                          <td style={{ ...styles.td, fontSize: "0.8125rem" }}>
                            {it.base_price_list_name || (it.base_price_list_num ? `#${it.base_price_list_num}` : "—")}
                          </td>
                          <td style={styles.td}>{it.factor ?? "—"}</td>
                          <td style={styles.td}>{formatPrice(it.base_price)}</td>
                          <td style={styles.td}>{formatPrice(it.price)}</td>
                          <td style={{ ...styles.td, color: "var(--text-tertiary, #94A3B8)", fontSize: "0.75rem" }}>
                            {it.last_synced ? new Date(it.last_synced).toLocaleString() : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <h2 style={{ fontSize: "1.125rem", fontWeight: 700, marginBottom: "0.5rem", marginTop: "2rem" }}>Period Discounts</h2>
            <p style={{ fontSize: "0.8125rem", color: "var(--text-tertiary, #94A3B8)", marginBottom: "1rem" }}>
              SAP Special Prices scoped to this whole price list (SAP marks these with card code <code>*{activeTab}</code> instead
              of a real customer) — a time-bound discount on specific items for everyone on this list. Not yet applied to prices
              shown on the storefront.
            </p>
            <div style={{ marginBottom: "1rem" }}>
              <SyncButton
                url={`/api/admin/price-lists/${activeTab}/period-discounts/sync`}
                label="Sync period discounts from SAP"
                onDone={() => activeTab !== null && loadPeriodDiscounts(activeTab)}
              />
            </div>
            <div style={{ ...styles.card, marginBottom: "2rem" }}>
              <LoadingOrEmpty
                isLoading={isLoadingPeriod}
                isEmpty={!isLoadingPeriod && periodRows.length === 0}
                emptyLabel="No period discounts synced yet for this price list"
              />
              {!isLoadingPeriod && periodRows.length > 0 && (
                <div style={{ overflowX: "auto" }}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.th}>Item Code</th>
                        <th style={styles.th}>Item Name</th>
                        <th style={styles.th}>UOM</th>
                        <th style={styles.th}>Price</th>
                        <th style={styles.th}>Discount %</th>
                        <th style={styles.th}>Price After Discount</th>
                        <th style={styles.th}>Date From</th>
                        <th style={styles.th}>Date To</th>
                        <th style={styles.th}>Last Synced</th>
                      </tr>
                    </thead>
                    <tbody>
                      {periodRows.map((r, i) => (
                        <tr key={`${r.sap_item_code}-${i}`}>
                          <td style={{ ...styles.td, fontFamily: "monospace", fontSize: "0.75rem" }}>{r.sap_item_code}</td>
                          <td style={styles.td}>{r.item_name_vi || r.item_name_en || "—"}</td>
                          <td style={styles.td}>{r.uom || "—"}</td>
                          <td style={styles.td}>{formatPrice(r.base_price)}</td>
                          <td style={styles.td}>{r.discount_percent ? `${Number(r.discount_percent).toFixed(4)}%` : "—"}</td>
                          <td style={{ ...styles.td, fontWeight: 600 }}>{formatPrice(r.special_price)}</td>
                          <td style={styles.td}>{r.date_from?.slice(0, 10) || "—"}</td>
                          <td style={styles.td}>{r.date_to?.slice(0, 10) || "open-ended"}</td>
                          <td style={{ ...styles.td, color: "var(--text-tertiary, #94A3B8)", fontSize: "0.75rem" }}>
                            {r.last_synced ? new Date(r.last_synced).toLocaleString() : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <h2 style={{ fontSize: "1.125rem", fontWeight: 700, marginBottom: "0.5rem" }}>Special Discounts</h2>
            <p style={{ fontSize: "0.8125rem", color: "var(--text-tertiary, #94A3B8)", marginBottom: "1rem" }}>
              SAP Special Prices negotiated per customer, bulk-synced for every customer currently assigned this price list.
              Not yet applied to prices shown on the storefront.
            </p>
            <div style={{ marginBottom: "1rem" }}>
              <SyncButton
                url={`/api/admin/price-lists/${activeTab}/special-discounts/sync`}
                label="Sync special discounts from SAP"
                loadingLabel="Syncing (one request per customer — can take a while)..."
                onDone={() => activeTab !== null && loadSpecialDiscounts(activeTab)}
              />
            </div>
            <div style={{ ...styles.card }}>
              <LoadingOrEmpty
                isLoading={isLoadingSpecial}
                isEmpty={!isLoadingSpecial && specialRows.length === 0}
                emptyLabel="No special discounts synced yet for this price list's customers"
              />
              {!isLoadingSpecial && specialRows.length > 0 && (
                <div style={{ overflowX: "auto" }}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.th}>Customer</th>
                        <th style={styles.th}>Item Code</th>
                        <th style={styles.th}>Item Name</th>
                        <th style={styles.th}>Special Price</th>
                        <th style={styles.th}>Discount %</th>
                        <th style={styles.th}>Valid From</th>
                        <th style={styles.th}>Valid To</th>
                        <th style={styles.th}>Last Synced</th>
                      </tr>
                    </thead>
                    <tbody>
                      {specialRows.map((r, i) => (
                        <tr key={`${r.sap_card_code}-${r.sap_item_code}-${i}`}>
                          <td style={styles.td}>
                            <div>{r.card_name || "—"}</div>
                            <div style={{ fontFamily: "monospace", fontSize: "0.7rem", color: "var(--text-tertiary, #94A3B8)" }}>{r.sap_card_code}</div>
                          </td>
                          <td style={{ ...styles.td, fontFamily: "monospace", fontSize: "0.75rem" }}>{r.sap_item_code}</td>
                          <td style={styles.td}>{r.item_name_vi || r.item_name_en || "—"}</td>
                          <td style={styles.td}>{formatPrice(r.special_price)}</td>
                          <td style={styles.td}>{r.discount_percent ? `${Number(r.discount_percent).toFixed(2)}%` : "—"}</td>
                          <td style={styles.td}>{r.valid_from?.slice(0, 10) || "—"}</td>
                          <td style={styles.td}>{r.valid_to?.slice(0, 10) || "open-ended"}</td>
                          <td style={{ ...styles.td, color: "var(--text-tertiary, #94A3B8)", fontSize: "0.75rem" }}>
                            {r.last_synced ? new Date(r.last_synced).toLocaleString() : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
