"use client";

import { useState, useEffect } from "react";
import { styles, btn } from "../adminUi";
import { useAdminSession } from "../layout";

/**
 * Self-service account settings for the currently logged-in admin (root or
 * role-scoped — every admin can change their own password and Owner Code,
 * unlike /admin/admin-users which lets ROOT change ANYONE's and has no
 * current-password check for the password). Linked from the sidebar as
 * "My Profile" (not tied to an AdminPermission — reachable by any
 * authenticated admin regardless of role).
 */
export default function ChangePasswordPage() {
  const session = useAdminSession();
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
