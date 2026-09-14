"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations, useLocale } from "next-intl";

type ApprovalStatus = "pending" | "approved" | "rejected";

interface Customer {
  id: number;
  email: string | null;
  phone: string | null;
  full_name: string;
  mst_code: string | null;
  sap_card_code: string | null;
  sap_card_name: string | null;
  approval_status: ApprovalStatus;
  rejection_reason: string | null;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
}

export default function AdminCustomersPage() {
  const t = useTranslations();
  const locale = useLocale();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<string>("pending");
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  // Reject modal
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectCustomerId, setRejectCustomerId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const fetchCustomers = useCallback(async (status?: string) => {
    setIsLoading(true);
    try {
      const url = status && status !== "all"
        ? `/api/admin/customers?status=${status}`
        : "/api/admin/customers";
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setCustomers(data.customers || []);
      }
    } catch (error) {
      console.error("Failed to fetch customers:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCustomers(activeFilter);
  }, [activeFilter, fetchCustomers]);

  const handleApprove = async (customerId: number) => {
    if (!confirm(t("admin.approveConfirm"))) return;

    setActionLoading(customerId);
    try {
      const res = await fetch(`/api/admin/customers/${customerId}/approve`, {
        method: "POST",
      });
      if (res.ok) {
        await fetchCustomers(activeFilter);
      } else {
        const data = await res.json();
        alert(data.error || "Failed to approve");
      }
    } catch (error) {
      console.error("Approve failed:", error);
    } finally {
      setActionLoading(null);
    }
  };

  const openRejectModal = (customerId: number) => {
    setRejectCustomerId(customerId);
    setRejectReason("");
    setShowRejectModal(true);
  };

  const handleReject = async () => {
    if (!rejectCustomerId || !rejectReason.trim()) return;

    setActionLoading(rejectCustomerId);
    setShowRejectModal(false);
    try {
      const res = await fetch(`/api/admin/customers/${rejectCustomerId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rejectReason.trim() }),
      });
      if (res.ok) {
        await fetchCustomers(activeFilter);
      } else {
        const data = await res.json();
        alert(data.error || "Failed to reject");
      }
    } catch (error) {
      console.error("Reject failed:", error);
    } finally {
      setActionLoading(null);
      setRejectCustomerId(null);
    }
  };

  const statusBadge = (status: ApprovalStatus) => {
    const styles: Record<ApprovalStatus, { bg: string; color: string; label: string }> = {
      pending: { bg: "#FEF3C7", color: "#92400E", label: t("admin.pending") },
      approved: { bg: "#D1FAE5", color: "#065F46", label: t("admin.approved") },
      rejected: { bg: "#FEE2E2", color: "#991B1B", label: t("admin.rejected") },
    };
    const s = styles[status];
    return (
      <span style={{
        display: "inline-block", padding: "0.25rem 0.75rem",
        borderRadius: "var(--radius-full)", fontSize: "0.75rem",
        fontWeight: 600, background: s.bg, color: s.color,
      }}>
        {s.label}
      </span>
    );
  };

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString(locale === "vi" ? "vi-VN" : "en-US", {
        year: "numeric", month: "short", day: "numeric",
        hour: "2-digit", minute: "2-digit",
      });
    } catch {
      return dateStr;
    }
  };

  const filterTabs = [
    { key: "pending", label: t("admin.pendingCustomers") },
    { key: "approved", label: t("admin.approvedCustomers") },
    { key: "rejected", label: t("admin.rejectedCustomers") },
    { key: "all", label: t("admin.allCustomers") },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-secondary, #F8FAFC)", padding: "2rem 1rem" }}>
      <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
        {/* Header */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          marginBottom: "2rem", flexWrap: "wrap", gap: "1rem",
        }}>
          <div>
            <h1 style={{ fontSize: "1.75rem", fontWeight: 800, color: "var(--text-primary, #0F172A)" }}>
              {t("admin.customers")}
            </h1>
            <p style={{ color: "var(--text-tertiary, #94A3B8)", fontSize: "0.875rem", marginTop: "0.25rem" }}>
              {locale === "vi"
                ? "Quản lý và duyệt tài khoản khách hàng mới"
                : "Manage and approve new customer accounts"}
            </p>
          </div>
          <a href={`/${locale}`} style={{
            padding: "0.5rem 1rem", borderRadius: "var(--radius-lg, 8px)",
            fontSize: "0.8125rem", color: "var(--text-secondary, #64748B)",
            border: "1px solid var(--color-gray-200, #E2E8F0)",
            textDecoration: "none", fontWeight: 500,
            background: "var(--bg-primary, #fff)",
          }}>
            ← {locale === "vi" ? "Cổng đặt hàng" : "Ordering Portal"}
          </a>
        </div>

        {/* Filter Tabs */}
        <div style={{
          display: "flex", gap: "0.5rem", marginBottom: "1.5rem",
          background: "var(--bg-primary, #fff)", padding: "0.375rem",
          borderRadius: "var(--radius-lg, 8px)",
          border: "1px solid var(--color-gray-200, #E2E8F0)",
          flexWrap: "wrap",
        }}>
          {filterTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveFilter(tab.key)}
              style={{
                padding: "0.5rem 1rem",
                borderRadius: "var(--radius-md, 6px)",
                border: "none",
                fontSize: "0.8125rem",
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.2s ease",
                background: activeFilter === tab.key
                  ? "var(--color-primary, #2BBCB3)"
                  : "transparent",
                color: activeFilter === tab.key
                  ? "#fff"
                  : "var(--text-secondary, #64748B)",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Customer Table */}
        <div style={{
          background: "var(--bg-primary, #fff)",
          borderRadius: "var(--radius-xl, 12px)",
          border: "1px solid var(--color-gray-200, #E2E8F0)",
          overflow: "hidden",
        }}>
          {isLoading ? (
            <div style={{ padding: "3rem", textAlign: "center", color: "var(--text-tertiary, #94A3B8)" }}>
              {t("common.loading")}
            </div>
          ) : customers.length === 0 ? (
            <div style={{ padding: "3rem", textAlign: "center", color: "var(--text-tertiary, #94A3B8)" }}>
              <div style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>📋</div>
              <p style={{ fontWeight: 600 }}>{t("admin.noCustomers")}</p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid var(--color-gray-200, #E2E8F0)" }}>
                    {[
                      t("admin.customerName"),
                      t("admin.email"),
                      t("admin.phone"),
                      t("admin.mstCode"),
                      t("admin.bpCode"),
                      t("admin.bpName"),
                      t("admin.registeredAt"),
                      t("admin.status"),
                      t("admin.actions"),
                    ].map((header) => (
                      <th key={header} style={{
                        padding: "0.75rem 1rem", textAlign: "left",
                        fontWeight: 700, color: "var(--text-secondary, #64748B)",
                        fontSize: "0.75rem", textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        whiteSpace: "nowrap",
                      }}>
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {customers.map((customer) => (
                    <tr key={customer.id} style={{
                      borderBottom: "1px solid var(--color-gray-200, #E2E8F0)",
                      transition: "background 0.15s ease",
                    }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-secondary, #F8FAFC)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <td style={{ padding: "0.75rem 1rem", fontWeight: 600, color: "var(--text-primary, #0F172A)", whiteSpace: "nowrap" }}>
                        {customer.full_name}
                      </td>
                      <td style={{ padding: "0.75rem 1rem", color: "var(--text-secondary, #64748B)" }}>
                        {customer.email || "—"}
                      </td>
                      <td style={{ padding: "0.75rem 1rem", color: "var(--text-secondary, #64748B)", whiteSpace: "nowrap" }}>
                        {customer.phone || "—"}
                      </td>
                      <td style={{ padding: "0.75rem 1rem", color: "var(--text-secondary, #64748B)", fontFamily: "monospace", fontSize: "0.75rem" }}>
                        {customer.mst_code || "—"}
                      </td>
                      <td style={{ padding: "0.75rem 1rem", color: "var(--text-secondary, #64748B)", fontFamily: "monospace", fontSize: "0.75rem" }}>
                        {customer.sap_card_code || "—"}
                      </td>
                      <td style={{ padding: "0.75rem 1rem", color: "var(--text-secondary, #64748B)" }}>
                        {customer.sap_card_name || "—"}
                      </td>
                      <td style={{ padding: "0.75rem 1rem", color: "var(--text-tertiary, #94A3B8)", whiteSpace: "nowrap", fontSize: "0.75rem" }}>
                        {formatDate(customer.created_at)}
                      </td>
                      <td style={{ padding: "0.75rem 1rem" }}>
                        {statusBadge(customer.approval_status)}
                        {customer.approval_status === "rejected" && customer.rejection_reason && (
                          <div style={{
                            fontSize: "0.6875rem", color: "#991B1B", marginTop: "0.25rem",
                            maxWidth: "150px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }} title={customer.rejection_reason}>
                            {customer.rejection_reason}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: "0.75rem 1rem", whiteSpace: "nowrap" }}>
                        {customer.approval_status === "pending" && (
                          <div style={{ display: "flex", gap: "0.375rem" }}>
                            <button
                              onClick={() => handleApprove(customer.id)}
                              disabled={actionLoading === customer.id}
                              style={{
                                padding: "0.375rem 0.75rem",
                                borderRadius: "var(--radius-md, 6px)",
                                border: "none",
                                fontSize: "0.75rem",
                                fontWeight: 600,
                                cursor: actionLoading === customer.id ? "not-allowed" : "pointer",
                                background: "linear-gradient(135deg, #10B981, #059669)",
                                color: "#fff",
                                opacity: actionLoading === customer.id ? 0.6 : 1,
                                transition: "opacity 0.2s",
                              }}
                            >
                              ✓ {t("admin.approve")}
                            </button>
                            <button
                              onClick={() => openRejectModal(customer.id)}
                              disabled={actionLoading === customer.id}
                              style={{
                                padding: "0.375rem 0.75rem",
                                borderRadius: "var(--radius-md, 6px)",
                                border: "1px solid #FCA5A5",
                                fontSize: "0.75rem",
                                fontWeight: 600,
                                cursor: actionLoading === customer.id ? "not-allowed" : "pointer",
                                background: "#FEF2F2",
                                color: "#DC2626",
                                opacity: actionLoading === customer.id ? 0.6 : 1,
                                transition: "opacity 0.2s",
                              }}
                            >
                              ✕ {t("admin.reject")}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Reject Modal */}
      {showRejectModal && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 1000, padding: "1rem",
        }} onClick={() => setShowRejectModal(false)}>
          <div style={{
            background: "var(--bg-primary, #fff)",
            borderRadius: "var(--radius-xl, 12px)",
            padding: "2rem",
            maxWidth: "420px",
            width: "100%",
            boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
          }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: "1.125rem", fontWeight: 700, marginBottom: "0.5rem", color: "var(--text-primary, #0F172A)" }}>
              {t("admin.rejectConfirm")}
            </h3>
            <p style={{ color: "var(--text-secondary, #64748B)", fontSize: "0.875rem", marginBottom: "1rem" }}>
              {locale === "vi"
                ? "Vui lòng nhập lý do từ chối để thông báo cho khách hàng."
                : "Please enter a rejection reason to notify the customer."}
            </p>

            <div className="input-group" style={{ marginBottom: "1.5rem" }}>
              <label className="input-label" htmlFor="rejectReason">{t("admin.rejectReason")} *</label>
              <textarea
                className="input"
                id="rejectReason"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder={t("admin.rejectReasonPlaceholder")}
                rows={3}
                style={{ resize: "vertical", minHeight: "80px" }}
                required
                autoFocus
              />
            </div>

            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
              <button
                onClick={() => setShowRejectModal(false)}
                style={{
                  padding: "0.5rem 1.25rem",
                  borderRadius: "var(--radius-lg, 8px)",
                  border: "1px solid var(--color-gray-200, #E2E8F0)",
                  background: "var(--bg-primary, #fff)",
                  color: "var(--text-secondary, #64748B)",
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={handleReject}
                disabled={!rejectReason.trim()}
                style={{
                  padding: "0.5rem 1.25rem",
                  borderRadius: "var(--radius-lg, 8px)",
                  border: "none",
                  background: rejectReason.trim()
                    ? "linear-gradient(135deg, #EF4444, #DC2626)"
                    : "#E2E8F0",
                  color: rejectReason.trim() ? "#fff" : "#94A3B8",
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  cursor: rejectReason.trim() ? "pointer" : "not-allowed",
                }}
              >
                {t("admin.reject")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
