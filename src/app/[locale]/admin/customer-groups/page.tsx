"use client";

import { useState, useEffect, useCallback } from "react";
import { styles, btn, SyncButton, LoadingOrEmpty, Toggle } from "../adminUi";

interface CustomerGroup {
  id: number;
  level: number;
  code: string;
  parent_code: string | null;
  name: string | null;
  is_active: number;
  /** is_active AND every ancestor's is_active — false if this group or any parent up the chain is off. */
  effective_active: boolean;
  /** Whether the parent chain (excluding this row itself) is active. */
  ancestor_active: boolean;
}

const LEVEL_LABELS: Record<number, string> = { 1: "Channel (level 1)", 2: "Sub-group (level 2)", 3: "Finest (level 3)" };

export default function CustomerGroupsPage() {
  const [groups, setGroups] = useState<CustomerGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [savingActiveId, setSavingActiveId] = useState<number | null>(null);

  // Add-manually form state
  const [addLevel, setAddLevel] = useState("1");
  const [addCode, setAddCode] = useState("");
  const [addParent, setAddParent] = useState("");
  const [addName, setAddName] = useState("");
  const [addMsg, setAddMsg] = useState("");
  const [addSaving, setAddSaving] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    const res = await fetch("/api/admin/customer-groups");
    const data = await res.json();
    setGroups(data.customerGroups || []);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const startEdit = (g: CustomerGroup) => {
    setEditingId(g.id);
    setEditValue(g.name || "");
  };

  const saveEdit = async (id: number) => {
    await fetch(`/api/admin/customer-groups/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editValue }),
    });
    setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, name: editValue || null } : g)));
    setEditingId(null);
  };

  const toggleActive = async (g: CustomerGroup, isActive: boolean) => {
    setSavingActiveId(g.id);
    await fetch(`/api/admin/customer-groups/${g.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive }),
    });
    // Reload rather than patch local state in place — toggling this row can
    // change effective_active/is_active on every descendant, in both
    // directions, across every level table.
    await load();
    setSavingActiveId(null);
  };

  const handleAdd = async () => {
    if (!addCode.trim()) { setAddMsg("Code is required"); return; }
    setAddSaving(true);
    setAddMsg("");
    try {
      const res = await fetch("/api/admin/customer-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          level: parseInt(addLevel, 10),
          code: addCode.trim(),
          parent_code: addParent.trim() || null,
          name: addName.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add");
      setAddMsg("✓ Added");
      setAddCode(""); setAddParent(""); setAddName("");
      load();
    } catch (err) {
      setAddMsg(err instanceof Error ? err.message : "Failed");
    } finally {
      setAddSaving(false);
    }
  };

  const byLevel = [1, 2, 3].map((level) => ({ level, rows: groups.filter((g) => g.level === level) }));

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>Customer Groups</h1>
            <p style={styles.subtitle}>
              Import from <code>SAP_Customer_Group</code> or add groups manually below.
              That file also defines the sync scope: only customers whose (CusGrp01, CusGrp02) matches a pair listed
              there get pulled into the SAP Customers sync. Re-import after updating the file; any code not yet in it
              can still be named directly below. Turn a group <strong>Active</strong> off to stop syncing customers
              under it. Unlike Item Groups, toggling here cascades to children in <strong>both directions</strong>:
              switching a group off unticks every child underneath it (labeled <strong>(parent off)</strong>), and
              switching it back on re-ticks them too.
            </p>
          </div>
          <SyncButton url="/api/admin/customer-groups/import" label="Import from SAP_Customer_Group" onDone={load} />
        </div>

        {/* ── Add manually ── */}
        <div style={styles.cardPadded}>
          <h2 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.75rem" }}>Add Customer Group Manually</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, marginBottom: "0.25rem", color: "var(--text-secondary, #64748B)" }}>Level</label>
              <select value={addLevel} onChange={(e) => setAddLevel(e.target.value)} style={{ ...styles.input, minWidth: 70 }}>
                {[1, 2, 3].map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, marginBottom: "0.25rem", color: "var(--text-secondary, #64748B)" }}>Code *</label>
              <input style={styles.input} value={addCode} onChange={(e) => setAddCode(e.target.value)} placeholder="e.g. GT" />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, marginBottom: "0.25rem", color: "var(--text-secondary, #64748B)" }}>Parent Code</label>
              <input style={styles.input} value={addParent} onChange={(e) => setAddParent(e.target.value)} placeholder="(optional)" />
            </div>
            <div style={{ flex: 1, minWidth: 180 }}>
              <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, marginBottom: "0.25rem", color: "var(--text-secondary, #64748B)" }}>Name</label>
              <input style={{ ...styles.input, width: "100%" }} value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="Group name" />
            </div>
            <button onClick={handleAdd} disabled={addSaving} style={btn("primary", addSaving)}>
              {addSaving ? "Adding..." : "Add"}
            </button>
          </div>
          {addMsg && <p style={{ marginTop: "0.5rem", fontSize: "0.8125rem", color: addMsg.startsWith("✓") ? "#059669" : "#DC2626" }}>{addMsg}</p>}
        </div>

        <LoadingOrEmpty isLoading={isLoading} isEmpty={!isLoading && groups.length === 0} emptyLabel="No customer groups yet — import from SAP_Customer_Group.xlsx or add manually above" />

        {!isLoading && groups.length > 0 && byLevel.map(({ level, rows }) => rows.length > 0 && (
          <div key={level} style={{ ...styles.card, marginBottom: "1.5rem" }}>
            <div style={{ padding: "0.75rem 1rem", fontWeight: 700, fontSize: "0.875rem", borderBottom: "1px solid var(--color-gray-200, #E2E8F0)" }}>
              {LEVEL_LABELS[level]} <span style={{ color: "var(--text-tertiary, #94A3B8)", fontWeight: 400 }}>({rows.length} codes)</span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Code</th>
                    <th style={styles.th}>Parent</th>
                    <th style={styles.th}>Name</th>
                    <th style={styles.th}>Active</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((g) => {
                    const parentOff = !g.ancestor_active;
                    return (
                      <tr key={g.id} style={!g.effective_active ? { opacity: 0.55 } : undefined}>
                        <td style={{ ...styles.td, fontFamily: "monospace" }}>{g.code}</td>
                        <td style={{ ...styles.td, fontFamily: "monospace", color: "var(--text-tertiary, #94A3B8)" }}>{g.parent_code || "—"}</td>
                        <td style={styles.td}>
                          {editingId === g.id ? (
                            <div style={{ display: "flex", gap: "0.5rem" }}>
                              <input style={styles.input} value={editValue} onChange={(e) => setEditValue(e.target.value)} autoFocus />
                              <button onClick={() => saveEdit(g.id)} style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--color-primary, #2BBCB3)" }}>Save</button>
                              <button onClick={() => setEditingId(null)} style={{ fontSize: "0.75rem", color: "var(--text-tertiary, #94A3B8)" }}>Cancel</button>
                            </div>
                          ) : (
                            <span onClick={() => startEdit(g)} style={{ cursor: "pointer", color: g.name ? "var(--text-primary, #0F172A)" : "var(--text-tertiary, #94A3B8)" }}>
                              {g.name || "(click to name)"}
                            </span>
                          )}
                        </td>
                        <td style={styles.td}>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                            <Toggle
                              checked={!!g.is_active}
                              disabled={savingActiveId === g.id}
                              onChange={(v) => toggleActive(g, v)}
                            />
                            {parentOff && (
                              <span
                                style={{ fontSize: "0.6875rem", color: "#DC2626", whiteSpace: "nowrap" }}
                                title="A parent group up the chain is off, so this group is inactive too"
                              >
                                (parent off)
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
