"use client";

import { useState, useEffect, useCallback, type CSSProperties } from "react";
import { styles, btn, Badge, LoadingOrEmpty } from "../adminUi";

type RoleKind = "super_admin" | "admin" | "sales" | "customer";
type ScopeField = "brands" | "channels" | "customer_groups" | "item_groups" | "warehouses";

interface Role {
  id: number;
  name: string;
  description: string | null;
  kind: RoleKind;
  permissions: string[];
  scope: Record<ScopeField, string[]>;
  user_count: number;
}

interface CodeOption { code: string; name: string | null; level?: number }
interface Options {
  permissions: string[];
  brands: CodeOption[];
  channels: CodeOption[];
  customerGroups: CodeOption[];
  itemGroups: CodeOption[];
  warehouses: string[];
}

const KIND_LABEL: Record<RoleKind, string> = { super_admin: "Super Admin", admin: "Admin", sales: "Sales", customer: "Customer" };
const KIND_TONE: Record<RoleKind, "error" | "success" | "warning" | "neutral"> = { super_admin: "error", admin: "success", sales: "warning", customer: "neutral" };
const KIND_HELP: Record<RoleKind, string> = {
  super_admin: "Every function and all data — nothing to configure.",
  admin: "Signs in to /admin. Choose its functions and data permissions.",
  sales: "Signs in to /sales (Orders, Inventory, My Profile). Choose its functions and data permissions.",
  customer: "Signs in to the storefront for the SAP customer set on the user. No admin functions; data permissions are optional (empty = no limit), no Customer Groups.",
};
const SCOPE_FIELDS: { key: ScopeField; label: string; required: boolean }[] = [
  { key: "brands", label: "Brands", required: true },
  { key: "channels", label: "Channels", required: true },
  { key: "customer_groups", label: "Customer Groups", required: true },
  { key: "item_groups", label: "Product Groups", required: true },
  { key: "warehouses", label: "Warehouses", required: false },
];
/** Readable names for the function keys. */
const FUNCTION_LABEL: Record<string, string> = {
  dashboard: "Dashboard", customers: "Customer Approval", "sap-customers": "SAP Customers", "customer-groups": "Customer Groups",
  "catalog-visibility": "Catalog Visibility", items: "Items", "item-groups": "Item Groups", "price-lists": "Price Lists",
  warehouses: "Warehouses", "contract-discounts": "Contract Discount", promotions: "Promotion Discount", orders: "Orders", inventory: "Inventory",
};

interface Draft {
  id: number | null;
  name: string;
  description: string;
  kind: RoleKind;
  permissions: Set<string>;
  scope: Record<ScopeField, Set<string>>;
}

const emptyScope = (): Record<ScopeField, Set<string>> => ({
  brands: new Set(), channels: new Set(), customer_groups: new Set(), item_groups: new Set(), warehouses: new Set(),
});

const label: CSSProperties = { fontSize: "0.6875rem", fontWeight: 700, color: "var(--text-secondary, #64748B)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "0.375rem", display: "block" };
const chipBox: CSSProperties = { display: "flex", flexWrap: "wrap", gap: "0.375rem" };

function Chip({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button type="button" onClick={onClick} title={title} style={{
      padding: "0.25rem 0.625rem", borderRadius: 999, fontSize: "0.75rem", cursor: "pointer", fontWeight: on ? 700 : 500,
      border: `1px solid ${on ? "var(--color-primary, #2BBCB3)" : "var(--color-gray-200, #E2E8F0)"}`,
      background: on ? "rgba(43,188,179,0.12)" : "var(--bg-primary, #fff)",
      color: on ? "var(--text-primary, #0F172A)" : "var(--text-secondary, #64748B)",
    }}>
      {on ? "✓ " : ""}{children}
    </button>
  );
}

/** Group codes picked from a list (with a filter box — there can be many). */
function GroupPicker({ options, selected, onToggle }: { options: CodeOption[]; selected: Set<string>; onToggle: (code: string) => void }) {
  const [filter, setFilter] = useState("");
  const shown = options.filter((o) => !filter || `${o.code} ${o.name ?? ""}`.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div>
      <input style={{ ...styles.input, width: 260, padding: "0.25rem 0.5rem", fontSize: "0.75rem", marginBottom: "0.375rem" }}
        placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div style={{ ...chipBox, maxHeight: 150, overflowY: "auto", padding: 2 }}>
        {[...selected].filter((c) => !options.some((o) => o.code === c)).map((c) => (
          <Chip key={c} on onClick={() => onToggle(c)} title="Not found any more">{c}</Chip>
        ))}
        {shown.map((o) => (
          <Chip key={`${o.level ?? ""}:${o.code}`} on={selected.has(o.code)} onClick={() => onToggle(o.code)} title={o.name ?? undefined}>
            {o.level ? <span style={{ opacity: 0.6 }}>L{o.level} </span> : null}{o.code}
          </Chip>
        ))}
      </div>
    </div>
  );
}

export default function RolesPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [options, setOptions] = useState<Options | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    const res = await fetch("/api/admin/roles");
    const data = await res.json();
    setRoles(data.roles || []);
    setOptions(data.options || null);
    setIsLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const edit = (r: Role | null) => {
    setError("");
    setDraft(r
      ? { id: r.id, name: r.name, description: r.description ?? "", kind: r.kind, permissions: new Set(r.permissions),
          scope: Object.fromEntries(SCOPE_FIELDS.map((f) => [f.key, new Set(r.scope[f.key])])) as Record<ScopeField, Set<string>> }
      : { id: null, name: "", description: "", kind: "admin", permissions: new Set(), scope: emptyScope() });
  };

  /** A new role pre-filled from `r` — its functions and data permissions — under a free name. */
  const duplicate = (r: Role) => {
    const names = new Set(roles.map((x) => x.name.toLowerCase()));
    let name = `${r.name} (copy)`;
    for (let n = 2; names.has(name.toLowerCase()); n++) name = `${r.name} (copy ${n})`;
    setError("");
    setDraft({
      id: null, name, description: r.description ?? "", kind: r.kind, permissions: new Set(r.permissions),
      scope: Object.fromEntries(SCOPE_FIELDS.map((f) => [f.key, new Set(r.scope[f.key])])) as Record<ScopeField, Set<string>>,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const toggle = (set: Set<string>, code: string) => { const next = new Set(set); if (next.has(code)) next.delete(code); else next.add(code); return next; };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(draft.id ? `/api/admin/roles/${draft.id}` : "/api/admin/roles", {
        method: draft.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name, description: draft.description, kind: draft.kind, permissions: [...draft.permissions],
          scope: Object.fromEntries(SCOPE_FIELDS.map((f) => [f.key, [...draft.scope[f.key]]])),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setDraft(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (r: Role) => {
    if (!confirm(`Delete role "${r.name}"?`)) return;
    const res = await fetch(`/api/admin/roles/${r.id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) alert(data.error || "Delete failed");
    await load();
  };

  const staffKind = draft && (draft.kind === "admin" || draft.kind === "sales");
  const isCustomer = draft?.kind === "customer";

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>Roles</h1>
            <p style={styles.subtitle}>
              Every user has one role. A role sets which functions its users can use and which data they see —
              users inherit both. Super Admin always has everything.
            </p>
          </div>
          <button style={btn("primary")} onClick={() => edit(null)}>＋ New role</button>
        </div>

        {draft && options && (
          <div style={{ ...styles.cardPadded, borderColor: "var(--color-primary, #2BBCB3)" }}>
            <h2 style={{ fontSize: "1.05rem", fontWeight: 800, marginBottom: "1rem" }}>{draft.id ? `Edit role — ${draft.name}` : "New role"}</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "1rem", marginBottom: "1rem" }}>
              <div>
                <span style={label}>Name *</span>
                <input style={{ ...styles.input, width: "100%" }} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </div>
              <div>
                <span style={label}>Description</span>
                <input style={{ ...styles.input, width: "100%" }} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              </div>
              <div>
                <span style={label}>Role type *</span>
                <select style={{ ...styles.input, width: "100%" }} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as RoleKind })}>
                  {(Object.keys(KIND_LABEL) as RoleKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                </select>
                <div style={{ fontSize: "0.75rem", color: "var(--text-tertiary, #94A3B8)", marginTop: 4 }}>{KIND_HELP[draft.kind]}</div>
              </div>
            </div>

            {staffKind && (
                <div style={{ marginBottom: "1rem" }}>
                  <span style={label}>Functions</span>
                  <div style={chipBox}>
                    {options.permissions.map((p) => (
                      <Chip key={p} on={draft.permissions.has(p)} onClick={() => setDraft({ ...draft, permissions: toggle(draft.permissions, p) })}>
                        {FUNCTION_LABEL[p] ?? p}
                      </Chip>
                    ))}
                  </div>
                  {draft.kind === "sales" && (
                    <div style={{ fontSize: "0.75rem", color: "var(--text-tertiary, #94A3B8)", marginTop: 4 }}>
                      The Sales area shows Orders and Inventory — give it at least Orders.
                    </div>
                  )}
                </div>
            )}
            {(staffKind || isCustomer) && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "1rem" }}>
                  {SCOPE_FIELDS.filter((f) => !(isCustomer && f.key === "customer_groups")).map((f) => {
                    const sel = draft.scope[f.key];
                    const setSel = (code: string) => setDraft({ ...draft, scope: { ...draft.scope, [f.key]: toggle(sel, code) } });
                    return (
                      <div key={f.key}>
                        <span style={label}>{f.label}{f.required && !isCustomer ? " *" : ""} <span style={{ fontWeight: 500, textTransform: "none" }}>({sel.size})</span></span>
                        {f.key === "brands" && <div style={chipBox}>{options.brands.map((b) => <Chip key={b.code} on={sel.has(b.code)} onClick={() => setSel(b.code)} title={b.name ?? undefined}>{b.code}{b.name ? ` · ${b.name}` : ""}</Chip>)}</div>}
                        {f.key === "channels" && <div style={chipBox}>{options.channels.map((c) => <Chip key={c.code} on={sel.has(c.code)} onClick={() => setSel(c.code)} title={c.name ?? undefined}>{c.code}</Chip>)}</div>}
                        {f.key === "warehouses" && <div style={chipBox}>{options.warehouses.map((w) => <Chip key={w} on={sel.has(w)} onClick={() => setSel(w)}>{w}</Chip>)}</div>}
                        {f.key === "customer_groups" && <GroupPicker options={options.customerGroups} selected={sel} onToggle={setSel} />}
                        {f.key === "item_groups" && <GroupPicker options={options.itemGroups} selected={sel} onToggle={setSel} />}
                      </div>
                    );
                  })}
                </div>
                <p style={{ fontSize: "0.75rem", color: "var(--text-tertiary, #94A3B8)", marginTop: "0.75rem" }}>
                  {isCustomer ? (
                    <>
                      Leave a list empty for no limit. Brands and Product Groups limit the products on the storefront; Warehouses
                      (when set) are the stock warehouses instead of the customer group&apos;s; Channels limit which SAP customers
                      can be given this role. A group includes all its sub-groups. (No Customer Groups — each user is one SAP customer.)
                    </>
                  ) : (<>
                  A group includes all its sub-groups. Customer Groups are limited to the chosen Channels. Users of this role only see
                  customers, items, orders and stock inside these lists.
                  </>)}
                </p>
              </>
            )}

            {error && <p style={{ color: "#DC2626", fontSize: "0.8125rem", marginTop: "0.75rem" }}>{error}</p>}
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
              <button style={btn("primary", saving)} disabled={saving || !draft.name.trim()} onClick={save}>{saving ? "Saving…" : "Save role"}</button>
              <button style={btn("secondary")} onClick={() => setDraft(null)}>Cancel</button>
            </div>
          </div>
        )}

        <div style={styles.card}>
          <LoadingOrEmpty isLoading={isLoading} isEmpty={!isLoading && roles.length === 0} emptyLabel="No roles yet" />
          {!isLoading && roles.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Role</th>
                    <th style={styles.th}>Type</th>
                    <th style={styles.th}>Functions</th>
                    <th style={styles.th}>Data permissions</th>
                    <th style={styles.th}>Users</th>
                    <th style={styles.th}></th>
                  </tr>
                </thead>
                <tbody>
                  {roles.map((r) => (
                    <tr key={r.id}>
                      <td style={styles.td}>
                        <div style={{ fontWeight: 700 }}>{r.name}</div>
                        {r.description && <div style={{ fontSize: "0.75rem", color: "var(--text-tertiary, #94A3B8)" }}>{r.description}</div>}
                      </td>
                      <td style={styles.td}><Badge label={KIND_LABEL[r.kind]} tone={KIND_TONE[r.kind]} /></td>
                      <td style={{ ...styles.td, fontSize: "0.75rem", maxWidth: 320 }}>
                        {r.kind === "super_admin" ? <em>All functions</em> : r.kind === "customer" ? <em>Storefront only</em>
                          : r.permissions.length ? r.permissions.map((p) => FUNCTION_LABEL[p] ?? p).join(", ") : <em style={{ color: "#DC2626" }}>none</em>}
                      </td>
                      <td style={{ ...styles.td, fontSize: "0.75rem" }}>
                        {r.kind === "super_admin" ? <em>All data</em> : (
                          SCOPE_FIELDS.filter((f) => !(r.kind === "customer" && f.key === "customer_groups")).map((f) => (
                            <div key={f.key}>
                              <span style={{ color: "var(--text-secondary, #64748B)" }}>{f.label}:</span>{" "}
                              {r.scope[f.key].length ? r.scope[f.key].join(", ")
                                : r.kind === "customer" ? <span style={{ color: "var(--text-tertiary, #94A3B8)" }}>all</span>
                                : <span style={{ color: f.required ? "#DC2626" : "var(--text-tertiary, #94A3B8)" }}>{f.required ? "not set" : "—"}</span>}
                            </div>
                          ))
                        )}
                      </td>
                      <td style={styles.td}>{r.user_count}</td>
                      <td style={{ ...styles.td, whiteSpace: "nowrap" }}>
                        <button style={{ ...btn("secondary"), padding: "0.25rem 0.625rem" }} onClick={() => edit(r)}>Edit</button>{" "}
                        <button style={{ ...btn("secondary"), padding: "0.25rem 0.625rem" }} title="Create a new role with the same functions and data permissions"
                          onClick={() => duplicate(r)}>Duplicate</button>{" "}
                        <button style={{ ...btn("danger", r.user_count > 0), padding: "0.25rem 0.625rem" }} disabled={r.user_count > 0}
                          title={r.user_count > 0 ? "Move its users to another role first" : undefined} onClick={() => remove(r)}>Delete</button>
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
