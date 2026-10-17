"use client";

import { useState, useEffect, useCallback, createContext, useContext } from "react";
import { useTranslations, useLocale } from "next-intl";
import { usePathname } from "next/navigation";
import type { AdminPermission } from "@/lib/auth/adminSession";
import { useAppName, usePageTitle } from "@/hooks/useAppName";

interface AdminSessionInfo {
  email: string;
  fullName: string;
  isSuperAdmin: boolean;
  permissions: AdminPermission[];
}

const AdminSessionContext = createContext<AdminSessionInfo | null>(null);
export function useAdminSession() {
  return useContext(AdminSessionContext);
}

interface UnreadOrderSummary {
  order_id: number;
  order_number: string;
  customer_name: string | null;
  unread_count: number;
  latest_message: string;
  latest_created_at: string;
}

/**
 * Top-right notification bell for customer messages on orders (see
 * order_messages) — global across all admins, not per-account (orders
 * aren't scoped per admin elsewhere either). Polled periodically and
 * refreshed on navigation, mirroring the customer storefront's own
 * notification bell (src/components/layout/Navbar.tsx).
 */
function MessageNotificationBell({ locale, pathname }: { locale: string; pathname: string }) {
  const [totalUnread, setTotalUnread] = useState(0);
  const [unreadOrders, setUnreadOrders] = useState<UnreadOrderSummary[]>([]);
  const [showPanel, setShowPanel] = useState(false);

  const checkUnread = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/orders/messages/unread");
      if (res.ok) {
        const data = await res.json();
        setTotalUnread(data.totalUnread || 0);
        setUnreadOrders(data.orders || []);
      }
    } catch {
      // leave the last-known count as is
    }
  }, []);

  useEffect(() => {
    checkUnread();
    const interval = setInterval(checkUnread, 30000);
    return () => clearInterval(interval);
  }, [checkUnread]);

  // Coming back from an order's Review page (opening the thread marks it
  // read) should clear the badge sooner than the next 30s poll.
  useEffect(() => {
    checkUnread();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return (
    <div style={{ position: "fixed", top: "1rem", right: "1.5rem", zIndex: 200 }}>
      <button
        onClick={() => setShowPanel((v) => !v)}
        aria-label="Order message notifications"
        style={{
          position: "relative", display: "flex", alignItems: "center", justifyContent: "center",
          width: "40px", height: "40px", borderRadius: "var(--radius-full, 999px)",
          border: "1px solid var(--color-gray-200, #E2E8F0)", background: "var(--bg-primary, #fff)",
          cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-secondary, #64748B)" }}>
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
        {totalUnread > 0 && (
          <span style={{
            position: "absolute", top: "-4px", right: "-4px", minWidth: "20px", height: "20px",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "#DC2626", color: "#fff", fontSize: "11px", fontWeight: 700,
            borderRadius: "var(--radius-full, 999px)", padding: "0 5px", lineHeight: 1,
          }}>
            {totalUnread}
          </span>
        )}
      </button>

      {showPanel && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 190 }} onClick={() => setShowPanel(false)} />
          <div style={{
            position: "absolute", right: 0, top: "calc(100% + 0.5rem)",
            background: "var(--bg-primary, #fff)", borderRadius: "var(--radius-lg, 8px)",
            boxShadow: "0 10px 40px rgba(0,0,0,0.12)", border: "1px solid var(--color-gray-200, #E2E8F0)",
            minWidth: "300px", maxWidth: "360px", maxHeight: "380px", overflowY: "auto",
            padding: "0.375rem", zIndex: 201,
          }}>
            <div style={{ padding: "0.5rem 0.75rem", fontSize: "0.75rem", fontWeight: 700, color: "var(--text-tertiary, #94A3B8)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Order Messages
            </div>
            {unreadOrders.length === 0 ? (
              <div style={{ padding: "0.75rem", fontSize: "0.8125rem", color: "var(--text-tertiary, #94A3B8)" }}>
                No new messages.
              </div>
            ) : (
              unreadOrders.map((o) => (
                <a
                  key={o.order_id}
                  href={`/${locale}/admin/orders/${o.order_id}`}
                  onClick={() => setShowPanel(false)}
                  style={{
                    display: "block", padding: "0.625rem 0.75rem", borderRadius: "var(--radius-md, 6px)",
                    textDecoration: "none", color: "var(--text-primary, #0F172A)",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-secondary, #F8FAFC)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.1875rem" }}>
                    <span style={{ fontSize: "0.8125rem", fontWeight: 700 }}>{o.order_number}</span>
                    <span style={{ fontSize: "0.7rem", fontWeight: 700, color: "#DC2626", background: "#FEF2F2", borderRadius: "var(--radius-full, 999px)", padding: "0.0625rem 0.4375rem" }}>
                      {o.unread_count}
                    </span>
                  </div>
                  <div style={{ fontSize: "0.7rem", color: "var(--text-tertiary, #94A3B8)", marginBottom: "0.1875rem" }}>
                    {o.customer_name || "—"}
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-secondary, #64748B)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {o.latest_message}
                  </div>
                </a>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

interface NavItem { key: AdminPermission | "change-password"; label: string; href: string; icon: string; rootOnly?: boolean; }
interface NavGroup { label: string; icon: string; items: NavItem[]; }

function NavGroupSection({
  group, locale, pathname, defaultOpen,
}: { group: NavGroup; locale: string; pathname: string; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      {/* Group header — click to toggle */}
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          width: "100%", padding: "0.375rem 0.75rem", borderRadius: "var(--radius-lg, 8px)",
          background: "transparent", border: "none", cursor: "pointer",
          fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
          color: "var(--text-tertiary, #94A3B8)", marginTop: "0.5rem",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
          <span>{group.icon}</span>
          <span>{group.label}</span>
        </span>
        <span style={{
          fontSize: "0.6rem", transition: "transform 0.2s",
          transform: open ? "rotate(180deg)" : "rotate(0deg)",
          display: "inline-block",
        }}>▼</span>
      </button>

      {/* Group children */}
      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.0625rem", paddingLeft: "0.625rem" }}>
          {group.items.map(item => {
            const href = item.href ? `/${locale}/admin/${item.href}` : `/${locale}/admin`;
            const isActive = item.href === "" ? pathname === `/${locale}/admin` : pathname.startsWith(href);
            return (
              <a key={item.key} href={href} style={{
                display: "flex", alignItems: "center", gap: "0.5rem",
                padding: "0.4375rem 0.625rem", borderRadius: "var(--radius-lg, 8px)",
                fontSize: "0.8125rem", fontWeight: isActive ? 700 : 500,
                color: isActive ? "var(--color-primary, #2BBCB3)" : "var(--text-secondary, #64748B)",
                background: isActive ? "rgba(43,188,179,0.1)" : "transparent",
                textDecoration: "none",
              }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = "var(--bg-secondary, #F8FAFC)"; }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
              >
                <span style={{ fontSize: "0.875rem" }}>{item.icon}</span>
                <span>{item.label}</span>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Dashboard", icon: "📊",
    items: [{ key: "dashboard", label: "Dashboard", href: "", icon: "📊" }],
  },
  {
    label: "Customer Approval", icon: "👥",
    items: [{ key: "customers", label: "Customer Approval", href: "customers", icon: "👥" }],
  },
  {
    label: "Orders", icon: "🧾",
    items: [{ key: "orders", label: "Orders", href: "orders", icon: "🧾" }],
  },
  {
    label: "Inventory", icon: "📊",
    items: [{ key: "inventory", label: "Inventory", href: "inventory", icon: "📊" }],
  },
  {
    label: "Master Data", icon: "🗄️",
    items: [
      { key: "customer-groups",    label: "Customer Groups",   href: "customer-groups",    icon: "🏷️" },
      { key: "sap-customers",      label: "SAP Customers",     href: "sap-customers",      icon: "🏢" },
      { key: "item-groups",        label: "Item Groups",       href: "item-groups",        icon: "🗂️" },
      { key: "items",              label: "Items",             href: "items",              icon: "📦" },
      { key: "warehouses",         label: "Warehouses",        href: "warehouses",         icon: "🏭" },
    ],
  },
  {
    label: "Price & Discount", icon: "💲",
    items: [
      { key: "price-lists",        label: "Price Lists",       href: "price-lists",        icon: "💲" },
      { key: "contract-discounts", label: "Contract Discount", href: "contract-discounts", icon: "📄" },
      { key: "promotions",         label: "Promotion Discount",href: "promotions",         icon: "🎁" },
    ],
  },
  {
    label: "Settings", icon: "⚙️",
    items: [
      { key: "change-password",    label: "My Profile",        href: "change-password",    icon: "👤" },
      { key: "catalog-visibility", label: "Catalog Visibility",href: "catalog-visibility", icon: "🔒" },
      { key: "settings",           label: "SAP Sync Config",  href: "settings",           icon: "🔄", rootOnly: true },
      { key: "admin-roles",        label: "Admin Roles",       href: "admin-roles",        icon: "🛡️", rootOnly: true },
      { key: "admin-users",        label: "Admin Users",       href: "admin-users",        icon: "🔑", rootOnly: true },
    ],
  },
];

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const pathname = usePathname();
  const [session, setSession] = useState<AdminSessionInfo | null>(null);
  const [isChecking, setIsChecking] = useState(true);
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const appName = useAppName(true, session?.fullName);

  const checkAuth = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/me");
      if (res.ok) {
        const data = await res.json();
        setSession(data.admin);
      }
    } catch {
      // Not authenticated
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // The tab title comes from the root layout ("IMV - Ordering Portal"); this
  // layout is a client component so it can't export metadata — mark the admin
  // area by setting the "(Admin)" title here instead (always English).
  usePageTitle(true, session?.fullName);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");
    setLoginLoading(true);

    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: adminEmail, password: adminPassword }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Login failed");
      }

      await checkAuth();
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoginLoading(false);
    }
  };

  if (isChecking) {
    return (
      <div className="auth-page">
        <div style={{ color: "var(--text-tertiary)", fontSize: "1rem" }}>
          {t("common.loading")}
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="auth-page">
        <div className="auth-card animate-scale-in" style={{ maxWidth: "420px" }}>
          <div className="auth-card__logo">
            <div className="auth-card__logo-icon" style={{
              background: "linear-gradient(135deg, #6366F1, #4F46E5)",
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </div>
            <h1 className="auth-card__title">{t("admin.loginTitle")}</h1>
            <p className="auth-card__subtitle">{t("admin.title")}</p>
          </div>

          <form className="auth-form" onSubmit={handleLogin} id="admin-login-form">
            {loginError && (
              <div style={{
                padding: "0.75rem 1rem",
                background: "var(--color-error-light)",
                color: "#991B1B",
                borderRadius: "var(--radius-lg)",
                fontSize: "0.875rem",
                fontWeight: 500,
              }}>
                {loginError}
              </div>
            )}

            <div className="input-group">
              <label className="input-label" htmlFor="adminEmail">{t("admin.adminEmail")}</label>
              <input
                type="email"
                className="input"
                id="adminEmail"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                placeholder="admin@example.com"
                required
                autoComplete="email"
              />
            </div>

            <div className="input-group">
              <label className="input-label" htmlFor="adminPassword">{t("admin.adminPassword")}</label>
              <input
                type="password"
                className="input"
                id="adminPassword"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary btn-lg"
              disabled={loginLoading}
              style={{ width: "100%" }}
              id="admin-login-btn"
            >
              {loginLoading ? t("common.loading") : t("admin.login")}
            </button>
          </form>

          <div style={{ textAlign: "center", marginTop: "1.5rem" }}>
            <a href={`/${locale}`} style={{
              fontSize: "0.8125rem",
              color: "var(--text-tertiary)",
            }}>
              ← {locale === "vi" ? "Quay lại cổng đặt hàng" : "Back to ordering portal"}
            </a>
          </div>
        </div>
      </div>
    );
  }

  // Which individual nav items this session can see
  const canSee = (item: NavItem): boolean =>
    item.key === "change-password" ? true
    : (item as { rootOnly?: boolean }).rootOnly ? session.isSuperAdmin
    : session.isSuperAdmin || session.permissions.includes(item.key as AdminPermission);

  // Build visible groups (only show a group if at least one item is visible)
  const visibleGroups = NAV_GROUPS
    .map(g => ({ ...g, items: g.items.filter(canSee) }))
    .filter(g => g.items.length > 0);

  // Determine which groups are "active" (contain the current page) so they
  // default to open; others start collapsed.
  function groupHasActive(g: typeof visibleGroups[0]): boolean {
    return g.items.some(item => {
      const href = item.href ? `/${locale}/admin/${item.href}` : `/${locale}/admin`;
      return item.href === "" ? pathname === `/${locale}/admin` : pathname.startsWith(href);
    });
  }

  const canSeeOrders = session.isSuperAdmin || session.permissions.includes("orders");

  return (
    <AdminSessionContext.Provider value={session}>
      <div style={{ display: "flex", minHeight: "100vh", background: "var(--bg-secondary, #F8FAFC)" }}>
        {canSeeOrders && <MessageNotificationBell locale={locale} pathname={pathname} />}

        {/* Sidebar */}
        <aside style={{
          width: "240px", flexShrink: 0, background: "var(--bg-primary, #fff)",
          borderRight: "1px solid var(--color-gray-200, #E2E8F0)",
          padding: "1.25rem 0.625rem", display: "flex", flexDirection: "column",
          overflowY: "auto",
        }}>
          <div style={{ padding: "0 0.75rem 1.25rem", fontWeight: 800, fontSize: "1rem", color: "var(--text-primary, #0F172A)" }}>
            {appName}
          </div>
          <nav style={{ display: "flex", flexDirection: "column", gap: "0.125rem", flex: 1 }}>
            {visibleGroups.map((group) => {
              const isGroupActive = groupHasActive(group);
              // Single-item groups (Dashboard, Customer Approval, Orders) render
              // as a direct link — no collapsible header needed.
              if (group.items.length === 1) {
                const item = group.items[0];
                const href = item.href ? `/${locale}/admin/${item.href}` : `/${locale}/admin`;
                const isActive = item.href === "" ? pathname === `/${locale}/admin` : pathname.startsWith(href);
                return (
                  <a key={item.key} href={href} style={{
                    display: "flex", alignItems: "center", gap: "0.5rem",
                    padding: "0.5rem 0.75rem", borderRadius: "var(--radius-lg, 8px)",
                    fontSize: "0.8125rem", fontWeight: isActive ? 700 : 600,
                    color: isActive ? "var(--color-primary, #2BBCB3)" : "var(--text-secondary, #64748B)",
                    background: isActive ? "rgba(43,188,179,0.1)" : "transparent",
                    textDecoration: "none",
                  }}>
                    <span>{item.icon}</span>
                    <span>{group.label}</span>
                  </a>
                );
              }
              // Multi-item groups: collapsible section
              return (
                <NavGroupSection
                  key={group.label}
                  group={group}
                  locale={locale}
                  pathname={pathname}
                  defaultOpen={isGroupActive}
                />
              );
            })}
          </nav>
          <div style={{ borderTop: "1px solid var(--color-gray-200, #E2E8F0)", paddingTop: "0.75rem", marginTop: "0.75rem" }}>
            <div style={{ fontSize: "0.75rem", color: "var(--text-tertiary, #94A3B8)", padding: "0 0.75rem", marginBottom: "0.25rem", wordBreak: "break-all" }}>
              {session.email}
            </div>
            <a href={`/${locale}`} style={{
              display: "block", padding: "0.5rem 0.75rem", fontSize: "0.8125rem",
              color: "var(--text-tertiary, #94A3B8)", textDecoration: "none",
            }}>
              ← {locale === "vi" ? "Cổng đặt hàng" : "Ordering Portal"}
            </a>
          </div>
        </aside>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {children}
        </div>
      </div>
    </AdminSessionContext.Provider>
  );
}
