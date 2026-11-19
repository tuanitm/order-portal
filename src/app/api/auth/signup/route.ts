import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { getSapClient } from "@/lib/sap-b1/client";
import bcrypt from "bcryptjs";
import { logAuditEvent } from "@/lib/auditLog";

/**
 * POST /api/auth/signup — Create a new user account (pending approval)
 * Body: {
 *   fullName, email, phone?, mstCode?, sapCardCode?, sapCardName?,
 *   registrationAddress?, registrationShippingAddress?, registrationRemark?,
 *   declaredRegionCode?, password
 * }
 *
 * When sapCardCode is NOT supplied (the customer didn't match an existing
 * SAP Business Partner), this is a brand-new-company registration — see
 * POST /api/admin/customers/[id]/create-bp for the admin-approval side.
 * sapCardName/registrationAddress(es)/registrationRemark in that case are
 * customer-typed, not SAP-sourced. declaredRegionCode is the customer's
 * self-declared Customer Group 2 — unverified, used only to route the
 * pending registration's visibility to the matching regional admin (see
 * isCustomerInApprovalScope); never written to SAP.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      fullName,
      email,
      phone,
      mstCode,
      sapCardCode,
      sapCardName,
      sapPriceListNum,
      sapCusGrp01,
      sapCusGrp02,
      sapCusGrp03,
      registrationAddress,
      registrationShippingAddress,
      registrationRemark,
      registrationContactPerson,
      declaredRegionCode,
      password,
      emailVerified,
    } = body;

    // Validate required fields
    if (!fullName || typeof fullName !== "string" || !fullName.trim()) {
      return NextResponse.json(
        { error: "Full name is required" },
        { status: 400 }
      );
    }

    if (!email || typeof email !== "string") {
      return NextResponse.json(
        { error: "Email is required" },
        { status: 400 }
      );
    }

    if (!password || typeof password !== "string" || password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters" },
        { status: 400 }
      );
    }

    if (!emailVerified) {
      return NextResponse.json(
        { error: "Email must be verified via OTP" },
        { status: 400 }
      );
    }

    const companyId = getCompanyId();

    // Check if email already exists
    const existingEmail = await queryOne<{ id: number }>(
      "SELECT id FROM users WHERE company_id = ? AND email = ? LIMIT 1",
      [companyId, email.trim().toLowerCase()]
    );
    if (existingEmail) {
      return NextResponse.json(
        { error: "Email already registered" },
        { status: 409 }
      );
    }

    // Check if phone already exists (if provided)
    if (phone && phone.trim()) {
      const existingPhone = await queryOne<{ id: number }>(
        "SELECT id FROM users WHERE company_id = ? AND phone = ? LIMIT 1",
        [companyId, phone.trim()]
      );
      if (existingPhone) {
        return NextResponse.json(
          { error: "Phone number already registered" },
          { status: 409 }
        );
      }
    }

    // Check if MST already exists (if provided)
    if (mstCode && mstCode.trim()) {
      const existingMst = await queryOne<{ id: number }>(
        "SELECT id FROM users WHERE company_id = ? AND mst_code = ? LIMIT 1",
        [companyId, mstCode.trim()]
      );
      if (existingMst) {
        return NextResponse.json(
          { error: "MST code already registered" },
          { status: 409 }
        );
      }
    }

    // One portal account per SAP customer — its code becomes the account's
    // User ID on approval (see POST /api/admin/customers/[id]/approve).
    if (sapCardCode && typeof sapCardCode === "string" && sapCardCode.trim()) {
      const existingCard = await queryOne<{ id: number }>(
        "SELECT id FROM users WHERE company_id = ? AND (LOWER(sap_card_code) = LOWER(?) OR LOWER(userid) = LOWER(?)) LIMIT 1",
        [companyId, sapCardCode.trim(), sapCardCode.trim()]
      );
      if (existingCard) {
        return NextResponse.json(
          { error: "This SAP customer already has a portal account" },
          { status: 409 }
        );
      }
    }

    // users.userid is NOT NULL and unique per company. Until approval sets it
    // to the SAP customer code, a pending account uses the SAP code it signed
    // up for, or (new company, no code yet) its verified email.
    const pendingUserid = (sapCardCode && typeof sapCardCode === "string" && sapCardCode.trim())
      ? sapCardCode.trim()
      : email.trim().toLowerCase();
    if (pendingUserid.length > 100) {
      return NextResponse.json({ error: "Email is too long (max 100 characters)" }, { status: 400 });
    }
    const existingUserid = await queryOne<{ id: number }>(
      "SELECT id FROM users WHERE company_id = ? AND userid = ? LIMIT 1",
      [companyId, pendingUserid]
    );
    if (existingUserid) {
      return NextResponse.json({ error: "This account is already registered" }, { status: 409 });
    }

    // New-company registration (no matched existing SAP BP): check SAP
    // LIVE for a duplicate FederalTaxID before creating the pending row —
    // the local `customers` cache (already checked client-side by
    // /api/bp/lookup) can be stale. If SAP itself can't be reached, don't
    // block signup on it — this is a soft check; the hard, final check is
    // in POST /api/admin/customers/[id]/create-bp right before the BP is
    // actually created.
    let liveBpMatch: { cardCode: string; cardName: string } | null = null;
    if (!sapCardCode && mstCode && mstCode.trim()) {
      try {
        const match = await getSapClient().findBusinessPartnerByTaxId(mstCode.trim());
        if (match) liveBpMatch = { cardCode: match.CardCode, cardName: match.CardName };
      } catch (error) {
        console.warn("[API] Live BP tax-id duplicate check failed, proceeding without it:", error);
      }
    }
    if (liveBpMatch) {
      return NextResponse.json(
        {
          error: "A Business Partner already exists for this tax code",
          existingBp: liveBpMatch,
        },
        { status: 409 }
      );
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Note: customer_groups itself is populated by syncCustomerGroupsFromHana
    // (or added manually via admin UI), never here — this just links the
    // user to whatever group codes SAP reports for them.

    // Insert user with pending approval status
    const result = await query<{ insertId: number }>(
      `INSERT INTO users (company_id, userid, role_id, email, phone, password_hash, full_name, mst_code, sap_card_code, sap_card_name, sap_price_list_num, sap_cus_grp01, sap_cus_grp02, sap_cus_grp03, registration_address, registration_shipping_address, registration_remark, registration_contact_person, declared_region_code, approval_status)
       VALUES (?, ?, (SELECT id FROM admin_roles WHERE company_id = ? AND kind = 'customer' ORDER BY id LIMIT 1), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        companyId,
        pendingUserid,
        companyId,
        email.trim().toLowerCase(),
        phone?.trim() || null,
        passwordHash,
        fullName.trim(),
        mstCode?.trim() || null,
        sapCardCode || null,
        sapCardName || null,
        sapPriceListNum ?? null,
        sapCusGrp01 || null,
        sapCusGrp02 || null,
        sapCusGrp03 || null,
        !sapCardCode ? (registrationAddress?.trim() || null) : null,
        !sapCardCode ? (registrationShippingAddress?.trim() || null) : null,
        !sapCardCode ? (registrationRemark?.trim() || null) : null,
        !sapCardCode ? (registrationContactPerson?.trim() || null) : null,
        !sapCardCode ? (declaredRegionCode?.trim() || null) : null,
      ]
    );

    console.log("[API] New user registered (pending approval):", email);

    const newUserId = (result as unknown as { insertId: number }).insertId;
    await logAuditEvent({
      actorType: "customer", actorId: newUserId, actorLabel: email.trim().toLowerCase(),
      action: "signup", entityType: "user", entityId: newUserId,
      details: { sapCardCode: sapCardCode || null, newCompany: !sapCardCode },
      request,
    });

    return NextResponse.json({
      success: true,
      userId: newUserId,
      approvalStatus: "pending",
    });
  } catch (error) {
    console.error("[API] Signup error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
