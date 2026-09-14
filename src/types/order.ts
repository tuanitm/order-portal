// ── Order Types ──

export type OrderStatus =
  | 'draft'
  | 'submitted'
  | 'processing'
  | 'sap_draft_created'
  | 'approved'
  | 'rejected'
  | 'completed';

export interface OrderLine {
  id?: number;
  orderId?: number;
  sapItemCode: string;
  itemName: string;
  quantity: number;
  uom: string;
  unitPrice: number;
  discountPercent: number;
  lineTotal: number;
}

export interface Order {
  id: number;
  orderNumber: string;
  userId: number;
  customerName: string;
  deliveryAddress: string;
  contactPhone: string;
  contactEmail: string;
  subtotal: number;
  discountTotal: number;
  grandTotal: number;
  remark: string;
  status: OrderStatus;
  sapDocEntry: number | null;
  sapDocNum: number | null;
  language: 'vi' | 'en';
  createdAt: string;
  updatedAt: string;
  lines?: OrderLine[];
}

export interface CreateOrderRequest {
  customerName: string;
  deliveryAddress: string;
  contactPhone: string;
  contactEmail: string;
  remark?: string;
  lines: {
    sapItemCode: string;
    itemName: string;
    quantity: number;
    uom: string;
    unitPrice: number;
    discountPercent: number;
  }[];
}

export interface OrderListResponse {
  orders: Order[];
  total: number;
  page: number;
  totalPages: number;
}
