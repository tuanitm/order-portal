/**
 * Single source of truth for the Excel Import feature's column headers/
 * order — shared by GET /api/products/template (writes these headers into
 * the downloadable file) and ImportExcelModal's header-alias matching
 * (reads/tolerates variants of these same headers), so the template and the
 * parser can never drift out of sync.
 */
export const IMPORT_TEMPLATE_COLUMNS_EN = ["Item Code", "Item Name", "Quantity", "Remark"] as const;
export const IMPORT_TEMPLATE_COLUMNS_VI = ["Mã hàng", "Tên hàng", "Số lượng", "Ghi chú"] as const;
