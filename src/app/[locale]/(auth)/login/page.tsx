"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { useAppName } from "@/hooks/useAppName";

export default function LoginPage() {
  const t = useTranslations();
  const appName = useAppName();
  const locale = useLocale();
  const searchParams = useSearchParams();

  // Pre-fill identifier from URL params (from identify page)
  const prefilledIdentifier = searchParams.get("identifier") || "";

  const [identifier, setIdentifier] = useState(prefilledIdentifier);
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [approvalStatus, setApprovalStatus] = useState<"pending" | "rejected" | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setApprovalStatus(null);
    setIsLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.error === "pending_approval") {
          setApprovalStatus("pending");
          return;
        }
        if (data.error === "account_rejected") {
          setApprovalStatus("rejected");
          setRejectionReason(data.reason || "");
          return;
        }
        throw new Error(data.error || "Login failed");
      }

      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card animate-scale-in">
        {/* Logo */}
        <div className="auth-card__logo">
          <div className="auth-card__logo-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <path d="M16 10a4 4 0 0 1-8 0" />
            </svg>
          </div>
          <h1 className="auth-card__title">{t("auth.loginTitle")}</h1>
          <p className="auth-card__subtitle">
            {appName}
          </p>
        </div>

        {/* Approval Status Messages */}
        {approvalStatus === "pending" && (
          <div style={{
            padding: "1.25rem",
            background: "linear-gradient(135deg, #FEF3C7, #FDE68A)",
            borderRadius: "var(--radius-lg)",
            marginBottom: "1.5rem",
            textAlign: "center",
          }}>
            <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>⏳</div>
            <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "#92400E", marginBottom: "0.5rem" }}>
              {t("auth.pendingApproval")}
            </h3>
            <p style={{ fontSize: "0.8125rem", color: "#78350F", lineHeight: 1.5 }}>
              {t("auth.pendingApprovalLogin")}
            </p>
          </div>
        )}

        {approvalStatus === "rejected" && (
          <div style={{
            padding: "1.25rem",
            background: "var(--color-error-light)",
            borderRadius: "var(--radius-lg)",
            marginBottom: "1.5rem",
            textAlign: "center",
          }}>
            <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>❌</div>
            <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "#991B1B", marginBottom: "0.5rem" }}>
              {t("auth.accountRejected")}
            </h3>
            <p style={{ fontSize: "0.8125rem", color: "#7F1D1D", lineHeight: 1.5 }}>
              {t("auth.accountRejectedLogin")}
            </p>
            {rejectionReason && (
              <div style={{
                marginTop: "0.75rem",
                padding: "0.75rem",
                background: "rgba(255,255,255,0.6)",
                borderRadius: "var(--radius-md)",
                fontSize: "0.8125rem",
                color: "#991B1B",
              }}>
                <strong>{t("auth.rejectionReason")}:</strong> {rejectionReason}
              </div>
            )}
          </div>
        )}

        {/* Login Form */}
        <form className="auth-form" onSubmit={handleSubmit} id="login-form">
          {error && (
            <div style={{
              padding: "0.75rem 1rem",
              background: "var(--color-error-light)",
              color: "#991B1B",
              borderRadius: "var(--radius-lg)",
              fontSize: "0.875rem",
              fontWeight: 500,
            }}>
              {error}
            </div>
          )}

          <div className="input-group">
            <label className="input-label" htmlFor="identifier">
              {t("auth.identifierLabel")}
            </label>
            <input
              type="text"
              className="input"
              id="identifier"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder={t("auth.identifierPlaceholder")}
              required
              autoComplete="username"
            />
          </div>

          <div className="input-group">
            <label className="input-label" htmlFor="password">
              {t("auth.password")}
            </label>
            <input
              type="password"
              className="input"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="current-password"
              autoFocus={!!prefilledIdentifier}
            />
            <div style={{ textAlign: "right", marginTop: "0.25rem" }}>
              <Link href="/forgot-password" style={{
                fontSize: "0.8125rem", color: "var(--color-primary)",
                fontWeight: 500, transition: "color 0.2s",
              }} id="forgot-password-link">
                {t("auth.forgotPassword")}
              </Link>
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-lg"
            disabled={isLoading}
            id="login-submit"
            style={{ width: "100%" }}
          >
            {isLoading ? t("common.loading") : t("auth.loginBtn")}
          </button>
        </form>

        <div className="auth-form__footer" style={{ marginTop: "1.5rem" }}>
          {t("auth.noAccount")}{" "}
          <Link href="/signup">{t("auth.signupLink")}</Link>
        </div>

        <div style={{ textAlign: "center", marginTop: "0.75rem" }}>
          <Link href="/identify" style={{
            fontSize: "0.8125rem",
            color: "var(--text-tertiary)",
            transition: "color 0.2s",
          }}>
            ← {locale === "vi" ? "Quay lại trang nhận dạng" : "Back to identify"}
          </Link>
        </div>
      </div>
    </div>
  );
}
