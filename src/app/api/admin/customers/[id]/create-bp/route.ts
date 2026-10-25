import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { isCustomerInApprovalScope } from "@/lib/adminScope";
import { getCustomerGroupAncestors } from "@/lib/customerGroups";
import { generateCardCode } from "@/lib/sap-b1/cardCode";
import { getSapClient } from "@/lib/sap-b1/client";
import { sendApprovalEmail } from "@/lib/email/sender";
import { logAuditEvent } from "@/lib/auditLog";

/**
 * POST /api/admin/customers/[id]/create-bp — for a new-company registration
 * (approval_status='pending', sap_card_code IS NULL — see POST
 * /api/auth/signup), assign the commercial fields an admin picks, generate
 * the sequential CardCode, create the Business Partner in SAP, and approve
 * the registration.
 *
 * BP Group Code and Payment Terms Code are deliberately NOT taken from the
 * request — they're copied from an existing BP in the same Customer Group
 * 3 (see findBpCommercialDefaultsByGroup3) rather than hand-typed by the
 * admin. Salesperson Code and Credit Limit are likewise not admin-facing;
 * they're just left at their defaults (unset / 0).
 *
 * Body: {
 *   cusGrp03: string, priceListNum: number, currency?: string,
 *   cardName?: string, contactPerson?: string, mstCode?: string,
 *   email?: string, phone?: string, billingAddress?: string, shippingAddress?: string,
 *   remark?: string
 * }
 * remark is portal-only (kept on the registration record for future
 * reference) — it's never sent to SAP, unlike every other field above.
 * The customer-info overrides are optional — the admin only sends them when
 * correcting what the customer typed at signup; anything omitted falls
 * back to the stored registration.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireAdminPermission(request, "customers");
    if (guard.response) return guard.response;
    const session = guard.session;

    const { id } = await params;
    const customerId = parseInt(id, 10);
    if (isNaN(customerId)) {
      return NextResponse.json({ error: "Invalid customer ID" }, { status: 400 });
    }

    const body = await request.json();
    const cusGrp03 = typeof body.cusGrp03 === "string" ? body.cusGrp03.trim() : "";
    const priceListNum = parseInt(body.priceListNum, 10);
    const currency = typeof body.currency === "string" && body.currency.trim() ? body.currency.trim().toUpperCase() : "VND";

    if (!cusGrp03) {
      return NextResponse.json({ error: "cusGrp03 (Customer Group 3) is required" }, { status: 400 });
    }
    if (isNaN(priceListNum)) {
      return NextResponse.json({ error: "priceListNum is required" }, { status: 400 });
    }

    const companyId = getCompanyId();

    const customer = await queryOne<{
      id: number;
      email: string | null;
      phone: string | null;
      full_name: string;
      mst_code: string | null;
      sap_card_code: string | null;
      sap_card_name: string | null;
      registration_address: string | null;
      registration_shipping_address: string | null;
      registration_contact_person: string | null;
      registration_remark: string | null;
      declared_region_code: string | null;
      approval_status: string;
      language: "vi" | "en";
    }>(
      `SELECT id, email, phone, full_name, mst_code, sap_card_code, sap_card_name,
              registration_address, registration_shipping_address, registration_contact_person,
              registration_remark, declared_region_code,
              approval_status, language
       FROM users WHERE company_id = ? AND id = ?`,
      [companyId, customerId]
    );

    if (!customer) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    const inScope = await isCustomerInApprovalScope(session, customer);
    if (!inScope) {
      return NextResponse.json({ error: "Forbidden — this customer is outside your assigned scope" }, { status: 403 });
    }

    if (customer.approval_status !== "pending") {
      return NextResponse.json({ error: "Customer is not in pending status" }, { status: 400 });
    }
    if (customer.sap_card_code) {
      return NextResponse.json({ error: "This customer already has a SAP Business Partner — use Approve instead" }, { status: 400 });
    }

    // Admin-editable overrides of what the customer typed at signup —
    // anything omitted keeps the stored value.
    const cardName = (typeof body.cardName === "string" && body.cardName.trim()) || customer.sap_card_name || customer.full_name;
    // Optional — falls back to the customer's own full_name (the login
    // account holder) when no contact person was given at signup or here.
    const contactPerson = (typeof body.contactPerson === "string" && body.contactPerson.trim())
      || customer.registration_contact_person
      || customer.full_name;
    const mstCode = (typeof body.mstCode === "string" && body.mstCode.trim()) || customer.mst_code;
    const email = (typeof body.email === "string" && body.email.trim()) ? body.email.trim().toLowerCase() : (customer.email || null);
    const phone = (typeof body.phone === "string" && body.phone.trim()) || customer.phone || null;
    const billingAddress = (typeof body.billingAddress === "string" && body.billingAddress.trim()) || customer.registration_address || "";
    const shippingAddress = (typeof body.shippingAddress === "string" && body.shippingAddress.trim())
      || customer.registration_shipping_address
      || billingAddress;
    // Portal-only note — not sent to SAP, just kept on the registration record.
    const remark = (typeof body.remark === "string" && body.remark.trim()) || customer.registration_remark || null;

    if (!mstCode) {
      return NextResponse.json({ error: "A tax code (MST) is required to create a Business Partner" }, { status: 400 });
    }

    const sap = getSapClient();

    // Last-moment duplicate check, right before creating the BP — the
    // signup-time check (POST /api/auth/signup) already ran this once, but
    // time has passed since then (and the admin may have just edited the
    // MST above). Unlike that soft check, this one is a hard stop: if SAP
    // can't even be reached to check, don't proceed.
    let existing;
    try {
      existing = await sap.findBusinessPartnerByTaxId(mstCode);
    } catch (error) {
      console.error("[Admin] create-bp duplicate check failed:", error);
      return NextResponse.json({ error: "Could not verify with SAP whether this tax code is already registered — try again" }, { status: 502 });
    }
    if (existing) {
      return NextResponse.json(
        { error: `A Business Partner already exists for this tax code: ${existing.CardCode} (${existing.CardName}). Link it manually instead of creating a duplicate.` },
        { status: 409 }
      );
    }

    const ancestors = await getCustomerGroupAncestors(cusGrp03);
    if (!ancestors) {
      return NextResponse.json({ error: `Customer Group 3 "${cusGrp03}" has no resolvable level-1/level-2 ancestors` }, { status: 400 });
    }

    let commercialDefaults;
    try {
      commercialDefaults = await sap.findBpCommercialDefaultsByGroup3(cusGrp03);
    } catch (error) {
      console.error("[Admin] BP commercial-defaults lookup failed:", error);
      return NextResponse.json({ error: "Could not look up BP Group Code / Payment Terms from SAP — try again" }, { status: 502 });
    }
    if (!commercialDefaults) {
      return NextResponse.json(
        { error: `No existing customer found under Customer Group 3 "${cusGrp03}" to copy BP Group Code / Payment Terms from — this group has no reference BP yet.` },
        { status: 400 }
      );
    }
    const { GroupCode: groupCode, PayTermsGrpCode: payTermsGrpCode } = commercialDefaults;

    let cardCode: string;
    try {
      cardCode = await generateCardCode(cusGrp03);
    } catch (error) {
      console.error("[Admin] CardCode generation failed:", error);
      return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to generate CardCode" }, { status: 502 });
    }

    try {
      await sap.createBusinessPartner({
        CardCode: cardCode,
        CardName: cardName,
        CardType: "cCustomer",
        FederalTaxID: mstCode,
        GroupCode: groupCode,
        U_CusGrp01: ancestors.level1Code,
        U_CusGrp02: ancestors.level2Code,
        U_CusGrp03: cusGrp03,
        PriceListNum: priceListNum,
        PayTermsGrpCode: payTermsGrpCode,
        CreditLimit: 0,
        Currency: currency,
        EmailAddress: email || undefined,
        BPAddresses: [
          { AddressName: "Bill To", AddressType: "bo_BillTo", Street: billingAddress },
          { AddressName: "Ship To", AddressType: "bo_ShipTo", Street: shippingAddress },
        ],
        ContactEmployees: [
          { Name: contactPerson, E_Mail: email || undefined, Phone1: phone || undefined },
        ],
      });
    } catch (error) {
      console.error("[Admin] createBusinessPartner failed:", error);
      return NextResponse.json(
        { error: `Failed to create Business Partner in SAP: ${error instanceof Error ? error.message : String(error)}` },
        { status: 502 }
      );
    }

    try {
      await query(
        `UPDATE users SET
           sap_card_code = ?, sap_card_name = ?, sap_price_list_num = ?,
           sap_cus_grp01 = ?, sap_cus_grp02 = ?, sap_cus_grp03 = ?,
           sap_group_code = ?, pay_terms_grp_code = ?, currency = ?,
           mst_code = ?, email = ?, phone = ?, registration_address = ?, registration_shipping_address = ?,
           registration_contact_person = ?, registration_remark = ?,
           approval_status = 'approved', approved_at = NOW(), approved_by = ?
         WHERE company_id = ? AND id = ?`,
        [
          cardCode, cardName, priceListNum,
          ancestors.level1Code, ancestors.level2Code, cusGrp03,
          groupCode, payTermsGrpCode, currency,
          mstCode, email, phone, billingAddress || null, shippingAddress || null,
          contactPerson || null, remark,
          session.email, companyId, customerId,
        ]
      );
    } catch (error) {
      // The BP was already created in SAP at this point — a failed local
      // update (e.g. the edited email collides with another account) must
      // not look like the whole operation silently failed.
      console.error("[Admin] users update after BP creation failed:", error);
      return NextResponse.json(
        { error: `Business Partner ${cardCode} was created in SAP, but saving it locally failed (likely the edited email is already used by another account): ${error instanceof Error ? error.message : String(error)}` },
        { status: 500 }
      );
    }

    // Upsert into the `customers` cache immediately, same shape as
    // syncSapCustomers, so pricing/ordering sees the new customer right
    // away rather than waiting for the next scheduled sync.
    await query(
      `INSERT INTO customers (
         company_id, sap_card_code, card_name, mst_code, price_list_num,
         cus_grp01, cus_grp02, cus_grp03, phone, email, address, account, is_enabled, last_synced)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, NOW())
       ON DUPLICATE KEY UPDATE
         card_name = VALUES(card_name), mst_code = VALUES(mst_code),
         price_list_num = VALUES(price_list_num),
         cus_grp01 = VALUES(cus_grp01), cus_grp02 = VALUES(cus_grp02), cus_grp03 = VALUES(cus_grp03),
         phone = VALUES(phone), email = VALUES(email), address = VALUES(address),
         account = VALUES(account), is_enabled = TRUE, last_synced = NOW()`,
      [
        companyId, cardCode, cardName, mstCode, priceListNum,
        ancestors.level1Code, ancestors.level2Code, cusGrp03,
        phone, email, billingAddress || null, email,
      ]
    );

    if (email) {
      try {
        await sendApprovalEmail(email, customer.full_name, customer.language || "vi");
      } catch (emailError) {
        console.error("[API] Failed to send approval email:", emailError);
      }
    }

    console.log(`[Admin] Customer ${customerId} approved with new BP ${cardCode}`);

    await logAuditEvent({
      actorType: "admin", actorId: session.adminId, actorLabel: session.email,
      action: "customer_create_bp", entityType: "customer", entityId: customerId,
      details: { cardCode, cardName, mstCode, cusGrp03 },
      request,
    });

    return NextResponse.json({ success: true, cardCode });
  } catch (error) {
    console.error("[API] create-bp error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
