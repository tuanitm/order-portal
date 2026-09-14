"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations, useLocale } from "next-intl";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  const checkAuth = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/customers?status=pending", {
        method: "GET",
      });
      if (res.ok) {
        setIsAuthenticated(true);
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

      setIsAuthenticated(true);
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

  if (!isAuthenticated) {
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

  return <>{children}</>;
}
