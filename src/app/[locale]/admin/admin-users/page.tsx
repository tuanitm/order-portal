"use client";

import { useState, useEffect, useCallback, useRef, type CSSProperties } from "react";
import { styles, btn, Badge, LoadingOrEmpty } from "../adminUi";

type RoleKind = "super_admin" | "admin" | "sales" | "account" | "customer";

/** Staff live in admin_users, customers in users — ids can repeat, so rows carry their table. */
type Account = "staff" | "customer";

interface UserRow {
  account: Account;
  id: number;
  userid: string | null;
  email: string | null;
  phone: string | null;
  full_name: string;
  sap_card_code: string | null;
  sap_card_name: string | null;
  is_active: number;
  must_change_password: number;
  approval_status: "pending" | "approved" | "rejected";
  department_code: string | null;
  owner_code: string | null;
  sap_user_code: string | null;
  sap_password_updated_at: string | null;
  role_id: number | null;
  role_name: string | null;
  role_kind: RoleKind | null;
  order_count: number;
}
interface RoleOption { id: number; name: string; kind: RoleKind }
interface Department { ocr_code: string; ocr_name: string | null }
interface SapCustomer { sap_card_code: string; card_name: string | null }

interface Form {
  id: number | null;
  /** Set when editing; a role change can't move an account between staff and customer. */
  account: Account | null;
  userid: string;
  fullName: string;
  email: string;
  phone: string;
  roleId: string;
  sapCardCode: string;
  sapCardName: string;
  password: string;
  mustChangePassword: boolean;
  isActive: boolean;
  departmentCode: string;
  ownerCode: string;
  sapUserCode: string;
  /** Typed here only to (re)save it — verified by SAP, stored encrypted. */
  sapPassword: string;
  sapPasswordSavedAt: string | null;
}

const KIND_LABEL: Record<RoleKind, string> = { super_admin: "Super Admin", admin: "Admin", sales: "Sales", account: "Accountant", customer: "Customer" };
const KIND_TONE: Record<RoleKind, "error" | "success" | "warning" | "neutral"> = { super_admin: "error", admin: "success", sales: "warning", account: "success", customer: "neutral" };
const TABS: { key: string; label: string }[] = [
  { key: "", label: "All" }, { key: "staff", label: "Staff" }, { key: "super_admin", label: "Super Admin" },
  { key: "admin", label: "Admin" }, { key: "sales", label: "Sales" }, { key: "customer", label: "Customers" },
];

const fieldLabel: CSSProperties = { fontSize: "0.6875rem", fontWeight: 700, color: "var(--text-secondary, #64748B)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "0.25rem", display: "block" };
const hint: CSSProperties = { fontSize: "0.6875rem", color: "var(--text-tertiary, #94A3B8)", marginTop: 2 };

const blankForm = (): Form => ({
  id: null, account: null, userid: "", fullName: "", email: "", phone: "", roleId: "", sapCardCode: "", sapCardName: "",
  password: "", mustChangePassword: true, isActive: true, departmentCode: "", ownerCode: "", sapUserCode: "", sapPassword: "", sapPasswordSavedAt: null,
});

const userUrl = (u: { id: number | null; account: Account | null }) => `/api/admin/users/${u.id}?account=${u.account ?? "customer"}`;

/** Type-ahead over SAP Customers (synced BPs). */
function SapCustomerPicker({ code, name, onPick }: { code: string; name: string; onPick: (code: string, name: string) => void }) {
  const [text, setText] = useState(code);
  const [results, setResults] = useState<SapCustomer[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setText(code); }, [code]);

  const search = (value: string) => {
    setText(value);
    onPick(value.trim(), "");
    if (timer.current) clearTimeout(timer.current);
    if (value.trim().length < 2) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      const res = await fetch(`/api/admin/sap-customers?search=${encodeURIComponent(value.trim())}&limit=15`);
      const data = await res.json();
      setResults(data.customers || []);
      setOpen(true);
    }, 300);
  };

  return (
    <div style={{ position: "relative" }}>
      <input style={{ ...styles.input, width: "100%" }} value={text} placeholder="Type code or name…"
        onChange={(e) => search(e.target.value)} onFocus={() => results.length && setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {name && <div style={{ ...hint, color: "var(--text-secondary, #64748B)" }}>{name}</div>}
      {open && results.length > 0 && (
        <div style={{ position: "absolute", zIndex: 20, top: "100%", left: 0, right: 0, maxHeight: 240, overflowY: "auto", background: "var(--bg-primary, #fff)", border: "1px solid var(--color-gray-200, #E2E8F0)", borderRadius: 6, boxShadow: "0 8px 24px rgba(15,23,42,0.12)" }}>
          {results.map((c) => (
            <div key={c.sap_card_code} onMouseDown={() => { onPick(c.sap_card_code, c.card_name || ""); setText(c.sap_card_code); setOpen(false); }}
              style={{ padding: "0.375rem 0.625rem", cursor: "pointer", fontSize: "0.8125rem", borderBottom: "1px solid var(--color-gray-100, #F1F5F9)" }}>
              <strong style={{ fontFamily: "monospace" }}>{c.sap_card_code}</strong> <span style={{ color: "var(--text-secondary, #64748B)" }}>{c.card_name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function UsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [tab, setTab] = useState("");
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([fetch("/api/admin/roles").then((r) => r.json()), fetch("/api/admin/cost-centers?dimension=2").then((r) => r.json())])
      .then(([r, d]) => { setRoles(r.roles || []); setDepartments(d.costCenters || []); })
      .catch(() => {});
  }, []);

  const load = useCallback(async (k: string, s: string) => {
    setIsLoading(true);
    const p = new URLSearchParams();
    if (k) p.set("kind", k);
    if (s.trim()) p.set("search", s.trim());
    const res = await fetch(`/api/admin/users?${p}`);
    const data = await res.json();
    setUsers(data.users || []);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(tab, search), 300);
    return () => clearTimeout(t);
  }, [tab, search, load]);

  const formKind: RoleKind | null = form ? roles.find((r) => String(r.id) === form.roleId)?.kind ?? null : null;
  const isStaff = formKind !== null && formKind !== "customer";
  // Accountants approve as their SAP user; Admin / Sales users push orders as it (Super Admin uses admin02).
  const hasSapAccount = formKind === "account" || formKind === "admin" || formKind === "sales" || formKind === "super_admin";

  const edit = (u: UserRow | null) => {
    setError("");
    setForm(u ? {
      id: u.id, account: u.account, userid: u.userid ?? "", fullName: u.full_name, email: u.email ?? "", phone: u.phone ?? "",
      roleId: u.role_id ? String(u.role_id) : "", sapCardCode: u.sap_card_code ?? "", sapCardName: u.sap_card_name ?? "",
      password: "", mustChangePassword: !!u.must_change_password, isActive: !!u.is_active,
      departmentCode: u.department_code ?? "", ownerCode: u.owner_code ?? "", sapUserCode: u.sap_user_code ?? "",
      sapPassword: "", sapPasswordSavedAt: u.sap_password_updated_at ?? null,
    } : blankForm());
  };

  const save = async () => {
    if (!form) return;
    setSaving(true);
    setError("");
    try {
      const body: Record<string, unknown> = {
        userid: form.userid, fullName: form.fullName, email: form.email, phone: form.phone, roleId: Number(form.roleId),
        mustChangePassword: form.mustChangePassword,
      };
      if (formKind === "customer") body.sapCardCode = form.sapCardCode;
      if (isStaff) { body.departmentCode = form.departmentCode; body.ownerCode = form.ownerCode; }
      if (hasSapAccount) body.sapUserCode = form.sapUserCode;
      if (form.password) body.password = form.password;
      if (form.id) body.isActive = form.isActive;
      const res = await fetch(form.id ? userUrl(form) : "/api/admin/users", {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      // Accountant's SAP password: its own call (verified by an SAP login, never in the audit log).
      if (hasSapAccount && form.sapPassword) {
        const userId = form.id ?? data.userId;
        const r2 = await fetch(`/api/admin/users/${userId}/sap-account`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sapUserCode: form.sapUserCode, password: form.sapPassword }),
        });
        const d2 = await r2.json().catch(() => ({}));
        if (!r2.ok) {
          await load(tab, search);
          throw new Error(`User saved, but the SAP password was not: ${d2.error || "SAP check failed"}`);
        }
      }
      setForm(null);
      await load(tab, search);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const quickPatch = async (u: UserRow, patch: Record<string, unknown>) => {
    const res = await fetch(userUrl(u), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    const data = await res.json();
    if (!res.ok) alert(data.error || "Update failed");
    await load(tab, search);
  };

  const remove = async (u: UserRow) => {
    if (!confirm(`Delete user "${u.userid || u.email}"?`)) return;
    const res = await fetch(userUrl(u), { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) alert(data.error || "Delete failed");
    await load(tab, search);
  };

  const canSave = !!form && !!form.fullName.trim() && !!form.roleId && (form.id !== null || form.password.length >= 6)
    && (formKind !== "customer" || !!form.sapCardCode.trim()) && (!isStaff || (!!form.userid.trim() && !!form.email.trim()))
    && (!hasSapAccount || !form.sapPassword || !!form.sapUserCode.trim());

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>Users</h1>
            <p style={styles.subtitle}>
              Every account — staff and customers. Each user has one role and inherits its functions and data permissions.
              Users sign in with their User ID or email.
            </p>
          </div>
          <button style={btn("primary")} onClick={() => edit(null)}>＋ New user</button>
        </div>

        {form && (
          <div style={{ ...styles.cardPadded, borderColor: "var(--color-primary, #2BBCB3)" }}>
            <h2 style={{ fontSize: "1.05rem", fontWeight: 800, marginBottom: "1rem" }}>{form.id ? `Edit user — ${form.userid || form.email}` : "New user"}</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.875rem 1rem" }}>
              <div>
                <span style={fieldLabel}>Role *</span>
                <select style={{ ...styles.input, width: "100%" }} value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })}>
                  <option value="">— Choose a role —</option>
                  {(["super_admin", "admin", "sales", "account", "customer"] as RoleKind[])
                    // Editing: only roles of the same table (staff ↔ customer can't be switched).
                    .filter((k) => !form.account || (form.account === "customer") === (k === "customer"))
                    .map((k) => {
                    const list = roles.filter((r) => r.kind === k);
                    return list.length ? (
                      <optgroup key={k} label={KIND_LABEL[k]}>
                        {list.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </optgroup>
                    ) : null;
                  })}
                </select>
                {formKind && <div style={hint}>Signs in to {formKind === "customer" ? "the storefront (/customer)" : formKind === "sales" ? "/sales" : "/admin"}</div>}
              </div>
              <div>
                <span style={fieldLabel}>User ID {isStaff ? "*" : ""}</span>
                {formKind === "customer" ? (
                  <>
                    <input style={{ ...styles.input, width: "100%", background: "var(--bg-secondary, #F8FAFC)" }} value={form.sapCardCode} readOnly placeholder="= SAP customer code" />
                    <div style={hint}>Always the SAP customer code (set automatically)</div>
                  </>
                ) : (
                  <>
                    <input style={{ ...styles.input, width: "100%" }} value={form.userid} onChange={(e) => setForm({ ...form, userid: e.target.value })} placeholder="e.g. nguyenvana" />
                    <div style={hint}>3–50 letters, digits, . _ - · unique</div>
                  </>
                )}
              </div>
              <div>
                <span style={fieldLabel}>Name *</span>
                <input style={{ ...styles.input, width: "100%" }} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
              </div>
              <div>
                <span style={fieldLabel}>Email{isStaff ? " *" : ""}</span>
                <input style={{ ...styles.input, width: "100%" }} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                <div style={hint}>Unique · also works for sign-in</div>
              </div>
              <div>
                <span style={fieldLabel}>Phone</span>
                <input style={{ ...styles.input, width: "100%" }} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              {formKind === "customer" && (
                <div>
                  <span style={fieldLabel}>SAP customer code *</span>
                  <SapCustomerPicker code={form.sapCardCode} name={form.sapCardName}
                    onPick={(code, name) => setForm((f) => (f ? { ...f, sapCardCode: code, sapCardName: name } : f))} />
                  <div style={hint}>The user orders for this customer on the storefront</div>
                </div>
              )}
              {isStaff && (
                <>
                  <div>
                    <span style={fieldLabel}>Department</span>
                    <select style={{ ...styles.input, width: "100%" }} value={form.departmentCode} onChange={(e) => setForm({ ...form, departmentCode: e.target.value })}>
                      <option value="">—</option>
                      {departments.map((d) => <option key={d.ocr_code} value={d.ocr_code}>{d.ocr_code}{d.ocr_name ? ` · ${d.ocr_name}` : ""}</option>)}
                    </select>
                  </div>
                  <div>
                    <span style={fieldLabel}>SAP owner code</span>
                    <input style={{ ...styles.input, width: "100%" }} value={form.ownerCode} onChange={(e) => setForm({ ...form, ownerCode: e.target.value })} />
                    <div style={hint}>Employee external no. → SO Owner</div>
                  </div>
                  {hasSapAccount && (
                    <>
                      <div>
                        <span style={fieldLabel}>SAP user code</span>
                        <input style={{ ...styles.input, width: "100%" }} value={form.sapUserCode} placeholder="e.g. acc01"
                          onChange={(e) => setForm({ ...form, sapUserCode: e.target.value })} />
                        <div style={hint}>{formKind === "account"
                          ? "SAP B1 user this Accountant approves as (SAP Approval Stages)."
                          : formKind === "super_admin"
                          ? "SAP B1 user this System Admin posts AR Invoices as (e.g. sa01; SAP approval templates apply). Their Sales Order pushes still use admin02."
                          : "SAP B1 user this user pushes orders to SAP as (SAP creator / approval originator, e.g. sa01). Empty = pushes as the default SAP user admin02."} The user can also set it in My Profile.</div>
                      </div>
                      <div>
                        <span style={fieldLabel}>SAP password</span>
                        <input type="password" autoComplete="new-password" style={{ ...styles.input, width: "100%" }} value={form.sapPassword}
                          placeholder={form.sapPasswordSavedAt ? "•••••• saved — type to replace" : "not saved"}
                          onChange={(e) => setForm({ ...form, sapPassword: e.target.value })} />
                        <div style={hint}>
                          {form.sapPasswordSavedAt ? `Saved ${form.sapPasswordSavedAt.slice(0, 16).replace("T", " ")}. ` : ""}
                          Checked with an SAP login, stored encrypted (Fernet). Changing the SAP user code clears it.
                        </div>
                      </div>
                    </>
                  )}
                </>
              )}
              <div>
                <span style={fieldLabel}>{form.id ? "New password" : "Password *"}</span>
                <input style={{ ...styles.input, width: "100%" }} type="password" autoComplete="new-password" value={form.password}
                  placeholder={form.id ? "Leave blank to keep" : "At least 6 characters"} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </div>
            </div>
            <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", marginTop: "0.875rem", fontSize: "0.8125rem" }}>
              <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
                <input type="checkbox" checked={form.mustChangePassword} onChange={(e) => setForm({ ...form, mustChangePassword: e.target.checked })} />
                Change password at next login
              </label>
              {form.id && (
                <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
                  <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
                  Active
                </label>
              )}
            </div>
            {error && <p style={{ color: "#DC2626", fontSize: "0.8125rem", marginTop: "0.75rem" }}>{error}</p>}
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
              <button style={btn("primary", saving || !canSave)} disabled={saving || !canSave} onClick={save}>{saving ? "Saving…" : "Save user"}</button>
              <button style={btn("secondary")} onClick={() => setForm(null)}>Cancel</button>
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap", alignItems: "center" }}>
          {TABS.map((t) => (
            <button key={t.key || "all"} onClick={() => setTab(t.key)} style={{
              padding: "0.375rem 0.875rem", borderRadius: "var(--radius-full)", fontSize: "0.75rem", fontWeight: 600, cursor: "pointer",
              background: tab === t.key ? "var(--color-primary, #2BBCB3)" : "var(--bg-primary, #fff)",
              color: tab === t.key ? "#fff" : "var(--text-secondary, #64748B)",
              border: tab === t.key ? "none" : "1px solid var(--color-gray-200, #E2E8F0)",
            }}>{t.label}</button>
          ))}
          <input style={{ ...styles.input, minWidth: 240, marginLeft: "auto" }} placeholder="🔍 User ID, name, email, SAP code, phone"
            value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        <div style={styles.card}>
          <LoadingOrEmpty isLoading={isLoading} isEmpty={!isLoading && users.length === 0} emptyLabel="No users match" />
          {!isLoading && users.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>User ID</th>
                    <th style={styles.th}>Name</th>
                    <th style={styles.th}>Email / Phone</th>
                    <th style={styles.th}>Role</th>
                    <th style={styles.th}>SAP Customer</th>
                    <th style={styles.th}>Status</th>
                    <th style={styles.th}>Change pwd next login</th>
                    <th style={styles.th}></th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={`${u.account}-${u.id}`} style={{ opacity: u.is_active ? 1 : 0.55 }}>
                      <td style={{ ...styles.td, fontFamily: "monospace", fontWeight: 700 }}>{u.userid || <span style={{ color: "var(--text-tertiary, #94A3B8)" }}>—</span>}</td>
                      <td style={styles.td}>{u.full_name}</td>
                      <td style={{ ...styles.td, fontSize: "0.75rem" }}>
                        <div>{u.email || "—"}</div>
                        {u.phone && <div style={{ color: "var(--text-tertiary, #94A3B8)" }}>{u.phone}</div>}
                      </td>
                      <td style={styles.td}>
                        {u.role_kind ? <Badge label={u.role_name || KIND_LABEL[u.role_kind]} tone={KIND_TONE[u.role_kind]} /> : <em style={{ color: "#DC2626" }}>no role</em>}
                      </td>
                      <td style={{ ...styles.td, fontSize: "0.75rem" }}>
                        {u.sap_card_code ? (<><strong style={{ fontFamily: "monospace" }}>{u.sap_card_code}</strong><div style={{ color: "var(--text-tertiary, #94A3B8)" }}>{u.sap_card_name}</div></>) : "—"}
                      </td>
                      <td style={styles.td}>
                        {!u.is_active ? <Badge label="Inactive" tone="neutral" />
                          : u.role_kind === "customer" && u.approval_status !== "approved"
                            ? <Badge label={u.approval_status === "pending" ? "Pending approval" : "Rejected"} tone={u.approval_status === "pending" ? "warning" : "error"} />
                            : <Badge label="Active" tone="success" />}
                      </td>
                      <td style={{ ...styles.td, textAlign: "center" }}>
                        <input type="checkbox" checked={!!u.must_change_password} title="Change password at next login"
                          onChange={(e) => quickPatch(u, { mustChangePassword: e.target.checked })} />
                      </td>
                      <td style={{ ...styles.td, whiteSpace: "nowrap" }}>
                        <button style={{ ...btn("secondary"), padding: "0.25rem 0.625rem" }} onClick={() => edit(u)}>Edit</button>{" "}
                        <button style={{ ...btn("secondary"), padding: "0.25rem 0.625rem" }} onClick={() => quickPatch(u, { isActive: !u.is_active })}>
                          {u.is_active ? "Deactivate" : "Activate"}
                        </button>{" "}
                        <button style={{ ...btn("danger", u.order_count > 0), padding: "0.25rem 0.625rem" }} disabled={u.order_count > 0}
                          title={u.order_count > 0 ? `Has ${u.order_count} order(s) — deactivate instead` : undefined} onClick={() => remove(u)}>Delete</button>
                      </td>
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
