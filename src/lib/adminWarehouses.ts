import { query } from "@/lib/db/connection";
import { loadConfig, getCompanyId } from "@/lib/config";
import type { AdminSession } from "@/lib/auth/adminSession";

/** config.json masterdata.wareHouse ("'1001','1003',...") as a list of codes. */
export function masterdataWarehouseCodes(): string[] {
  return (loadConfig().masterdata.wareHouse || "")
    .split(",")
    .map((s) => s.trim().replace(/^'|'$/g, ""))
    .filter(Boolean);
}

/**
 * The warehouses this admin may work with — the Inventory page, the "Self
 * create" order dialog and the order page's warehouse picker / SAP push.
 * Root: every masterdata.wareHouse warehouse. Anyone else: their own
 * admin_user_warehouses codes (Admin Users → Warehouse), limited to
 * masterdata.wareHouse; none assigned = none (default-deny, like the group
 * scopes in adminScope.ts).
 */
export async function getAdminWarehouseCodes(session: AdminSession): Promise<string[]> {
  const masterdata = masterdataWarehouseCodes();
  if (session.isSuperAdmin) return masterdata;
  if (!session.adminId) return [];
  const rows = await query<{ warehouse_code: string }[]>(
    `SELECT warehouse_code FROM admin_user_warehouses WHERE company_id = ? AND admin_user_id = ?`,
    [getCompanyId(), session.adminId]
  );
  const assigned = new Set(rows.map((r) => r.warehouse_code));
  return masterdata.filter((code) => assigned.has(code));
}

/**
 * This admin's warehouses with their SAP names, in masterdata order. Admin
 * pages use only this — Warehouse Visibility (customer_group_warehouses /
 * "Included") is the customers' rule for which stock they see, not the admins'.
 */
export async function getAdminWarehouses(session: AdminSession): Promise<{ code: string; name: string | null }[]> {
  const codes = await getAdminWarehouseCodes(session);
  if (codes.length === 0) return [];
  const rows = await query<{ sap_warehouse_code: string; warehouse_name: string | null }[]>(
    `SELECT sap_warehouse_code, warehouse_name FROM warehouses WHERE company_id = ? AND sap_warehouse_code IN (${codes.map(() => "?").join(",")})`,
    [getCompanyId(), ...codes]
  );
  const names = new Map(rows.map((r) => [r.sap_warehouse_code, r.warehouse_name]));
  return codes.map((code) => ({ code, name: names.get(code) ?? null }));
}
