import { NextRequest } from "next/server";
import jwt from "jsonwebtoken";
import { queryOne } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";

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
  /** Set by an admin ("change password at next login"). */
  mustChangePassword: boolean;
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
  must_change_password: number;
}

/**
 * Resolve the signed-in customer from the `auth-token` cookie. Only users
 * whose role is of kind "customer" (or older rows with no role) — staff sign
 * in through the admin-token cookie instead. Returns null if there is no
 * valid session (never throws).
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
    `SELECT u.id, u.email, u.phone, u.full_name, u.sap_card_code, u.sap_card_name, u.sap_price_list_num,
            u.sap_cus_grp01, u.sap_cus_grp02, u.sap_cus_grp03, u.language, u.approval_status, u.must_change_password
     FROM users u
     LEFT JOIN admin_roles r ON r.id = u.role_id
     WHERE u.company_id = ? AND u.id = ? AND u.is_active = TRUE AND (u.role_id IS NULL OR r.kind = 'customer')`,
    [getCompanyId(), decoded.userId]
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
    mustChangePassword: !!user.must_change_password,
  };
}
