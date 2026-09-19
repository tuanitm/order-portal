"use client";

import { useState, useEffect, useCallback } from "react";
import { styles, btn, SyncButton, LoadingOrEmpty, Toggle } from "../adminUi";

interface ItemGroup {
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

const LEVEL_LABELS: Record<number, string> = {
  1: "Level 1", 2: "Level 2 (sellability gate)", 3: "Level 3",
  4: "Level 4", 5: "Level 5", 6: "Level 6",
};

export default function ItemGroupsPage() {
  const [groups, setGroups] = useState<ItemGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  // Staged Active/Inactive changes, keyed by group id — applied in one bulk
  // request when "Save Changes" is clicked, instead of one PATCH + reload
  // per toggle click.
  const [pendingActive, setPendingActive] = useState<Record<number, boolean>>({});
  const [isSavingBulk, setIsSavingBulk] = useState(false);

  // Add-manually form state
  const [addLevel, setAddLevel] = useState("1");
  const [addCode, setAddCode] = useState("");
  const [addParent, setAddParent] = useState("");
  const [addName, setAddName] = useState("");
  const [addMsg, setAddMsg] = useState("");
  const [addSaving, setAddSaving] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    const res = await fetch("/api/admin/item-groups");
    const data = await res.json();
    setGroups(data.itemCategories || []);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const startEdit = (g: ItemGroup) => {
    setEditingId(g.id);
    setEditValue(g.name || "");
  };

  const saveEdit = async (id: number) => {
    await fetch(`/api/admin/item-groups/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editValue }),
    });
    setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, name: editValue || null } : g)));
    setEditingId(null);
  };

  const stageActive = (g: ItemGroup, isActive: boolean) => {
    setPendingActive((prev) => {
      const next = { ...prev };
      if (isActive === !!g.is_active) {
        // Back to the saved value — nothing to save for this row anymore.
        delete next[g.id];
      } else {
        next[g.id] = isActive;
      }
      return next;
    });
  };

  /**
   * Stage isActive for every group at `level` AND every real descendant of
   * those groups (walked via parent_code, not just deeper-level rows in
   * general) — the "Select All/None" button's "tick all sub item groups
   * under" behavior for that level's card.
   */
  const selectLevelAndBelow = (level: number, isActive: boolean) => {
    const childrenByParentKey = new Map<string, ItemGroup[]>();
    for (const g of groups) {
      if (!g.parent_code) continue;
      const key = `${g.level - 1}:${g.parent_code}`;
      if (!childrenByParentKey.has(key)) childrenByParentKey.set(key, []);
      childrenByParentKey.get(key)!.push(g);
    }

    const targets: ItemGroup[] = [];
    const visited = new Set<number>();
    const stack = groups.filter((g) => g.level === level);
    while (stack.length > 0) {
      const g = stack.pop()!;
      if (visited.has(g.id)) continue;
      visited.add(g.id);
      targets.push(g);
      const key = `${g.level}:${g.code}`;
      for (const child of childrenByParentKey.get(key) || []) stack.push(child);
    }

    setPendingActive((prev) => {
      const next = { ...prev };
      for (const g of targets) {
        if (isActive === !!g.is_active) delete next[g.id];
        else next[g.id] = isActive;
      }
      return next;
    });
  };

  const pendingCount = Object.keys(pendingActive).length;

  const discardPending = () => setPendingActive({});

  const savePendingActive = async () => {
    const changes = Object.entries(pendingActive).map(([id, isActive]) => ({ id: Number(id), isActive }));
    if (changes.length === 0) return;
    setIsSavingBulk(true);
    try {
      await fetch("/api/admin/item-groups/bulk-active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes }),
      });
      setPendingActive({});
      // One reload after the whole batch — staged changes (and any
      // parent/child cascade they trigger) can affect descendants across
      // every level table, so re-fetch once rather than patch in place.
      await load();
    } finally {
      setIsSavingBulk(false);
    }
  };

  const handleAdd = async () => {
    if (!addCode.trim()) { setAddMsg("Code is required"); return; }
    setAddSaving(true);
    setAddMsg("");
    try {
      const res = await fetch("/api/admin/item-groups", {
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

  const byLevel = [1, 2, 3, 4, 5, 6].map((level) => ({ level, rows: groups.filter((g) => g.level === level) }));

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>Item Groups</h1>
            <p style={styles.subtitle}>
              Import from <code>SAP_Item_Group</code> or add groups manually below.
              That file also defines the sync scope: only items whose (ItemCat01, ItemCat02) matches a pair listed
              there get pulled into the Items sync. Re-import after updating the file; any code not yet in it can
              still be named directly below. Turn a group <strong>Active</strong> off to stop syncing master data
              for items under it — items already synced are marked inactive instead of deleted. Turning a group
              off also unticks every child group underneath it (labeled <strong>(parent off)</strong>); turning
              the parent back on does not re-tick them — re-enable each child individually if needed.
              Toggling Active/Inactive on any number of rows below just stages the change — click
              <strong> Save Changes</strong> once to apply all of them together.
            </p>
          </div>
          <SyncButton
            url="/api/admin/item-groups/import"
            label="Import from SAP_Item_Group"
            onDone={load}
          />
        </div>

        {pendingCount > 0 && (
          <div
            style={{
              ...styles.cardPadded,
              marginBottom: "1.5rem",
              display: "flex",
              alignItems: "center",
              gap: "1rem",
              flexWrap: "wrap",
              position: "sticky",
              top: "1rem",
              zIndex: 5,
              borderColor: "var(--color-primary, #2BBCB3)",
            }}
          >
            <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>
              {pendingCount} change{pendingCount === 1 ? "" : "s"} staged
            </span>
            <button onClick={savePendingActive} disabled={isSavingBulk} style={btn("primary", isSavingBulk)}>
              {isSavingBulk ? "Saving..." : "Save Changes"}
            </button>
            <button onClick={discardPending} disabled={isSavingBulk} style={btn("secondary", isSavingBulk)}>
              Discard
            </button>
          </div>
        )}

        {/* ── Add manually ── */}
        <div style={styles.cardPadded}>
          <h2 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.75rem" }}>Add Item Group Manually</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, marginBottom: "0.25rem", color: "var(--text-secondary, #64748B)" }}>Level</label>
              <select value={addLevel} onChange={(e) => setAddLevel(e.target.value)} style={{ ...styles.input, minWidth: 70 }}>
                {[1,2,3,4,5,6].map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, marginBottom: "0.25rem", color: "var(--text-secondary, #64748B)" }}>Code *</label>
              <input style={styles.input} value={addCode} onChange={(e) => setAddCode(e.target.value)} placeholder="e.g. D1" />
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

        <LoadingOrEmpty
          isLoading={isLoading}
          isEmpty={!isLoading && groups.length === 0}
          emptyLabel="No item groups yet — import from SAP_Item_Group.xlsx or add manually above"
        />

        {!isLoading && groups.length > 0 && byLevel.map(({ level, rows }) => rows.length > 0 && (
          <div key={level} style={{ ...styles.card, marginBottom: "1.5rem" }}>
            <div
              style={{
                padding: "0.75rem 1rem",
                fontWeight: 700,
                fontSize: "0.875rem",
                borderBottom: "1px solid var(--color-gray-200, #E2E8F0)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "0.75rem",
                flexWrap: "wrap",
              }}
            >
              <span>
                {LEVEL_LABELS[level]} <span style={{ color: "var(--text-tertiary, #94A3B8)", fontWeight: 400 }}>({rows.length} codes)</span>
              </span>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                  onClick={() => selectLevelAndBelow(level, true)}
                  disabled={isSavingBulk}
                  style={{ ...btn("secondary", isSavingBulk), fontWeight: 600 }}
                  title={`Stage Active for every ${LEVEL_LABELS[level]} group and everything under it`}
                >
                  Select All
                </button>
                <button
                  onClick={() => selectLevelAndBelow(level, false)}
                  disabled={isSavingBulk}
                  style={{ ...btn("secondary", isSavingBulk), fontWeight: 600 }}
                  title={`Stage Inactive for every ${LEVEL_LABELS[level]} group and everything under it`}
                >
                  Select None
                </button>
              </div>
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
                              checked={g.id in pendingActive ? pendingActive[g.id] : !!g.is_active}
                              disabled={isSavingBulk}
                              onChange={(v) => stageActive(g, v)}
                            />
                            {g.id in pendingActive && (
                              <span
                                style={{ fontSize: "0.6875rem", color: "var(--color-primary, #2BBCB3)", whiteSpace: "nowrap" }}
                                title="Staged — click Save Changes to apply"
                              >
                                (pending)
                              </span>
                            )}
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
