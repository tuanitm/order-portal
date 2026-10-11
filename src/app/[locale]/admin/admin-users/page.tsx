"use client";

import { useState, useEffect, useCallback } from "react";
import { styles, btn, Toggle, LoadingOrEmpty } from "../adminUi";
import { useAdminSession } from "../layout";

interface AdminUserRow {
  id: number; email: string; full_name: string; is_active: number; is_root: number;
  role_id: number | null; role_name: string | null; created_at: string;
}
interface Role { id: number; name: string }

export default function AdminUsersPage() {
  const session = useAdminSession();
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", fullName: "", roleId: "" });
  const [error, setError] = useState("");

  // Per-admin data scoping — Customer Groups / Item Groups the admin may
  // see/manage (default: none, until root assigns some — see adminScope.ts).
  const [cgInputs, setCgInputs] = useState<Record<number, string>>({});
  const [igInputs, setIgInputs] = useState<Record<number, string>>({});
  const [savingScope, setSavingScope] = useState<string | null>(null); // `${userId}:customer`|`${userId}:item`
  const [scopeMsg, setScopeMsg] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setIsLoading(true);
    const [usersRes, rolesRes] = await Promise.all([
      fetch("/api/admin/users"),
      fetch("/api/admin/roles"),
    ]);
    const usersData = await usersRes.json();
    const rolesData = await rolesRes.json();
    const loadedUsers: AdminUserRow[] = usersData.adminUsers || [];
    setUsers(loadedUsers);
    setRoles(rolesData.roles || []);
    setIsLoading(false);

    // Seed each admin's two scope textboxes from their current assignments.
    await Promise.all(
      loadedUsers.map(async (u) => {
        const [cgRes, igRes] = await Promise.all([
          fetch(`/api/admin/users/${u.id}/customer-groups`),
          fetch(`/api/admin/users/${u.id}/item-groups`),
        ]);
        const cgData = await cgRes.json();
        const igData = await igRes.json();
        setCgInputs((m) => (u.id in m ? m : { ...m, [u.id]: (cgData.codes || []).join(", ") }));
        setIgInputs((m) => (u.id in m ? m : { ...m, [u.id]: (igData.codes || []).join(", ") }));
      })
    );
  }, []);

  const saveScope = async (userId: number, kind: "customer" | "item") => {
    const key = `${userId}:${kind}`;
    setSavingScope(key);
    setScopeMsg((m) => ({ ...m, [key]: "" }));
    const raw = (kind === "customer" ? cgInputs[userId] : igInputs[userId]) || "";
    const codes = raw.split(",").map((c) => c.trim()).filter(Boolean);
    try {
      const res = await fetch(`/api/admin/users/${userId}/${kind === "customer" ? "customer-groups" : "item-groups"}`, {
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
              underneath it.
            </p>
          </div>
          {session?.isSuperAdmin && (
            <button onClick={() => setShowNew(!showNew)} style={btn("primary")}>{showNew ? "Cancel" : "+ New Admin User"}</button>
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
                    <th style={styles.th}>Customer Groups</th>
                    <th style={styles.th}>Item Groups</th>
                    {session?.isSuperAdmin && <th style={styles.th}>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} style={u.is_root ? { background: "var(--bg-secondary, #F8FAFC)" } : undefined}>
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
                      {u.is_root ? (
                        <>
                          <td style={{ ...styles.td, color: "var(--text-tertiary, #94A3B8)", fontStyle: "italic" }}>— (sees everything)</td>
                          <td style={{ ...styles.td, color: "var(--text-tertiary, #94A3B8)", fontStyle: "italic" }}>— (sees everything)</td>
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
                        </>
                      )}
                      {session?.isSuperAdmin && (
                        <td style={styles.td}>
                          {!u.is_root && (
                            <button onClick={() => deleteUser(u.id)} style={{ fontSize: "0.75rem", color: "#DC2626", background: "none", border: "none", cursor: "pointer" }}>Delete</button>
                          )}
                        </td>
                      )}
                    </tr>
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
