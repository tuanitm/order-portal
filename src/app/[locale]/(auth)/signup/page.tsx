"use client";

import { useState, useEffect, useRef } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";

type Step = "info" | "otp" | "complete";

export default function SignupPage() {
  const t = useTranslations();
  const locale = useLocale();
  const searchParams = useSearchParams();

  // Pre-fill from URL params (from identify page)
  const prefilledIdentifier = searchParams.get("identifier") || "";
  const identifierType = searchParams.get("type") || "";

  const [step, setStep] = useState<Step>("info");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState(identifierType === "email" ? prefilledIdentifier : "");
  const [phone, setPhone] = useState(identifierType === "phone" ? prefilledIdentifier : "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [mstCode, setMstCode] = useState(identifierType === "mst" ? prefilledIdentifier : "");
  const [mstResult, setMstResult] = useState<{ cardCode: string; cardName: string } | null>(null);
  const [mstError, setMstError] = useState("");
  const [mstLoading, setMstLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  // OTP state
  const [otpCode, setOtpCode] = useState(["", "", "", "", "", ""]);
  const [otpSending, setOtpSending] = useState(false);
  const [otpCooldown, setOtpCooldown] = useState(0);
  const [otpError, setOtpError] = useState("");
  const [otpVerifying, setOtpVerifying] = useState(false);
  const otpInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Auto-lookup MST if pre-filled
  useEffect(() => {
    if (identifierType === "mst" && prefilledIdentifier) {
      handleMstLookup();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cooldown timer
  useEffect(() => {
    if (otpCooldown <= 0) return;
    const timer = setInterval(() => {
      setOtpCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [otpCooldown]);

  const handleMstLookup = async () => {
    if (!mstCode.trim()) return;
    setMstLoading(true);
    setMstError("");
    setMstResult(null);
    try {
      const res = await fetch("/api/bp/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mstCode: mstCode.trim() }),
      });
      if (!res.ok) throw new Error("Lookup failed");
      const data = await res.json();
      if (data.found) {
        setMstResult({ cardCode: data.cardCode, cardName: data.cardName });
        // Auto-fill customer name from SAP BP
        if (data.cardName) {
          setFullName(data.cardName);
        }
        // Auto-fill email if available from SAP
        if (data.email && !email) {
          setEmail(data.email);
        }
      } else {
        setMstError(t("auth.mstNotFound"));
      }
    } catch {
      setMstError(t("auth.mstNotFound"));
    } finally {
      setMstLoading(false);
    }
  };

  // Send OTP
  const handleSendOtp = async () => {
    if (!email) {
      setError(t("auth.emailRequired"));
      return;
    }
    setOtpSending(true);
    setOtpError("");
    setError("");
    try {
      const res = await fetch("/api/auth/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, purpose: "signup", language: locale }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "otp_cooldown") {
          setOtpCooldown(data.waitSeconds || 60);
        }
        throw new Error(data.message || "Failed to send OTP");
      }
      setStep("otp");
      setOtpCooldown(60);
      setTimeout(() => otpInputRefs.current[0]?.focus(), 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send OTP");
    } finally {
      setOtpSending(false);
    }
  };

  // Handle Step 1 → Step 2 (validate info, send OTP)
  const handleInfoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!email) {
      setError(t("auth.emailRequired"));
      return;
    }
    if (password !== confirmPassword) {
      setError(t("auth.passwordMismatch"));
      return;
    }
    if (password.length < 6) {
      setError(t("auth.passwordMin"));
      return;
    }

    await handleSendOtp();
  };

  // OTP input handling
  const handleOtpChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const newOtp = [...otpCode];
    newOtp[index] = value.slice(-1);
    setOtpCode(newOtp);
    setOtpError("");

    // Auto-focus next input
    if (value && index < 5) {
      otpInputRefs.current[index + 1]?.focus();
    }
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
    for (let i = 0; i < pasted.length; i++) {
      newOtp[i] = pasted[i];
    }
    setOtpCode(newOtp);
    if (pasted.length >= 6) {
      otpInputRefs.current[5]?.focus();
    }
  };

  // Verify OTP
  const handleVerifyOtp = async () => {
    const code = otpCode.join("");
    if (code.length !== 6) {
      setOtpError(t("auth.otpInvalid"));
      return;
    }

    setOtpVerifying(true);
    setOtpError("");
    try {
      const res = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code, purpose: "signup", language: locale }),
      });
      const data = await res.json();
      if (!res.ok || !data.valid) {
        throw new Error(data.message || t("auth.otpInvalid"));
      }

      // OTP verified → create account
      await handleCreateAccount();
    } catch (err) {
      setOtpError(err instanceof Error ? err.message : t("auth.otpInvalid"));
    } finally {
      setOtpVerifying(false);
    }
  };

  // Create account after OTP verification
  const handleCreateAccount = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName,
          email: email || undefined,
          phone: phone || undefined,
          password,
          mstCode: mstCode.trim() || undefined,
          sapCardCode: mstResult?.cardCode || undefined,
          sapCardName: mstResult?.cardName || undefined,
          emailVerified: true,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Signup failed");
      }
      setStep("complete");
    } catch (err) {
      setOtpError(err instanceof Error ? err.message : "Signup failed");
    } finally {
      setIsLoading(false);
    }
  };

  // Resend OTP
  const handleResendOtp = async () => {
    setOtpCode(["", "", "", "", "", ""]);
    await handleSendOtp();
  };

  // ── Step indicator ──
  const stepIndicator = (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      gap: "0.5rem", marginBottom: "2rem",
    }}>
      {(["info", "otp", "complete"] as Step[]).map((s, i) => (
        <div key={s} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <div style={{
            width: 32, height: 32, borderRadius: "50%", display: "flex",
            alignItems: "center", justifyContent: "center", fontSize: "0.75rem",
            fontWeight: 700,
            background: step === s ? "var(--color-primary)" : (["info", "otp", "complete"].indexOf(step) > i ? "var(--color-success)" : "var(--color-gray-200)"),
            color: step === s || ["info", "otp", "complete"].indexOf(step) > i ? "#fff" : "var(--text-tertiary)",
            transition: "all 0.3s ease",
          }}>
            {["info", "otp", "complete"].indexOf(step) > i ? "✓" : i + 1}
          </div>
          <span style={{
            fontSize: "0.75rem", fontWeight: 500,
            color: step === s ? "var(--text-primary)" : "var(--text-tertiary)",
          }}>
            {t(`auth.step${i + 1}` as Parameters<typeof t>[0])}
          </span>
          {i < 2 && (
            <div style={{
              width: 32, height: 2,
              background: ["info", "otp", "complete"].indexOf(step) > i ? "var(--color-success)" : "var(--color-gray-200)",
              transition: "background 0.3s ease",
            }} />
          )}
        </div>
      ))}
    </div>
  );

  // ── Step 3: Complete (Pending Approval) ──
  if (step === "complete") {
    return (
      <div className="auth-page">
        <div className="auth-card animate-scale-in" style={{ maxWidth: "480px" }}>
          {stepIndicator}
          <div style={{ textAlign: "center", padding: "1rem 0" }}>
            <div style={{
              width: 72, height: 72, borderRadius: "50%", margin: "0 auto 1.5rem",
              background: "linear-gradient(135deg, #FEF3C7, #FDE68A)", display: "flex",
              alignItems: "center", justifyContent: "center", fontSize: "2rem",
              animation: "scaleIn 0.5s ease-out",
            }}>⏳</div>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "0.5rem" }}>
              {t("auth.pendingApproval")}
            </h2>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.875rem", marginBottom: "2rem", lineHeight: 1.6 }}>
              {t("auth.pendingApprovalMsg")}
            </p>
            <Link href="/login" className="btn btn-primary btn-lg" style={{ width: "100%" }}>
              {t("auth.loginBtn")}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ── Step 2: OTP Verification ──
  if (step === "otp") {
    return (
      <div className="auth-page">
        <div className="auth-card animate-scale-in" style={{ maxWidth: "480px" }}>
          {stepIndicator}
          <div style={{ textAlign: "center", marginBottom: "2rem" }}>
            <div style={{
              width: 56, height: 56, borderRadius: "var(--radius-xl)", margin: "0 auto 1rem",
              background: "linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#fff", fontSize: "1.5rem",
            }}>📧</div>
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
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={digit}
                onChange={(e) => handleOtpChange(i, e.target.value)}
                onKeyDown={(e) => handleOtpKeyDown(i, e)}
                style={{
                  width: 48, height: 56, textAlign: "center",
                  fontSize: "1.5rem", fontWeight: 700,
                  border: `2px solid ${otpError ? "var(--color-error)" : digit ? "var(--color-primary)" : "var(--color-gray-200)"}`,
                  borderRadius: "var(--radius-lg)",
                  background: "var(--bg-primary)",
                  color: "var(--text-primary)",
                  outline: "none",
                  transition: "all 0.2s ease",
                }}
                id={`otp-input-${i}`}
                autoFocus={i === 0}
              />
            ))}
          </div>

          {otpError && (
            <div style={{
              padding: "0.75rem 1rem", background: "var(--color-error-light)",
              color: "#991B1B", borderRadius: "var(--radius-lg)",
              fontSize: "0.875rem", fontWeight: 500, textAlign: "center",
              marginBottom: "1rem",
            }}>
              {otpError}
            </div>
          )}

          <button
            className="btn btn-primary btn-lg"
            onClick={handleVerifyOtp}
            disabled={otpVerifying || otpCode.join("").length !== 6}
            style={{ width: "100%", marginBottom: "1rem" }}
            id="verify-otp-btn"
          >
            {otpVerifying ? t("common.loading") : t("auth.otpVerify")}
          </button>

          {/* Resend */}
          <div style={{ textAlign: "center" }}>
            {otpCooldown > 0 ? (
              <span style={{ fontSize: "0.875rem", color: "var(--text-tertiary)" }}>
                {t("auth.otpResendIn", { seconds: otpCooldown })}
              </span>
            ) : (
              <button
                className="btn btn-ghost btn-sm"
                onClick={handleResendOtp}
                disabled={otpSending}
                id="resend-otp-btn"
              >
                {otpSending ? t("auth.otpSending") : t("auth.otpResend")}
              </button>
            )}
          </div>

          {/* Back button */}
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => { setStep("info"); setOtpCode(["", "", "", "", "", ""]); setOtpError(""); }}
            style={{ width: "100%", marginTop: "1rem" }}
          >
            ← {t("common.back")}
          </button>
        </div>
      </div>
    );
  }

  // ── Step 1: Information ──
  return (
    <div className="auth-page">
      <div className="auth-card animate-scale-in" style={{ maxWidth: "480px" }}>
        {stepIndicator}
        <div className="auth-card__logo" style={{ marginBottom: "1.5rem" }}>
          <div className="auth-card__logo-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="8.5" cy="7" r="4" />
              <line x1="20" y1="8" x2="20" y2="14" />
              <line x1="23" y1="11" x2="17" y2="11" />
            </svg>
          </div>
          <h1 className="auth-card__title">{t("auth.signupTitle")}</h1>
        </div>

        <form className="auth-form" onSubmit={handleInfoSubmit} id="signup-form">
          {error && (
            <div style={{
              padding: "0.75rem 1rem", background: "var(--color-error-light)",
              color: "#991B1B", borderRadius: "var(--radius-lg)",
              fontSize: "0.875rem", fontWeight: 500,
            }}>
              {error}
            </div>
          )}

          <div className="input-group">
            <label className="input-label" htmlFor="fullName">{t("auth.fullName")} *</label>
            <input type="text" className="input" id="fullName" value={fullName}
              onChange={(e) => setFullName(e.target.value)} required />
          </div>

          <div className="input-group">
            <label className="input-label" htmlFor="email">{t("auth.email")} *
              <span style={{ fontSize: "0.7rem", color: "var(--text-tertiary)", marginLeft: "0.5rem", fontWeight: 400 }}>
                ({locale === "vi" ? "dùng để xác thực OTP" : "used for OTP verification"})
              </span>
            </label>
            <input type="email" className="input" id="email" value={email}
              onChange={(e) => setEmail(e.target.value)} placeholder="email@example.com" required />
          </div>

          <div className="input-group">
            <label className="input-label" htmlFor="phone">{t("auth.phone")}</label>
            <input type="tel" className="input" id="phone" value={phone}
              onChange={(e) => setPhone(e.target.value)} placeholder="0901234567" />
          </div>

          {/* MST Code — always visible, optional */}
          <div className="input-group">
            <label className="input-label" htmlFor="mstCode">
              {t("auth.mstCode")}
              <span style={{ fontSize: "0.7rem", color: "var(--text-tertiary)", marginLeft: "0.5rem", fontWeight: 400 }}>
                ({t("auth.mstOptional")})
              </span>
            </label>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input type="text" className="input" id="mstCode" value={mstCode}
                onChange={(e) => { setMstCode(e.target.value); setMstResult(null); setMstError(""); }}
                placeholder="0123456789" style={{ flex: 1 }} />
              <button type="button" className="btn btn-secondary" onClick={handleMstLookup}
                disabled={mstLoading || !mstCode.trim()} id="mst-lookup-btn">
                {mstLoading ? "..." : t("auth.mstLookup")}
              </button>
            </div>
            {mstResult && (
              <div style={{
                padding: "0.75rem 1rem", background: "var(--color-success-light)",
                color: "#065F46", borderRadius: "var(--radius-lg)",
                fontSize: "0.875rem", fontWeight: 500, marginTop: "0.5rem",
              }}>
                ✓ {t("auth.mstFound")}: <strong>{mstResult.cardName}</strong> ({mstResult.cardCode})
              </div>
            )}
            {mstError && <div className="error-text" style={{ marginTop: "0.25rem" }}>{mstError}</div>}
          </div>

          <div className="input-group">
            <label className="input-label" htmlFor="signupPassword">{t("auth.password")} *</label>
            <input type="password" className="input" id="signupPassword" value={password}
              onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required minLength={6} />
          </div>

          <div className="input-group">
            <label className="input-label" htmlFor="confirmPassword">{t("auth.confirmPassword")} *</label>
            <input type="password" className="input" id="confirmPassword" value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)} placeholder="••••••••" required />
          </div>

          <button type="submit" className="btn btn-primary btn-lg" disabled={otpSending}
            id="signup-next" style={{ width: "100%" }}>
            {otpSending ? t("auth.otpSending") : t("auth.sendOtp")}
          </button>
        </form>

        <div className="auth-form__footer" style={{ marginTop: "1.5rem" }}>
          {t("auth.hasAccount")}{" "}
          <Link href="/login">{t("auth.loginLink")}</Link>
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
