import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getBasePriceListNum } from "@/lib/sap-b1/sync";
import { getVisibleWarehousesForCustomerGroup } from "@/lib/warehouseVisibility";
import { query } from "@/lib/db/connection";
import {
  resolveHiddenItemCategories,
  buildHiddenCategoryClauses,
  queryPricedProducts,
  type PricingContext,
} from "@/lib/pricing/productPricing";

const MAX_CODES = 500;

/**
 * POST /api/products/batch — exact-code pricing lookup for Excel Import.
 *
 * Applies the SAME visibility/pricing rules as GET /api/products, then
 * splits codes that were not returned into two buckets:
 *   - notFound    : code does not exist in the items table at all
 *   - notVisible  : code exists but is blocked by catalog visibility,
 *                   inactive, or manually hidden for this customer
 *
 * Body: { codes: string[] }
 * 200:  { items: ProductWithPricing[], notFound: string[], notVisible: string[] }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const rawCodes = Array.isArray(body?.codes) ? body.codes : null;
    if (!rawCodes || rawCodes.length === 0) {
      return NextResponse.json({ error: "codes is required" }, { status: 400 });
    }

    const codes: string[] = [...new Set(rawCodes.map((c: unknown) => String(c).trim()).filter(Boolean))] as string[];
    if (codes.length === 0) {
      return NextResponse.json({ error: "codes is required" }, { status: 400 });
    }
    if (codes.length > MAX_CODES) {
      return NextResponse.json({ error: `Too many codes (max ${MAX_CODES})` }, { status: 400 });
    }

    const user = await getSessionUser(request);
    const sapCardCode = user?.approvalStatus === "approved" ? user.sapCardCode : null;
    const priceListNum = user?.approvalStatus === "approved" ? user.sapPriceListNum : null;
    const cusGrp01 = user?.approvalStatus === "approved" ? user.sapCusGrp01 : null;
    const cusGrp02 = user?.approvalStatus === "approved" ? user.sapCusGrp02 : null;
    const cusGrp03 = user?.approvalStatus === "approved" ? user.sapCusGrp03 : null;

    const hiddenCategories = user?.approvalStatus === "approved"
      ? await resolveHiddenItemCategories(user.sapCusGrp01, user.sapCusGrp02, user.sapCusGrp03)
      : [];
    const { clauses: hiddenClauses, params: hiddenParams } = buildHiddenCategoryClauses(hiddenCategories);

    const visibleWarehouses = await getVisibleWarehousesForCustomerGroup(cusGrp02);
    const stockWarehouseCodes = visibleWarehouses.map((w) => w.code);

    const ctx: PricingContext = {
      sapCardCode: sapCardCode ?? "",
      cusGrp01: cusGrp01 ?? "",
      cusGrp02: cusGrp02 ?? "",
      cusGrp03: cusGrp03 ?? "",
      priceListNum,
      basePriceListNum: await getBasePriceListNum(),
      stockWarehouseCodes,
    };

    // ── Step 1: Priced + visible items (passes all catalog visibility checks) ──
    const items = await queryPricedProducts(
      ctx,
      hiddenClauses,
      hiddenParams,
      [`i.sap_item_code IN (${codes.map(() => "?").join(",")})`],
      codes,
      "ORDER BY i.sap_item_code ASC LIMIT ?",
      [codes.length]
    );

    const foundCodes = new Set(items.map((i) => i.sapItemCode.toUpperCase()));
    const missingCodes = codes.filter((c) => !foundCodes.has(c.toUpperCase()));

    if (missingCodes.length === 0) {
      return NextResponse.json({ items, notFound: [], notVisible: [] });
    }

    // ── Step 2: Distinguish "not in system" from "blocked by catalog visibility" ──
    const placeholders = missingCodes.map(() => "?").join(",");
    const existingRows = await query<{ sap_item_code: string }[]>(
      `SELECT sap_item_code FROM items WHERE sap_item_code IN (${placeholders})`,
      missingCodes
    );
    const existingSet = new Set(existingRows.map((r) => r.sap_item_code.toUpperCase()));

    const notFound: string[] = [];
    const notVisible: string[] = [];
    for (const code of missingCodes) {
      if (existingSet.has(code.toUpperCase())) {
        notVisible.push(code); // exists but blocked by catalog visibility / inactive / hidden
      } else {
        notFound.push(code);   // not in items table at all
      }
    }

    return NextResponse.json({ items, notFound, notVisible });
  } catch (error) {
    console.error("[API] Batch product lookup error:", error);
    return NextResponse.json(
      { error: "Failed to look up products" },
      { status: 500 }
    );
  }
}
