"use client";

import { Fragment, useState, useEffect, useCallback } from "react";
import { styles, btn, Toggle, LoadingOrEmpty } from "../adminUi";
import { useAdminSession } from "../layout";

interface AdminUserRow {
  id: number; email: string; full_name: string; is_active: number; is_root: number;
  role_id: number | null; role_name: string | null; department_code: string | null;
  owner_code: string | null; created_at: string;
}
interface Role { id: number; name: string }
interface CostCenter { ocr_code: string; ocr_name: string | null; is_active: number }

export default function AdminUsersPage() {
  const session = useAdminSession();
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [departments, setDepartments] = useState<CostCenter[]>([]);
  const [syncingDepts, setSyncingDepts] = useState(false);
  const [deptSyncMsg, setDeptSyncMsg] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", fullName: "", roleId: "" });
  const [error, setError] = useState("");

  // Edit existing admin user (name/email/role/password) — a separate inline
  // form per row, opened by the "Edit" button, distinct from the always-on
  // Active toggle and Customer/Item Group scope inputs above.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ fullName: "", email: "", roleId: "", password: "", departmentCode: "", ownerCode: "" });
  const [editError, setEditError] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  // Per-admin data scoping — Customer Groups / Item Groups the admin may
  // see/manage (default: none, until root assigns some — see adminScope.ts).
  const [cgInputs, setCgInputs] = useState<Record<number, string>>({});
  const [igInputs, setIgInputs] = useState<Record<number, string>>({});
  // Warehouses the admin may use on Inventory and when creating / pushing orders (see adminWarehouses.ts).
  const [whInputs, setWhInputs] = useState<Record<number, string>>({});
  const [masterdataWarehouses, setMasterdataWarehouses] = useState<string[]>([]);
  const [savingScope, setSavingScope] = useState<string | null>(null); // `${userId}:customer`|`${userId}:item`|`${userId}:warehouse`
  const [scopeMsg, setScopeMsg] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setIsLoading(true);
    const [usersRes, rolesRes, deptRes] = await Promise.all([
      fetch("/api/admin/users"),
      fetch("/api/admin/roles"),
      fetch("/api/admin/cost-centers?dimension=2"),
    ]);
    const usersData = await usersRes.json();
    const rolesData = await rolesRes.json();
    const deptData = await deptRes.json();
    const loadedUsers: AdminUserRow[] = usersData.adminUsers || [];
    setUsers(loadedUsers);
    setRoles(rolesData.roles || []);
    setDepartments(deptData.costCenters || []);
    setIsLoading(false);

    // Seed each admin's scope textboxes from their current assignments.
    await Promise.all(
      loadedUsers.map(async (u) => {
        const [cgRes, igRes, whRes] = await Promise.all([
          fetch(`/api/admin/users/${u.id}/customer-groups`),
          fetch(`/api/admin/users/${u.id}/item-groups`),
          fetch(`/api/admin/users/${u.id}/warehouses`),
        ]);
        const cgData = await cgRes.json();
        const igData = await igRes.json();
        const whData = await whRes.json();
        setCgInputs((m) => (u.id in m ? m : { ...m, [u.id]: (cgData.codes || []).join(", ") }));
        setIgInputs((m) => (u.id in m ? m : { ...m, [u.id]: (igData.codes || []).join(", ") }));
        setWhInputs((m) => (u.id in m ? m : { ...m, [u.id]: (whData.codes || []).join(", ") }));
        if (whData.available) setMasterdataWarehouses(whData.available);
      })
    );
  }, []);

  const saveScope = async (userId: number, kind: "customer" | "item" | "warehouse") => {
    const key = `${userId}:${kind}`;
    setSavingScope(key);
    setScopeMsg((m) => ({ ...m, [key]: "" }));
    const raw = (kind === "customer" ? cgInputs[userId] : kind === "item" ? igInputs[userId] : whInputs[userId]) || "";
    const codes = raw.split(",").map((c) => c.trim()).filter(Boolean);
    const endpoint = { customer: "customer-groups", item: "item-groups", warehouse: "warehouses" }[kind];
    try {
      const res = await fetch(`/api/admin/users/${userId}/${endpoint}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error([data.error, data.message].filter(Boolean).join(" — "));
      setScopeMsg((m) => ({ ...m, [key]: "✓ Saved" }));
    } catch (err) {
      setScopeMsg((m) => ({ ...m, [key]: err instanceof Error ? err.message : "Save failed" }));
    } finally {
      setSavingScope(null);
    }
  };

  useEffect(() => {
    load();
  }, [load]);

  const createUser = async () => {
    setError("");
    if (!form.email || !form.password || !form.fullName || !form.roleId) {
      setError("All fields are required");
      return;
    }
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, roleId: Number(form.roleId) }),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Failed to create admin user");
      return;
    }
    setShowNew(false);
    setForm({ email: "", password: "", fullName: "", roleId: "" });
    await load();
  };

  const toggleActive = async (id: number, value: boolean) => {
    await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: value }),
    });
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, is_active: value ? 1 : 0 } : u)));
  };

  const deleteUser = async (id: number) => {
    if (!confirm("Delete this admin user?")) return;
    await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
    await load();
  };

  const startEdit = (u: AdminUserRow) => {
    setEditingId(u.id);
    setEditForm({
      fullName: u.full_name, email: u.email, roleId: u.role_id ? String(u.role_id) : "",
      password: "", departmentCode: u.department_code || "", ownerCode: u.owner_code || "",
    });
    setEditError("");
  };

  const syncDepartments = async () => {
    setSyncingDepts(true);
    setDeptSyncMsg("");
    try {
      const res = await fetch("/api/admin/cost-centers/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error([data.error, data.message].filter(Boolean).join(" — "));
      setDeptSyncMsg(`✓ Synced ${data.costCentersSynced} codes`);
      await load();
    } catch (err) {
      setDeptSyncMsg(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncingDepts(false);
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditError("");
  };

  const saveEdit = async (u: AdminUserRow) => {
    setEditError("");
    if (!editForm.fullName || !editForm.email) {
      setEditError("Name and email are required");
      return;
    }
    if (editForm.password && editForm.password.length < 6) {
      setEditError("Password must be at least 6 characters");
      return;
    }
    setEditSaving(true);
    try {
      const body: Record<string, string | number> = {
        fullName: editForm.fullName, email: editForm.email,
        departmentCode: editForm.departmentCode, ownerCode: editForm.ownerCode,
      };
      if (!u.is_root && editForm.roleId) body.roleId = Number(editForm.roleId);
      if (editForm.password) body.password = editForm.password;

      const res = await fetch(`/api/admin/users/${u.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error([data.error, data.message].filter(Boolean).join(" — "));
      setEditingId(null);
      await load();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setEditSaving(false);
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>Admin Users</h1>
            <p style={styles.subtitle}>
              All admin accounts, including <strong>root</strong> (unrestricted, marked <strong>ROOT</strong> below) — only
              root can see this page. <strong>Customer Groups</strong>/<strong>Item Groups</strong> (comma-separated codes) scope what
              each admin can see/manage on Customers, SAP Customers, Items, Item Groups and Customer Groups — an admin
              with none assigned sees/manages nothing on those pages. Assigning a group also grants every group
              underneath it. <strong>Warehouse</strong> (comma-separated codes from masterdata
              {masterdataWarehouses.length > 0 ? `: ${masterdataWarehouses.join(", ")}` : ""}) limits which warehouses the
              admin sees on Inventory and can use when creating or pushing orders; root always has them all.
            </p>
          </div>
          {session?.isSuperAdmin && (
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
              <button onClick={syncDepartments} disabled={syncingDepts} style={btn("secondary", syncingDepts)}>
                {syncingDepts ? "Syncing..." : "Sync Departments from SAP"}
              </button>
              {deptSyncMsg && (
                <span style={{ fontSize: "0.75rem", color: deptSyncMsg.startsWith("✓") ? "#059669" : "#DC2626" }}>{deptSyncMsg}</span>
              )}
              <button onClick={() => setShowNew(!showNew)} style={btn("primary")}>{showNew ? "Cancel" : "+ New Admin User"}</button>
            </div>
          )}
        </div>

        {showNew && (
          <div style={styles.cardPadded}>
            {error && <div style={{ color: "#991B1B", fontSize: "0.8125rem", marginBottom: "0.75rem" }}>{error}</div>}
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
              <input style={styles.input} placeholder="Full name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
              <input style={styles.input} placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              <input style={styles.input} type="password" placeholder="Password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              <select style={styles.input} value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })}>
                <option value="">Select role</option>
                {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <button onClick={createUser} style={btn("primary")}>Create admin user</button>
          </div>
        )}

        <div style={styles.card}>
          <LoadingOrEmpty isLoading={isLoading} isEmpty={!isLoading && users.length === 0} emptyLabel="No additional admin users yet" />
          {!isLoading && users.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Name</th>
                    <th style={styles.th}>Email</th>
                    <th style={styles.th}>Role</th>
                    <th style={styles.th}>Active</th>
                    <th style={styles.th}>Department</th>
                    <th style={styles.th}>Owner Code</th>
                    <th style={styles.th}>Customer Groups</th>
                    <th style={styles.th}>Item Groups</th>
                    <th style={styles.th}>Warehouse</th>
                    {session?.isSuperAdmin && <th style={styles.th}>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <Fragment key={u.id}>
                    <tr style={u.is_root ? { background: "var(--bg-secondary, #F8FAFC)" } : undefined}>
                      <td style={styles.td}>
                        {u.full_name}
                        {!!u.is_root && (
                          <span style={{ marginLeft: "0.375rem", fontSize: "0.65rem", fontWeight: 700, color: "#92400E", background: "#FEF3C7", padding: "0.0625rem 0.375rem", borderRadius: "var(--radius-full, 999px)" }}>
                            ROOT
                          </span>
                        )}
                      </td>
                      <td style={styles.td}>{u.email}</td>
                      <td style={styles.td}>{u.is_root ? <em style={{ color: "var(--text-tertiary, #94A3B8)" }}>unrestricted</em> : u.role_name}</td>
                      <td style={styles.td}><Toggle checked={!!u.is_active} onChange={(v) => toggleActive(u.id, v)} /></td>
                      <td style={styles.td}>
                        {u.department_code
                          ? (departments.find((d) => d.ocr_code === u.department_code)?.ocr_name || u.department_code)
                          : <em style={{ color: "var(--text-tertiary, #94A3B8)" }}>— none</em>}
                      </td>
                      <td style={{ ...styles.td, fontFamily: "monospace", fontSize: "0.8125rem" }}>
                        {u.owner_code || <em style={{ fontFamily: "inherit", color: "var(--text-tertiary, #94A3B8)" }}>— none</em>}
                      </td>
                      {u.is_root ? (
                        <>
                          <td style={{ ...styles.td, color: "var(--text-tertiary, #94A3B8)", fontStyle: "italic" }}>— (sees everything)</td>
                          <td style={{ ...styles.td, color: "var(--text-tertiary, #94A3B8)", fontStyle: "italic" }}>— (sees everything)</td>
                          <td style={{ ...styles.td, color: "var(--text-tertiary, #94A3B8)", fontStyle: "italic" }} title={masterdataWarehouses.join(", ")}>
                            — (all in masterdata)
                          </td>
                        </>
                      ) : (
                        <>
                          <td style={styles.td}>
                            <div style={{ display: "flex", gap: "0.375rem" }}>
                              <input
                                type="text"
                                value={cgInputs[u.id] ?? ""}
                                onChange={(e) => setCgInputs((m) => ({ ...m, [u.id]: e.target.value }))}
                                onKeyDown={(e) => e.key === "Enter" && saveScope(u.id, "customer")}
                                placeholder="e.g. GTSO, GTNO"
                                style={{ ...styles.input, width: "140px", padding: "0.25rem 0.5rem", fontSize: "0.75rem" }}
                              />
                              <button onClick={() => saveScope(u.id, "customer")} disabled={savingScope === `${u.id}:customer`} style={smallBtn}>
                                {savingScope === `${u.id}:customer` ? "..." : "Save"}
                              </button>
                            </div>
                            {scopeMsg[`${u.id}:customer`] && (
                              <p style={{ marginTop: "0.25rem", fontSize: "0.7rem", color: scopeMsg[`${u.id}:customer`].startsWith("✓") ? "#059669" : "#DC2626" }}>
                                {scopeMsg[`${u.id}:customer`]}
                              </p>
                            )}
                          </td>
                          <td style={styles.td}>
                            <div style={{ display: "flex", gap: "0.375rem" }}>
                              <input
                                type="text"
                                value={igInputs[u.id] ?? ""}
                                onChange={(e) => setIgInputs((m) => ({ ...m, [u.id]: e.target.value }))}
                                onKeyDown={(e) => e.key === "Enter" && saveScope(u.id, "item")}
                                placeholder="e.g. D1, L1"
                                style={{ ...styles.input, width: "140px", padding: "0.25rem 0.5rem", fontSize: "0.75rem" }}
                              />
                              <button onClick={() => saveScope(u.id, "item")} disabled={savingScope === `${u.id}:item`} style={smallBtn}>
                                {savingScope === `${u.id}:item` ? "..." : "Save"}
                              </button>
                            </div>
                            {scopeMsg[`${u.id}:item`] && (
                              <p style={{ marginTop: "0.25rem", fontSize: "0.7rem", color: scopeMsg[`${u.id}:item`].startsWith("✓") ? "#059669" : "#DC2626" }}>
                                {scopeMsg[`${u.id}:item`]}
                              </p>
                            )}
                          </td>
                          <td style={styles.td}>
                            <div style={{ display: "flex", gap: "0.375rem" }}>
                              <input
                                type="text"
                                value={whInputs[u.id] ?? ""}
                                onChange={(e) => setWhInputs((m) => ({ ...m, [u.id]: e.target.value }))}
                                onKeyDown={(e) => e.key === "Enter" && saveScope(u.id, "warehouse")}
                                placeholder={masterdataWarehouses.length ? `e.g. ${masterdataWarehouses.slice(0, 2).join(", ")}` : "e.g. 1001, 1003"}
                                title={masterdataWarehouses.length ? `Allowed: ${masterdataWarehouses.join(", ")}` : undefined}
                                style={{ ...styles.input, width: "120px", padding: "0.25rem 0.5rem", fontSize: "0.75rem" }}
                              />
                              <button onClick={() => saveScope(u.id, "warehouse")} disabled={savingScope === `${u.id}:warehouse`} style={smallBtn}>
                                {savingScope === `${u.id}:warehouse` ? "..." : "Save"}
                              </button>
                            </div>
                            {scopeMsg[`${u.id}:warehouse`] && (
                              <p style={{ marginTop: "0.25rem", fontSize: "0.7rem", color: scopeMsg[`${u.id}:warehouse`].startsWith("✓") ? "#059669" : "#DC2626" }}>
                                {scopeMsg[`${u.id}:warehouse`]}
                              </p>
                            )}
                          </td>
                        </>
                      )}
                      {session?.isSuperAdmin && (
                        <td style={styles.td}>
                          <div style={{ display: "flex", gap: "0.75rem" }}>
                            <button onClick={() => (editingId === u.id ? cancelEdit() : startEdit(u))} style={{ fontSize: "0.75rem", color: "var(--color-primary, #2563EB)", background: "none", border: "none", cursor: "pointer" }}>
                              {editingId === u.id ? "Cancel" : "Edit"}
                            </button>
                            {!u.is_root && (
                              <button onClick={() => deleteUser(u.id)} style={{ fontSize: "0.75rem", color: "#DC2626", background: "none", border: "none", cursor: "pointer" }}>Delete</button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                    {editingId === u.id && (
                      <tr>
                        <td colSpan={session?.isSuperAdmin ? 10 : 9} style={{ ...styles.td, background: "var(--bg-secondary, #F8FAFC)" }}>
                          {editError && <div style={{ color: "#991B1B", fontSize: "0.8125rem", marginBottom: "0.75rem" }}>{editError}</div>}
                          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                            <input style={styles.input} placeholder="Full name" value={editForm.fullName} onChange={(e) => setEditForm({ ...editForm, fullName: e.target.value })} />
                            <input style={styles.input} placeholder="Email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
                            {!u.is_root && (
                              <select style={styles.input} value={editForm.roleId} onChange={(e) => setEditForm({ ...editForm, roleId: e.target.value })}>
                                <option value="">Select role</option>
                                {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                              </select>
                            )}
                            <select
                              style={styles.input}
                              value={editForm.departmentCode}
                              onChange={(e) => setEditForm({ ...editForm, departmentCode: e.target.value })}
                            >
                              <option value="">No department</option>
                              {departments.map((d) => (
                                <option key={d.ocr_code} value={d.ocr_code}>{d.ocr_name || d.ocr_code}{!d.is_active ? " (inactive)" : ""}</option>
                              ))}
                            </select>
                            <input
                              style={{ ...styles.input, width: "180px" }}
                              placeholder="Owner code (SAP Employee Code)"
                              title="Matched live against the SAP Employee's Employee Code (Human Resources > Employee Master Data) when this admin pushes an order — sets DocumentsOwner/U_OwnerName. Several admins may share the same code. Leave blank to fall back to the integration login's own Employee."
                              value={editForm.ownerCode}
                              onChange={(e) => setEditForm({ ...editForm, ownerCode: e.target.value })}
                            />
                            <input
                              style={styles.input}
                              type="password"
                              placeholder="New password (leave blank to keep current)"
                              value={editForm.password}
                              onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                            />
                            <button onClick={() => saveEdit(u)} disabled={editSaving} style={btn("primary")}>
                              {editSaving ? "Saving..." : "Save"}
                            </button>
                            <button onClick={cancelEdit} style={smallBtn}>Cancel</button>
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const smallBtn = {
  fontSize: "0.7rem", padding: "0 0.5rem", border: "1px solid var(--color-gray-200, #E2E8F0)",
  borderRadius: "var(--radius-md, 6px)", background: "var(--bg-primary, #fff)", cursor: "pointer",
} as const;
