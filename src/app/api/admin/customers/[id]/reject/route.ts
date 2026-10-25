import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { sendRejectionEmail } from "@/lib/email/sender";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { isCustomerInApprovalScope } from "@/lib/adminScope";
import { logAuditEvent } from "@/lib/auditLog";

/**
 * POST /api/admin/customers/[id]/reject — Reject a customer
 * Body: { reason: string }
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

    const body = await request.json();
    const { reason } = body;

    if (!reason || typeof reason !== "string" || !reason.trim()) {
      return NextResponse.json(
        { error: "Rejection reason is required" },
        { status: 400 }
      );
    }

    const companyId = getCompanyId();

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
       LEFT JOIN customers c ON c.company_id = u.company_id AND c.sap_card_code = u.sap_card_code
       WHERE u.company_id = ? AND u.id = ?`,
      [companyId, customerId]
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

    // Reject
    await query(
      `UPDATE users SET approval_status = 'rejected', rejection_reason = ?
       WHERE company_id = ? AND id = ?`,
      [reason.trim(), companyId, customerId]
    );

    // Send rejection email
    if (customer.email) {
      try {
        await sendRejectionEmail(
          customer.email,
          customer.full_name,
          reason.trim(),
          customer.language || "vi"
        );
      } catch (emailError) {
        console.error("[API] Failed to send rejection email:", emailError);
      }
    }

    console.log(`[API] Customer ${customerId} rejected: ${reason}`);

    await logAuditEvent({
      actorType: "admin", actorId: session.adminId, actorLabel: session.email,
      action: "customer_reject", entityType: "customer", entityId: customerId,
      details: { email: customer.email, reason: reason.trim() },
      request,
    });

    return NextResponse.json({
      success: true,
      message: "Customer rejected",
    });
  } catch (error) {
    console.error("[API] Reject customer error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
