import { NextResponse } from "next/server";
import { getCompanyPrefix, isShowAvailableEnabled, isShowDiscountsEnabled } from "@/lib/appInfo";
import { getPublicKey } from "@/lib/webPush";

/** GET /api/app-info — public, non-sensitive display info (company prefix, storefront display toggles, Web Push VAPID public key). */
export async function GET() {
  return NextResponse.json({
    companyPrefix: getCompanyPrefix(),
    showAvailable: isShowAvailableEnabled(),
    showDiscounts: isShowDiscountsEnabled(),
    webPushPublicKey: getPublicKey(),
  });
}
