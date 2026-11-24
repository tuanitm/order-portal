import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { searchCustomersForAdmin, getCustomerForAdmin, getCustomerDetail } from "@/lib/adminOrderCreate";
import { searchArItems, getDepartments, getVatGroups, previewArTemplates, getRebates, arBrandOptions } from "@/lib/arInvoice/service";
import { getCompanyId } from "@/lib/config";
import { queryOne } from "@/lib/db/connection";
import { arErrorResponse } from "../respond";

/**
 * GET /api/admin/ar-invoices/lookups — what the AR Invoice form needs:
 *   ?customers=<search>          customers within the user's scope
 *   ?customer=<CardCode>         that customer's bill-to / ship-to / warehouses
 *   ?items=<search>              sellable service items within the user's brands
 *   ?rebates=<CardCode>&doc=<id>  that customer's open SAP rebates (CKTM), with suggested item + invoice text
 *   ?preview=1&card=&codes=a,b   which SAP AR approval templates would apply when the user posts
 *   ?items=<search>&brand=<code> … of that brand only (the header Brand)
 *   (none)                       departments, VAT groups, brands (Settings ∩ role), the user's SAP user and department
 */
export async function GET(request: NextRequest) {
  const guard = await requireAdminPermission(request, "ar-invoice");
  if (guard.response) return guard.response;
  const sp = request.nextUrl.searchParams;
  try {
    if (sp.has("customers")) return NextResponse.json({ customers: await searchCustomersForAdmin(guard.session, sp.get("customers") ?? "") });
    if (sp.has("customer")) {
      const c = await getCustomerForAdmin(guard.session, sp.get("customer") ?? "");
      if (!c) return NextResponse.json({ error: "Customer not found" }, { status: 404 });
      const d = await getCustomerDetail(guard.session, c);
      return NextResponse.json({ customer: d.customer, billTo: d.billTo, shipTo: d.shipTo, warehouses: d.warehouses });
    }
    if (sp.has("rebates")) {
      const c = await getCustomerForAdmin(guard.session, sp.get("rebates") ?? "");
      if (!c) return NextResponse.json({ error: "Customer not found" }, { status: 404 });
      const doc = Number(sp.get("doc")) || null;
      return NextResponse.json({ rebates: await getRebates(c.sap_card_code, undefined, doc) });
    }
    if (sp.has("items")) return NextResponse.json({ items: await searchArItems(guard.session, sp.get("items") ?? "", undefined, sp.get("brand")) });
    const me = await queryOne<{ sap_user_code: string | null; department_code: string | null }>(
      `SELECT sap_user_code, department_code FROM admin_users WHERE company_id = ? AND id = ?`, [getCompanyId(), guard.session.adminId]
    );
    if (sp.has("preview")) {
      const codes = (sp.get("codes") ?? "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 50);
      return NextResponse.json({ sapUser: me?.sap_user_code ?? null, templates: await previewArTemplates(sp.get("card") ?? "", codes, me?.sap_user_code ?? null) });
    }
    const [departments, vatGroups, brands] = await Promise.all([getDepartments(), getVatGroups(), arBrandOptions(guard.session)]);
    return NextResponse.json({ departments, vatGroups, brands, sapUser: me?.sap_user_code ?? null, myDepartment: me?.department_code ?? null });
  } catch (error) {
    return arErrorResponse(error, "Lookup failed");
  }
}
