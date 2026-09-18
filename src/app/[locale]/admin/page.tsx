"use client";

import { useState, useEffect } from "react";
import { useLocale } from "next-intl";
import { styles, SyncButton } from "./adminUi";
import { useAdminSession } from "./layout";

interface DashboardCounts {
  pendingCustomers: number;
  approvedCustomers: number;
  items: number;
  itemGroups: number;
  sellablePairCount: number;
  priceLists: number;
  orders: number;
}

export default function AdminDashboardPage() {
  const session = useAdminSession();
  const locale = useLocale();
  const [counts, setCounts] = useState<DashboardCounts | null>(null);

  const loadCounts = async () => {
    const [customersRes, itemCategoriesRes, priceListsRes, ordersRes, itemsRes] = await Promise.all([
      fetch("/api/admin/customers").then((r) => (r.ok ? r.json() : { customers: [] })),
      fetch("/api/admin/item-groups").then((r) => (r.ok ? r.json() : { itemCategories: [] })),
      fetch("/api/admin/price-lists").then((r) => (r.ok ? r.json() : { priceLists: [] })),
      fetch("/api/admin/orders").then((r) => (r.ok ? r.json() : { total: 0 })),
      fetch("/api/admin/items?limit=1").then((r) => (r.ok ? r.json() : { total: 0 })),
    ]);

    const customers = customersRes.customers || [];
    const level1Categories = (itemCategoriesRes.itemCategories || []).filter((c: { level: number }) => c.level === 1);
    setCounts({
      pendingCustomers: customers.filter((c: { approval_status: string }) => c.approval_status === "pending").length,
      approvedCustomers: customers.filter((c: { approval_status: string }) => c.approval_status === "approved").length,
      items: itemsRes.total || 0,
      itemGroups: level1Categories.length,
      sellablePairCount: itemCategoriesRes.sellablePairCount || 0,
      priceLists: (priceListsRes.priceLists || []).length,
      orders: ordersRes.total || 0,
    });
  };

  useEffect(() => {
    loadCounts();
  }, []);

  const tiles = counts
    ? [
        { label: "Pending customer requests", value: counts.pendingCustomers, href: "customers" },
        { label: "Approved customers", value: counts.approvedCustomers, href: "customers" },
        { label: "Sellable category pairs", value: counts.sellablePairCount, href: "item-groups" },
        { label: "Synced items", value: counts.items, href: "items" },
        { label: "Price lists", value: counts.priceLists, href: "price-lists" },
        { label: "Orders", value: counts.orders, href: "orders" },
      ]
    : [];

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>Dashboard</h1>
            <p style={styles.subtitle}>Signed in as {session?.email}{session?.isSuperAdmin ? " (super-admin)" : ""}</p>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
          {tiles.map((tile) => (
            <a key={tile.label} href={`/${locale}/admin/${tile.href}`} style={{ ...styles.cardPadded, marginBottom: 0, textDecoration: "none", display: "block" }}>
              <div style={{ fontSize: "1.75rem", fontWeight: 800, color: "var(--text-primary, #0F172A)" }}>{tile.value}</div>
              <div style={{ fontSize: "0.8125rem", color: "var(--text-tertiary, #94A3B8)", marginTop: "0.25rem" }}>{tile.label}</div>
            </a>
          ))}
        </div>

        <div style={styles.cardPadded}>
          <h2 style={{ fontSize: "1.125rem", fontWeight: 700, marginBottom: "1rem" }}>Quick sync</h2>
          <p style={{ fontSize: "0.8125rem", color: "var(--text-tertiary, #94A3B8)", marginBottom: "1rem" }}>
            Customer Groups and Item Groups are never pulled from SAP automatically — update
            SAP_Customer_Group.xlsx / SAP_Item_Group.xlsx and import on their own pages. Everything below runs automatically
            once a day (see scripts/daily-sync.mjs); these buttons just let you run it on demand too.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <SyncButton url="/api/admin/sap-customers/sync" label="Sync SAP customers" onDone={loadCounts} />
            <SyncButton url="/api/admin/items/sync" label="Sync items from SAP" onDone={loadCounts} />
            <SyncButton url="/api/admin/price-lists/sync" label="Sync price lists from SAP" onDone={loadCounts} />
            <SyncButton url="/api/admin/contract-discounts/agreements/sync" label="Sync contract discounts from SAP" onDone={loadCounts} />
            <SyncButton url="/api/admin/promotions/sync" label="Sync promotions from SAP" onDone={loadCounts} />
          </div>
        </div>
      </div>
    </div>
  );
}
