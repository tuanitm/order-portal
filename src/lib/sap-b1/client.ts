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

export interface SapSpecialPrice {
  ItemCode: string;
  CardCode: string;
  Price: number;
  DiscountPercent: number;
  PriceListNum: number;
  Valid: string;
  ValidFrom: string | null;
  ValidTo: string | null;
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
      require('fs').writeFileSync('d:\\Project\\Order-Portal\\sap_error.txt', String(error?.stack || error?.message || error));
      throw error;
    }
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

  /**
   * Fetch promotion discounts from SAP B1 via SQLQueries.
   * SAP SQLQueries does not support CTEs (WITH), so we inline subqueries.
   */
  async executePromotionSql(): Promise<any[]> {
    await this.ensureSession();

    const BP_SUB = `(
      SELECT DISTINCT A."DocEntry", CAST(NULL AS NVARCHAR(50)) AS "BPGrpCode", CAST(NULL AS NVARCHAR(254)) AS "BPGrpName", A."Code" AS "BPCode", IFNULL(BP."CardName", A."Name") AS "BPName"
      FROM "PM_APPLYBP" A LEFT JOIN "OCRD" BP ON BP."CardCode" = A."Code"
      WHERE A."Type" = '2' AND BP."U_CusGrp02" IN('GTSO','GTNO','GTSE','GTMK') AND BP."U_CusCCDept" = 'HCMD01'
      UNION ALL
      SELECT DISTINCT A."DocEntry", G."Code" AS "BPGrpCode", G."Name" AS "BPGrpName", BP."CardCode" AS "BPCode", IFNULL(BP."CardName", D."Name") AS "BPName"
      FROM "PM_APPLYBP" A
      INNER JOIN "@PM_GRP_BP" G ON G."Code" = A."Code"
      INNER JOIN "PM_GRP_BP_DETAILS" D ON D."DocEntry" = G."DocEntry"
      LEFT JOIN "OCRD" BP ON ((D."Type"='B' AND BP."CardCode"=D."Code") OR (D."Type"='CG1' AND BP."U_CusGrp01"=D."Code") OR (D."Type"='CG2' AND BP."U_CusGrp02"=D."Code") OR (D."Type"='CG3' AND BP."U_CusGrp03"=D."Code"))
      WHERE A."Type" = 'UDO_PM_GRP_BP' AND IFNULL(D."Exclude",'N') <> 'Y' AND BP."U_CusGrp01"='GT' AND BP."U_CusGrp02" IN('GTSO','GTNO','GTSE','GTMK') AND BP."U_CusCCDept"='HCMD01'
    )`;

    const IT_SUB = `(
      SELECT DISTINCT S."DocEntry", CAST(NULL AS NVARCHAR(50)) AS "SellingGrpCode", CAST(NULL AS NVARCHAR(254)) AS "SellingGrpName", S."Code" AS "SellingItemCode", IFNULL(I."ItemName", S."Name") AS "SellingItemName", S."BreakBy", S."FrSelling", S."DiscountType", S."DiscountValue", S."FreeItemCode", IFNULL(F."ItemName", S."FreeItemName") AS "FreeItemName"
      FROM "PM_SELLING_ITEMS" S LEFT JOIN "OITM" I ON I."ItemCode"=S."Code" LEFT JOIN "OITM" F ON F."ItemCode"=S."FreeItemCode"
      WHERE S."Type"='4' AND I."U_ItemCat01" IN('D1','L1')
      UNION ALL
      SELECT DISTINCT S."DocEntry", G."Code" AS "SellingGrpCode", G."Name" AS "SellingGrpName", I."ItemCode" AS "SellingItemCode", IFNULL(I."ItemName", D."ItemName") AS "SellingItemName", S."BreakBy", S."FrSelling", S."DiscountType", S."DiscountValue", S."FreeItemCode", IFNULL(F."ItemName", S."FreeItemName") AS "FreeItemName"
      FROM "PM_SELLING_ITEMS" S
      INNER JOIN "@PM_GRP_ITEM" G ON G."Code"=S."Code"
      INNER JOIN "PM_GRP_ITEM_DETAILS" D ON D."DocEntry"=G."DocEntry"
      LEFT JOIN "OITM" I ON ((D."Type"='I' AND I."ItemCode"=D."Code") OR (D."Type"='IC1' AND I."U_ItemCat01"=D."Code") OR (D."Type"='IC2' AND I."U_ItemCat02"=D."Code") OR (D."Type"='IC3' AND I."U_ItemCat03"=D."Code") OR (D."Type"='IC4' AND I."U_ItemCat04"=D."Code") OR (D."Type"='IC5' AND I."U_ItemCat05"=D."Code") OR (D."Type"='IC6' AND I."U_ItemCat06"=D."Code"))
      LEFT JOIN "OITM" F ON F."ItemCode"=S."FreeItemCode"
      WHERE S."Type"='UDO_PM_GRP_ITEM' AND IFNULL(D."Exclude",'N') <> 'Y' AND I."U_ItemCat01" IN('D1','L1')
    )`;

    const sqlText = `SELECT DISTINCT H."DocEntry" AS "doc_entry", H."Code" AS "promotion_code", H."Name" AS "promotion_name", H."CreateDate" AS "create_date", H."UpdateDate" AS "update_date", H."U_StartDate" AS "begin_date", H."U_EndDate" AS "end_date", BP."BPGrpCode" AS "bp_grp_code", BP."BPGrpName" AS "bp_grp_name", BP."BPCode" AS "bp_code", BP."BPName" AS "bp_name", IT."SellingGrpCode" AS "selling_grp_code", IT."SellingGrpName" AS "selling_grp_name", IT."SellingItemCode" AS "selling_item_code", IT."SellingItemName" AS "selling_item_name", CASE WHEN IT."DiscountType"='P' THEN IT."DiscountValue" ELSE NULL END AS "disc_pct", CASE WHEN IFNULL(IT."BreakBy", H."U_BreakBy")='Q' THEN IT."FrSelling" ELSE NULL END AS "selling_qty", CASE WHEN IT."DiscountType"='I' THEN IT."FreeItemCode" ELSE NULL END AS "giving_item_code", CASE WHEN IT."DiscountType"='I' THEN IT."FreeItemName" ELSE NULL END AS "giving_item_name", CASE WHEN IT."DiscountType"='I' THEN IT."DiscountValue" ELSE NULL END AS "giving_qty" FROM "@PM_HEADER" H INNER JOIN ${BP_SUB} BP ON BP."DocEntry"=H."DocEntry" INNER JOIN ${IT_SUB} IT ON IT."DocEntry"=H."DocEntry" WHERE IFNULL(H."U_Status",'N')='R' AND IFNULL(H."Canceled",'N') <> 'Y' AND IFNULL(H."U_Prefix",'N')='GT' ORDER BY H."U_StartDate" DESC, H."Code", BP."BPGrpCode", BP."BPCode", IT."SellingGrpCode", IT."SellingItemCode"`;

    const sqlCode = 'PromoDiscSync';

    try {
      // Create or update the stored query
      try {
        await this.request('POST', '/SQLQueries', {
          SqlCode: sqlCode, SqlName: 'Promotion Discounts Sync', SqlText: sqlText,
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

      // Execute with pagination
      const allRows: any[] = [];
      let skip = 0;
      const top = 500;
      while (true) {
        const result = await this.request<{ value: any[] }>(
          'GET', `/SQLQueries('${sqlCode}')/List?$top=${top}&$skip=${skip}`
        );
        const rows = result.value || [];
        allRows.push(...rows);
        if (rows.length < top) break;
        skip += top;
      }
      console.log(`[SAP] Promotion query returned ${allRows.length} rows`);
      return allRows;
    } catch (error) {
      console.error('[SAP] executePromotionSql failed:', error);
      throw error;
    }
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
