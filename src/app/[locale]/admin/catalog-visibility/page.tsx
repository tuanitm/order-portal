"use client";

import { useState, useEffect, useCallback } from "react";
import { styles, btn, LoadingOrEmpty } from "../adminUi";

interface CustomerGroup { id: number; level: number; code: string; name: string | null }
interface ItemGroup { id: number; level: number; code: string; name: string | null }
interface Rule {
  id: number;
  customer_group_id: number;
  cg_code: string;
  cg_name: string | null;
  cg_level: number;
  item_category_level: number;
  item_category_code: string;
  is_visible: number;
}

const labelFor = (code: string, name: string | null, level: number) =>
  `${code}${name ? ` — ${name}` : ""} (L${level})`;

export default function CatalogVisibilityPage() {
  const [customerGroups, setCustomerGroups] = useState<CustomerGroup[]>([]);
  const [itemGroups, setItemGroups] = useState<ItemGroup[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Add-rule form
  const [addCgId, setAddCgId] = useState("");
  const [addIgCode, setAddIgCode] = useState("");
  const [addVisible, setAddVisible] = useState("1");
  const [addMsg, setAddMsg] = useState("");
  const [addSaving, setAddSaving] = useState(false);

  // Per-customer override panel
  const [customerId, setCustomerId] = useState("");
  const [overrideInfo, setOverrideInfo] = useState<{
    customer: { full_name: string; sap_card_code: string } | null;
    overrides: { item_category_level: number; item_category_code: string; is_visible: number }[];
  } | null>(null);
  const [overrideMap, setOverrideMap] = useState<Map<string, boolean | null>>(new Map());
  const catKey = (level: number, code: string) => `${level}:${code}`;

  const load = useCallback(async () => {
    setIsLoading(true);
    const res = await fetch("/api/admin/catalog-visibility");
    const data = await res.json();
    setCustomerGroups(data.customerGroups || []);
    setItemGroups(data.itemGroups || []);
    setRules(data.rules || []);
    setIsLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Add rule ──
  const handleAdd = async () => {
    if (!addCgId || !addIgCode) { setAddMsg("Select both Customer Group and Item Group"); return; }
    setAddSaving(true);
    setAddMsg("");
    const ig = itemGroups.find((g) => `${g.level}:${g.code}` === addIgCode);
    if (!ig) { setAddMsg("Invalid item group"); setAddSaving(false); return; }
    try {
      const res = await fetch("/api/admin/catalog-visibility", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerGroupId: Number(addCgId),
          itemCategoryLevel: ig.level,
          itemCategoryCode: ig.code,
          isVisible: addVisible === "1",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setAddMsg("✓ Added");
      load();
    } catch (err) {
      setAddMsg(err instanceof Error ? err.message : "Failed");
    } finally {
      setAddSaving(false);
    }
  };

  const toggleRule = async (rule: Rule) => {
    await fetch("/api/admin/catalog-visibility", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerGroupId: rule.customer_group_id,
        itemCategoryLevel: rule.item_category_level,
        itemCategoryCode: rule.item_category_code,
        isVisible: !rule.is_visible,
      }),
    });
    load();
  };

  const deleteRule = async (id: number) => {
    if (!confirm("Remove this visibility rule?")) return;
    await fetch("/api/admin/catalog-visibility", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    load();
  };

  // ── Per-customer overrides ──
  const loadCustomerOverrides = async () => {
    if (!customerId) return;
    const res = await fetch(`/api/admin/catalog-visibility/customers/${customerId}`);
    if (!res.ok) { setOverrideInfo(null); return; }
    const data = await res.json();
    setOverrideInfo(data);
    const m = new Map<string, boolean | null>();
    for (const o of data.overrides) m.set(catKey(o.item_category_level, o.item_category_code), !!o.is_visible);
    setOverrideMap(m);
  };

  const toggleOverride = (icLevel: number, icCode: string) => {
    const k = catKey(icLevel, icCode);
    const current = overrideMap.get(k);
    const next = new Map(overrideMap);
    if (current === undefined || current === null) next.set(k, false);
    else if (current === false) next.set(k, true);
    else next.delete(k);
    setOverrideMap(next);
  };

  const saveOverrides = async () => {
    const overrides = [...overrideMap.entries()].map(([k, isVisible]) => {
      const [itemCategoryLevel, itemCategoryCode] = k.split(":");
      return { itemCategoryLevel: Number(itemCategoryLevel), itemCategoryCode, isVisible };
    });
    await fetch(`/api/admin/catalog-visibility/customers/${customerId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ overrides }),
    });
    await loadCustomerOverrides();
  };

  // ── Helper ──
  const igLabel = (level: number, code: string) => {
    const ig = itemGroups.find((g) => g.level === level && g.code === code);
    return ig ? labelFor(ig.code, ig.name, ig.level) : `${code} (L${level})`;
  };

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>Catalog Visibility</h1>
            <p style={styles.subtitle}>
              Pair a Customer Group with an Item Group to control visibility. No rule = visible by default.
              Rules inherit downward automatically — all sub-groups and items underneath are included.
              Per-customer overrides at the bottom always win.
            </p>
          </div>
        </div>

        {/* ── Add rule form ── */}
        <div style={styles.cardPadded}>
          <h2 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.75rem" }}>Add Visibility Rule</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end" }}>
            <div style={{ minWidth: 200 }}>
              <label style={formLabel}>Customer Group</label>
              <select value={addCgId} onChange={(e) => setAddCgId(e.target.value)} style={{ ...styles.input, width: "100%" }}>
                <option value="">— Select —</option>
                {customerGroups.map((cg) => (
                  <option key={cg.id} value={cg.id}>{"  ".repeat(cg.level - 1)}{labelFor(cg.code, cg.name, cg.level)}</option>
                ))}
              </select>
            </div>
            <div style={{ minWidth: 200 }}>
              <label style={formLabel}>Item Group</label>
              <select value={addIgCode} onChange={(e) => setAddIgCode(e.target.value)} style={{ ...styles.input, width: "100%" }}>
                <option value="">— Select —</option>
                {itemGroups.map((ig) => (
                  <option key={ig.id} value={`${ig.level}:${ig.code}`}>{"  ".repeat(ig.level - 1)}{labelFor(ig.code, ig.name, ig.level)}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={formLabel}>Visibility</label>
              <select value={addVisible} onChange={(e) => setAddVisible(e.target.value)} style={{ ...styles.input, minWidth: 100 }}>
                <option value="1">✓ Visible</option>
                <option value="0">✕ Hidden</option>
              </select>
            </div>
            <button onClick={handleAdd} disabled={addSaving} style={btn("primary", addSaving)}>
              {addSaving ? "Adding..." : "Add Rule"}
            </button>
          </div>
          {addMsg && <p style={{ marginTop: "0.5rem", fontSize: "0.8125rem", color: addMsg.startsWith("✓") ? "#059669" : "#DC2626" }}>{addMsg}</p>}
        </div>

        {/* ── Rules table (explicit pairings only) ── */}
        <LoadingOrEmpty
          isLoading={isLoading}
          isEmpty={!isLoading && rules.length === 0}
          emptyLabel="No visibility rules yet — all item groups are visible to all customer groups by default. Add rules above to restrict access."
        />

        {!isLoading && rules.length > 0 && (
          <div style={{ ...styles.card, marginBottom: "1.5rem" }}>
            <div style={{ padding: "0.75rem 1rem", fontWeight: 700, fontSize: "0.875rem", borderBottom: "1px solid var(--color-gray-200, #E2E8F0)" }}>
              Visibility Rules <span style={{ color: "var(--text-tertiary, #94A3B8)", fontWeight: 400 }}>({rules.length} rules)</span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Customer Group</th>
                    <th style={styles.th}>Item Group</th>
                    <th style={{ ...styles.th, textAlign: "center" }}>Visible</th>
                    <th style={{ ...styles.th, textAlign: "center", width: 80 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((r) => (
                    <tr key={r.id}>
                      <td style={styles.td}>
                        <span style={{ fontFamily: "monospace" }}>{r.cg_code}</span>
                        {r.cg_name ? ` — ${r.cg_name}` : ""}
                        <span style={{ fontSize: "0.6875rem", color: "var(--text-tertiary, #94A3B8)" }}> (L{r.cg_level})</span>
                      </td>
                      <td style={styles.td}>
                        <span style={{ fontFamily: "monospace" }}>{r.item_category_code}</span>{" "}
                        <span style={{ fontSize: "0.6875rem", color: "var(--text-tertiary, #94A3B8)" }}>
                          {igLabel(r.item_category_level, r.item_category_code).replace(r.item_category_code, "").trim()}
                        </span>
                      </td>
                      <td style={{ ...styles.td, textAlign: "center" }}>
                        <button
                          onClick={() => toggleRule(r)}
                          style={{
                            width: 28, height: 28, borderRadius: "50%", border: "none", cursor: "pointer",
                            background: r.is_visible ? "#D1FAE5" : "#FEE2E2",
                            color: r.is_visible ? "#065F46" : "#991B1B", fontWeight: 700,
                          }}
                          title={r.is_visible ? "Visible — click to hide" : "Hidden — click to show"}
                        >
                          {r.is_visible ? "✓" : "✕"}
                        </button>
                      </td>
                      <td style={{ ...styles.td, textAlign: "center" }}>
                        <button
                          onClick={() => deleteRule(r.id)}
                          style={{ fontSize: "0.75rem", color: "#DC2626", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Per-customer overrides ── */}
        <div style={styles.cardPadded}>
          <h2 style={{ fontSize: "1.125rem", fontWeight: 700, marginBottom: "0.5rem" }}>Per-customer Override</h2>
          <p style={{ fontSize: "0.8125rem", color: "var(--text-tertiary, #94A3B8)", marginBottom: "1rem" }}>
            Override group-level rules for a specific customer. Per-customer overrides always win.
          </p>
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
            <input
              style={styles.input}
              placeholder="Customer user ID (from Customers page)"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
            />
            <button onClick={loadCustomerOverrides} style={btn("secondary")}>Look up</button>
          </div>

          {overrideInfo?.customer && (
            <>
              <p style={{ fontSize: "0.8125rem", marginBottom: "1rem" }}>
                <strong>{overrideInfo.customer.full_name}</strong> ({overrideInfo.customer.sap_card_code})
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem" }}>
                {itemGroups.map((ig) => {
                  const state = overrideMap.get(catKey(ig.level, ig.code));
                  const label = state === undefined ? "Group default" : state ? "Visible" : "Hidden";
                  const bg = state === undefined ? "#F1F5F9" : state ? "#D1FAE5" : "#FEE2E2";
                  const color = state === undefined ? "#475569" : state ? "#065F46" : "#991B1B";
                  return (
                    <button
                      key={ig.id}
                      onClick={() => toggleOverride(ig.level, ig.code)}
                      style={{ padding: "0.375rem 0.75rem", borderRadius: "var(--radius-full)", border: "none", background: bg, color, fontSize: "0.75rem", fontWeight: 600, cursor: "pointer" }}
                    >
                      {ig.code} (L{ig.level}): {label}
                    </button>
                  );
                })}
              </div>
              <button onClick={saveOverrides} style={btn("primary")}>Save overrides</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const formLabel = {
  display: "block" as const, fontSize: "0.75rem", fontWeight: 600,
  marginBottom: "0.25rem", color: "var(--text-secondary, #64748B)",
};
