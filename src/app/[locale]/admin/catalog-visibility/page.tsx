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
interface Warehouse { sap_warehouse_code: string; warehouse_name: string; is_included: number }
interface WarehouseMapping { customer_group_id: number; warehouse_code: string }

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

  // Customer Group (level 2) <-> Warehouse mapping — one free-typed,
  // comma-separated textbox of warehouse codes per group.
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseMappings, setWarehouseMappings] = useState<WarehouseMapping[]>([]);
  const [isLoadingWh, setIsLoadingWh] = useState(true);
  const [whInputs, setWhInputs] = useState<Record<number, string>>({});
  const [savingGroupId, setSavingGroupId] = useState<number | null>(null);
  const [whMsg, setWhMsg] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    setIsLoading(true);
    const res = await fetch("/api/admin/catalog-visibility");
    const data = await res.json();
    setCustomerGroups(data.customerGroups || []);
    setItemGroups(data.itemGroups || []);
    setRules(data.rules || []);
    setIsLoading(false);
  }, []);

  const loadWarehouseMatrix = useCallback(async () => {
    setIsLoadingWh(true);
    const res = await fetch("/api/admin/catalog-visibility/warehouses");
    const data = await res.json();
    const whs: Warehouse[] = data.warehouses || [];
    const maps: WarehouseMapping[] = data.mappings || [];
    setWarehouses(whs);
    setWarehouseMappings(maps);
    // Seed each group's textbox from its current mappings, so re-opening the
    // page (or saving another group) doesn't lose what's already there.
    setWhInputs((prev) => {
      const next = { ...prev };
      const byGroup = new Map<number, string[]>();
      for (const m of maps) {
        if (!byGroup.has(m.customer_group_id)) byGroup.set(m.customer_group_id, []);
        byGroup.get(m.customer_group_id)!.push(m.warehouse_code);
      }
      for (const [gid, codes] of byGroup) next[gid] = codes.join(", ");
      return next;
    });
    setIsLoadingWh(false);
  }, []);

  useEffect(() => { load(); loadWarehouseMatrix(); }, [load, loadWarehouseMatrix]);

  const customerGroupsL2 = customerGroups.filter((cg) => cg.level === 2);

  const saveGroupWarehouses = async (cgId: number) => {
    setSavingGroupId(cgId);
    setWhMsg((m) => ({ ...m, [cgId]: "" }));
    const warehouseCodes = (whInputs[cgId] || "").split(",").map((c) => c.trim()).filter(Boolean);
    try {
      const res = await fetch("/api/admin/catalog-visibility/warehouses", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerGroupId: cgId, warehouseCodes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error([data.error, data.message].filter(Boolean).join(" — "));
      setWhMsg((m) => ({ ...m, [cgId]: "✓ Saved" }));
      await loadWarehouseMatrix();
    } catch (err) {
      setWhMsg((m) => ({ ...m, [cgId]: err instanceof Error ? err.message : "Save failed" }));
    } finally {
      setSavingGroupId(null);
    }
  };

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

        {/* ── Customer Group (L2) <-> Warehouse ── */}
        <div style={styles.cardPadded}>
          <h2 style={{ fontSize: "1.125rem", fontWeight: 700, marginBottom: "0.5rem" }}>Warehouse Visibility</h2>
          <p style={{ fontSize: "0.8125rem", color: "var(--text-tertiary, #94A3B8)", marginBottom: "1rem" }}>
            Which warehouse(s) a Customer Group (level 2) draws stock from, for the storefront&apos;s available-quantity
            check. Type the warehouse codes for that group, separated by commas, e.g. <code>1000, 1001, 1002</code>, then
            Save. A group left blank falls back to every warehouse marked <strong>Included</strong> on the{" "}
            <a href="warehouses">Warehouses</a> page (today&apos;s default).
          </p>

          <LoadingOrEmpty
            isLoading={isLoadingWh}
            isEmpty={!isLoadingWh && customerGroupsL2.length === 0}
            emptyLabel="No level-2 customer groups yet — import from Customer Groups."
          />

          {!isLoadingWh && customerGroupsL2.length > 0 && (
            <>
              <div style={{ overflowX: "auto" }}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Customer Group</th>
                      <th style={styles.th}>Warehouse Codes</th>
                      <th style={{ ...styles.th, width: 100 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {customerGroupsL2.map((cg) => (
                      <tr key={cg.id}>
                        <td style={styles.td}>
                          <span style={{ fontFamily: "monospace" }}>{cg.code}</span>
                          {cg.name ? ` — ${cg.name}` : ""}
                        </td>
                        <td style={styles.td}>
                          <input
                            type="text"
                            value={whInputs[cg.id] ?? ""}
                            onChange={(e) => setWhInputs((m) => ({ ...m, [cg.id]: e.target.value }))}
                            placeholder="e.g. 1000, 1001, 1002"
                            style={{ ...styles.input, width: "100%" }}
                          />
                          {whMsg[cg.id] && (
                            <p style={{ marginTop: "0.25rem", fontSize: "0.75rem", color: whMsg[cg.id].startsWith("✓") ? "#059669" : "#DC2626" }}>
                              {whMsg[cg.id]}
                            </p>
                          )}
                        </td>
                        <td style={styles.td}>
                          <button
                            onClick={() => saveGroupWarehouses(cg.id)}
                            disabled={savingGroupId === cg.id}
                            style={btn("primary", savingGroupId === cg.id)}
                          >
                            {savingGroupId === cg.id ? "Saving..." : "Save"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {warehouses.some((w) => w.is_included) && (
                <p style={{ marginTop: "0.75rem", fontSize: "0.75rem", color: "var(--text-tertiary, #94A3B8)" }}>
                  Included warehouse codes: {warehouses.filter((w) => w.is_included).map((w) => `${w.sap_warehouse_code} (${w.warehouse_name})`).join(", ")}
                </p>
              )}
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
