"use client";

import { useState } from "react";
import { styles, btn } from "../adminUi";
import { useAdminSession } from "../layout";

/**
 * Self-service password change for the currently logged-in admin (root or
 * role-scoped — every admin can change their own password, unlike
 * /admin/admin-users which lets ROOT change ANYONE's password and has no
 * current-password check). Not listed in the sidebar nav (it isn't tied to
 * an AdminPermission), but reachable by any authenticated admin.
 */
export default function ChangePasswordPage() {
  const session = useAdminSession();
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
            <h1 style={styles.title}>Change Password</h1>
            <p style={styles.subtitle}>
              {session?.email ? `Signed in as ${session.email}. ` : ""}
              Change your own admin login password below.
            </p>
          </div>
        </div>

        <div style={{ ...styles.cardPadded, maxWidth: "420px" }}>
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
