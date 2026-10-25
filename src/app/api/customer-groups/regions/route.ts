import { NextResponse } from "next/server";
import { getCustomerGroupsWithEffectiveActive } from "@/lib/customerGroups";
import { loadConfig } from "@/lib/config";

/**
 * GET /api/customer-groups/regions — PUBLIC (no admin auth): the active
 * Customer Group 2 ("region") codes/names, for the new-customer signup
 * form's self-declared region picker (see POST /api/auth/signup).
 *
 * This value is NOT written to SAP and is never treated as authoritative —
 * it's only an unverified routing hint so the matching regional admin can
 * see a pending registration before an admin assigns the real Customer
 * Group 1/2/3 at approval time (see isCustomerInApprovalScope). Only names
 * are exposed here, nothing sensitive.
 */
export async function GET() {
  const { masterdata } = loadConfig();
  const rootCodes = (masterdata.customerGroup || "")
    .split(",")
    .map((s) => s.trim().replace(/^'|'$/g, ""))
    .filter(Boolean);

  const rows = await getCustomerGroupsWithEffectiveActive();
  const regions = rows
    .filter((r) => r.level === 2 && r.effective_active && r.parent_code && rootCodes.includes(r.parent_code))
    .map((r) => ({ code: r.code, name: r.name }))
    .sort((a, b) => a.code.localeCompare(b.code));

  return NextResponse.json({ regions });
}
