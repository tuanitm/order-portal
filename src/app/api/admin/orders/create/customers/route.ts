import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { searchCustomersForAdmin } from "@/lib/adminOrderCreate";

/** GET /api/admin/orders/create/customers?search= — customer picker of the "Self create" order dialog. */
export async function GET(request: NextRequest) {
  const guard = await requireAdminPermission(request, "orders");
  if (guard.response) return guard.response;

  const search = new URL(request.url).searchParams.get("search") ?? "";
  try {
    return NextResponse.json({ customers: await searchCustomersForAdmin(guard.session, search) });
  } catch (error) {
    console.error("[Admin] Self-create customer search failed:", error);
    return NextResponse.json({ error: "Failed to search customers" }, { status: 500 });
  }
}
