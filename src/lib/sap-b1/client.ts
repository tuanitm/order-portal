import { Agent } from 'undici';
import { loadConfig, resolveEnvSecret } from '@/lib/config';

// SAP B1 Service Layer uses a self-signed certificate. Scope the relaxed TLS
// check to this client's own requests only — never disable it process-wide.
const insecureDispatcher = new Agent({ connect: { rejectUnauthorized: false } });

/** A single SQL string literal, with embedded single quotes escaped (doubled, the SQL-standard way). */
function toSqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** A SQL IN-list literal built from raw values — e.g. ["A","B"] -> "'A','B'". */
function toSqlList(values: string[]): string {
  return values.map(toSqlLiteral).join(",");
}

/**
 * A single OData $filter string literal, with embedded single quotes
 * escaped (doubled, the OData-standard way — happens to match
 * toSqlLiteral's escaping rule today, but kept separate since these are
 * two different query languages and there's no guarantee that stays true).
 * Used by every `$filter=...eq '<value>'`/`contains(field,'<value>')` built
 * in this file from a value that isn't already known-safe (a hardcoded
 * literal or an internal enum), rather than inlining
 * `value.replace(/'/g, "''")` at each call site.
 */
function toODataLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

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
  /** Default address names (BPAddresses.AddressName) and Sales Supervisor (U_MDM_CD_SEL04 code). */
  BilltoDefault?: string | null;
  ShipToDefault?: string | null;
  U_CusSEL04?: string | null;
  BPAddresses?: SapBpAddress[];
}

export interface SapBpAddress {
  AddressName: string;
  AddressType: "bo_BillTo" | "bo_ShipTo" | string;
  Street?: string | null;
  Block?: string | null;
  BuildingFloorRoom?: string | null;
  City?: string | null;
  County?: string | null;
  State?: string | null;
  ZipCode?: string | null;
  Country?: string | null;
}

/** One row of SAP user table U_MDM_CD_SEL04 — the Sales Supervisor value list. */
export interface SapSalesSupervisor {
  Code: string;
  Name: string | null;
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

/**
 * One row of OCRC (Distribution Rules / "Profit Centers" in this B1
 * version's own terminology) via the /ProfitCenters Service Layer entity.
 * InWhichDimension is the Distribution Rule dimension (1-5) it belongs to —
 * confirmed empirically: dimension 1 holds Brand codes (matching Items'
 * own U_ProdBrand UDF, e.g. "D1" = PIGEON), dimension 2 holds Department
 * codes (e.g. "HCMD19" = ECOM), and dimension 3 holds Customer codes —
 * CenterCode there IS the BusinessPartner's own CardCode (e.g. "GTSO0701"
 * = "CÔNG TY TNHH GIA PHẠM P & T"), one-to-one, confirmed empirically.
 */
export interface SapProfitCenter {
  CenterCode: string;
  CenterName: string;
  InWhichDimension: number;
  Active: string; // BoYesNoEnum: 'tYES' | 'tNO'
}

/** One row of src.OITW (Item-Warehouse stock) via SQLQueries — see getInventoryStock. */
export interface SapInventoryStockRow {
  item_code: string;
  warehouse_code: string;
  in_stock: number;
  committed: number;
  ordered: number;
}

/** One batch's on-hand qty + dates (OBTQ join OBTN) via SQLQueries — see getBatchStock. Dates come back as "YYYYMMDD" strings. */
export interface SapBatchStockRow {
  item_code: string;
  warehouse_code: string;
  qty: number;
  mnf_date: string | null;
  exp_date: string | null;
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
  /** Brand UDF — same code space as ProfitCenters where InWhichDimension=1 (e.g. "D1" = PIGEON). */
  U_ProdBrand?: string | null;
  /** NOT the same field name as a Sales Order line's own VatGroup despite meaning the same thing. */
  SalesVATGroup?: string | null;
  U_ItemTaxClass?: string | null;
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
  /** Brand UDF on the header — see POST /api/admin/orders/[id]/confirm for
   * how it's resolved when an order's lines span more than one brand. */
  U_ProdBrand?: string;
  // U_DocNo deliberately not modeled — it's generated server-side by SAP's
  // own SBO_SP_TransactionNotification trigger after the Sales Order is
  // added (format SOO+YYMMDD+3-digit running number, e.g. "SOO261015015"),
  // not something this client sets. See POST .../confirm.
  /** "Y" if this order has at least one Promotion Discount line (CK99999999), else unset. */
  U_GetPMStatus?: string;
  /** The customer BusinessPartner's own EmailAddress/Address/FederalTaxID/CardName — see POST .../confirm. */
  U_InvEmail?: string;
  /** Always the literal "TM/CK" — not looked up from anywhere. */
  U_BPPaymentMethod?: string;
  U_InvAddress?: string;
  U_InvTaxNo?: string;
  U_InvName?: string;
  /** Portal order number (e.g. SO-GTSO0701-261015-503) — stamped onto the SAP
   * Sales Order header so the portal reference is visible in SAP. */
  U_RelDocs?: string;
  /** SAP B1's "Owner" authorization field (General Authorization's
   * "Read Own Records Only" restriction checks THIS, not the Service Layer
   * login that created the document) — the confirming admin's own Employee,
   * resolved via SapB1Client.resolveOrderOwner. */
  DocumentsOwner?: number;
  /** LastName + " " + FirstName of the same Employee as DocumentsOwner — see resolveOrderOwner. */
  U_OwnerName?: string;
  /** Bill-to / ship-to address names (BPAddresses.AddressName) picked in the admin "Self create" dialog. */
  PayToCode?: string;
  ShipToCode?: string;
  /** Sales Supervisor (value list: user table U_MDM_CD_SEL04). */
  U_CusSEL04?: string;
  DocumentLines: {
    ItemCode: string;
    /** Only set for the synthetic Contract/Promotion Discount lines (see
     * POST .../confirm) — every other line leaves this unset and gets
     * the item master's own default description. */
    ItemDescription?: string;
    Quantity: number;
    UnitPrice?: number;
    DiscountPercent?: number;
    WarehouseCode?: string;
    ShipDate?: string;
    // Distribution Rule dimension 1 (Brand) — revenue and COGS. NOTE: the
    // Service Layer JSON property names (confirmed empirically by reading
    // back a real posted line) are CostingCode/COGSCostingCode, NOT the
    // underlying RDR1 SQL column names (OcrCode/CogsOcrCo) — Service Layer
    // silently drops unrecognized property names instead of erroring, so
    // using the wrong ones here looks like success but writes nothing.
    CostingCode?: string;
    COGSCostingCode?: string;
    /** Distribution Rule dimension 2 (Department) — revenue and COGS. */
    CostingCode2?: string;
    COGSCostingCode2?: string;
    /** Distribution Rule dimension 3 (Customer, CenterCode == CardCode) — revenue and COGS. */
    CostingCode3?: string;
    COGSCostingCode3?: string;
    /** Required remaining shelf-life % range (UDFs) — see customer_require_shelflife. */
    U_ReqSLFrom?: number;
    U_ReqSLTo?: number;
    /** NOT the RDR1 SQL column name (VatPrcnt) — "VatGroup" IS the real
     * Service Layer property, confirmed empirically. Only set explicitly
     * on Contract/Promotion Discount lines, whose own item master VatGroup
     * (CK99999998/CK99999999's SalesVATGroup) differs from a real item's. */
    VatGroup?: string;
    // ── "Period Management" add-on UDFs — field names verified against a
    // real posted order before use (see POST .../confirm). U_SONo is NOT
    // modeled — it mirrors the header's own U_DocNo, which SAP's
    // SBO_SP_TransactionNotification trigger generates server-side AFTER
    // the Sales Order is added, so there's nothing for this client to set. ──
    U_SODate?: string;
    /** Null/omitted for real inventory lines; the BUY item's own code for every other line. */
    U_PM_BaseItem?: string;
    /** `{buyLine'sOwnLineNum}-{buyItemCode}` — same value for every line derived from one buy line. */
    U_PM_BaseLine?: string;
    U_INVDesc?: string;
    U_SortField?: string;
    /** 98 = Contract Discount, 20 = Promotion Discount, 31 = free/gift item. Unset for real inventory lines. */
    U_PM_Type?: string;
    U_PM_HavingSetupPrrt?: string;
    /** Promotion code — ONLY set on Promotion Discount lines, never on gift lines (which get U_CTKM_NAME only). */
    U_CTKM?: string;
    U_CTKM_NAME?: string;
    U_PM_FreeQty?: number;
    U_PM_DiscPercent?: number;
    U_PM_DiscAmount?: number;
    U_PM_DiscPrice?: number;
    U_PM_PriceBefFix?: number;
    U_PM_FixPrice?: number;
    /** Shared across every line derived from the same buy/inventory line. */
    U_PM_GUID?: string;
    U_PM_PrrtPMApplied?: number;
    /** Real inventory/free-item lines only — items.item_tax_class, synced from Items.U_ItemTaxClass. */
    U_ItemTaxClass?: string;
  }[];
}

export interface SapDocumentResponse {
  DocEntry: number;
  DocNum: number;
}

/** Minimal shape returned by the FederalTaxID duplicate check — see findBusinessPartnerByTaxId. */
export interface SapBusinessPartnerTaxMatch {
  CardCode: string;
  CardName: string;
  FederalTaxID: string | null;
}

/** Which SAP Employee a pushed Sales Order's DocumentsOwner/U_OwnerName header fields should carry — see resolveOrderOwner. */
export interface SapOrderOwner {
  /** EmployeesInfo.EmployeeID — posted as the order's DocumentsOwner. */
  employeeId: number;
  /** LastName + " " + FirstName — posted as the order's U_OwnerName UDF.
   *  Undefined (not "") when the Employee has neither name part set, so a
   *  caller's `|| undefined` chain omits U_OwnerName entirely rather than
   *  sending an empty string alongside a real DocumentsOwner. */
  ownerName: string | undefined;
}

/** POST /BusinessPartners body for registering a brand-new company (not yet a SAP BP). */
export interface CreateBusinessPartnerPayload {
  CardCode: string;
  CardName: string;
  CardType: 'cCustomer';
  FederalTaxID: string;
  GroupCode: number;
  U_CusGrp01: string;
  U_CusGrp02: string;
  U_CusGrp03: string;
  PriceListNum: number;
  PayTermsGrpCode: number;
  CreditLimit: number;
  SalesPersonCode?: number;
  Currency?: string;
  EmailAddress?: string;
  BPAddresses: {
    AddressName: string;
    AddressType: 'bo_BillTo' | 'bo_ShipTo';
    Street: string;
    City?: string;
  }[];
  ContactEmployees: {
    Name: string;
    E_Mail?: string;
    Phone1?: string;
  }[];
}

// ── SAP B1 Service Layer Client ──

export class SapB1Client {
  private baseUrl: string;
  private companyDB: string;
  private userName: string;
  private password: string;
  private sessionId: string | null = null;
  private loginPromise: Promise<void> | null = null;
  /** Memoized result of resolveOrderOwner's fallback lookup (the
   *  integration login's own linked Employee) — that Employee doesn't
   *  change during this client's process lifetime, so there's no reason
   *  to re-run its two SAP round trips on every single order confirmation
   *  that doesn't resolve via an admin's own owner_code. Only a SUCCESSFUL
   *  resolution is cached — a transient failure (or a genuine "no Employee
   *  linked yet") is deliberately left uncached so it keeps retrying on
   *  the next push instead of getting stuck null for the rest of the
   *  process's life over what might have been a one-off SAP hiccup. */
  private fallbackOwnerCache: SapOrderOwner | null = null;

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

    const usedSessionId = this.sessionId;
    if (this.sessionId) {
      headers['Cookie'] = `B1SESSION=${this.sessionId}`;
    }

    let response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      dispatcher: insecureDispatcher,
    } as RequestInit);

    // If session expired or invalid (401), re-authenticate once and retry
    if (response.status === 401) {
      console.warn('[SAP] Session expired or invalid (401), re-authenticating...');
      if (this.sessionId === usedSessionId) {
        this.sessionId = null;
      }
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
   * Login to SAP B1 Service Layer (deduplicated across concurrent callers)
   */
  async login(): Promise<void> {
    if (this.loginPromise) {
      return this.loginPromise;
    }

    this.loginPromise = (async () => {
      try {
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
      } finally {
        this.loginPromise = null;
      }
    })();

    return this.loginPromise;
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
   * Look up a Business Partner live by FederalTaxID (MST) — the new-company
   * registration flow's duplicate check (see POST /api/auth/signup and
   * POST /api/admin/customers/[id]/create-bp). Unlike getBusinessPartner,
   * this deliberately THROWS rather than swallowing errors into `null`: a
   * failed duplicate check must never be silently treated as "no match
   * found", which would risk creating a duplicate BP if SAP is briefly
   * unreachable.
   */
  async findBusinessPartnerByTaxId(taxId: string): Promise<SapBusinessPartnerTaxMatch | null> {
    await this.ensureSession();
    const filter = encodeURIComponent(`FederalTaxID eq ${toODataLiteral(taxId)}`);
    const select = encodeURIComponent('CardCode,CardName,FederalTaxID');
    const result = await this.request<{ value: SapBusinessPartnerTaxMatch[] }>(
      'GET',
      `/BusinessPartners?$filter=${filter}&$select=${select}&$top=1`
    );
    return result.value?.[0] || null;
  }

  /**
   * BP Group Code / Payment Terms Code copied from an existing customer in
   * the same Customer Group 3 — these are admin-hidden on the new-company
   * registration dialog and instead derived from a sibling BP (see POST
   * /api/admin/customers/[id]/create-bp). Returns null if no existing BP
   * carries this U_CusGrp03 yet (e.g. the very first customer in a brand
   * new group) — the caller must surface that as an error, not guess.
   */
  async findBpCommercialDefaultsByGroup3(cusGrp03: string): Promise<{ GroupCode: number; PayTermsGrpCode: number } | null> {
    await this.ensureSession();
    const filter = encodeURIComponent(`CardType eq 'cCustomer' and U_CusGrp03 eq ${toODataLiteral(cusGrp03)}`);
    const select = encodeURIComponent('GroupCode,PayTermsGrpCode');
    const result = await this.request<{ value: { GroupCode: number; PayTermsGrpCode: number }[] }>(
      'GET',
      `/BusinessPartners?$filter=${filter}&$select=${select}&$top=1`
    );
    return result.value?.[0] || null;
  }

  /**
   * Highest existing CardCode starting with `prefix`, queried live against
   * SAP (not the local `customers` cache) so a newly-generated CardCode
   * can't collide with a BP created since the last sync. CardCodes under
   * one prefix are fixed-length, so lexicographic ($orderby) order matches
   * numeric order. Returns null if none exist yet — see generateCardCode
   * in src/lib/sap-b1/cardCode.ts for the increment/pad logic.
   */
  async findMaxCardCodeWithPrefix(prefix: string): Promise<string | null> {
    await this.ensureSession();
    const filter = encodeURIComponent(`startswith(CardCode,${toODataLiteral(prefix)})`);
    const result = await this.request<{ value: { CardCode: string }[] }>(
      'GET',
      `/BusinessPartners?$filter=${filter}&$select=CardCode&$orderby=CardCode desc&$top=1`
    );
    return result.value?.[0]?.CardCode || null;
  }

  /** EmployeesInfo row shape needed by both owner-resolution lookups below.
   *  Always scoped to Active eq 'tYES' — a terminated Employee should never
   *  be posted as an order's Owner, even if an admin's owner_code (or the
   *  integration login's ApplicationUserID link) still points at one. */
  private async findEmployeeInfo(filter: string): Promise<SapOrderOwner | null> {
    const select = encodeURIComponent('EmployeeID,FirstName,LastName');
    const result = await this.request<{ value: { EmployeeID: number; FirstName: string | null; LastName: string | null }[] }>(
      'GET',
      `/EmployeesInfo?$filter=${encodeURIComponent(`(${filter}) and Active eq 'tYES'`)}&$select=${select}&$top=1`
    );
    const row = result.value?.[0];
    if (!row) return null;
    return { employeeId: row.EmployeeID, ownerName: [row.LastName, row.FirstName].filter(Boolean).join(' ') || undefined };
  }

  /**
   * Resolves which SAP Employee a pushed Sales Order's DocumentsOwner/
   * U_OwnerName header fields should carry (see POST
   * /api/admin/orders/[id]/confirm). Two-step, in order:
   *  1. If `ownerCode` is given (an admin's own admin_users.owner_code),
   *     look up the Employee (EmployeesInfo/OHEM) whose EmployeeCode —
   *     Human Resources > Employee Master Data's own "Code"/"Employee
   *     Code" field, confirmed empirically (verified live: EmployeeCode
   *     "VNIMVHCM807376" -> EmployeeID 147) — matches it exactly. NOT
   *     ExternalEmployeeNumber (that field is unused/always null in this
   *     company) nor the primary-key EmployeeID itself (numeric only,
   *     can't hold a code like this). Several admins may share one code,
   *     pointing at the same Employee.
   *  2. Otherwise, or if no ACTIVE Employee has that EmployeeCode, fall
   *     back to the Employee linked to THIS client's own shared Service
   *     Layer login (config.json's sapb1.userId, e.g. "admin02") via
   *     Users.UserCode -> Users.InternalKey -> EmployeesInfo.ApplicationUserID
   *     — memoized in fallbackOwnerCache, since that Employee can't change
   *     within this client's process lifetime.
   * Returns null if neither step finds an Employee at all (e.g. the
   * integration login itself has no linked Employee yet) — the caller
   * should then just omit DocumentsOwner/U_OwnerName from the push rather
   * than block it; this never throws (ensureSession included — a login
   * failure here is just another reason to return null, not a hard error).
   */
  async resolveOrderOwner(ownerCode: string | null | undefined): Promise<SapOrderOwner | null> {
    try {
      await this.ensureSession();

      if (ownerCode) {
        const byCode = await this.findEmployeeInfo(`EmployeeCode eq ${toODataLiteral(ownerCode)}`);
        if (byCode) return byCode;
      }

      if (this.fallbackOwnerCache) return this.fallbackOwnerCache;

      const userResult = await this.request<{ value: { InternalKey: number }[] }>(
        'GET',
        `/Users?$filter=${encodeURIComponent(`UserCode eq ${toODataLiteral(this.userName)}`)}&$select=InternalKey&$top=1`
      );
      const internalKey = userResult.value?.[0]?.InternalKey;
      if (internalKey === undefined) return null;

      const fallback = await this.findEmployeeInfo(`ApplicationUserID eq ${internalKey}`);
      if (fallback) this.fallbackOwnerCache = fallback;
      return fallback;
    } catch (error) {
      console.error('[SAP] Failed to resolve order owner:', error);
      return null;
    }
  }

  /**
   * Create a new Business Partner (CardType cCustomer) — the new-company
   * registration flow's final step, called once an admin has assigned the
   * commercial fields and the CardCode has been generated (see
   * POST /api/admin/customers/[id]/create-bp).
   */
  async createBusinessPartner(payload: CreateBusinessPartnerPayload): Promise<{ CardCode: string }> {
    await this.ensureSession();
    return this.request<{ CardCode: string }>('POST', '/BusinessPartners', payload);
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
        'CardCode,CardName,FederalTaxID,Phone1,EmailAddress,Address,PriceListNum,U_CusGrp01,U_CusGrp02,U_CusGrp03,' +
          'BilltoDefault,ShipToDefault,U_CusSEL04,BPAddresses'
      );
      const pairFilter = params.pairs
        .map((p) => `(U_CusGrp01 eq ${toODataLiteral(p.cat1)} and U_CusGrp02 eq ${toODataLiteral(p.cat2)})`)
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
   * Every Sales Supervisor (user table U_MDM_CD_SEL04 — the value list behind
   * the U_CusSEL04 field on business partners and sales orders), all pages.
   */
  async getSalesSupervisors(): Promise<SapSalesSupervisor[]> {
    await this.ensureSession();
    const all: SapSalesSupervisor[] = [];
    for (let skip = 0; ; ) {
      const result = await this.request<{ value: SapSalesSupervisor[] }>(
        'GET',
        `/U_MDM_CD_SEL04?$select=Code,Name&$orderby=Code&$skip=${skip}`
      );
      const page = result.value || [];
      if (page.length === 0) break;
      all.push(...page);
      skip += page.length;
    }
    return all;
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
   * Get Distribution Rule codes ("Profit Centers") for one dimension (1 =
   * Brand, 2 = Department, ...) — see syncCostCenters.
   */
  async getProfitCenters(dimension: number): Promise<SapProfitCenter[]> {
    await this.ensureSession();
    const out: SapProfitCenter[] = [];
    let path: string | null =
      `/ProfitCenters?$select=CenterCode,CenterName,InWhichDimension,Active&$filter=${encodeURIComponent(`InWhichDimension eq ${dimension}`)}`;
    while (path) {
      const result: { value: SapProfitCenter[]; 'odata.nextLink'?: string } = await this.request('GET', path);
      out.push(...(result.value || []));
      path = result['odata.nextLink'] ? `/${result['odata.nextLink']}` : null;
    }
    return out;
  }

  /**
   * Create-or-update a named SQLQueries object and page through its /List
   * result in full — shared by every SQLQueries-based puller (inventory
   * stock, batch expiry, ...). Service Layer caps the actual page size
   * server-side (often 20) regardless of the requested $top, so this
   * advances by what came back, not the requested page size, and stops
   * only on an empty page — same gotcha as getItems' own pagination.
   */
  private async runSqlQuery<T>(sqlCode: string, sqlName: string, sqlText: string): Promise<T[]> {
    await this.ensureSession();
    try {
      try {
        await this.request('POST', '/SQLQueries', { SqlCode: sqlCode, SqlName: sqlName, SqlText: sqlText });
        console.log('[SAP] Created SQLQuery', sqlCode);
      } catch (createErr: any) {
        // Whatever the exact reason the create failed (SAP's own "already
        // exists" error doesn't always come back with a message containing
        // "400" — e.g. under the concurrent-caller race this SqlCode reuse
        // can produce), fall back to PATCH rather than only on that one
        // specific substring match. Only if the PATCH itself also fails is
        // this truly unrecoverable.
        try {
          await this.request('PATCH', `/SQLQueries('${sqlCode}')`, { SqlText: sqlText });
          console.log('[SAP] Updated SQLQuery', sqlCode);
        } catch {
          throw createErr;
        }
      }

      const allRows: T[] = [];
      let skip = 0;
      const top = 500;
      for (;;) {
        const result = await this.request<{ value: T[] }>(
          'GET', `/SQLQueries('${sqlCode}')/List?$top=${top}&$skip=${skip}`
        );
        const rows = result.value || [];
        if (rows.length === 0) break;
        allRows.push(...rows);
        skip += rows.length;
      }
      console.log(`[SAP] SQLQuery ${sqlCode} returned ${allRows.length} rows`);
      return allRows;
    } catch (error) {
      console.error(`[SAP] SQLQuery ${sqlCode} failed:`, error);
      throw error;
    }
  }

  /**
   * Get per-item, per-warehouse on-hand/committed/on-order stock straight
   * from OITW via SQLQueries — the OData ItemWarehouseInfoCollection on
   * /Items returns ~55 full GL-account-laden objects per item (one per
   * warehouse), far too heavy to fold into the regular items sync, so this
   * goes directly at the lean source table instead, same pattern as
   * executePromotionSql. Rows where on-hand/committed/on-order are all zero
   * are skipped server-side (most item×warehouse combinations are).
   *
   * Scoped by config.json's masterdata.itemGroup (checked against OITM's
   * U_ItemCat01/02, same two-level check as the item/customer group syncs)
   * and masterdata.wareHouse (checked against WhsCode) — both ready-made
   * SQL IN-list literals, e.g. "'D1','L1'".
   */
  async getInventoryStock(itemGroupFilter: string, warehouseFilter: string): Promise<SapInventoryStockRow[]> {
    const sqlText = `SELECT T0."ItemCode" AS "item_code", T0."WhsCode" AS "warehouse_code", T0."OnHand" AS "in_stock", T0."IsCommited" AS "committed", T0."OnOrder" AS "ordered" FROM "OITW" T0 INNER JOIN "OITM" T1 ON T1."ItemCode" = T0."ItemCode" WHERE (T0."OnHand" <> 0 OR T0."IsCommited" <> 0 OR T0."OnOrder" <> 0) AND (T1."U_ItemCat01" IN (${itemGroupFilter}) OR T1."U_ItemCat02" IN (${itemGroupFilter})) AND T0."WhsCode" IN (${warehouseFilter}) ORDER BY T0."ItemCode", T0."WhsCode"`;
    return this.runSqlQuery<SapInventoryStockRow>('InventoryStockSync', 'Inventory Stock Sync', sqlText);
  }

  /**
   * Get raw per-batch on-hand quantity + manufacture/expiration dates
   * (OBTQ joined to OBTN by (ItemCode, SysNumber) — NOT DistNumber, which
   * OBTQ doesn't carry; confirmed empirically) for every batch with
   * Quantity > 0, scoped the same way as getInventoryStock. The %
   * remaining-shelf-life itself is computed in JS (syncInventoryStock), not
   * here — SAP's SQLQueries engine rejects CASE expressions and arithmetic
   * operators in the SELECT list outright ("Cannot support the case
   * expression" / "mismatched input '*'"), confirmed empirically, so this
   * can only ever return raw columns.
   */
  async getBatchStock(itemGroupFilter: string, warehouseFilter: string): Promise<SapBatchStockRow[]> {
    const sqlText = `SELECT Q."ItemCode" AS "item_code", Q."WhsCode" AS "warehouse_code", Q."Quantity" AS "qty", B."MnfDate" AS "mnf_date", B."ExpDate" AS "exp_date" FROM "OBTQ" Q INNER JOIN "OBTN" B ON B."ItemCode" = Q."ItemCode" AND B."SysNumber" = Q."SysNumber" INNER JOIN "OITM" I ON I."ItemCode" = Q."ItemCode" WHERE Q."Quantity" > 0 AND Q."WhsCode" IN (${warehouseFilter}) AND (I."U_ItemCat01" IN (${itemGroupFilter}) OR I."U_ItemCat02" IN (${itemGroupFilter})) ORDER BY Q."ItemCode", Q."WhsCode"`;
    return this.runSqlQuery<SapBatchStockRow>('BatchStockSync', 'Batch Stock Sync', sqlText);
  }

  /**
   * Live (uncached) on-hand/committed stock for ONE warehouse, restricted
   * to an explicit list of item codes — used by the admin Order Review
   * page's "Avail Qty" check, which needs a fresh read for just the items
   * on one order rather than the whole catalog (unlike getInventoryStock,
   * which is the scheduled whole-catalog sync into item_warehouse_stock).
   *
   * `sqlCodeSuffix` (the order id) scopes the underlying SQLQueries object
   * per order, not a single name shared by every call — two admins
   * reviewing different orders at once used to be able to overwrite each
   * other's query text before reading it back (occasionally surfacing as
   * an outright request failure, not just wrong data, since SAP's retry
   * path didn't always recognize the resulting conflict as recoverable).
   */
  async getLiveItemStock(warehouseCode: string, itemCodes: string[], sqlCodeSuffix: string | number): Promise<SapInventoryStockRow[]> {
    if (itemCodes.length === 0) return [];
    const sqlText = `SELECT T0."ItemCode" AS "item_code", T0."WhsCode" AS "warehouse_code", T0."OnHand" AS "in_stock", T0."IsCommited" AS "committed", T0."OnOrder" AS "ordered" FROM "OITW" T0 WHERE T0."WhsCode" = ${toSqlLiteral(warehouseCode)} AND T0."ItemCode" IN (${toSqlList(itemCodes)})`;
    return this.runSqlQuery<SapInventoryStockRow>(`OSC${sqlCodeSuffix}`, 'Order Review Stock Check', sqlText);
  }

  /**
   * Live (uncached) per-batch on-hand qty + dates for ONE warehouse,
   * restricted to an explicit list of item codes — same scope as
   * getLiveItemStock (including the per-order `sqlCodeSuffix`), used to
   * compute the shelf-life-qualifying portion of that stock for the admin
   * Order Review page.
   */
  async getLiveBatchStock(warehouseCode: string, itemCodes: string[], sqlCodeSuffix: string | number): Promise<SapBatchStockRow[]> {
    if (itemCodes.length === 0) return [];
    const sqlText = `SELECT Q."ItemCode" AS "item_code", Q."WhsCode" AS "warehouse_code", Q."Quantity" AS "qty", B."MnfDate" AS "mnf_date", B."ExpDate" AS "exp_date" FROM "OBTQ" Q INNER JOIN "OBTN" B ON B."ItemCode" = Q."ItemCode" AND B."SysNumber" = Q."SysNumber" WHERE Q."Quantity" > 0 AND Q."WhsCode" = ${toSqlLiteral(warehouseCode)} AND Q."ItemCode" IN (${toSqlList(itemCodes)})`;
    return this.runSqlQuery<SapBatchStockRow>(`OBC${sqlCodeSuffix}`, 'Order Review Batch Check', sqlText);
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
        "U_ItemCat01,U_ItemCat02,U_ItemCat03,U_ItemCat04,U_ItemCat05,U_ItemCat06,U_ProdBrand,SalesVATGroup,U_ItemTaxClass";
      queryParts.push(`$select=${encodeURIComponent(select)}`);

      if (params?.top) queryParts.push(`$top=${params.top}`);
      if (params?.skip) queryParts.push(`$skip=${params.skip}`);

      const filters: string[] = ["Valid eq 'tYES'"];
      if (params?.itemCatPairs && params.itemCatPairs.length > 0) {
        filters.push(
          `(${params.itemCatPairs
            .map((p) => `(U_ItemCat01 eq ${toODataLiteral(p.cat1)} and U_ItemCat02 eq ${toODataLiteral(p.cat2)})`)
            .join(' or ')})`
        );
      }
      if (params?.filter) filters.push(params.filter);
      if (params?.search) {
        const searchLiteral = toODataLiteral(params.search);
        filters.push(
          `(contains(ItemCode,${searchLiteral}) or contains(ItemName,${searchLiteral}))`
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
      const filter = encodeURIComponent(`CardCode eq ${toODataLiteral(cardCode)}`);
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
  async getContractDiscounts(params: { top: number; skip: number; filter?: string }): Promise<SapContractDiscount[]> {
    await this.ensureSession();
    try {
      const queryParts = [`$top=${params.top}`, `$skip=${params.skip}`];
      if (params.filter) queryParts.push(`$filter=${encodeURIComponent(params.filter)}`);
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
   * Create a confirmed Sales Order directly in SAP B1 (bypasses the Draft
   * stage — used when Post SO Mode is set to "Sales Order").
   * U_DocNo is still generated server-side by SAP's SBO_SP_TransactionNotification.
   */
  async createSalesOrder(draft: SapSalesOrderDraft): Promise<SapDocumentResponse> {
    await this.ensureSession();
    return this.request<SapDocumentResponse>('POST', '/Orders', draft);
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
   * Delete a Draft Sales Order by DocEntry — used when an admin cancels an
   * order that's already been pushed to SAP (see POST
   * /api/admin/orders/[id]/cancel). A Draft (ObjectType 112) is just a
   * proposal sitting in SAP, not yet a real committed Sales Order — it
   * never reserved stock or posted anything — so deleting it outright is
   * the correct cleanup, not a "Cancel" action (which only applies to real
   * documents like Sales Orders/Invoices). Without this, a cancelled-in-
   * the-portal order would leave its Draft sitting in SAP, where someone
   * could still "Add" it there and create a real order the portal thinks
   * doesn't exist.
   */
  async deleteDraftSalesOrder(docEntry: number): Promise<void> {
    await this.ensureSession();
    await this.request<void>('DELETE', `/Drafts(${docEntry})`);
  }

  /**
   * Get a confirmed Sales Order's key status fields — used to sync U_DocNo
   * (e.g. "SOO261015001") and DocStatus back to the portal after the draft is
   * approved in SAP and becomes a real Sales Order.
   *
   * Strategy (Draft DocEntry ≠ Sales Order DocEntry in SAP B1):
   *   1. Filter /Orders by U_RelDocs eq '<portalOrderNumber>' — unique per order.
   *   2. Fallback: /Orders(docEntry) for legacy orders before U_RelDocs was added.
   */
  async getSalesOrderStatus(
    docEntry: number,
    orderNumber?: string | null,
  ): Promise<{
    DocEntry: number;
    DocNum: number;
    U_DocNo: string | null;
    DocStatus: string | null;
    Cancelled: string | null;
  } | null> {
    await this.ensureSession();
    type Row = { DocEntry: number; DocNum: number; U_DocNo: string | null; DocStatus: string | null; Cancelled: string | null; };

    // ── Attempt 1: filter by U_RelDocs (portal order number) ──────────────
    if (orderNumber) {
      try {
        const filter = encodeURIComponent(`U_RelDocs eq ${toODataLiteral(orderNumber)}`);
        const listResult = await this.request<{ value: Row[] }>(
          'GET',
          `/Orders?$filter=${filter}&$top=1`
        );
        if (listResult?.value?.length) {
          console.log(`[SAP] Found SO for ${orderNumber} via U_RelDocs (DocEntry=${listResult.value[0].DocEntry})`);
          return listResult.value[0];
        }
        console.log(`[SAP] No SO found by U_RelDocs='${orderNumber}' yet`);
      } catch (error) {
        console.warn(`[SAP] U_RelDocs filter failed, trying DocEntry fallback:`, error);
      }
    }

    // ── Attempt 2: direct DocEntry lookup (legacy / fallback) ─────────────
    try {
      const result = await this.request<Row>('GET', `/Orders(${docEntry})`);
      if (result) {
        console.log(`[SAP] Found SO via DocEntry=${docEntry}`);
        return result;
      }
    } catch (error) {
      const status = (error as { httpStatus?: number })?.httpStatus;
      if (status !== 404) {
        console.error(`[SAP] getSalesOrderStatus DocEntry=${docEntry} failed:`, error);
      }
    }

    return null;
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
