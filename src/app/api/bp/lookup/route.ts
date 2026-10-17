import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db/connection";

interface CustomerMatchRow {
  sap_card_code: string;
  card_name: string | null;
  mst_code: string | null;
  phone: string | null;
  email: string | null;
  price_list_num: number | null;
  cus_grp01: string | null;
  cus_grp02: string | null;
  cus_grp03: string | null;
}

/**
 * POST /api/bp/lookup — Look up a SAP Business Partner by email, phone,
 * and/or MST (tax) code, against the locally-synced `customers` cache (see
 * syncSapCustomers in sap-b1/sync.ts) — never a live SAP call, so the signup
 * form can fire this on every field without hammering the Service Layer.
 *
 * Body: at least one of { email, phone, mstCode } — the signup form sends
 * whichever of the 3 the customer has typed so far, and this matches on
 * ANY of them (same normalization as POST /api/auth/identify, so the same
 * value finds the same row either place looks it up). Returns the first
 * match's BP identity + SAP linkage fields for auto-filling the rest of the
 * form, never more than one row.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = typeof body?.email === "string" ? body.email.trim() : "";
    const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
    const mstCode = typeof body?.mstCode === "string" ? body.mstCode.trim() : "";

    if (!email && !phone && !mstCode) {
      return NextResponse.json(
        { error: "email, phone, or mstCode is required" },
        { status: 400 }
      );
    }

    const conditions: string[] = [];
    const params: string[] = [];
    if (email) {
      conditions.push("email = ?");
      params.push(email.toLowerCase());
    }
    if (phone) {
      conditions.push("phone = ?");
      params.push(phone.replace(/[+\-\s()]/g, ""));
    }
    if (mstCode) {
      // VN tax codes synced from SAP can carry a branch-suffix dash, stray
      // ASCII spaces, or non-ASCII whitespace (e.g. a non-breaking space
      // picked up from an Excel import) that a plain `REPLACE(.., ' ', '')`
      // wouldn't strip — compare both sides reduced to alphanumerics only
      // so any such formatting noise can't hide an otherwise-exact match.
      conditions.push("REGEXP_REPLACE(mst_code, '[^0-9A-Za-z]', '') = ?");
      params.push(mstCode.replace(/[^0-9A-Za-z]/g, ""));
    }

    const match = await queryOne<CustomerMatchRow>(
      `SELECT sap_card_code, card_name, mst_code, phone, email, price_list_num, cus_grp01, cus_grp02, cus_grp03
       FROM customers WHERE ${conditions.join(" OR ")} LIMIT 1`,
      params
    );

    if (!match) {
      return NextResponse.json({ found: false });
    }

    return NextResponse.json({
      found: true,
      cardCode: match.sap_card_code,
      cardName: match.card_name,
      email: match.email,
      phone: match.phone,
      mstCode: match.mst_code,
      priceListNum: match.price_list_num,
      cusGrp01: match.cus_grp01,
      cusGrp02: match.cus_grp02,
      cusGrp03: match.cus_grp03,
    });
  } catch (error) {
    console.error("[API] BP lookup error:", error);
    return NextResponse.json(
      { error: "Failed to lookup business partner" },
      { status: 500 }
    );
  }
}
