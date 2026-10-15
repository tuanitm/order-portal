"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import OrderStatusBadge from "@/components/order/OrderStatusBadge";
import ReorderButton from "@/components/order/ReorderButton";
import { useOnPushNotification } from "@/hooks/usePushRefresh";
import { use } from "react";

interface OrderDetail {
  id: number;
  order_number: string;
  customer_name: string | null;
  delivery_address: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  subtotal: string;
  discount_total: string;
  grand_total: string;
  remark: string | null;
  status: string;
  created_at: string;
  sap_doc_entry: number | null;
}

interface OrderLine {
  id: number;
  sap_item_code: string;
  item_name: string;
  quantity: number;
  uom: string;
  unit_price: string;
  line_total: string;
  confirm_qty: number;
  customer_confirm_status: "pending" | "accepted" | "rejected";
}

interface OrderMessage {
  id: number;
  sender_type: "admin" | "customer";
  sender_name: string | null;
  message: string;
  created_at: string;
}

function formatPrice(amount: number): string {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(amount) + "₫";
}

function formatDate(dateString: string, locale: string): string {
  return new Date(dateString).toLocaleDateString(locale === "vi" ? "vi-VN" : "en-US", {
    year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

/**
 * Message thread with the support team about this order — the admin side
 * posts here when something changes after the order was placed (not
 * enough stock, qty adjusted, shelf-life requirement not met, ...); the
 * customer can reply directly instead of needing a separate channel.
 */
function MessagesThread({ orderId, locale }: { orderId: number; locale: string }) {
  const [messages, setMessages] = useState<OrderMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/orders/${orderId}/messages`);
    if (!res.ok) return;
    const data = await res.json();
    setMessages(data.messages || []);
    setIsLoading(false);
  }, [orderId]);

  useEffect(() => {
    load();
  }, [load]);

  // A push notification about THIS order (new message, or a status change
  // — either way worth re-checking the thread) refreshes it immediately
  // instead of leaving it stale until the customer manually reloads.
  useOnPushNotification(useCallback((data) => {
    if (data.url.endsWith(`/orders/${orderId}`)) load();
  }, [orderId, load]));

  const send = async () => {
    const message = draft.trim();
    if (!message) return;
    setIsSending(true);
    setError("");
    try {
      const res = await fetch(`/api/orders/${orderId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send");
      setDraft("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="card" style={{ marginBottom: "1.5rem" }}>
      <div className="card-body">
        <h3 style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "1rem" }}>
          {locale === "vi" ? "Trao đổi về đơn hàng" : "Order Messages"}
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", maxHeight: "300px", overflowY: "auto", marginBottom: "1rem" }}>
          {isLoading && <div style={{ fontSize: "0.8125rem", color: "var(--text-tertiary)" }}>{locale === "vi" ? "Đang tải..." : "Loading..."}</div>}
          {!isLoading && messages.length === 0 && (
            <div style={{ fontSize: "0.8125rem", color: "var(--text-tertiary)" }}>
              {locale === "vi" ? "Chưa có tin nhắn nào." : "No messages yet."}
            </div>
          )}
          {messages.map((m) => (
            <div
              key={m.id}
              style={{
                alignSelf: m.sender_type === "customer" ? "flex-end" : "flex-start",
                maxWidth: "75%",
                padding: "0.5rem 0.75rem",
                borderRadius: "var(--radius-lg, 8px)",
                background: m.sender_type === "customer" ? "var(--color-primary)" : "var(--bg-secondary, #F8FAFC)",
                color: m.sender_type === "customer" ? "#fff" : "var(--text-primary)",
              }}
            >
              <div style={{ fontSize: "0.7rem", fontWeight: 600, opacity: 0.8, marginBottom: "0.1875rem" }}>
                {m.sender_type === "admin"
                  ? m.sender_name || (locale === "vi" ? "Bộ phận hỗ trợ" : "Support")
                  : m.sender_name || (locale === "vi" ? "Bạn" : "You")}
                {" — "}
                {formatDate(m.created_at, locale)}
              </div>
              <div style={{ fontSize: "0.8125rem", whiteSpace: "pre-wrap" }}>{m.message}</div>
            </div>
          ))}
        </div>
        {error && <div style={{ color: "#DC2626", fontSize: "0.8125rem", marginBottom: "0.5rem" }}>{error}</div>}
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <textarea
            className="input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={locale === "vi" ? "Nhập tin nhắn..." : "Type a message..."}
            rows={2}
            style={{ flex: 1, resize: "vertical" }}
          />
          <button onClick={send} disabled={isSending || !draft.trim()} className="btn btn-primary">
            {isSending ? (locale === "vi" ? "Đang gửi..." : "Sending...") : (locale === "vi" ? "Gửi" : "Send")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const { id } = use(params);
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Editing own delivery info (address/phone/remark) — only while the
  // order hasn't been pushed to SAP (see the PATCH route).
  const [isEditingInfo, setIsEditingInfo] = useState(false);
  const [infoDraft, setInfoDraft] = useState({ deliveryAddress: "", contactPhone: "", remark: "" });
  const [isSavingInfo, setIsSavingInfo] = useState(false);
  const [infoError, setInfoError] = useState("");

  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState("");

  // Per-line Accept/Reject (admin-adjusted Confirm Qty) in flight.
  const [respondingLineId, setRespondingLineId] = useState<number | null>(null);
  const [lineError, setLineError] = useState("");

  const load = useCallback(() => {
    const controller = new AbortController();
    fetch(`/api/orders/${id}`, { signal: controller.signal })
      .then((res) => {
        if (res.status === 404) {
          setNotFound(true);
          return null;
        }
        return res.ok ? res.json() : null;
      })
      .then((data) => {
        if (data) {
          setOrder(data.order);
          setLines(data.lines || []);
        }
      })
      .catch((err) => {
        if (err instanceof Error && err.name !== "AbortError") {
          console.error("Failed to load order:", err);
        }
      })
      .finally(() => setIsLoading(false));
    return () => controller.abort();
  }, [id]);

  useEffect(() => {
    return load();
  }, [load]);

  // A push notification about this order (status change, or a new
  // message) refreshes the page's own data right away instead of leaving
  // it stale until the customer manually reloads.
  useOnPushNotification(useCallback((data) => {
    if (data.url.endsWith(`/orders/${id}`)) load();
  }, [id, load]));

  const startEditInfo = () => {
    if (!order) return;
    setInfoDraft({
      deliveryAddress: order.delivery_address || "",
      contactPhone: order.contact_phone || "",
      remark: order.remark || "",
    });
    setInfoError("");
    setIsEditingInfo(true);
  };

  const saveInfo = async () => {
    setIsSavingInfo(true);
    setInfoError("");
    try {
      const res = await fetch(`/api/orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(infoDraft),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      setIsEditingInfo(false);
      load();
    } catch (err) {
      setInfoError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setIsSavingInfo(false);
    }
  };

  const cancelOrder = async () => {
    if (!confirm(locale === "vi" ? "Bạn chắc chắn muốn hủy đơn hàng này?" : "Are you sure you want to cancel this order?")) return;
    setIsCancelling(true);
    setCancelError("");
    try {
      const res = await fetch(`/api/orders/${id}/cancel`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to cancel order");
      load();
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : "Failed to cancel order");
    } finally {
      setIsCancelling(false);
    }
  };

  const respondToLine = async (lineId: number, accept: boolean) => {
    setRespondingLineId(lineId);
    setLineError("");
    try {
      const res = await fetch(`/api/orders/${id}/lines/${lineId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accept }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to respond");
      load();
    } catch (err) {
      setLineError(err instanceof Error ? err.message : "Failed to respond");
    } finally {
      setRespondingLineId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="page">
        <div className="container" style={{ maxWidth: "800px", textAlign: "center", padding: "4rem 2rem", color: "var(--text-tertiary)" }}>
          {t("common.loading")}
        </div>
      </div>
    );
  }

  if (notFound || !order) {
    return (
      <div className="page">
        <div className="container" style={{ maxWidth: "800px", textAlign: "center", padding: "4rem 2rem" }}>
          <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>🔍</div>
          <h2>{locale === "vi" ? "Không tìm thấy đơn hàng" : "Order not found"}</h2>
          <Link href="/orders" className="btn btn-primary" style={{ marginTop: "1.5rem" }}>
            ← {t("order.title")}
          </Link>
        </div>
      </div>
    );
  }

  const discountTotal = Number(order.discount_total);
  const isEditable = !order.sap_doc_entry;
  const canCancel = isEditable && !["cancelled", "completed", "rejected"].includes(order.status);
  const hasAnyAdjustment = lines.some((l) => l.confirm_qty !== l.quantity);

  return (
    <div className="page">
      <div className="container" style={{ maxWidth: "800px" }}>
        {/* Header */}
        <div style={{ marginBottom: "2rem" }}>
          <Link href="/orders" style={{
            fontSize: "0.8125rem", color: "var(--text-tertiary)",
            textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "0.25rem",
            marginBottom: "1rem",
          }}>
            ← {t("order.title")}
          </Link>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
            <div>
              <h1 style={{ fontSize: "1.5rem", fontWeight: 800, marginBottom: "0.25rem" }}>
                {order.order_number}
              </h1>
              <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)" }}>
                {formatDate(order.created_at, locale)}
              </p>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
              <OrderStatusBadge orderId={order.id} status={order.status} large />
              <ReorderButton orderId={order.id} />
              {canCancel && (
                <button onClick={cancelOrder} disabled={isCancelling} className="btn btn-secondary" style={{ color: "#DC2626", borderColor: "#DC2626" }}>
                  {isCancelling
                    ? (locale === "vi" ? "Đang hủy..." : "Cancelling...")
                    : (locale === "vi" ? "Hủy đơn hàng" : "Cancel Order")}
                </button>
              )}
            </div>
          </div>
          {cancelError && <div style={{ color: "#DC2626", fontSize: "0.8125rem", marginTop: "0.5rem" }}>{cancelError}</div>}
        </div>

        {/* Customer Info */}
        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <div className="card-body">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h3 style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {t("checkout.deliveryInfo")}
              </h3>
              {isEditable && !isEditingInfo && (
                <button onClick={startEditInfo} className="btn btn-secondary" style={{ fontSize: "0.75rem", padding: "0.375rem 0.75rem" }}>
                  {locale === "vi" ? "Chỉnh sửa" : "Edit"}
                </button>
              )}
            </div>

            {isEditingInfo ? (
              <div>
                {infoError && <div style={{ color: "#DC2626", fontSize: "0.8125rem", marginBottom: "0.75rem" }}>{infoError}</div>}
                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  <div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", marginBottom: "0.25rem" }}>{t("checkout.contactPhone")}</div>
                    <input
                      className="input"
                      style={{ width: "100%" }}
                      value={infoDraft.contactPhone}
                      onChange={(e) => setInfoDraft({ ...infoDraft, contactPhone: e.target.value })}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", marginBottom: "0.25rem" }}>{t("checkout.deliveryAddress")}</div>
                    <input
                      className="input"
                      style={{ width: "100%" }}
                      value={infoDraft.deliveryAddress}
                      onChange={(e) => setInfoDraft({ ...infoDraft, deliveryAddress: e.target.value })}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", marginBottom: "0.25rem" }}>{t("checkout.remark")}</div>
                    <textarea
                      className="input"
                      style={{ width: "100%", resize: "vertical" }}
                      rows={2}
                      value={infoDraft.remark}
                      onChange={(e) => setInfoDraft({ ...infoDraft, remark: e.target.value })}
                    />
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button onClick={saveInfo} disabled={isSavingInfo} className="btn btn-primary">
                      {isSavingInfo ? (locale === "vi" ? "Đang lưu..." : "Saving...") : (locale === "vi" ? "Lưu" : "Save")}
                    </button>
                    <button onClick={() => setIsEditingInfo(false)} disabled={isSavingInfo} className="btn btn-secondary">
                      {locale === "vi" ? "Hủy" : "Cancel"}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
              <div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", marginBottom: "0.125rem" }}>{t("checkout.customerName")}</div>
                <div style={{ fontWeight: 600 }}>{order.customer_name || "—"}</div>
              </div>
              <div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", marginBottom: "0.125rem" }}>{t("checkout.contactPhone")}</div>
                <div style={{ fontWeight: 600 }}>{order.contact_phone || "—"}</div>
              </div>
              <div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", marginBottom: "0.125rem" }}>{t("checkout.contactEmail")}</div>
                <div style={{ fontWeight: 600 }}>{order.contact_email || "—"}</div>
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <div style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", marginBottom: "0.125rem" }}>{t("checkout.deliveryAddress")}</div>
                <div style={{ fontWeight: 600 }}>{order.delivery_address || "—"}</div>
              </div>
              {order.remark && (
                <div style={{ gridColumn: "1 / -1" }}>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", marginBottom: "0.125rem" }}>{t("checkout.remark")}</div>
                  <div style={{ fontWeight: 500, fontStyle: "italic" }}>{order.remark}</div>
                </div>
              )}
            </div>
            )}
          </div>
        </div>

        {/* Order Lines */}
        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <div className="card-body" style={{ padding: 0 }}>
            <h3 style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em", padding: "1rem 1.25rem 0.75rem" }}>
              {t("checkout.orderSummary")}
            </h3>
            {lineError && <div style={{ color: "#DC2626", fontSize: "0.8125rem", padding: "0 1.25rem 0.75rem" }}>{lineError}</div>}
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid var(--color-gray-200)" }}>
                    <th style={{ padding: "0.625rem 1.25rem", textAlign: "left", fontWeight: 700, color: "var(--text-secondary)", fontSize: "0.75rem" }}>{t("product.itemCode")}</th>
                    <th style={{ padding: "0.625rem 1.25rem", textAlign: "left", fontWeight: 700, color: "var(--text-secondary)", fontSize: "0.75rem" }}>{locale === "vi" ? "Tên sản phẩm" : "Product Name"}</th>
                    <th style={{ padding: "0.625rem 1.25rem", textAlign: "center", fontWeight: 700, color: "var(--text-secondary)", fontSize: "0.75rem" }}>{t("cart.quantity")}</th>
                    {hasAnyAdjustment && (
                      <th style={{ padding: "0.625rem 1.25rem", textAlign: "center", fontWeight: 700, color: "var(--text-secondary)", fontSize: "0.75rem" }}>
                        {locale === "vi" ? "SL xác nhận" : "Confirmed Qty"}
                      </th>
                    )}
                    <th style={{ padding: "0.625rem 1.25rem", textAlign: "right", fontWeight: 700, color: "var(--text-secondary)", fontSize: "0.75rem" }}>{t("cart.unitPrice")}</th>
                    <th style={{ padding: "0.625rem 1.25rem", textAlign: "right", fontWeight: 700, color: "var(--text-secondary)", fontSize: "0.75rem" }}>{t("cart.lineTotal")}</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => {
                    const adjusted = line.confirm_qty !== line.quantity;
                    return (
                      <tr key={line.id} style={{ borderBottom: "1px solid var(--color-gray-200)" }}>
                        <td style={{ padding: "0.625rem 1.25rem", fontFamily: "monospace", fontSize: "0.75rem", color: "var(--text-secondary)" }}>{line.sap_item_code}</td>
                        <td style={{ padding: "0.625rem 1.25rem", fontWeight: 600 }}>{line.item_name}</td>
                        <td style={{ padding: "0.625rem 1.25rem", textAlign: "center" }}>{line.quantity} {line.uom}</td>
                        {hasAnyAdjustment && (
                          <td style={{ padding: "0.625rem 1.25rem", textAlign: "center" }}>
                            {adjusted ? (
                              <div>
                                <div style={{ fontWeight: 700, color: line.customer_confirm_status === "rejected" ? "#DC2626" : "#D97706" }}>
                                  {line.confirm_qty} {line.uom}
                                </div>
                                {line.customer_confirm_status === "pending" && isEditable ? (
                                  <div style={{ display: "flex", gap: "0.25rem", justifyContent: "center", marginTop: "0.25rem" }}>
                                    <button
                                      onClick={() => respondToLine(line.id, true)}
                                      disabled={respondingLineId === line.id}
                                      className="btn btn-primary"
                                      style={{ fontSize: "0.7rem", padding: "0.25rem 0.5rem" }}
                                    >
                                      {locale === "vi" ? "Đồng ý" : "Accept"}
                                    </button>
                                    <button
                                      onClick={() => respondToLine(line.id, false)}
                                      disabled={respondingLineId === line.id}
                                      className="btn btn-secondary"
                                      style={{ fontSize: "0.7rem", padding: "0.25rem 0.5rem", color: "#DC2626", borderColor: "#DC2626" }}
                                    >
                                      {locale === "vi" ? "Từ chối" : "Reject"}
                                    </button>
                                  </div>
                                ) : (
                                  <div style={{
                                    fontSize: "0.7rem", fontWeight: 600, marginTop: "0.125rem",
                                    color: line.customer_confirm_status === "accepted" ? "#059669"
                                         : line.customer_confirm_status === "rejected" ? "#DC2626" : "#D97706",
                                  }}>
                                    {line.customer_confirm_status === "accepted"
                                      ? (locale === "vi" ? "Đã đồng ý" : "Accepted")
                                      : line.customer_confirm_status === "rejected"
                                        ? (locale === "vi" ? "Đã từ chối" : "Rejected")
                                        : (locale === "vi" ? "Đang chờ" : "Pending")}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span style={{ color: "var(--text-tertiary)" }}>—</span>
                            )}
                          </td>
                        )}
                        <td style={{ padding: "0.625rem 1.25rem", textAlign: "right" }}>{formatPrice(Number(line.unit_price))}</td>
                        <td style={{ padding: "0.625rem 1.25rem", textAlign: "right", fontWeight: 700 }}>{formatPrice(Number(line.line_total))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Totals */}
        <div className="card">
          <div className="card-body" style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.5rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", width: "250px" }}>
              <span style={{ color: "var(--text-secondary)" }}>{t("cart.subtotal")}</span>
              <span style={{ fontWeight: 600 }}>{formatPrice(Number(order.subtotal))}</span>
            </div>
            {discountTotal > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", width: "250px" }}>
                <span style={{ color: "var(--text-secondary)" }}>{t("cart.discount")}</span>
                <span style={{ fontWeight: 600, color: "#DC2626" }}>-{formatPrice(discountTotal)}</span>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", width: "250px", paddingTop: "0.5rem", borderTop: "2px solid var(--color-gray-200)" }}>
              <span style={{ fontWeight: 700, fontSize: "1rem" }}>{t("cart.total")}</span>
              <span style={{ fontWeight: 800, fontSize: "1.125rem", color: "var(--color-primary-dark)" }}>{formatPrice(Number(order.grand_total))}</span>
            </div>
          </div>
        </div>

        <div style={{ marginTop: "1.5rem" }}>
          <MessagesThread orderId={order.id} locale={locale} />
        </div>
      </div>
    </div>
  );
}
