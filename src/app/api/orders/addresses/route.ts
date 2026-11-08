import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getCustomerAddressBook } from "@/lib/customerAddresses";

/** GET /api/orders/addresses — the signed-in customer's own SAP bill-to / ship-to addresses, for checkout. */
export async function GET(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  return NextResponse.json(await getCustomerAddressBook(user.sapCardCode));
}
