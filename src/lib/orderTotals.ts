import { getPool } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";

export interface OrderTotals {
  subtotal: number;
  discountTotal: number;
  grandTotal: number;
  /** Every line's (possibly new) line_total. */
  lines: { id: number; lineTotal: number }[];
}

/**
 * Re-derives each line's line_total and the order's subtotal / discount /
 * total from the quantity that will actually be delivered — Confirm Qty, or
 * 0 for a line whose adjusted quantity the customer rejected (rejected lines
 * are never pushed to SAP). Called after anything that changes confirm_qty
 * or customer_confirm_status: the admin editing Cfm Qty (and the linked gift
 * line following it), the live-stock cap before a SAP push, and the
 * customer's Accept/Reject.
 *
 * Same formulas as checkout (createOrdersFromLines): line_total = unit price
 * x qty, subtotal = base price x qty, total = sum of line totals, discount =
 * subtotal - total; gift lines are 0. A line still at its originally ordered
 * quantity keeps its checkout line_total (computed there from the unrounded
 * unit price), so an untouched order's amounts never move by rounding.
 */
export async function recalculateOrderTotals(orderId: number): Promise<OrderTotals> {
  const companyId = getCompanyId();
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT id, quantity, confirm_qty, customer_confirm_status, base_unit_price, unit_price, line_total
         FROM order_lines WHERE company_id = ? AND order_id = ? FOR UPDATE`,
      [companyId, orderId]
    );
    const lines = rows as {
      id: number; quantity: number; confirm_qty: number; customer_confirm_status: string;
      base_unit_price: string; unit_price: string; line_total: string;
    }[];

    let subtotal = 0;
    let grandTotal = 0;
    const result: OrderTotals["lines"] = [];
    for (const l of lines) {
      const qty = l.customer_confirm_status === "rejected" ? 0 : Number(l.confirm_qty);
      const unit = Number(l.unit_price);
      const stored = Number(l.line_total);
      // At the ordered quantity, keep checkout's own figure if it is still
      // that (within the 0.5/unit rounding of the stored unit price).
      const keepCheckoutTotal = qty === Number(l.quantity) && Math.abs(stored - unit * qty) <= 0.5 * qty;
      const lineTotal = keepCheckoutTotal ? stored : Math.round(unit * qty);
      if (lineTotal !== stored) {
        await conn.execute(`UPDATE order_lines SET line_total = ? WHERE company_id = ? AND id = ?`, [lineTotal, companyId, l.id]);
      }
      subtotal += Math.round(Number(l.base_unit_price)) * qty;
      grandTotal += lineTotal;
      result.push({ id: l.id, lineTotal });
    }
    const discountTotal = subtotal - grandTotal;
    await conn.execute(
      `UPDATE orders SET subtotal = ?, discount_total = ?, grand_total = ? WHERE company_id = ? AND id = ?`,
      [subtotal, discountTotal, grandTotal, companyId, orderId]
    );
    await conn.commit();
    return { subtotal, discountTotal, grandTotal, lines: result };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
