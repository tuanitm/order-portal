import { NextRequest, NextResponse } from "next/server";
import { getSapClient } from "@/lib/sap-b1/client";

/**
 * POST /api/bp/lookup — Lookup Business Partner by MST (Tax) Code in SAP B1
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { mstCode } = body;

    if (!mstCode || typeof mstCode !== "string") {
      return NextResponse.json(
        { error: "MST code is required" },
        { status: 400 }
      );
    }

    const sapClient = getSapClient();
    const bp = await sapClient.getBusinessPartnerByTaxCode(mstCode.trim());

    if (bp) {
      console.log(`[API] BP found for MST ${mstCode}: ${bp.CardCode} - ${bp.CardName}`);
      return NextResponse.json({
        found: true,
        cardCode: bp.CardCode,
        cardName: bp.CardName,
        email: bp.EmailAddress || null,
        mstCode: bp.FederalTaxID || mstCode.trim(),
      });
    } else {
      console.log(`[API] BP not found for MST ${mstCode}`);
      return NextResponse.json({
        found: false,
        mstCode: mstCode.trim(),
      });
    }
  } catch (error) {
    console.error("[API] BP lookup error:", error);
    return NextResponse.json(
      { error: "Failed to lookup business partner" },
      { status: 500 }
    );
  }
}
