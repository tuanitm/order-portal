import { NextRequest, NextResponse } from "next/server";
import { findUserByIdentifier } from "@/lib/auth/login";
import { queryOne } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { rateLimit } from "@/lib/rateLimit";

interface MatchRow {
  email: string | null;
  phone: string | null;
  mst_code: string | null;
}

/**
 * POST /api/auth/identify — Check if an account exists by userid, SAP customer
 * code (sap_card_code), email, phone or MST (tax) code. Body: { identifier: string }
 * Returns: { exists: boolean, identifierType: 'email' | 'phone' | 'mst' | 'cardCode' }
 *
 * Found → the screen asks for the password. Not found → the signup form,
 * pre-filled from the existing SAP customer (BP) when the value is one of
 * its identifiers ('cardCode' = a SAP customer code with no portal account yet).
 *
 * Scans all three columns in one query rather than pre-guessing which one
 * the identifier is by its shape — a tax code and a phone number are both
 * plain digit strings of similar length (e.g. "0315832139" is 10 digits,
 * matching the same 9-15-digit pattern a phone number would), so picking
 * exactly one column to check based on a regex meant real tax-code logins
 * were silently never found (looked up only against `phone`, which didn't
 * match, so the system thought the account didn't exist at all and sent
 * the customer to signup instead of login).
 */
export async function POST(request: NextRequest) {
  // Public: limit per IP so it can't be looped to discover accounts / SAP codes.
  const limited = rateLimit(request, "identify", 30, 60);
  if (limited) return limited;
  try {
    const body = await request.json();
    const { identifier } = body;

    if (!identifier || typeof identifier !== "string" || !identifier.trim()) {
      return NextResponse.json(
        { error: "Identifier is required" },
        { status: 400 }
      );
    }

    const value = identifier.trim();
    const normalizedPhone = value.replace(/[+\-\s()]/g, "");
    const normalizedEmail = value.toLowerCase();

    // Any account — staff by userid/email, customers also by phone/tax code.
    const found = await findUserByIdentifier(value);
    const match: MatchRow | null = found ? { email: found.email, phone: found.phone, mst_code: found.mst_code } : null;

    // Classify AFTER the lookup, from whichever column the match actually
    // came from — used only for the signup form's own field pre-fill when
    // no account exists yet, never for the existence check itself.
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const phoneRegex = /^[0-9]{9,15}$/;
    let identifierType: "email" | "phone" | "mst" | "cardCode";
    const sapCustomer = match
      ? null
      : await queryOne<{ sap_card_code: string }>(
          "SELECT sap_card_code FROM customers WHERE company_id = ? AND LOWER(sap_card_code) = ? LIMIT 1",
          [getCompanyId(), normalizedEmail]
        );
    if (match) {
      identifierType = match.phone === normalizedPhone ? "phone" : match.mst_code === value ? "mst" : "email";
    } else if (sapCustomer) {
      identifierType = "cardCode";
    } else if (emailRegex.test(value)) {
      identifierType = "email";
    } else if (phoneRegex.test(normalizedPhone)) {
      identifierType = "phone";
    } else {
      identifierType = "mst";
    }

    return NextResponse.json({
      exists: !!match,
      identifierType,
      // "staff" for Super Admin / Admin / Sales accounts — the screen goes straight to the password step.
      accountType: found ? (found.kind && found.kind !== "customer" ? "staff" : "customer") : null,
    });
  } catch (error) {
    console.error("[API] Identify error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
