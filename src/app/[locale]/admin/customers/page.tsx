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
  sap_price_list_num: number | null;
  sap_cus_grp01: string | null;
  sap_cus_grp02: string | null;
  sap_cus_grp03: string | null;
  registration_address: string | null;
  registration_shipping_address: string | null;
  registration_remark: string | null;
  registration_contact_person: string | null;
  declared_region_code: string | null;
  approval_status: ApprovalStatus;
  rejection_reason: string | null;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
}

interface CustomerGroupOption { id: number; level: number; code: string; name: string | null }
interface PriceListOption { price_list_num: number; list_name: string }

export default function AdminCustomersPage() {
  const t = useTranslations();
  const locale = useLocale();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<string>("pending");
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  // Surfaced inline instead of window.alert() — alert()/confirm() are
  // silently blocked (no dialog, no error, no-op) in several contexts admins
  // actually open this panel from (Teams/Zalo's embedded browser, some
  // mobile WebViews), which looked exactly like "click Approve, nothing
  // happens" with zero feedback.
  const [actionError, setActionError] = useState<string | null>(null);

  // Approve confirm modal (only for customers who already have a SAP card code)
  const [confirmApproveId, setConfirmApproveId] = useState<number | null>(null);

  // Reject modal
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectCustomerId, setRejectCustomerId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  // "Create in SAP & Approve" modal — for new-company registrations
  // (sap_card_code IS NULL) instead of the simple confirm modal above.
  const [createBpCustomerId, setCreateBpCustomerId] = useState<number | null>(null);
  const [customerGroupOptions, setCustomerGroupOptions] = useState<CustomerGroupOption[]>([]);
  const [priceListOptions, setPriceListOptions] = useState<PriceListOption[]>([]);
  // BP Group Code / Payment Terms are auto-derived server-side from a
  // sibling BP in the same Customer Group 3 (see create-bp/route.ts) —
  // not admin-facing. Salesperson Code / Credit Limit are likewise hidden
  // and just left at their defaults. Currency defaults to VND.
  const [createBpForm, setCreateBpForm] = useState({
    cusGrp03: "", priceListNum: "", currency: "VND",
    cardName: "", contactPerson: "", mstCode: "", email: "", phone: "", billingAddress: "", shippingAddress: "",
    remark: "",
  });
  const [createBpSaving, setCreateBpSaving] = useState(false);
  const [createBpError, setCreateBpError] = useState("");

  useEffect(() => {
    fetch("/api/admin/customer-groups").then((r) => r.json()).then((d) => setCustomerGroupOptions(d.customerGroups || [])).catch(() => {});
    fetch("/api/admin/price-lists").then((r) => r.json()).then((d) => setPriceListOptions(d.priceLists || [])).catch(() => {});
  }, []);

  const openCreateBpModal = (customerId: number) => {
    const customer = customers.find((c) => c.id === customerId);
    setCreateBpCustomerId(customerId);
    setCreateBpError("");
    setCreateBpForm({
      cusGrp03: "", priceListNum: "", currency: "VND",
      cardName: customer?.sap_card_name || customer?.full_name || "",
      contactPerson: customer?.registration_contact_person || "",
      mstCode: customer?.mst_code || "",
      email: customer?.email || "",
      phone: customer?.phone || "",
      billingAddress: customer?.registration_address || "",
      shippingAddress: customer?.registration_shipping_address || customer?.registration_address || "",
      remark: customer?.registration_remark || "",
    });
  };

  const handleCreateBp = async () => {
    if (!createBpCustomerId) return;
    const f = createBpForm;
    if (!f.cusGrp03 || !f.priceListNum || !f.cardName.trim() || !f.mstCode.trim() || !f.billingAddress.trim()) {
      setCreateBpError("Customer Group 3, Price List, Name, MST, and Billing Address are required");
      return;
    }
    setCreateBpSaving(true);
    setCreateBpError("");
    try {
      const res = await fetch(`/api/admin/customers/${createBpCustomerId}/create-bp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cusGrp03: f.cusGrp03,
          priceListNum: Number(f.priceListNum),
          currency: f.currency,
          cardName: f.cardName.trim(),
          contactPerson: f.contactPerson.trim() || undefined,
          mstCode: f.mstCode.trim(),
          email: f.email.trim() || undefined,
          phone: f.phone.trim() || undefined,
          billingAddress: f.billingAddress.trim(),
          shippingAddress: f.shippingAddress.trim() || undefined,
          remark: f.remark.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setCreateBpCustomerId(null);
        await fetchCustomers(activeFilter);
      } else {
        setCreateBpError(data.error || "Failed to create Business Partner");
      }
    } catch (error) {
      console.error("Create BP failed:", error);
      setCreateBpError("Failed to create Business Partner — check your connection and try again.");
    } finally {
      setCreateBpSaving(false);
    }
  };

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

  const doApprove = async (customerId: number) => {
    setConfirmApproveId(null);
    setActionError(null);
    setActionLoading(customerId);
    try {
      const res = await fetch(`/api/admin/customers/${customerId}/approve`, {
        method: "POST",
      });
      if (res.ok) {
        await fetchCustomers(activeFilter);
      } else {
        const data = await res.json();
        setActionError(data.error || "Failed to approve");
      }
    } catch (error) {
      console.error("Approve failed:", error);
      setActionError("Failed to approve — check your connection and try again.");
    } finally {
      setActionLoading(null);
    }
  };

  const handleResync = async (customerId: number) => {
    setActionError(null);
    setActionLoading(customerId);
    try {
      const res = await fetch(`/api/admin/customers/${customerId}/resync-sap`, { method: "POST" });
      if (res.ok) {
        await fetchCustomers(activeFilter);
      } else {
        const data = await res.json();
        setActionError(data.error || "Failed to resync");
      }
    } catch (error) {
      console.error("Resync failed:", error);
      setActionError("Failed to resync — check your connection and try again.");
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

    setActionError(null);
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
        setActionError(data.error || "Failed to reject");
      }
    } catch (error) {
      console.error("Reject failed:", error);
      setActionError("Failed to reject — check your connection and try again.");
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
              Manage and approve new customer accounts
            </p>
          </div>
        </div>

        {actionError && (
          <div style={{
            padding: "0.75rem 1rem", background: "var(--color-error-light, #FEF2F2)",
            color: "#991B1B", borderRadius: "var(--radius-lg, 8px)",
            fontSize: "0.875rem", fontWeight: 500, marginBottom: "1rem",
            display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem",
          }}>
            <span>{actionError}</span>
            <button onClick={() => setActionError(null)} style={{ background: "none", border: "none", color: "#991B1B", cursor: "pointer", fontWeight: 700 }}>
              ✕
            </button>
          </div>
        )}

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
                      "Group",
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
                      <td style={{ padding: "0.75rem 1rem", color: "var(--text-secondary, #64748B)", fontFamily: "monospace", fontSize: "0.75rem", whiteSpace: "nowrap" }}>
                        {[customer.sap_cus_grp01, customer.sap_cus_grp02, customer.sap_cus_grp03].filter(Boolean).join(" / ")
                          || (customer.declared_region_code ? `~${customer.declared_region_code} (declared)` : "—")}
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
                              onClick={() => customer.sap_card_code ? setConfirmApproveId(customer.id) : openCreateBpModal(customer.id)}
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
                              {customer.sap_card_code ? `✓ ${t("admin.approve")}` : "✓ Create in SAP & Approve"}
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
                        {customer.sap_card_code && (
                          <button
                            onClick={() => handleResync(customer.id)}
                            disabled={actionLoading === customer.id}
                            style={{
                              padding: "0.375rem 0.75rem",
                              borderRadius: "var(--radius-md, 6px)",
                              border: "1px solid var(--color-gray-200, #E2E8F0)",
                              fontSize: "0.75rem",
                              fontWeight: 600,
                              cursor: actionLoading === customer.id ? "not-allowed" : "pointer",
                              background: "var(--bg-primary, #fff)",
                              color: "var(--text-secondary, #64748B)",
                              opacity: actionLoading === customer.id ? 0.6 : 1,
                              marginTop: customer.approval_status === "pending" ? "0.375rem" : 0,
                            }}
                          >
                            ↻ Resync SAP
                          </button>
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

      {/* Approve Confirm Modal */}
      {confirmApproveId !== null && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 1000, padding: "1rem",
        }} onClick={() => setConfirmApproveId(null)}>
          <div style={{
            background: "var(--bg-primary, #fff)",
            borderRadius: "var(--radius-xl, 12px)",
            padding: "2rem",
            maxWidth: "420px",
            width: "100%",
            boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
          }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: "1.125rem", fontWeight: 700, marginBottom: "0.5rem", color: "var(--text-primary, #0F172A)" }}>
              {t("admin.approveConfirm")}
            </h3>
            <p style={{ color: "var(--text-secondary, #64748B)", fontSize: "0.875rem", marginBottom: "1.5rem" }}>
              {customers.find((c) => c.id === confirmApproveId)?.full_name}
            </p>
            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
              <button
                onClick={() => setConfirmApproveId(null)}
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
                onClick={() => doApprove(confirmApproveId)}
                style={{
                  padding: "0.5rem 1.25rem",
                  borderRadius: "var(--radius-lg, 8px)",
                  border: "none",
                  background: "linear-gradient(135deg, #10B981, #059669)",
                  color: "#fff",
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {t("admin.approve")}
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* Create BP & Approve Modal — new-company registrations (sap_card_code IS NULL) */}
      {createBpCustomerId !== null && (() => {
        const customer = customers.find((c) => c.id === createBpCustomerId);
        const level3Groups = customerGroupOptions.filter((g) => g.level === 3);
        return (
          <div style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 1000, padding: "1rem",
          }} onClick={() => setCreateBpCustomerId(null)}>
            <div style={{
              background: "var(--bg-primary, #fff)",
              borderRadius: "var(--radius-xl, 12px)",
              padding: "2rem",
              maxWidth: "520px",
              width: "100%",
              maxHeight: "90vh",
              overflowY: "auto",
              boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
            }} onClick={(e) => e.stopPropagation()}>
              <h3 style={{ fontSize: "1.125rem", fontWeight: 700, marginBottom: "0.5rem", color: "var(--text-primary, #0F172A)" }}>
                Create Business Partner &amp; Approve
              </h3>

              <p style={{ color: "var(--text-tertiary, #94A3B8)", fontSize: "0.8125rem", marginBottom: "1rem" }}>
                Review and correct what {customer?.full_name || "the customer"} entered at signup before creating the Business Partner in SAP.
              </p>

              {customer?.declared_region_code && (
                <div style={{
                  background: "var(--bg-secondary, #F8FAFC)", borderRadius: "var(--radius-lg, 8px)",
                  padding: "0.75rem 1rem", marginBottom: "1.25rem", fontSize: "0.8125rem",
                  color: "var(--text-secondary, #64748B)", lineHeight: 1.6,
                }}>
                  Self-declared region (unverified): <strong>{customer.declared_region_code}</strong> — pick the matching Customer Group 3 below.
                </div>
              )}

              {createBpError && (
                <div style={{
                  padding: "0.75rem 1rem", background: "var(--color-error-light, #FEF2F2)",
                  color: "#991B1B", borderRadius: "var(--radius-lg, 8px)",
                  fontSize: "0.8125rem", fontWeight: 500, marginBottom: "1rem",
                }}>
                  {createBpError}
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                <div className="input-group" style={{ gridColumn: "1 / -1" }}>
                  <label className="input-label" htmlFor="cbCardName">Name *</label>
                  <input type="text" className="input" id="cbCardName" value={createBpForm.cardName}
                    onChange={(e) => setCreateBpForm((f) => ({ ...f, cardName: e.target.value }))} />
                </div>

                <div className="input-group" style={{ gridColumn: "1 / -1" }}>
                  <label className="input-label" htmlFor="cbContactPerson">Contact Person</label>
                  <input type="text" className="input" id="cbContactPerson" value={createBpForm.contactPerson}
                    onChange={(e) => setCreateBpForm((f) => ({ ...f, contactPerson: e.target.value }))} />
                </div>

                <div className="input-group">
                  <label className="input-label" htmlFor="cbMst">MST *</label>
                  <input type="text" className="input" id="cbMst" value={createBpForm.mstCode}
                    onChange={(e) => setCreateBpForm((f) => ({ ...f, mstCode: e.target.value }))} />
                </div>

                <div className="input-group">
                  <label className="input-label" htmlFor="cbEmail">Email</label>
                  <input type="email" className="input" id="cbEmail" value={createBpForm.email}
                    onChange={(e) => setCreateBpForm((f) => ({ ...f, email: e.target.value }))} />
                </div>

                <div className="input-group" style={{ gridColumn: "1 / -1" }}>
                  <label className="input-label" htmlFor="cbPhone">Phone</label>
                  <input type="tel" className="input" id="cbPhone" value={createBpForm.phone}
                    onChange={(e) => setCreateBpForm((f) => ({ ...f, phone: e.target.value }))} />
                </div>

                <div className="input-group" style={{ gridColumn: "1 / -1" }}>
                  <label className="input-label" htmlFor="cbBillingAddress">Billing Address *</label>
                  <input type="text" className="input" id="cbBillingAddress" value={createBpForm.billingAddress}
                    onChange={(e) => setCreateBpForm((f) => ({ ...f, billingAddress: e.target.value }))} />
                </div>

                <div className="input-group" style={{ gridColumn: "1 / -1" }}>
                  <label className="input-label" htmlFor="cbShippingAddress">Shipping Address</label>
                  <input type="text" className="input" id="cbShippingAddress" value={createBpForm.shippingAddress}
                    onChange={(e) => setCreateBpForm((f) => ({ ...f, shippingAddress: e.target.value }))}
                    placeholder="Same as billing address if left blank" />
                </div>

                <div className="input-group" style={{ gridColumn: "1 / -1" }}>
                  <label className="input-label" htmlFor="cbCusGrp03">Customer Group 3 *</label>
                  <select className="input" id="cbCusGrp03" value={createBpForm.cusGrp03}
                    onChange={(e) => setCreateBpForm((f) => ({ ...f, cusGrp03: e.target.value }))}>
                    <option value="">—</option>
                    {level3Groups.map((g) => (
                      <option key={g.id} value={g.code}>{g.code}{g.name ? ` — ${g.name}` : ""}</option>
                    ))}
                  </select>
                </div>

                <div className="input-group">
                  <label className="input-label" htmlFor="cbPriceList">Price List *</label>
                  <select className="input" id="cbPriceList" value={createBpForm.priceListNum}
                    onChange={(e) => setCreateBpForm((f) => ({ ...f, priceListNum: e.target.value }))}>
                    <option value="">—</option>
                    {priceListOptions.map((p) => (
                      <option key={p.price_list_num} value={p.price_list_num}>{p.price_list_num} — {p.list_name}</option>
                    ))}
                  </select>
                </div>

                <div className="input-group">
                  <label className="input-label" htmlFor="cbCurrency">Currency</label>
                  <input type="text" className="input" id="cbCurrency" value={createBpForm.currency}
                    onChange={(e) => setCreateBpForm((f) => ({ ...f, currency: e.target.value }))} />
                </div>

                <div className="input-group" style={{ gridColumn: "1 / -1" }}>
                  <label className="input-label" htmlFor="cbRemark">Remark</label>
                  <textarea className="input" id="cbRemark" value={createBpForm.remark} rows={2}
                    style={{ resize: "vertical", minHeight: "60px" }}
                    onChange={(e) => setCreateBpForm((f) => ({ ...f, remark: e.target.value }))} />
                </div>
              </div>

              <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end", marginTop: "1.5rem" }}>
                <button
                  onClick={() => setCreateBpCustomerId(null)}
                  disabled={createBpSaving}
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
                  onClick={handleCreateBp}
                  disabled={createBpSaving}
                  style={{
                    padding: "0.5rem 1.25rem",
                    borderRadius: "var(--radius-lg, 8px)",
                    border: "none",
                    background: "linear-gradient(135deg, #10B981, #059669)",
                    color: "#fff",
                    fontSize: "0.875rem",
                    fontWeight: 600,
                    cursor: createBpSaving ? "not-allowed" : "pointer",
                    opacity: createBpSaving ? 0.6 : 1,
                  }}
                >
                  {createBpSaving ? t("common.loading") : "Create & Approve"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
