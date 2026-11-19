import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { rateLimit } from "@/lib/rateLimit";

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
 * Body: at least one of { email, phone, mstCode, cardCode } — the signup form sends
 * whichever of the 3 the customer has typed so far, and this matches on
 * ANY of them (same normalization as POST /api/auth/identify, so the same
 * value finds the same row either place looks it up). Returns the first
 * match's BP identity for auto-filling the rest of the form, never more
 * than one row.
 *
 * Public (no login), so it must not leak customer data:
 *  - matched ONLY by a SAP customer code (short, guessable) → just the name
 *    plus a MASKED email/phone hint ("ng***@gmail.com"), never the real
 *    contact details or tax code;
 *  - matched by an email / phone / tax code the caller typed → the other
 *    identifiers too (they already know one of the customer's identifiers);
 *  - price list and customer groups are never returned — signup reads them
 *    from the customers table itself (POST /api/auth/signup);
 *  - rate-limited per IP.
 */
function maskEmail(email: string | null): string | null {
  if (!email) return null;
  // SAP's email field can hold several addresses ("a@x.com;b@y.com").
  const masked = email
    .split(/[;,\s]+/)
    .filter(Boolean)
    .map((one) => {
      const [user, domain] = one.split("@");
      return domain ? `${user.slice(0, 2)}***@${domain}` : "***";
    });
  return masked.length ? masked.join("; ") : null;
}

function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  const d = phone.replace(/\s/g, "");
  if (d.length < 5) return "***";
  return `${d.slice(0, 2)}${"*".repeat(Math.max(3, d.length - 4))}${d.slice(-2)}`;
}

export async function POST(request: NextRequest) {
  const limited = rateLimit(request, "bp-lookup", 30, 60);
  if (limited) return limited;
  try {
    const body = await request.json();
    const email = typeof body?.email === "string" ? body.email.trim() : "";
    const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
    const mstCode = typeof body?.mstCode === "string" ? body.mstCode.trim() : "";
    // SAP customer code typed on the identify screen (no portal account yet).
    const cardCode = typeof body?.cardCode === "string" ? body.cardCode.trim() : "";

    if (!email && !phone && !mstCode && !cardCode) {
      return NextResponse.json(
        { error: "email, phone, mstCode, or cardCode is required" },
        { status: 400 }
      );
    }

    const conditions: string[] = [];
    const params: string[] = [];
    if (cardCode) {
      conditions.push("LOWER(sap_card_code) = ?");
      params.push(cardCode.toLowerCase());
    }
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
       FROM customers WHERE company_id = ? AND (${conditions.join(" OR ")}) LIMIT 1`,
      [getCompanyId(), ...params]
    );

    if (!match) {
      return NextResponse.json({ found: false });
    }

    // Did the caller prove they know one of the customer's identifiers?
    const knowsIdentifier =
      (!!email && match.email?.toLowerCase() === email.toLowerCase()) ||
      (!!phone && (match.phone ?? "").replace(/[+\-\s()]/g, "") === phone.replace(/[+\-\s()]/g, "")) ||
      (!!mstCode && (match.mst_code ?? "").replace(/[^0-9A-Za-z]/g, "") === mstCode.replace(/[^0-9A-Za-z]/g, ""));

    if (!knowsIdentifier) {
      // Matched only by the SAP customer code.
      return NextResponse.json({
        found: true,
        codeOnly: true,
        cardCode: match.sap_card_code,
        cardName: match.card_name,
        emailHint: maskEmail(match.email),
        phoneHint: maskPhone(match.phone),
      });
    }

    return NextResponse.json({
      found: true,
      cardCode: match.sap_card_code,
      cardName: match.card_name,
      // No email: the user's sign-in email is their own, typed and OTP-verified
      // — SAP's customer email is never copied onto a user.
      phone: match.phone,
      mstCode: match.mst_code,
    });
  } catch (error) {
    console.error("[API] BP lookup error:", error);
    return NextResponse.json(
      { error: "Failed to lookup business partner" },
      { status: 500 }
    );
  }
}
