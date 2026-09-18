import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db/connection";
import { sendApprovalEmail } from "@/lib/email/sender";
import { requireAdminPermission } from "@/lib/auth/adminSession";

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
      approval_status: string;
      language: "vi" | "en";
    }>(
      "SELECT id, email, full_name, sap_card_code, approval_status, language FROM users WHERE id = ?",
      [customerId]
    );

    if (!customer) {
      return NextResponse.json(
        { error: "Customer not found" },
        { status: 404 }
      );
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
