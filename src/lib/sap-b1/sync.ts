import { getSapClient } from "@/lib/sap-b1/client";
import { getPool, query, queryOne } from "@/lib/db/connection";
import { getItemCategoryPairsFromDB, getInactiveItemGroupCodesByLevel } from "@/lib/itemCategories";
import { getCustomerGroupPairsFromDB } from "@/lib/customerGroups";
import { loadConfig } from "@/lib/config";
import type { PoolConnection } from "mysql2/promise";

/** Parse a ready-made SQL IN-list literal from config.json (e.g. "'1000','1001'") into plain codes. */
function parseSqlInList(sqlInList: string): Set<string> {
  const codes = new Set<string>();
  const re = /'([^']*)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sqlInList))) codes.add(m[1]);
  return codes;
}

const PAGE_SIZE = 200;

/**
 * SAP returns date fields as full ISO datetimes (e.g. "2025-12-01T00:00:00Z"),
 * which MySQL's DATE columns reject outright under strict mode rather than
 * truncating. Trim to the date portion before binding.
 */
function toMySQLDate(isoDate: string | null | undefined): string | null {
  if (!isoDate) return null;
  return isoDate.slice(0, 10);
}

// ── DB-driven config (admin-editable via item_groups / price_lists tables) ──

/** The price list marked as the "original" base price (price_lists.is_base). */
export async function getBasePriceListNum(): Promise<number> {
  const row = await queryOne<{ price_list_num: number }>(
    `SELECT price_list_num FROM price_lists WHERE is_base = TRUE LIMIT 1`
  );
  return row?.price_list_num ?? 11;
}

/** Every price list we cache per-item pricing for (base + all channel lists). */
export async function getTrackedPriceListNums(): Promise<number[]> {
  const rows = await query<{ price_list_num: number }[]>(
    `SELECT price_list_num FROM price_lists WHERE is_base = TRUE OR is_channel = TRUE`
  );
  return rows.map((r) => r.price_list_num);
}

/**
 * Pull all SAP price lists into the local cache. Does not touch
 * `is_base`/`is_channel` on lists already known — admin decision.
 */
export async function syncPriceLists(): Promise<{ listsSynced: number }> {
  const sap = getSapClient();
  const pool = getPool();
  const lists = await sap.getPriceLists();

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const l of lists) {
      await conn.execute(
        `INSERT INTO price_lists (price_list_num, list_name, last_synced)
         VALUES (?, ?, NOW())
         ON DUPLICATE KEY UPDATE list_name = VALUES(list_name), last_synced = NOW()`,
        [l.PriceListNo, l.PriceListName]
      );
    }
    await conn.commit();
    return { listsSynced: lists.length };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

/**
 * Pull the warehouse list from SAP B1, restricted to the codes in
 * config.json's masterdata.wareHouse, and make `warehouses` match exactly:
 * upserts every listed code found in SAP, and deletes any existing row
 * whose code is no longer listed (cascading to that warehouse's rows in
 * customer_group_warehouses, which already only ever offers Included
 * warehouses — see schema.sql). `is_included` is simply "active in SAP",
 * since every row in the table is, by construction, one masterdata.wareHouse
 * already named as wanted. Admins can still uncheck one as a temporary
 * override on the Warehouses admin page; that holds until the next sync.
 */
export async function syncWarehouses(): Promise<{ warehousesSynced: number }> {
  const sap = getSapClient();
  const pool = getPool();
  const includedCodes = parseSqlInList(loadConfig().masterdata.wareHouse);
  const warehouses = (await sap.getWarehouses()).filter((w) => includedCodes.has(w.WarehouseCode));

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const codes = warehouses.map((w) => w.WarehouseCode);
    await conn.query(
      codes.length > 0 ? `DELETE FROM warehouses WHERE sap_warehouse_code NOT IN (?)` : `DELETE FROM warehouses`,
      codes.length > 0 ? [codes] : undefined
    );

    for (const w of warehouses) {
      await conn.execute(
        `INSERT INTO warehouses (sap_warehouse_code, warehouse_name, is_inactive_in_sap, is_included, last_synced)
         VALUES (?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE warehouse_name = VALUES(warehouse_name), is_inactive_in_sap = VALUES(is_inactive_in_sap), is_included = VALUES(is_included), last_synced = NOW()`,
        [w.WarehouseCode, w.WarehouseName, w.Inactive === "tYES", w.Inactive !== "tYES"]
      );
    }
    await conn.commit();
    return { warehousesSynced: warehouses.length };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

/**
 * Pull per-item, per-warehouse on-hand/committed/on-order stock from SAP
 * (OITW via SQLQueries — see client.getInventoryStock) and replace the
 * `item_warehouse_stock` cache wholesale. This is what the storefront's
 * stock gate (src/app/api/products/route.ts) reads — see
 * defaultWarehouseIncluded/syncWarehouses for which warehouses count.
 */
export async function syncInventoryStock(): Promise<{ rowsSynced: number }> {
  const sap = getSapClient();
  const pool = getPool();
  const rows = await sap.getInventoryStock();

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Not TRUNCATE: that's DDL and implicitly commits in MySQL, which would
    // break rollback-on-error for the rest of this transaction.
    await conn.execute(`DELETE FROM item_warehouse_stock`);

    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const values = chunk.map((r) => [r.item_code, r.warehouse_code, r.in_stock, r.committed, r.ordered]);
      await conn.query(
        `INSERT INTO item_warehouse_stock (sap_item_code, warehouse_code, in_stock, committed, ordered, last_synced)
         VALUES ?`,
        [values.map((v) => [...v, new Date()])]
      );
    }

    await conn.commit();
    return { rowsSynced: rows.length };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

/**
 * Pull items + their tracked price-list prices from SAP B1 and upsert them
 * into the local MySQL cache (`items`, `item_channel_prices`). Sync scope
 * is the (ItemCat01, ItemCat02) pairs from the `item_groups` table in MySQL
 * (imported from SAP_Item_Group.xlsx or added manually via admin UI) —
 * an item only syncs once its level-1 + level-2 category pair exists there
 * AND both rows are active; an item is also skipped (left/marked inactive)
 * if any of its level 3-6 categories point at a group switched off in the
 * admin UI, even though those levels aren't part of the SAP-side filter.
 * Which price lists are "tracked" comes from `price_lists` (admin-editable).
 */
export async function syncItems(): Promise<{ itemsSynced: number }> {
  const sap = getSapClient();
  const pool = getPool();

  const [basePriceListNum, trackedPriceLists] = await Promise.all([
    getBasePriceListNum(),
    getTrackedPriceListNums(),
  ]);

  const catPairs = await getItemCategoryPairsFromDB();

  if (catPairs.length === 0) {
    console.warn(
      "[Sync] No (ItemCat01, ItemCat02) pairs found in item_groups table — import from SAP_Item_Group.xlsx or add manually first."
    );
    return { itemsSynced: 0 };
  }

  const cat01Rows = await query<{ code: string; name: string | null }[]>(
    `SELECT code, name FROM item_groups WHERE level = 1`
  );
  const cat01NameByCode = new Map(cat01Rows.map((r) => [r.code, r.name]));

  // Levels 1-2 already gate which items SAP even returns (via catPairs
  // above); levels 3-6 aren't part of that SAP-side filter, so an item
  // under an inactive level 3-6 group is skipped here instead — it's
  // left inactive (or, if new, never inserted at all).
  const inactiveByLevel = await getInactiveItemGroupCodesByLevel();
  const isUnderInactiveGroup = (item: {
    U_ItemCat01?: string | null; U_ItemCat02?: string | null; U_ItemCat03?: string | null;
    U_ItemCat04?: string | null; U_ItemCat05?: string | null; U_ItemCat06?: string | null;
  }) => {
    const codesByLevel: (string | null | undefined)[] = [
      item.U_ItemCat01, item.U_ItemCat02, item.U_ItemCat03,
      item.U_ItemCat04, item.U_ItemCat05, item.U_ItemCat06,
    ];
    return codesByLevel.some((code, i) => code && inactiveByLevel.get(i + 1)?.has(code));
  };

  // Deactivate everything first — the loop below reactivates (is_active =
  // TRUE) only items SAP actually returns for the current itemgroup.json
  // pairs, so anything no longer covered (including legacy rows with no
  // item_cat01/02 at all) ends up inactive. Items an admin manually hid
  // are unaffected either way (is_manually_hidden is a separate column).
  await query(`UPDATE items SET is_active = FALSE`);

  let skip = 0;
  let itemsSynced = 0;

  for (;;) {
    const items = await sap.getItems({
      top: PAGE_SIZE,
      skip,
      itemCatPairs: catPairs,
    });
    if (items.length === 0) break;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      for (const item of items) {
        if (isUnderInactiveGroup(item)) continue;

        const basePrice =
          item.ItemPrices?.find((p) => p.PriceList === basePriceListNum)?.Price ?? 0;
        const cat01Name = item.U_ItemCat01 ? cat01NameByCode.get(item.U_ItemCat01) : null;
        const category = cat01Name || item.U_ItemCat01 || String(item.ItemsGroupCode);

        await conn.execute(
          `INSERT INTO items (
             sap_item_code, item_name_vi, uom, category, items_group_code,
             item_cat01, item_cat02, item_cat03, item_cat04, item_cat05, item_cat06,
             base_price, image_url, is_active, last_synced)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, NOW())
           ON DUPLICATE KEY UPDATE
             item_name_vi = VALUES(item_name_vi),
             uom = VALUES(uom),
             category = VALUES(category),
             items_group_code = VALUES(items_group_code),
             item_cat01 = VALUES(item_cat01), item_cat02 = VALUES(item_cat02),
             item_cat03 = VALUES(item_cat03), item_cat04 = VALUES(item_cat04),
             item_cat05 = VALUES(item_cat05), item_cat06 = VALUES(item_cat06),
             base_price = VALUES(base_price),
             image_url = VALUES(image_url),
             is_active = TRUE,
             last_synced = NOW()`,
          [
            item.ItemCode,
            item.ItemName,
            item.SalesUnit || null,
            category,
            item.ItemsGroupCode,
            item.U_ItemCat01 || null,
            item.U_ItemCat02 || null,
            item.U_ItemCat03 || null,
            item.U_ItemCat04 || null,
            item.U_ItemCat05 || null,
            item.U_ItemCat06 || null,
            basePrice,
            item.U_ImageURL?.trim() || null,
          ]
        );

        await syncItemChannelPrices(conn, item.ItemCode, item.ItemPrices, trackedPriceLists);
        itemsSynced++;
      }

      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }

    // SAP's Service Layer caps the actual page size server-side (often 20)
    // regardless of the requested $top, so advance by what came back, not
    // by our requested page size, and stop only on an empty page.
    skip += items.length;
  }

  return { itemsSynced };
}

async function syncItemChannelPrices(
  conn: PoolConnection,
  sapItemCode: string,
  itemPrices: { PriceList: number; Price: number; BasePriceList?: number; Factor?: number }[],
  trackedPriceLists: number[]
): Promise<void> {
  for (const listNum of trackedPriceLists) {
    const entry = itemPrices.find((p) => p.PriceList === listNum);
    const price = entry?.Price ?? 0;
    const basePriceListNum = entry?.BasePriceList ?? null;
    const factor = entry?.Factor ?? null;
    await conn.execute(
      `INSERT INTO item_channel_prices (sap_item_code, price_list_num, base_price_list_num, factor, price, last_synced)
       VALUES (?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         base_price_list_num = VALUES(base_price_list_num),
         factor = VALUES(factor),
         price = VALUES(price),
         last_synced = NOW()`,
      [sapItemCode, listNum, basePriceListNum, factor, price]
    );
  }
}

/**
 * Pull negotiated SpecialPrices ("contract discounts") for one customer
 * (CardCode) from SAP B1 and upsert them into the local `special_prices`
 * cache. Called lazily (e.g. when the products API finds no cached rows for
 * a card code) or on-demand from the admin contract-discounts page.
 */
export async function syncSpecialPricesForCard(cardCode: string): Promise<{ pricesSynced: number }> {
  const sap = getSapClient();
  const pool = getPool();

  const specialPrices = await sap.getSpecialPrices(cardCode);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Clear stale rows for this card so removed/expired SAP special prices
    // don't linger in the cache.
    await conn.execute(`DELETE FROM special_prices WHERE sap_card_code = ?`, [cardCode]);

    for (const sp of specialPrices) {
      if (sp.Valid !== "tYES") continue;
      await conn.execute(
        `INSERT INTO special_prices (sap_card_code, sap_item_code, special_price, discount_percent, valid_from, valid_to, last_synced)
         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [cardCode, sp.ItemCode, sp.Price, sp.DiscountPercent ?? null, toMySQLDate(sp.ValidFrom), toMySQLDate(sp.ValidTo)]
      );
    }

    await conn.commit();
    return { pricesSynced: specialPrices.length };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

/**
 * Flatten one SAP SpecialPrices row into its per-period discount tiers. A
 * price-list-wide row (CardCode = '*NN') always carries its real data in
 * SpecialPriceDataAreas; a normal per-customer row usually has an empty
 * SpecialPriceDataAreas and carries its one discount on the row's own
 * top-level fields instead — fall back to those when there are no areas.
 */
function expandSpecialPriceTiers(sp: {
  ItemCode: string;
  Price: number;
  DiscountPercent: number;
  ValidFrom: string | null;
  ValidTo: string | null;
  SpecialPriceDataAreas?: { DateFrom: string | null; Dateto: string | null; Discount: number | null; SpecialPrice: number }[];
}): { itemCode: string; basePrice: number | null; specialPrice: number; discountPercent: number | null; from: string | null; to: string | null }[] {
  const areas = sp.SpecialPriceDataAreas ?? [];
  if (areas.length === 0) {
    // No nested areas: SAP's own top-level Price IS the resolved special
    // price here (that's how a normal per-customer row works), not a
    // separate "before discount" baseline — there's no baseline in this
    // object to report, so leave basePrice null rather than duplicate it.
    return [{ itemCode: sp.ItemCode, basePrice: null, specialPrice: sp.Price, discountPercent: sp.DiscountPercent ?? null, from: toMySQLDate(sp.ValidFrom), to: toMySQLDate(sp.ValidTo) }];
  }
  // sp.Price is the row's own (undiscounted) price on this price list — one
  // value per item, shared by every date-tier under it.
  return areas.map((a) => ({
    itemCode: sp.ItemCode,
    basePrice: sp.Price,
    specialPrice: a.SpecialPrice,
    discountPercent: a.Discount ?? null,
    from: toMySQLDate(a.DateFrom),
    to: toMySQLDate(a.Dateto),
  }));
}

/**
 * Pull "period discounts" for a price list — SAP SpecialPrices rows SAP
 * itself scopes to the whole list (CardCode = '*{priceListNum}', e.g. '*12'
 * for "S02. GT Price List") rather than to one customer — and upsert them
 * into `period_discount`. Not yet wired into the live storefront price
 * calculation (see src/app/api/products/route.ts); this just caches what
 * SAP has.
 */
export async function syncPeriodDiscounts(priceListNum: number): Promise<{ rowsSynced: number }> {
  const sap = getSapClient();
  const pool = getPool();

  const rows = await sap.getPriceListSpecialPrices(priceListNum);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(`DELETE FROM period_discount WHERE price_list_num = ?`, [priceListNum]);

    let rowsSynced = 0;
    for (const sp of rows) {
      if (sp.Valid !== "tYES") continue;
      for (const tier of expandSpecialPriceTiers(sp)) {
        await conn.execute(
          `INSERT INTO period_discount (price_list_num, sap_item_code, base_price, discount_percent, special_price, date_from, date_to, last_synced)
           VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
          [priceListNum, tier.itemCode, tier.basePrice, tier.discountPercent, tier.specialPrice, tier.from, tier.to]
        );
        rowsSynced++;
      }
    }

    await conn.commit();
    return { rowsSynced };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

/**
 * Pull "special discounts" (negotiated SAP SpecialPrices, the normal
 * per-customer form) for every local customer currently assigned the given
 * channel price list — e.g. all "GT Channel" customers on "S02. GT Price
 * List" — in one bulk run, rather than one card code at a time like
 * syncSpecialPricesForCard. Upserts into `special_discount`. One SAP round
 * trip per customer, so this can take a while for a large channel. Not yet
 * wired into the live storefront price calculation; this just caches what
 * SAP has.
 */
export async function syncSpecialDiscountsForChannel(
  priceListNum: number
): Promise<{ customersProcessed: number; rowsSynced: number }> {
  const sap = getSapClient();
  const pool = getPool();

  const customers = await query<{ sap_card_code: string }[]>(
    `SELECT DISTINCT sap_card_code FROM customers WHERE price_list_num = ? AND sap_card_code IS NOT NULL AND sap_card_code != ''`,
    [priceListNum]
  );
  const cardCodes = customers.map((c) => c.sap_card_code);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (cardCodes.length > 0) {
      await conn.query(`DELETE FROM special_discount WHERE sap_card_code IN (?)`, [cardCodes]);
    }

    let rowsSynced = 0;
    for (const cardCode of cardCodes) {
      const rows = await sap.getSpecialPrices(cardCode);
      for (const sp of rows) {
        if (sp.Valid !== "tYES") continue;
        for (const tier of expandSpecialPriceTiers(sp)) {
          await conn.execute(
            `INSERT INTO special_discount (sap_card_code, sap_item_code, special_price, discount_percent, valid_from, valid_to, last_synced)
             VALUES (?, ?, ?, ?, ?, ?, NOW())`,
            [cardCode, tier.itemCode, tier.specialPrice, tier.discountPercent, tier.from, tier.to]
          );
          rowsSynced++;
        }
      }
    }

    await conn.commit();
    return { customersProcessed: cardCodes.length, rowsSynced };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

/**
 * Refresh one customer's SAP card code / channel price list / customer
 * group codes from BusinessPartners. Only updates that customer's own
 * `users` row — never writes to `customer_groups`, which is populated only
 * by the manual custgroup.json import.
 */
export async function syncCustomerGroupsForCard(
  cardCode: string
): Promise<{ cusGrp01: string | null; cusGrp02: string | null; cusGrp03: string | null }> {
  const sap = getSapClient();
  const bp = await sap.getBusinessPartner(cardCode);

  const cusGrp01 = bp?.U_CusGrp01 || null;
  const cusGrp02 = bp?.U_CusGrp02 || null;
  const cusGrp03 = bp?.U_CusGrp03 || null;

  await query(
    `UPDATE users SET sap_price_list_num = ?, sap_cus_grp01 = ?, sap_cus_grp02 = ?, sap_cus_grp03 = ?
     WHERE sap_card_code = ?`,
    [bp?.PriceListNum ?? null, cusGrp01, cusGrp02, cusGrp03, cardCode]
  );

  return { cusGrp01, cusGrp02, cusGrp03 };
}

/**
 * Pull Contract Discounts from SAP B1 via OData `/CBD` endpoint, filtered by:
 *   - Header U_Code IN (customer group codes + customer card codes from DB)
 *   - Line U_Code IN (item group codes + item codes from DB)
 */
export async function syncContractDiscounts(): Promise<{ headersSynced: number; linesSynced: number; headersSkipped: number }> {
  const sap = getSapClient();
  const pool = getPool();

  // Build customer-side code list from DB
  const cgRows = await query<{ code: string }[]>(
    `SELECT DISTINCT code FROM customer_groups`
  );
  const custRows = await query<{ sap_card_code: string }[]>(
    `SELECT DISTINCT sap_card_code FROM customers`
  );
  const customerCodes = new Set(
    [
      ...cgRows.map((r) => r.code),
      ...custRows.map((r) => r.sap_card_code),
    ]
      .filter(Boolean)
      .map((c) => c.trim())
  );

  // Build item-side code list from DB
  const igRows = await query<{ code: string }[]>(
    `SELECT DISTINCT code FROM item_groups`
  );
  const itemRows = await query<{ sap_item_code: string }[]>(
    `SELECT DISTINCT sap_item_code FROM items`
  );
  const itemCodes = new Set(
    [
      ...igRows.map((r) => r.code),
      ...itemRows.map((r) => r.sap_item_code),
    ]
      .filter(Boolean)
      .map((c) => c.trim())
  );

  if (customerCodes.size === 0) {
    console.warn("[Sync CBD] No customer groups or customers in DB — import them first.");
    return { headersSynced: 0, linesSynced: 0, headersSkipped: 0 };
  }
  if (itemCodes.size === 0) {
    console.warn("[Sync CBD] No item groups or items in DB — import them first.");
    return { headersSynced: 0, linesSynced: 0, headersSkipped: 0 };
  }

  let skip = 0;
  let headersSynced = 0;
  let linesSynced = 0;
  let headersSkipped = 0;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    for (;;) {
      const headers = await sap.getContractDiscounts({ top: PAGE_SIZE, skip });
      if (headers.length === 0) break;

      for (const h of headers) {
        // SAP U_Code might have trailing spaces
        const headerCode = h.U_Code ? h.U_Code.trim() : "";
        if (!headerCode || !customerCodes.has(headerCode)) {
          headersSkipped++;
          continue;
        }

        let syncedAnyLines = false;
        const lines = h.MDM_CD_CBD_LCollection || [];
        
        for (const l of lines) {
          const lineCode = l.U_Code ? l.U_Code.trim() : "";
          if (!lineCode || !itemCodes.has(lineCode)) {
            continue; // Skip lines that don't match item/item group
          }

          syncedAnyLines = true;
          await conn.execute(
            `INSERT INTO contract_discount (
               doc_entry, doc_num, line_id, period, status, create_date, update_date, canceled,
               u_type_cust, u_type_name_cust, u_code_cust, u_name_cust, u_valid_from, u_valid_to,
               u_type_item, u_type_name_item, u_code_item, u_name_item, u_base_disc_pct, last_synced)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
             ON DUPLICATE KEY UPDATE
               doc_num = VALUES(doc_num), period = VALUES(period), status = VALUES(status),
               create_date = VALUES(create_date), update_date = VALUES(update_date), canceled = VALUES(canceled),
               u_type_cust = VALUES(u_type_cust), u_type_name_cust = VALUES(u_type_name_cust),
               u_code_cust = VALUES(u_code_cust), u_name_cust = VALUES(u_name_cust),
               u_valid_from = VALUES(u_valid_from), u_valid_to = VALUES(u_valid_to),
               u_type_item = VALUES(u_type_item), u_type_name_item = VALUES(u_type_name_item),
               u_code_item = VALUES(u_code_item), u_name_item = VALUES(u_name_item),
               u_base_disc_pct = VALUES(u_base_disc_pct), last_synced = NOW()`,
            [
              h.DocEntry, h.DocNum, l.LineId, h.Period, h.Status, toMySQLDate(h.CreateDate), toMySQLDate(h.UpdateDate), h.Canceled,
              h.U_Type, h.U_TypeName, headerCode, h.U_Name, toMySQLDate(h.U_ValidFrom), toMySQLDate(h.U_ValidTo),
              l.U_Type, l.U_TypeName, lineCode, l.U_Name, l.U_BaseDiscPct,
            ]
          );
          linesSynced++;
        }

        if (syncedAnyLines) {
          headersSynced++;
        } else {
          headersSkipped++;
        }
      }

      skip += headers.length;
    }

    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }

  return { headersSynced, linesSynced, headersSkipped };
}

/**
 * Pull Customer Required Shelf Life (CSL — same "[CD]" module as Contract
 * Discounts) from SAP and flatten header+lines into `customer_require_shelflife`,
 * mirroring:
 *   SELECT t1.DocEntry, t1.U_Code CustGroupCode, t1.U_Name CustGroupName,
 *          t1.U_ValidFrom, t1.U_ValidTo,
 *          t2.U_Code ItemGroupCode, t2.U_Name ItemGroupName,
 *          t2.U_ReqSLFrom, t2.U_ReqSLTo
 *   FROM "@MDM_CD_CSL_H" t1 INNER JOIN "@MDM_CD_CSL_L" t2 ON t1.DocEntry = t2.DocEntry
 * — done in JS against /CSL (see getCustomerRequiredShelfLife) rather than
 * as a literal SQLQuery, since SAP blocks raw SQL access to these two
 * tables for this account ("not accessible") but /CSL is a dedicated,
 * accessible Service Layer binding for the same UDO.
 *
 * Scope: only rows whose customer code AND item code are both already
 * known `customer_groups`/`item_groups` codes are kept — a header naming a
 * specific customer (not a group), or a group this portal doesn't track at
 * all, is dropped. Unlike syncContractDiscounts, customers.sap_card_code /
 * items.sap_item_code are deliberately NOT part of the scope (per the
 * admin's request — only customer_groups/item_groups).
 */
export async function syncCustomerRequiredShelfLife(): Promise<{ rowsSynced: number; rowsSkipped: number }> {
  const sap = getSapClient();
  const pool = getPool();

  const cgRows = await query<{ code: string }[]>(`SELECT DISTINCT code FROM customer_groups`);
  const customerGroupCodes = new Set(cgRows.map((r) => r.code.trim()));
  const igRows = await query<{ code: string }[]>(`SELECT DISTINCT code FROM item_groups`);
  const itemGroupCodes = new Set(igRows.map((r) => r.code.trim()));

  if (customerGroupCodes.size === 0 || itemGroupCodes.size === 0) {
    console.warn("[Sync CSL] No customer_groups or item_groups in DB yet — import them first.");
    return { rowsSynced: 0, rowsSkipped: 0 };
  }

  const headers = await sap.getCustomerRequiredShelfLife();

  const rows: {
    docEntry: number; custGroupCode: string; custGroupName: string | null;
    validFrom: string | null; validTo: string | null;
    itemGroupCode: string; itemGroupName: string | null;
    shelfLifeFrom: number | null; shelfLifeTo: number | null;
  }[] = [];
  let rowsSkipped = 0;

  for (const h of headers) {
    if (h.Canceled === "Y") continue;
    const custGroupCode = h.U_Code?.trim();
    if (!custGroupCode || !customerGroupCodes.has(custGroupCode)) {
      rowsSkipped += (h.MDM_CD_CSL_LCollection ?? []).length;
      continue;
    }
    for (const l of h.MDM_CD_CSL_LCollection ?? []) {
      const itemGroupCode = l.U_Code?.trim();
      if (!itemGroupCode || !itemGroupCodes.has(itemGroupCode)) {
        rowsSkipped++;
        continue;
      }
      rows.push({
        docEntry: h.DocEntry,
        custGroupCode,
        custGroupName: h.U_Name,
        validFrom: toMySQLDate(h.U_ValidFrom),
        validTo: toMySQLDate(h.U_ValidTo),
        itemGroupCode,
        itemGroupName: l.U_Name,
        shelfLifeFrom: l.U_ReqSLFrom,
        shelfLifeTo: l.U_ReqSLTo,
      });
    }
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(`DELETE FROM customer_require_shelflife`);

    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK).map((r) => [
        r.docEntry, r.custGroupCode, r.custGroupName, r.validFrom, r.validTo,
        r.itemGroupCode, r.itemGroupName, r.shelfLifeFrom, r.shelfLifeTo, new Date(),
      ]);
      if (chunk.length === 0) continue;
      await conn.query(
        `INSERT INTO customer_require_shelflife
           (doc_entry, cust_group_code, cust_group_name, valid_from, valid_to,
            item_group_code, item_group_name, shelf_life_from, shelf_life_to, last_synced)
         VALUES ?`,
        [chunk]
      );
    }

    await conn.commit();
    return { rowsSynced: rows.length, rowsSkipped };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

/**
 * Pull SAP customers (BusinessPartners) into the local `customers`
 * cache — one row per real SAP customer, scoped to the (U_CusGrp01,
 * U_CusGrp02) pairs from the `customer_groups` table in MySQL
 * (imported from SAP_Customer_Group.xlsx or added manually via admin UI).
 * Distinct from `users` (portal-registered accounts).
 * The `account` column is NOT touched by sync — it is only set when
 * an admin approves a customer signup.
 */
export async function syncSapCustomers(): Promise<{ customersSynced: number }> {
  const sap = getSapClient();
  const pool = getPool();

  const pairs = await getCustomerGroupPairsFromDB();
  if (pairs.length === 0) {
    console.warn(
      "[Sync] No (CusGrp01, CusGrp02) pairs found in customer_groups table — import from SAP_Customer_Group.xlsx or add manually first."
    );
    return { customersSynced: 0 };
  }

  let skip = 0;
  let customersSynced = 0;

  for (;;) {
    const customers = await sap.getCustomersByGroupPairs({ pairs, top: PAGE_SIZE, skip });
    if (customers.length === 0) break;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      for (const c of customers) {
        await conn.execute(
          `INSERT INTO customers (
             sap_card_code, card_name, mst_code, price_list_num,
             cus_grp01, cus_grp02, cus_grp03, phone, email, address, last_synced)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE
             card_name = VALUES(card_name), mst_code = VALUES(mst_code),
             price_list_num = VALUES(price_list_num),
             cus_grp01 = VALUES(cus_grp01), cus_grp02 = VALUES(cus_grp02), cus_grp03 = VALUES(cus_grp03),
             phone = VALUES(phone), email = VALUES(email), address = VALUES(address),
             last_synced = NOW()`,
          [
            c.CardCode, c.CardName || null, c.FederalTaxID || null, c.PriceListNum ?? null,
            c.U_CusGrp01 || null, c.U_CusGrp02 || null, c.U_CusGrp03 || null,
            c.Phone1 || null, c.EmailAddress || null, c.Address || null,
          ]
        );
        customersSynced++;
      }

      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }

    skip += customers.length;
  }

  return { customersSynced };
}

