/**
 * The same order-status wording shown to customers in messages/en.json and
 * messages/vi.json's order.statusLabels — duplicated here (plain strings,
 * not next-intl keys) because this is read server-side, outside any
 * request's locale context, to build push-notification text (see
 * notifyCustomerOfStatusChange in orderHistory.ts). Keep these two in sync
 * if the storefront's own wording ever changes.
 */
const LABELS: Record<string, { vi: string; en: string }> = {
  draft: { vi: "Nháp", en: "Draft" },
  submitted: { vi: "Chờ xác nhận", en: "Pending Confirmation" },
  processing: { vi: "Đang xử lý", en: "Processing" },
  sap_draft_created: { vi: "Đã đẩy lên SAP", en: "Pushed to SAP" },
  approved: { vi: "Đã xác nhận", en: "Confirmed" },
  rejected: { vi: "Từ chối", en: "Rejected" },
  completed: { vi: "Hoàn thành", en: "Completed" },
  cancelled: { vi: "Đã hủy", en: "Cancelled" },
};

export function getOrderStatusLabel(status: string, language: "vi" | "en" = "vi"): string {
  return LABELS[status]?.[language] || status;
}
