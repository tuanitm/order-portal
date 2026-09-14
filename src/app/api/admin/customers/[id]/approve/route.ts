import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db/connection";
import { sendApprovalEmail } from "@/lib/email/sender";

/**
 * POST /api/admin/customers/[id]/approve — Approve a customer
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Admin auth check
    const adminToken = request.cookies.get("admin-token")?.value;
    if (!adminToken) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

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
      approval_status: string;
      language: "vi" | "en";
    }>(
      "SELECT id, email, full_name, approval_status, language FROM users WHERE id = ?",
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
      [adminToken, customerId]
    );

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
