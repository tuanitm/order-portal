"use client";

import { useState, useEffect, useCallback } from "react";
import { styles, btn, Toggle, LoadingOrEmpty } from "../adminUi";
import { useAdminSession } from "../layout";

interface AdminUserRow {
  id: number; email: string; full_name: string; is_active: number; role_id: number; role_name: string; created_at: string;
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

  const load = useCallback(async () => {
    setIsLoading(true);
    const [usersRes, rolesRes] = await Promise.all([
      fetch("/api/admin/users"),
      fetch("/api/admin/roles"),
    ]);
    const usersData = await usersRes.json();
    const rolesData = await rolesRes.json();
    setUsers(usersData.adminUsers || []);
    setRoles(rolesData.roles || []);
    setIsLoading(false);
  }, []);

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
            <p style={styles.subtitle}>Accounts in addition to the config.json bootstrap super-admin.</p>
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
                    {session?.isSuperAdmin && <th style={styles.th}>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td style={styles.td}>{u.full_name}</td>
                      <td style={styles.td}>{u.email}</td>
                      <td style={styles.td}>{u.role_name}</td>
                      <td style={styles.td}><Toggle checked={!!u.is_active} onChange={(v) => toggleActive(u.id, v)} /></td>
                      {session?.isSuperAdmin && (
                        <td style={styles.td}>
                          <button onClick={() => deleteUser(u.id)} style={{ fontSize: "0.75rem", color: "#DC2626", background: "none", border: "none", cursor: "pointer" }}>Delete</button>
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
