import { Agent } from 'undici';
import { loadConfig, resolveEnvSecret } from '@/lib/config';

// SAP B1 Service Layer uses a self-signed certificate. Scope the relaxed TLS
// check to this client's own requests only — never disable it process-wide.
const insecureDispatcher = new Agent({ connect: { rejectUnauthorized: false } });

// ── SAP B1 Types ──

export interface SapLoginPayload {
  CompanyDB: string;
  UserName: string;
  Password: string;
}

export interface SapBusinessPartner {
  CardCode: string;
  CardName: string;
  CardType: string;
  FederalTaxID: string;
  Phone1?: string;
  EmailAddress?: string;
  Address?: string;
  GroupCode?: number;
  PriceListNum?: number;
  U_CusGrp01?: string;
  U_CusGrp02?: string;
  U_CusGrp03?: string;
}

export interface SapPriceList {
  PriceListNo: number;
  PriceListName: string;
}

export interface SapWarehouse {
  WarehouseCode: string;
  WarehouseName: string;
  Inactive: string; // BoYesNoEnum: 'tYES' | 'tNO'
}

/** One row of src.OITW (Item-Warehouse stock) via SQLQueries — see getInventoryStock. */
export interface SapInventoryStockRow {
  item_code: string;
  warehouse_code: string;
  in_stock: number;
  committed: number;
  ordered: number;
}


export interface SapItemPrice {
  PriceList: number;
  Price: number;
  Currency: string | null;
  BasePriceList: number;
  Factor: number;
}

export interface SapItem {
  ItemCode: string;
  ItemName: string;
  QuantityOnStock: number;
  SalesUnit: string;
  ItemPrices: SapItemPrice[];
  U_ImageURL?: string | null; // UDF for item image (SAP field name is case-sensitive)
  ItemsGroupCode: number;
  Valid: string;
  U_ItemCat01?: string;
  U_ItemCat02?: string;
  U_ItemCat03?: string;
  U_ItemCat04?: string;
  U_ItemCat05?: string;
  U_ItemCat06?: string;
}

/**
 * A dated/quantified tier nested under a SpecialPrices row. For a normal
 * per-customer row (real CardCode) this is usually empty and the discount
 * lives on the row's own top-level fields instead; for a price-list-wide row
 * (CardCode = '*{PriceListNum}') this is where the real data is — the row's
 * own Price/DiscountPercent are just the undiscounted baseline.
 */
export interface SapSpecialPriceDataArea {
  DateFrom: string | null;
  Dateto: string | null;
  Discount: number | null;
  SpecialPrice: number;
  BPCode: string;
  PriceListNo: number;
  ItemNo: string;
  RowNumber: number;
}

export interface SapSpecialPrice {
  ItemCode: string;
  CardCode: string;
  Price: number;
  DiscountPercent: number;
  PriceListNum: number;
  Valid: string;
  ValidFrom: string | null;
  ValidTo: string | null;
  SpecialPriceDataAreas?: SapSpecialPriceDataArea[];
}

export interface SapContractDiscountLine {
  DocEntry: number;
  LineId: number;
  U_Type: string | null;
  U_TypeName: string | null;
  U_Code: string | null;
  U_Name: string | null;
  U_BaseDiscPct: number | null;
}

export interface SapCslLine {
  DocEntry: number;
  LineId: number;
  U_Type: string | null;
  U_TypeName: string | null;
  U_Code: string | null;
  U_Name: string | null;
  U_ReqSLFrom: number | null;
  U_ReqSLTo: number | null;
  U_FreeTxt: string | null;
}

/** One SAP B1 "Customer Required Shelf Life" header (UDO @MDM_CD_CSL_H / @MDM_CD_CSL_L), via /CSL. */
export interface SapCsl {
  DocEntry: number;
  DocNum: number;
  Status: string | null;
  Canceled: string | null;
  U_Type: string | null;
  U_TypeName: string | null;
  U_Code: string | null;
  U_Name: string | null;
  U_ValidFrom: string | null;
  U_ValidTo: string | null;
  MDM_CD_CSL_LCollection: SapCslLine[];
}

export interface SapContractDiscount {
  DocEntry: number;
  DocNum: number;
  Period: number | null;
  Status: string | null;
  CreateDate: string | null;
  UpdateDate: string | null;
  Canceled: string | null;
  U_Type: string | null;
  U_TypeName: string | null;
  U_Code: string | null;
  U_Name: string | null;
  U_ValidFrom: string | null;
  U_ValidTo: string | null;
  MDM_CD_CBD_LCollection: SapContractDiscountLine[];
}

/** Flat row from SQL join of @MDM_CD_CBD_H and @MDM_CD_CBD_L */
export interface SapContractDiscountFlat {
  DocEntry: number;
  DocNum: number;
  LineId: number;
  Period: number | null;
  Status: string | null;
  CreateDate: string | null;
  UpdateDate: string | null;
  Canceled: string | null;
  U_Type_Cust: string | null;
  U_TypeName_Cust: string | null;
  U_Code_Cust: string | null;
  U_Name_Cust: string | null;
  U_ValidFrom: string | null;
  U_ValidTo: string | null;
  U_Type_Item: string | null;
  U_TypeName_Item: string | null;
  U_Code_Item: string | null;
  U_Name_Item: string | null;
  U_BaseDiscPct: number | null;
}

export interface SapSalesOrderDraft {
  CardCode: string;
  DocDate?: string;
  DocDueDate?: string;
  Comments?: string;
  DocumentLines: {
    ItemCode: string;
    Quantity: number;
    UnitPrice?: number;
    DiscountPercent?: number;
  }[];
}

export interface SapDocumentResponse {
  DocEntry: number;
  DocNum: number;
}

// ── SAP B1 Service Layer Client ──

export class SapB1Client {
  private baseUrl: string;
  private companyDB: string;
  private userName: string;
  private password: string;
  private sessionId: string | null = null;

  constructor() {
    const sapConfig = loadConfig().sapb1;
    this.baseUrl = sapConfig.baseUrl;
    this.companyDB = sapConfig.companyID;
    this.userName = sapConfig.userId;
    this.password = resolveEnvSecret('SAPB1_PASSWORD');
  }

  /**
   * Make an HTTP request to SAP B1 Service Layer
   */
  private async request<T>(
    method: string,
    endpoint: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.sessionId) {
      headers['Cookie'] = `B1SESSION=${this.sessionId}`;
    }

    let response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      dispatcher: insecureDispatcher,
    } as RequestInit);

    // If session expired (401), retry once
    if (response.status === 401 && this.sessionId) {
      console.warn('[SAP] Session expired, re-authenticating...');
      this.sessionId = null;
      await this.ensureSession();
      headers['Cookie'] = `B1SESSION=${this.sessionId}`;
      response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        dispatcher: insecureDispatcher,
      } as RequestInit);
    }

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`SAP B1 API error ${response.status}: ${errorBody}`);
    }

    const text = await response.text();
    return text ? JSON.parse(text) : ({} as T);
  }

  /**
   * Login to SAP B1 Service Layer
   */
  async login(): Promise<void> {
    const payload: SapLoginPayload = {
      CompanyDB: this.companyDB,
      UserName: this.userName,
      Password: this.password,
    };

    const response = await fetch(`${this.baseUrl}/Login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      dispatcher: insecureDispatcher,
    } as RequestInit);

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`SAP B1 Login failed: ${errorBody}`);
    }

    const data = await response.json();
    this.sessionId = data.SessionId;
    console.log('[SAP] Login successful, session:', this.sessionId?.substring(0, 8) + '...');
  }

  /**
   * Logout from SAP B1 Service Layer
   */
  async logout(): Promise<void> {
    if (this.sessionId) {
      try {
        await this.request('POST', '/Logout');
      } catch {
        // Ignore logout errors
      }
      this.sessionId = null;
    }
  }

  /**
   * Ensure we have an active session
   */
  private async ensureSession(): Promise<void> {
    if (!this.sessionId) {
      await this.login();
    }
  }

  /**
   * Get Business Partner by Federal Tax ID (MST Code)
   */
  async getBusinessPartnerByTaxCode(mstCode: string): Promise<SapBusinessPartner | null> {
    await this.ensureSession();
    try {
      const filter = encodeURIComponent(`FederalTaxID eq '${mstCode}'`);
      const select = encodeURIComponent(
        'CardCode,CardName,CardType,FederalTaxID,Phone1,EmailAddress,Address,GroupCode,PriceListNum,U_CusGrp01,U_CusGrp02,U_CusGrp03'
      );
      const result = await this.request<{ value: SapBusinessPartner[] }>(
        'GET',
        `/BusinessPartners?$filter=${filter}&$select=${select}`
      );
      return result.value && result.value.length > 0 ? result.value[0] : null;
    } catch (error) {
      console.error('[SAP] Failed to get BP by tax code:', error);
      return null;
    }
  }

  /**
   * Get Business Partner by Card Code
   */
  async getBusinessPartner(cardCode: string): Promise<SapBusinessPartner | null> {
    await this.ensureSession();
    try {
      const select = encodeURIComponent(
        'CardCode,CardName,CardType,FederalTaxID,Phone1,EmailAddress,Address,GroupCode,PriceListNum,U_CusGrp01,U_CusGrp02,U_CusGrp03'
      );
      return await this.request<SapBusinessPartner>(
        'GET',
        `/BusinessPartners('${cardCode}')?$select=${select}`
      );
    } catch (error) {
      console.error('[SAP] Failed to get BP:', error);
      return null;
    }
  }

  /**
   * Get customers (CardType=cCustomer) whose (U_CusGrp01, U_CusGrp02)
   * matches one of the given pairs — the sync scope for the SAP customer
   * master cache, same pattern as getItems' itemCatPairs.
   */
  async getCustomersByGroupPairs(params: {
    pairs: { cat1: string; cat2: string }[];
    top: number;
    skip: number;
  }): Promise<SapBusinessPartner[]> {
    await this.ensureSession();
    try {
      const select = encodeURIComponent(
        'CardCode,CardName,FederalTaxID,Phone1,EmailAddress,Address,PriceListNum,U_CusGrp01,U_CusGrp02,U_CusGrp03'
      );
      const pairFilter = params.pairs
        .map((p) => `(U_CusGrp01 eq '${p.cat1}' and U_CusGrp02 eq '${p.cat2}')`)
        .join(' or ');
      const filter = encodeURIComponent(`CardType eq 'cCustomer' and (${pairFilter})`);
      const result = await this.request<{ value: SapBusinessPartner[] }>(
        'GET',
        `/BusinessPartners?$select=${select}&$filter=${filter}&$top=${params.top}&$skip=${params.skip}`
      );
      return result.value || [];
    } catch (error) {
      console.error('[SAP] Failed to get customers by group pairs:', error);
      return [];
    }
  }

  /**
   * Get Price Lists (for admin reference-data sync — names for the price
   * list numbers already used in item pricing).
   */
  async getPriceLists(): Promise<SapPriceList[]> {
    await this.ensureSession();
    const lists: SapPriceList[] = [];
    let path: string | null = '/PriceLists?$select=PriceListNo,PriceListName';
    while (path) {
      const result: { value: SapPriceList[]; 'odata.nextLink'?: string } = await this.request(
        'GET',
        path
      );
      lists.push(...(result.value || []));
      path = result['odata.nextLink'] ? `/${result['odata.nextLink']}` : null;
    }
    return lists;
  }

  /**
   * Get Warehouses from SAP B1 (for the admin's inventory-visibility
   * warehouse list — see `warehouses` table / syncWarehouses).
   */
  async getWarehouses(): Promise<SapWarehouse[]> {
    await this.ensureSession();
    const out: SapWarehouse[] = [];
    let path: string | null = '/Warehouses?$select=WarehouseCode,WarehouseName,Inactive';
    while (path) {
      const result: { value: SapWarehouse[]; 'odata.nextLink'?: string } = await this.request('GET', path);
      out.push(...(result.value || []));
      path = result['odata.nextLink'] ? `/${result['odata.nextLink']}` : null;
    }
    return out;
  }

  /**
   * Get per-item, per-warehouse on-hand/committed/on-order stock straight
   * from OITW via SQLQueries — the OData ItemWarehouseInfoCollection on
   * /Items returns ~55 full GL-account-laden objects per item (one per
   * warehouse), far too heavy to fold into the regular items sync, so this
   * goes directly at the lean source table instead, same pattern as
   * executePromotionSql. Rows where on-hand/committed/on-order are all zero
   * are skipped server-side (most item×warehouse combinations are).
   */
  async getInventoryStock(): Promise<SapInventoryStockRow[]> {
    await this.ensureSession();

    const sqlText = `SELECT T0."ItemCode" AS "item_code", T0."WhsCode" AS "warehouse_code", T0."OnHand" AS "in_stock", T0."IsCommited" AS "committed", T0."OnOrder" AS "ordered" FROM "OITW" T0 WHERE T0."OnHand" <> 0 OR T0."IsCommited" <> 0 OR T0."OnOrder" <> 0 ORDER BY T0."ItemCode", T0."WhsCode"`;
    const sqlCode = 'InventoryStockSync';

    try {
      try {
        await this.request('POST', '/SQLQueries', {
          SqlCode: sqlCode, SqlName: 'Inventory Stock Sync', SqlText: sqlText,
        });
        console.log('[SAP] Created SQLQuery', sqlCode);
      } catch (createErr: any) {
        if (createErr.message?.includes('400')) {
          await this.request('PATCH', `/SQLQueries('${sqlCode}')`, { SqlText: sqlText });
          console.log('[SAP] Updated SQLQuery', sqlCode);
        } else {
          throw createErr;
        }
      }

      const allRows: SapInventoryStockRow[] = [];
      let skip = 0;
      const top = 500;
      for (;;) {
        const result = await this.request<{ value: SapInventoryStockRow[] }>(
          'GET', `/SQLQueries('${sqlCode}')/List?$top=${top}&$skip=${skip}`
        );
        const rows = result.value || [];
        if (rows.length === 0) break;
        allRows.push(...rows);
        // Service Layer caps the actual page size server-side (often 20)
        // regardless of the requested $top, so advance by what came back,
        // not by our requested page size, and stop only on an empty page —
        // same gotcha as getItems' pagination (see its comment).
        skip += rows.length;
      }
      console.log(`[SAP] Inventory stock query returned ${allRows.length} rows`);
      return allRows;
    } catch (error) {
      console.error('[SAP] getInventoryStock failed:', error);
      throw error;
    }
  }

  /**
   * Get Items from SAP B1
   */
  async getItems(params?: {
    top?: number;
    skip?: number;
    filter?: string;
    search?: string;
    /** Restrict to items whose (U_ItemCat01, U_ItemCat02) matches one of these exact pairs. */
    itemCatPairs?: { cat1: string; cat2: string }[];
  }): Promise<SapItem[]> {
    await this.ensureSession();
    try {
      // U_ImageURL is a UDF: until Service Layer has picked it up (it caches
      // metadata, so a freshly-added UDF is rejected as "invalid property"
      // until it's restarted) selecting it fails the whole request. Retry
      // without it rather than syncing nothing.
      try {
        return await this.fetchItems(params, true);
      } catch (error) {
        if (!String(error instanceof Error ? error.message : error).includes('U_ImageURL')) throw error;
        console.warn('[SAP] Items.U_ImageURL not available in Service Layer yet — syncing without item images');
        return await this.fetchItems(params, false);
      }
    } catch (error) {
      console.error('[SAP] Failed to get items:', error);
      return [];
    }
  }

  private async fetchItems(
    params: {
      top?: number;
      skip?: number;
      filter?: string;
      search?: string;
      itemCatPairs?: { cat1: string; cat2: string }[];
    } | undefined,
    withImage: boolean
  ): Promise<SapItem[]> {
    {
      const queryParts: string[] = [];
      const select =
        "ItemCode,ItemName,SalesUnit,ItemPrices,ItemsGroupCode,Valid," +
        (withImage ? "U_ImageURL," : "") +
        "U_ItemCat01,U_ItemCat02,U_ItemCat03,U_ItemCat04,U_ItemCat05,U_ItemCat06";
      queryParts.push(`$select=${encodeURIComponent(select)}`);

      if (params?.top) queryParts.push(`$top=${params.top}`);
      if (params?.skip) queryParts.push(`$skip=${params.skip}`);

      const filters: string[] = ["Valid eq 'tYES'"];
      if (params?.itemCatPairs && params.itemCatPairs.length > 0) {
        filters.push(
          `(${params.itemCatPairs
            .map((p) => `(U_ItemCat01 eq '${p.cat1}' and U_ItemCat02 eq '${p.cat2}')`)
            .join(' or ')})`
        );
      }
      if (params?.filter) filters.push(params.filter);
      if (params?.search) {
        filters.push(
          `(contains(ItemCode,'${params.search}') or contains(ItemName,'${params.search}'))`
        );
      }
      queryParts.push(`$filter=${encodeURIComponent(filters.join(' and '))}`);

      const queryString = queryParts.join('&');
      const result = await this.request<{ value: SapItem[] }>(
        'GET',
        `/Items?${queryString}`
      );
      return result.value || [];
    }
  }

  /**
   * Get Special Prices for a Business Partner
   */
  async getSpecialPrices(cardCode: string): Promise<SapSpecialPrice[]> {
    await this.ensureSession();
    try {
      const filter = encodeURIComponent(`CardCode eq '${cardCode}'`);
      const result = await this.request<{ value: SapSpecialPrice[] }>(
        'GET',
        `/SpecialPrices?$filter=${filter}`
      );
      return result.value || [];
    } catch (error) {
      console.error('[SAP] Failed to get special prices:', error);
      return [];
    }
  }

  /**
   * Get the SpecialPrices rows SAP scopes to a whole Price List rather than
   * one customer — SAP's own convention for this is CardCode = '*{num}'
   * (e.g. '*12' for price list 12). These are "period discounts": the real
   * discount/period for each item is in each row's SpecialPriceDataAreas,
   * not its own top-level fields. See SapSpecialPriceDataArea.
   */
  async getPriceListSpecialPrices(priceListNum: number): Promise<SapSpecialPrice[]> {
    return this.getSpecialPrices(`*${priceListNum}`);
  }

  /**
   * Get Contract Discounts (CBD — Customer Based Discount headers, each
   * with its line collection nested automatically, no $expand needed).
   * Header targets a customer (specific CardCode or a customer-group
   * level); each line targets items (specific ItemCode or an item-category
   * level) with a discount percentage.
   */
  async getContractDiscounts(params: { top: number; skip: number }): Promise<SapContractDiscount[]> {
    await this.ensureSession();
    try {
      const queryParts = [`$top=${params.top}`, `$skip=${params.skip}`];
      const result = await this.request<{ value: SapContractDiscount[] }>(
        'GET',
        `/CBD?${queryParts.join('&')}`
      );
      return result.value || [];
    } catch (error: any) {
      console.error('[SAP] Failed to get contract discounts:', error);
      throw error;
    }
  }

  /**
   * Get Customer Required Shelf Life headers (CSL — same "[CD]" custom
   * module family as CBD/Contract Discounts), each with its line collection
   * nested automatically. Header targets a customer (specific CardCode or a
   * customer-group level); each line targets an item-group level with a
   * required remaining-shelf-life % range (U_ReqSLFrom/U_ReqSLTo). Raw
   * SQLQueries access to the underlying "@MDM_CD_CSL_H"/"@MDM_CD_CSL_L"
   * tables is blocked for this SAP user ("not accessible") — /CSL works.
   */
  async getCustomerRequiredShelfLife(): Promise<SapCsl[]> {
    await this.ensureSession();
    const all: SapCsl[] = [];
    let skip = 0;
    const top = 20;
    for (;;) {
      const result = await this.request<{ value: SapCsl[] }>(
        'GET',
        `/CSL?$top=${top}&$skip=${skip}`
      );
      const rows = result.value || [];
      if (rows.length === 0) break;
      all.push(...rows);
      // Service Layer caps the actual page size server-side regardless of
      // the requested $top, so advance by what came back, not by our
      // requested page size, and stop only on an empty page — same gotcha
      // as getItems/getInventoryStock's pagination.
      skip += rows.length;
    }
    return all;
  }

  /**
   * Create a Draft Sales Order in SAP B1
   */
  async createDraftSalesOrder(draft: SapSalesOrderDraft): Promise<SapDocumentResponse> {
    await this.ensureSession();
    // /Drafts is shared by every document type — SAP rejects the request
    // ("Object type for draft is missing") unless DocObjectCode says which;
    // 'oOrders' = Sales Order.
    return this.request<SapDocumentResponse>('POST', '/Drafts', { DocObjectCode: 'oOrders', ...draft });
  }

  /**
   * Get a Draft Sales Order by DocEntry
   */
  async getDraftSalesOrder(docEntry: number): Promise<SapSalesOrderDraft & SapDocumentResponse> {
    await this.ensureSession();
    return this.request<SapSalesOrderDraft & SapDocumentResponse>(
      'GET',
      `/Drafts(${docEntry})`
    );
  }

}

// Singleton instance
let sapClient: SapB1Client | null = null;

export function getSapClient(): SapB1Client {
  if (!sapClient) {
    sapClient = new SapB1Client();
  }
  return sapClient;
}

export default SapB1Client;
