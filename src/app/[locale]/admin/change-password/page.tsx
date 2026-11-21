"use client";

import { useState, useEffect } from "react";
import { styles, btn } from "../adminUi";
import { useAdminSession, useStaffBase } from "../layout";

/**
 * Self-service account settings for the currently logged-in admin (root or
 * role-scoped — every admin can change their own password and Owner Code,
 * unlike /admin/admin-users which lets ROOT change ANYONE's and has no
 * current-password check for the password). Linked from the sidebar as
 * "My Profile" (not tied to an AdminPermission — reachable by any
 * authenticated admin regardless of role).
 */
/**
 * Accountant only (role kind "account"): their own SAP B1 user + password,
 * entered once — verified by an SAP login, stored Fernet-encrypted. Approving
 * a Sales Order then signs in to SAP with it automatically; when the password
 * is changed in SAP, enter the new one here.
 */
function SapAccountCard({ kind }: { kind: string }) {
  const [loaded, setLoaded] = useState(false);
  const [sapUserCode, setSapUserCode] = useState("");
  const [password, setPassword] = useState("");
  const [saved, setSaved] = useState<{ sapUserCode: string | null; hasPassword: boolean; updatedAt: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/me/sap-account");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load");
        setSaved(data);
        setSapUserCode(data.sapUserCode || "");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setOk("");
    setBusy(true);
    try {
      const res = await fetch("/api/admin/me/sap-account", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sapUserCode, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      setSaved(data);
      setPassword("");
      setOk(`✓ Verified with SAP and saved — you approve as ${data.sapUserCode}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  const forget = async () => {
    if (!confirm("Remove the saved SAP password? You'll need to enter it again before approving.")) return;
    setBusy(true);
    setError("");
    setOk("");
    try {
      const res = await fetch("/api/admin/me/sap-account", { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed");
      setSaved((p) => (p ? { ...p, hasPassword: false, updatedAt: null } : p));
      setOk("Saved SAP password removed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const labelStyle = { display: "block", fontSize: "0.75rem", fontWeight: 600, marginBottom: "0.25rem", color: "var(--text-secondary, #64748B)" } as const;
  return (
    <div style={{ ...styles.cardPadded, maxWidth: "420px", marginBottom: "1.5rem" }}>
      <h2 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.25rem" }}>SAP account {kind === "account" ? "(SO Approval)" : "(Push to SAP)"}</h2>
      <p style={{ fontSize: "0.8125rem", color: "var(--text-secondary, #64748B)", marginBottom: "0.75rem" }}>
        {kind === "account"
          ? "The SAP B1 user you approve Sales Orders as — it decides which orders you see (SAP Approval Stages)."
          : "The SAP B1 user your orders are pushed to SAP as (Confirm & Push): SAP shows it as the Sales Order's creator and the approval originator. Without one, your pushes use the portal's default SAP user (admin02)."}
        {" "}Enter it once: it&apos;s checked with an SAP login and the password is stored encrypted. If you change your password in SAP, enter the new one here.
      </p>
      {saved && (
        <div style={{ fontSize: "0.8125rem", marginBottom: "0.75rem", fontWeight: 600, color: saved.hasPassword ? "#059669" : "#B45309" }}>
          {saved.hasPassword
            ? `✓ Saved for ${saved.sapUserCode}${saved.updatedAt ? ` · ${saved.updatedAt.slice(0, 16).replace("T", " ")}` : ""}`
            : saved.sapUserCode ? `No password saved for ${saved.sapUserCode}` : "Not set up yet"}
        </div>
      )}
      <form onSubmit={save}>
        {error && <div style={{ color: "#991B1B", fontSize: "0.8125rem", marginBottom: "0.75rem" }}>{error}</div>}
        {ok && <div style={{ color: "#059669", fontSize: "0.8125rem", marginBottom: "0.75rem" }}>{ok}</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div>
            <label style={labelStyle}>SAP user code</label>
            <input type="text" style={{ ...styles.input, width: "100%" }} placeholder="e.g. acc03" autoComplete="off"
              value={sapUserCode} disabled={!loaded} onChange={(e) => setSapUserCode(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>SAP password</label>
            <input type="password" style={{ ...styles.input, width: "100%" }} autoComplete="new-password"
              placeholder={saved?.hasPassword ? "•••••• saved — type the new one to replace" : "Your SAP B1 password"}
              value={password} disabled={!loaded} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" disabled={busy || !loaded || !sapUserCode.trim() || !password} style={{ ...btn("primary", busy || !sapUserCode.trim() || !password), flex: 1 }}>
              {busy ? "Checking with SAP…" : "Verify & save"}
            </button>
            {saved?.hasPassword && (
              <button type="button" disabled={busy} onClick={forget} style={btn("secondary", busy)}>Remove</button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}

export default function ChangePasswordPage() {
  const session = useAdminSession();
  const staffBase = useStaffBase();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  // Owner Code — this admin's own SAP Employee lookup key (matched against
  // EmployeesInfo.EmployeeCode, i.e. Human Resources > Employee Master
  // Data's "Code"/"Employee Code" field, when THIS admin pushes an order to
  // SAP — see SapB1Client.resolveOrderOwner). Loaded/saved via its own
  // self-service endpoint, same pattern as the password section below but
  // with no current-value confirmation needed.
  const [ownerCode, setOwnerCode] = useState("");
  const [ownerCodeLoaded, setOwnerCodeLoaded] = useState(false);
  const [ownerCodeError, setOwnerCodeError] = useState("");
  const [ownerCodeSuccess, setOwnerCodeSuccess] = useState(false);
  const [ownerCodeSaving, setOwnerCodeSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/me/owner-code");
        const data = await res.json();
        if (res.ok) setOwnerCode(data.ownerCode || "");
        else setOwnerCodeError(data.error || "Failed to load Owner Code");
      } catch {
        setOwnerCodeError("Failed to load Owner Code");
      } finally {
        setOwnerCodeLoaded(true);
      }
    })();
  }, []);

  const saveOwnerCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setOwnerCodeError("");
    setOwnerCodeSuccess(false);
    setOwnerCodeSaving(true);
    try {
      const res = await fetch("/api/admin/me/owner-code", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save Owner Code");
      setOwnerCodeSuccess(true);
    } catch (err) {
      setOwnerCodeError(err instanceof Error ? err.message : "Failed to save Owner Code");
    } finally {
      setOwnerCodeSaving(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess(false);

    if (!currentPassword || !newPassword) {
      setError("All fields are required");
      return;
    }
    if (newPassword.length < 6) {
      setError("New password must be at least 6 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/admin/me/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to change password");
      // A forced change ("change password at next login") is done — continue to the area.
      if (session?.mustChangePassword) {
        window.location.replace(staffBase);
        return;
      }
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
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>My Profile</h1>
            <p style={styles.subtitle}>
              {session?.email ? `Signed in as ${session.email}. ` : ""}
              Manage your own Owner Code and login password below.
            </p>
          </div>
        </div>

        {session && ["account", "admin", "sales"].includes(session.kind) && <SapAccountCard kind={session.kind} />}

        <div style={{ ...styles.cardPadded, maxWidth: "420px", marginBottom: "1.5rem" }}>
          <h2 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.25rem" }}>Owner Code</h2>
          <p style={{ fontSize: "0.8125rem", color: "var(--text-secondary, #64748B)", marginBottom: "0.75rem" }}>
            Matched against your SAP Employee record&apos;s Code (Human Resources &gt; Employee Master
            Data) when you push an order to SAP — sets that order&apos;s Owner so other SAP users can
            see it. Several admins may share the same code. Leave blank to use the default
            integration account&apos;s own Employee.
          </p>
          <form onSubmit={saveOwnerCode}>
            {ownerCodeError && <div style={{ color: "#991B1B", fontSize: "0.8125rem", marginBottom: "0.75rem" }}>{ownerCodeError}</div>}
            {ownerCodeSuccess && <div style={{ color: "#059669", fontSize: "0.8125rem", marginBottom: "0.75rem" }}>✓ Owner Code saved</div>}
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input
                type="text"
                style={{ ...styles.input, flex: 1 }}
                placeholder="e.g. VNIMVHCM807376"
                value={ownerCode}
                disabled={!ownerCodeLoaded}
                onChange={(e) => { setOwnerCode(e.target.value); setOwnerCodeSuccess(false); }}
              />
              <button type="submit" disabled={ownerCodeSaving || !ownerCodeLoaded} style={btn("primary", ownerCodeSaving)}>
                {ownerCodeSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </form>
        </div>

        <div style={{ ...styles.cardPadded, maxWidth: "420px" }}>
          <h2 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.75rem" }}>Change Password</h2>
          <form onSubmit={submit}>
            {error && <div style={{ color: "#991B1B", fontSize: "0.8125rem", marginBottom: "0.75rem" }}>{error}</div>}
            {success && <div style={{ color: "#059669", fontSize: "0.8125rem", marginBottom: "0.75rem" }}>✓ Password changed successfully</div>}

            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, marginBottom: "0.25rem", color: "var(--text-secondary, #64748B)" }}>
                  Current password
                </label>
                <input
                  type="password"
                  style={{ ...styles.input, width: "100%" }}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, marginBottom: "0.25rem", color: "var(--text-secondary, #64748B)" }}>
                  New password
                </label>
                <input
                  type="password"
                  style={{ ...styles.input, width: "100%" }}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, marginBottom: "0.25rem", color: "var(--text-secondary, #64748B)" }}>
                  Confirm new password
                </label>
                <input
                  type="password"
                  style={{ ...styles.input, width: "100%" }}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              <button type="submit" disabled={saving} style={btn("primary", saving)}>
                {saving ? "Saving..." : "Change password"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
