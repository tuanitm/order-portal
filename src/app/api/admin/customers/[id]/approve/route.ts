import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db/connection";
import { sendApprovalEmail } from "@/lib/email/sender";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { isCustomerInApprovalScope } from "@/lib/adminScope";

/**
 * POST /api/admin/customers/[id]/approve — Approve a customer
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
      return NextResponse.json(
        { error: "Invalid customer ID" },
        { status: 400 }
      );
    }

    // Check customer exists and is pending
    const customer = await queryOne<{
      id: number;
      email: string | null;
      full_name: string;
      sap_card_code: string | null;
      sap_cus_grp01: string | null;
      sap_cus_grp02: string | null;
      sap_cus_grp03: string | null;
      approval_status: string;
      language: "vi" | "en";
    }>(
      `SELECT u.id, u.email, u.full_name, u.sap_card_code,
              COALESCE(u.sap_cus_grp01, c.cus_grp01) AS sap_cus_grp01,
              COALESCE(u.sap_cus_grp02, c.cus_grp02) AS sap_cus_grp02,
              COALESCE(u.sap_cus_grp03, c.cus_grp03) AS sap_cus_grp03,
              u.approval_status, u.language
       FROM users u
       LEFT JOIN customers c ON c.sap_card_code = u.sap_card_code
       WHERE u.id = ?`,
      [customerId]
    );

    if (!customer) {
      return NextResponse.json(
        { error: "Customer not found" },
        { status: 404 }
      );
    }

    const inScope = await isCustomerInApprovalScope(session, customer);
    if (!inScope) {
      return NextResponse.json({ error: "Forbidden — this customer is outside your assigned scope" }, { status: 403 });
    }

    if (customer.approval_status !== "pending") {
      return NextResponse.json(
        { error: "Customer is not in pending status" },
        { status: 400 }
      );
    }

    // Approve
    await query(
      `UPDATE users SET approval_status = 'approved', approved_at = NOW(), approved_by = ?
       WHERE id = ?`,
      [session.email, customerId]
    );

    // Fill the account column in customers table (link SAP customer to portal account)
    if (customer.email && customer.sap_card_code) {
      await query(
        `UPDATE customers SET account = ? WHERE sap_card_code = ?`,
        [customer.email, customer.sap_card_code]
      );
    }

    // Send approval email
    if (customer.email) {
      try {
        await sendApprovalEmail(
          customer.email,
          customer.full_name,
          customer.language || "vi"
        );
      } catch (emailError) {
        console.error("[API] Failed to send approval email:", emailError);
        // Don't fail the approval if email fails
      }
    }

    console.log(`[API] Customer ${customerId} approved`);

    return NextResponse.json({
      success: true,
      message: "Customer approved successfully",
    });
  } catch (error) {
    console.error("[API] Approve customer error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
