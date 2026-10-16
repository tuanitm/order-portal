"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

export default function ChangePasswordPage() {
  const t = useTranslations();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess(false);

    if (!currentPassword || !newPassword) {
      setError(t("auth.passwordRequired"));
      return;
    }
    if (newPassword.length < 6) {
      setError(t("auth.passwordMin"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("auth.passwordMismatch"));
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/auth/me/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to change password");
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change password");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page">
      <div className="container" style={{ maxWidth: "480px" }}>
        <div className="page__header">
          <h1 className="page__title">{t("auth.changePassword")}</h1>
        </div>

        <div className="card" style={{ padding: "1.5rem" }}>
          <form className="auth-form" onSubmit={submit}>
            {error && (
              <div style={{
                padding: "0.75rem 1rem", background: "var(--color-error-light)",
                color: "#991B1B", borderRadius: "var(--radius-lg)",
                fontSize: "0.875rem", fontWeight: 500,
              }}>{error}</div>
            )}
            {success && (
              <div style={{
                padding: "0.75rem 1rem", background: "var(--color-success-light)",
                color: "#065F46", borderRadius: "var(--radius-lg)",
                fontSize: "0.875rem", fontWeight: 500,
              }}>✓ {t("auth.resetSuccess")}</div>
            )}

            <div className="input-group">
              <label className="input-label" htmlFor="currentPassword">{t("auth.currentPassword")}</label>
              <input
                type="password" className="input" id="currentPassword"
                value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="••••••••" autoComplete="current-password"
              />
            </div>

            <div className="input-group">
              <label className="input-label" htmlFor="newPassword">{t("auth.newPassword")}</label>
              <input
                type="password" className="input" id="newPassword"
                value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••" autoComplete="new-password" minLength={6}
              />
            </div>

            <div className="input-group">
              <label className="input-label" htmlFor="confirmPassword">{t("auth.confirmNewPassword")}</label>
              <input
                type="password" className="input" id="confirmPassword"
                value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••" autoComplete="new-password"
              />
            </div>

            <button type="submit" className="btn btn-primary btn-lg" disabled={saving} style={{ width: "100%" }}>
              {saving ? t("common.loading") : t("auth.changePassword")}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
