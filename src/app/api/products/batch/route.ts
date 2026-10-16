import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getBasePriceListNum } from "@/lib/sap-b1/sync";
import { getVisibleWarehousesForCustomerGroup } from "@/lib/warehouseVisibility";
import {
  resolveHiddenItemCategories,
  buildHiddenCategoryClauses,
  queryPricedProducts,
  type PricingContext,
} from "@/lib/pricing/productPricing";

const MAX_CODES = 500;

/**
 * POST /api/products/batch — exact-code pricing lookup for Excel Import
 * (bulk-add from an uploaded order file). Unlike GET /api/products' `search`
 * (a fuzzy LIKE on name/code), this matches `sap_item_code` exactly, in one
 * round trip for every code the customer's file contained, reusing the
 * SAME pricing/visibility core (see src/lib/pricing/productPricing.ts) as
 * the regular product list — a hidden/inactive/out-of-stock code simply
 * won't appear in `items` and therefore surfaces in `notFound`, exactly
 * like it would be excluded from the storefront listing.
 *
 * Body: { codes: string[] }
 * 200:  { items: ProductWithPricing[], notFound: string[] }
 * 400:  missing/empty codes, or more than MAX_CODES distinct codes
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
    const notFound = codes.filter((c) => !foundCodes.has(c.toUpperCase()));

    return NextResponse.json({ items, notFound });
  } catch (error) {
    console.error("[API] Batch product lookup error:", error);
    return NextResponse.json(
      { error: "Failed to look up products" },
      { status: 500 }
    );
  }
}
