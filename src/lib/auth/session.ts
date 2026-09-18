import { NextRequest } from "next/server";
import jwt from "jsonwebtoken";
import { queryOne } from "@/lib/db/connection";

const JWT_SECRET = process.env.JWT_SECRET || "order-portal-secret-key-change-in-production";

export interface SessionUser {
  id: number;
  email: string | null;
  phone: string | null;
  fullName: string;
  sapCardCode: string | null;
  sapCardName: string | null;
  sapPriceListNum: number | null;
  sapCusGrp01: string | null;
  sapCusGrp02: string | null;
  sapCusGrp03: string | null;
  language: "vi" | "en";
  approvalStatus: "pending" | "approved" | "rejected";
}

interface UserRow {
  id: number;
  email: string | null;
  phone: string | null;
  full_name: string;
  sap_card_code: string | null;
  sap_card_name: string | null;
  sap_price_list_num: number | null;
  sap_cus_grp01: string | null;
  sap_cus_grp02: string | null;
  sap_cus_grp03: string | null;
  language: "vi" | "en";
  approval_status: "pending" | "approved" | "rejected";
}

/**
 * Resolve the currently logged-in user from the `auth-token` cookie.
 * Returns null if there is no valid session (never throws).
 */
export async function getSessionUser(request: NextRequest): Promise<SessionUser | null> {
  const token = request.cookies.get("auth-token")?.value;
  if (!token) return null;

  let decoded: { userId: number };
  try {
    decoded = jwt.verify(token, JWT_SECRET) as { userId: number };
  } catch {
    return null;
  }

  const user = await queryOne<UserRow>(
    `SELECT id, email, phone, full_name, sap_card_code, sap_card_name, sap_price_list_num,
            sap_cus_grp01, sap_cus_grp02, sap_cus_grp03, language, approval_status
     FROM users WHERE id = ? AND is_active = TRUE`,
    [decoded.userId]
  );
  if (!user) return null;

  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    fullName: user.full_name,
    sapCardCode: user.sap_card_code,
    sapCardName: user.sap_card_name,
    sapPriceListNum: user.sap_price_list_num,
    sapCusGrp01: user.sap_cus_grp01,
    sapCusGrp02: user.sap_cus_grp02,
    sapCusGrp03: user.sap_cus_grp03,
    language: user.language,
    approvalStatus: user.approval_status,
  };
}
