"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Link } from "@/i18n/navigation";

export default function IdentifyPage() {
  const t = useTranslations();
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!identifier.trim()) return;

    setIsLoading(true);

    try {
      const res = await fetch("/api/auth/identify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: identifier.trim() }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to check account");
      }

      const data = await res.json();
      const encodedIdentifier = encodeURIComponent(identifier.trim());

      if (data.exists) {
        // Existing user → go to login with pre-filled identifier
        router.push(`/login?identifier=${encodedIdentifier}`);
      } else {
        // New user → go to signup with pre-filled identifier
        router.push(`/signup?identifier=${encodedIdentifier}&type=${data.identifierType}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
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
          <h1 className="auth-card__title">{t("auth.identifyTitle")}</h1>
          <p className="auth-card__subtitle">
            {t("auth.identifySubtitle")}
          </p>
        </div>

        {/* Identify Form */}
        <form className="auth-form" onSubmit={handleSubmit} id="identify-form">
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
            <div style={{ position: "relative" }}>
              <svg style={{
                position: "absolute", left: "1rem", top: "50%",
                transform: "translateY(-50%)", color: "var(--text-tertiary)",
                width: "18px", height: "18px",
              }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                className="input"
                id="identifier"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder={t("auth.identifierPlaceholder")}
                required
                autoComplete="username"
                autoFocus
                style={{ paddingLeft: "2.75rem" }}
              />
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-lg"
            disabled={isLoading || !identifier.trim()}
            id="identify-submit"
            style={{ width: "100%" }}
          >
            {isLoading ? t("auth.checking") : t("auth.continueBtn")}
          </button>
        </form>

        <div className="auth-form__footer" style={{ marginTop: "1.5rem" }}>
          {t("common.appName")}
        </div>
      </div>
    </div>
  );
}
