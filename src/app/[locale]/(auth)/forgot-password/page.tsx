"use client";

import { useState, useEffect, useRef } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";

type Step = "email" | "otp" | "newPassword" | "success";

export default function ForgotPasswordPage() {
  const t = useTranslations();
  const locale = useLocale();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [otpCode, setOtpCode] = useState(["", "", "", "", "", ""]);
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [otpCooldown, setOtpCooldown] = useState(0);
  const otpInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Cooldown timer
  useEffect(() => {
    if (otpCooldown <= 0) return;
    const timer = setInterval(() => {
      setOtpCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [otpCooldown]);

  // Step 1: Send OTP to email
  const handleSendOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!email) return;
    setIsLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, purpose: "forgot-password", language: locale }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "otp_cooldown") setOtpCooldown(data.waitSeconds || 60);
        throw new Error(data.message || "Failed to send OTP");
      }
      setStep("otp");
      setOtpCooldown(60);
      setTimeout(() => otpInputRefs.current[0]?.focus(), 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send OTP");
    } finally {
      setIsLoading(false);
    }
  };

  // OTP input handling
  const handleOtpChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const newOtp = [...otpCode];
    newOtp[index] = value.slice(-1);
    setOtpCode(newOtp);
    setError("");
    if (value && index < 5) otpInputRefs.current[index + 1]?.focus();
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !otpCode[index] && index > 0) {
      otpInputRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    const newOtp = [...otpCode];
    for (let i = 0; i < pasted.length; i++) newOtp[i] = pasted[i];
    setOtpCode(newOtp);
    if (pasted.length >= 6) otpInputRefs.current[5]?.focus();
  };

  // Step 2: Verify OTP
  const handleVerifyOtp = async () => {
    const code = otpCode.join("");
    if (code.length !== 6) { setError(t("auth.otpInvalid")); return; }
    setIsLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code, purpose: "forgot-password", language: locale }),
      });
      const data = await res.json();
      if (!res.ok || !data.valid) throw new Error(data.message || t("auth.otpInvalid"));
      setStep("newPassword");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.otpInvalid"));
    } finally {
      setIsLoading(false);
    }
  };

  // Step 3: Reset password
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (newPassword.length < 6) { setError(t("auth.passwordMin")); return; }
    if (newPassword !== confirmNewPassword) { setError(t("auth.passwordMismatch")); return; }
    setIsLoading(true);

    try {
      // TODO: Call actual password reset API with MySQL
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, newPassword }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Reset failed");
      }
      setStep("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setIsLoading(false);
    }
  };

  // ── Success ──
  if (step === "success") {
    return (
      <div className="auth-page">
        <div className="auth-card animate-scale-in">
          <div style={{ textAlign: "center", padding: "1rem 0" }}>
            <div style={{
              width: 72, height: 72, borderRadius: "50%", margin: "0 auto 1.5rem",
              background: "var(--color-success-light)", display: "flex",
              alignItems: "center", justifyContent: "center", fontSize: "2rem",
            }}>✓</div>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "0.5rem" }}>
              {t("auth.resetSuccess")}
            </h2>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.875rem", marginBottom: "2rem" }}>
              {t("auth.resetSuccessMsg")}
            </p>
            <Link href="/login" className="btn btn-primary btn-lg" style={{ width: "100%" }}>
              {t("auth.backToLogin")}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ── New Password ──
  if (step === "newPassword") {
    return (
      <div className="auth-page">
        <div className="auth-card animate-scale-in">
          <div style={{ textAlign: "center", marginBottom: "2rem" }}>
            <div style={{
              width: 56, height: 56, borderRadius: "var(--radius-xl)", margin: "0 auto 1rem",
              background: "linear-gradient(135deg, var(--color-secondary), var(--color-secondary-dark))",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#fff", fontSize: "1.5rem",
            }}>🔑</div>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "0.5rem" }}>
              {t("auth.resetPassword")}
            </h2>
          </div>

          <form className="auth-form" onSubmit={handleResetPassword} id="reset-password-form">
            {error && (
              <div style={{
                padding: "0.75rem 1rem", background: "var(--color-error-light)",
                color: "#991B1B", borderRadius: "var(--radius-lg)",
                fontSize: "0.875rem", fontWeight: 500,
              }}>{error}</div>
            )}

            <div className="input-group">
              <label className="input-label" htmlFor="newPassword">{t("auth.newPassword")}</label>
              <input type="password" className="input" id="newPassword" value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)} placeholder="••••••••"
                required minLength={6} autoComplete="new-password" />
            </div>

            <div className="input-group">
              <label className="input-label" htmlFor="confirmNewPassword">{t("auth.confirmNewPassword")}</label>
              <input type="password" className="input" id="confirmNewPassword" value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)} placeholder="••••••••"
                required autoComplete="new-password" />
            </div>

            <button type="submit" className="btn btn-accent btn-lg" disabled={isLoading}
              style={{ width: "100%" }} id="reset-password-btn">
              {isLoading ? t("common.loading") : t("auth.resetPassword")}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ── OTP Verification ──
  if (step === "otp") {
    return (
      <div className="auth-page">
        <div className="auth-card animate-scale-in">
          <div style={{ textAlign: "center", marginBottom: "2rem" }}>
            <div style={{
              width: 56, height: 56, borderRadius: "var(--radius-xl)", margin: "0 auto 1rem",
              background: "linear-gradient(135deg, var(--color-secondary), var(--color-secondary-dark))",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#fff", fontSize: "1.5rem",
            }}>🔑</div>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "0.5rem" }}>
              {t("auth.otpTitle")}
            </h2>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.875rem" }}>
              {t("auth.otpDesc")} <strong>{email}</strong>
            </p>
          </div>

          {/* OTP Input */}
          <div style={{
            display: "flex", gap: "0.5rem", justifyContent: "center", marginBottom: "1.5rem",
          }} onPaste={handleOtpPaste}>
            {otpCode.map((digit, i) => (
              <input
                key={i}
                ref={(el) => { otpInputRefs.current[i] = el; }}
                type="text" inputMode="numeric" maxLength={1} value={digit}
                onChange={(e) => handleOtpChange(i, e.target.value)}
                onKeyDown={(e) => handleOtpKeyDown(i, e)}
                style={{
                  width: 48, height: 56, textAlign: "center",
                  fontSize: "1.5rem", fontWeight: 700,
                  border: `2px solid ${error ? "var(--color-error)" : digit ? "var(--color-secondary)" : "var(--color-gray-200)"}`,
                  borderRadius: "var(--radius-lg)", background: "var(--bg-primary)",
                  color: "var(--text-primary)", outline: "none", transition: "all 0.2s ease",
                }}
                autoFocus={i === 0}
              />
            ))}
          </div>

          {error && (
            <div style={{
              padding: "0.75rem 1rem", background: "var(--color-error-light)",
              color: "#991B1B", borderRadius: "var(--radius-lg)",
              fontSize: "0.875rem", fontWeight: 500, textAlign: "center", marginBottom: "1rem",
            }}>{error}</div>
          )}

          <button className="btn btn-accent btn-lg" onClick={handleVerifyOtp}
            disabled={isLoading || otpCode.join("").length !== 6}
            style={{ width: "100%", marginBottom: "1rem" }} id="verify-otp-btn">
            {isLoading ? t("common.loading") : t("auth.otpVerify")}
          </button>

          <div style={{ textAlign: "center" }}>
            {otpCooldown > 0 ? (
              <span style={{ fontSize: "0.875rem", color: "var(--text-tertiary)" }}>
                {t("auth.otpResendIn").replace("{seconds}", String(otpCooldown))}
              </span>
            ) : (
              <button className="btn btn-ghost btn-sm" onClick={() => handleSendOtp()}
                disabled={isLoading}>
                {t("auth.otpResend")}
              </button>
            )}
          </div>

          <button className="btn btn-ghost btn-sm"
            onClick={() => { setStep("email"); setOtpCode(["", "", "", "", "", ""]); setError(""); }}
            style={{ width: "100%", marginTop: "1rem" }}>
            ← {t("common.back")}
          </button>
        </div>
      </div>
    );
  }

  // ── Step 1: Enter Email ──
  return (
    <div className="auth-page">
      <div className="auth-card animate-scale-in">
        <div style={{ textAlign: "center", marginBottom: "2rem" }}>
          <div style={{
            width: 56, height: 56, borderRadius: "var(--radius-xl)", margin: "0 auto 1rem",
            background: "linear-gradient(135deg, var(--color-secondary), var(--color-secondary-dark))",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontSize: "1.5rem",
          }}>🔑</div>
          <h2 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "0.5rem" }}>
            {t("auth.forgotPasswordTitle")}
          </h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.875rem" }}>
            {t("auth.forgotPasswordDesc")}
          </p>
        </div>

        <form className="auth-form" onSubmit={handleSendOtp} id="forgot-password-form">
          {error && (
            <div style={{
              padding: "0.75rem 1rem", background: "var(--color-error-light)",
              color: "#991B1B", borderRadius: "var(--radius-lg)",
              fontSize: "0.875rem", fontWeight: 500,
            }}>{error}</div>
          )}

          <div className="input-group">
            <label className="input-label" htmlFor="resetEmail">{t("auth.email")}</label>
            <input type="email" className="input" id="resetEmail" value={email}
              onChange={(e) => setEmail(e.target.value)} placeholder="email@example.com"
              required autoComplete="email" />
          </div>

          <button type="submit" className="btn btn-accent btn-lg" disabled={isLoading}
            style={{ width: "100%" }} id="send-reset-otp-btn">
            {isLoading ? t("auth.otpSending") : t("auth.sendOtp")}
          </button>
        </form>

        <div className="auth-form__footer" style={{ marginTop: "1.5rem" }}>
          <Link href="/login">{t("auth.backToLogin")}</Link>
        </div>
      </div>
    </div>
  );
}
