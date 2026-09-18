"use client";

import { useState, useEffect, useCallback, createContext, useContext } from "react";
import { useTranslations, useLocale } from "next-intl";
import { usePathname } from "next/navigation";
import type { AdminPermission } from "@/lib/auth/adminSession";

interface AdminSessionInfo {
  email: string;
  isSuperAdmin: boolean;
  permissions: AdminPermission[];
}

const AdminSessionContext = createContext<AdminSessionInfo | null>(null);
export function useAdminSession() {
  return useContext(AdminSessionContext);
}

const NAV_ITEMS: { key: AdminPermission; label: string; href: string; icon: string }[] = [
  { key: "dashboard", label: "Dashboard", href: "", icon: "📊" },
  { key: "customers", label: "Customers Approval", href: "customers", icon: "👥" },
  { key: "sap-customers", label: "SAP Customers", href: "sap-customers", icon: "🏢" },
  { key: "customer-groups", label: "Customer Groups", href: "customer-groups", icon: "🏷️" },
  { key: "catalog-visibility", label: "Catalog Visibility", href: "catalog-visibility", icon: "🔒" },
  { key: "items", label: "Items", href: "items", icon: "📦" },
  { key: "item-groups", label: "Item Groups", href: "item-groups", icon: "🗂️" },
  { key: "price-lists", label: "Price Lists", href: "price-lists", icon: "💲" },
  { key: "contract-discounts", label: "Contract Discounts", href: "contract-discounts", icon: "📄" },
  { key: "promotions", label: "Promotion Discounts", href: "promotions", icon: "🎁" },
  { key: "orders", label: "Orders", href: "orders", icon: "🧾" },
  { key: "admin-users", label: "Admin Users", href: "admin-users", icon: "🔑" },
  { key: "admin-roles", label: "Admin Roles", href: "admin-roles", icon: "🛡️" },
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

  const visibleNav = NAV_ITEMS.filter((item) => session.isSuperAdmin || session.permissions.includes(item.key));

  return (
    <AdminSessionContext.Provider value={session}>
      <div style={{ display: "flex", minHeight: "100vh", background: "var(--bg-secondary, #F8FAFC)" }}>
        {/* Sidebar */}
        <aside style={{
          width: "220px", flexShrink: 0, background: "var(--bg-primary, #fff)",
          borderRight: "1px solid var(--color-gray-200, #E2E8F0)",
          padding: "1.5rem 0.75rem", display: "flex", flexDirection: "column",
        }}>
          <div style={{ padding: "0 0.75rem 1.25rem", fontWeight: 800, fontSize: "1rem", color: "var(--text-primary, #0F172A)" }}>
            IMV Admin
          </div>
          <nav style={{ display: "flex", flexDirection: "column", gap: "0.125rem", flex: 1 }}>
            {visibleNav.map((item) => {
              const href = item.href ? `/${locale}/admin/${item.href}` : `/${locale}/admin`;
              const isActive = item.href === "" ? pathname === `/${locale}/admin` : pathname.startsWith(href);
              return (
                <a key={item.key} href={href} style={{
                  display: "flex", alignItems: "center", gap: "0.5rem",
                  padding: "0.5rem 0.75rem", borderRadius: "var(--radius-lg, 8px)",
                  fontSize: "0.8125rem", fontWeight: isActive ? 700 : 500,
                  color: isActive ? "var(--color-primary, #2BBCB3)" : "var(--text-secondary, #64748B)",
                  background: isActive ? "rgba(43,188,179,0.1)" : "transparent",
                  textDecoration: "none",
                }}>
                  <span>{item.icon}</span>
                  <span>{item.label}</span>
                </a>
              );
            })}
          </nav>
          <div style={{ borderTop: "1px solid var(--color-gray-200, #E2E8F0)", paddingTop: "0.75rem", marginTop: "0.75rem" }}>
            <div style={{ fontSize: "0.75rem", color: "var(--text-tertiary, #94A3B8)", padding: "0 0.75rem", marginBottom: "0.5rem", wordBreak: "break-all" }}>
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
