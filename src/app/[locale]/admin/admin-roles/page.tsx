"use client";

import { useState, useEffect, useCallback } from "react";
import { styles, btn, LoadingOrEmpty } from "../adminUi";
import type { AdminPermission } from "@/lib/auth/adminSession";

interface Role {
  id: number;
  name: string;
  description: string | null;
  permissions: AdminPermission[];
}

export default function AdminRolesPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [available, setAvailable] = useState<AdminPermission[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newPermissions, setNewPermissions] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setIsLoading(true);
    const res = await fetch("/api/admin/roles");
    const data = await res.json();
    setRoles(data.roles || []);
    setAvailable(data.availablePermissions || []);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const togglePermission = (roleId: number, permission: AdminPermission, has: boolean) => {
    const role = roles.find((r) => r.id === roleId);
    if (!role) return;
    const permissions = has ? role.permissions.filter((p) => p !== permission) : [...role.permissions, permission];
    setRoles((prev) => prev.map((r) => (r.id === roleId ? { ...r, permissions } : r)));
    fetch(`/api/admin/roles/${roleId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ permissions }),
    });
  };

  const createRole = async () => {
    if (!newName.trim()) return;
    await fetch("/api/admin/roles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName, description: newDescription, permissions: [...newPermissions] }),
    });
    setShowNew(false);
    setNewName("");
    setNewDescription("");
    setNewPermissions(new Set());
    await load();
  };

  const deleteRole = async (id: number) => {
    if (!confirm("Delete this role?")) return;
    const res = await fetch(`/api/admin/roles/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json();
      alert(data.error || "Failed to delete role");
      return;
    }
    await load();
  };

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>Admin Roles</h1>
            <p style={styles.subtitle}>Each role grants access to whole sections (not per-action). The config.json bootstrap admin is always a super-admin with everything.</p>
          </div>
          <button onClick={() => setShowNew(!showNew)} style={btn("primary")}>{showNew ? "Cancel" : "+ New Role"}</button>
        </div>

        {showNew && (
          <div style={{ ...styles.cardPadded }}>
            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
              <input style={styles.input} placeholder="Role name" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <input style={{ ...styles.input, flex: 1 }} placeholder="Description (optional)" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem" }}>
              {available.map((p) => {
                const checked = newPermissions.has(p);
                return (
                  <button
                    key={p}
                    onClick={() => {
                      const next = new Set(newPermissions);
                      checked ? next.delete(p) : next.add(p);
                      setNewPermissions(next);
                    }}
                    style={{
                      padding: "0.375rem 0.75rem", borderRadius: "var(--radius-full)", border: "none",
                      fontSize: "0.75rem", fontWeight: 600, cursor: "pointer",
                      background: checked ? "#D1FAE5" : "#F1F5F9", color: checked ? "#065F46" : "#475569",
                    }}
                  >
                    {p}
                  </button>
                );
              })}
            </div>
            <button onClick={createRole} style={btn("primary")}>Create role</button>
          </div>
        )}

        <div style={styles.card}>
          <LoadingOrEmpty isLoading={isLoading} isEmpty={!isLoading && roles.length === 0} emptyLabel="No roles yet" />
          {!isLoading && roles.map((role) => (
            <div key={role.id} style={{ padding: "1rem", borderBottom: "1px solid var(--color-gray-200, #E2E8F0)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                <div>
                  <strong>{role.name}</strong>
                  {role.description && <span style={{ color: "var(--text-tertiary, #94A3B8)", fontSize: "0.8125rem", marginLeft: "0.5rem" }}>{role.description}</span>}
                </div>
                <button onClick={() => deleteRole(role.id)} style={{ fontSize: "0.75rem", color: "#DC2626", background: "none", border: "none", cursor: "pointer" }}>Delete</button>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem" }}>
                {available.map((p) => {
                  const has = role.permissions.includes(p);
                  return (
                    <button
                      key={p}
                      onClick={() => togglePermission(role.id, p, has)}
                      style={{
                        padding: "0.25rem 0.625rem", borderRadius: "var(--radius-full)", border: "none",
                        fontSize: "0.6875rem", fontWeight: 600, cursor: "pointer",
                        background: has ? "#D1FAE5" : "#F1F5F9", color: has ? "#065F46" : "#94A3B8",
                      }}
                    >
                      {p}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
