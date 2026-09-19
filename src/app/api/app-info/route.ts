import { NextResponse } from "next/server";
import { getCompanyPrefix } from "@/lib/appInfo";

/** GET /api/app-info — public, non-sensitive display info (the company prefix shown before the portal name). */
export async function GET() {
  return NextResponse.json({ companyPrefix: getCompanyPrefix() });
}
