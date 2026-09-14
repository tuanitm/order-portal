import { readFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

// Allow self-signed SSL certificates for SAP B1 Service Layer
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

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
}

export interface SapItem {
  ItemCode: string;
  ItemName: string;
  QuantityOnStock: number;
  SalesUnit: string;
  ItemPrices: { PriceList: number; Price: number }[];
  U_ImageUrl?: string; // UDF for item image
  ItemsGroupCode: number;
  Valid: string;
}

export interface SapSpecialPrice {
  ItemCode: string;
  CardCode: string;
  Price: number;
  Discount: number;
  UoMEntry: number;
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
    const configPath = join(process.cwd(), 'config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    const sapConfig = config.sapb1;

    this.baseUrl = sapConfig.baseUrl;
    this.companyDB = sapConfig.companyID;
    this.userName = sapConfig.userId;

    // Decrypt SAP password from .env
    const envPath = join(process.cwd(), '.env');
    const envContent = readFileSync(envPath, 'utf-8');
    const match = envContent.match(/SAPB1_PASSWORD=["']?([^"'\r\n]+)["']?/);
    const encryptedPass = match ? match[1].replace(/^FERNET:/, '') : '';

    if (encryptedPass.startsWith('gAAAAA')) {
      const keyPath = join(process.cwd(), 'scripts', '.encryption_key');
      try {
        this.password = execSync(
          `python -c "import sys; from cryptography.fernet import Fernet; key = open(r'${keyPath}','rb').read(); f = Fernet(key); print(f.decrypt(b'${encryptedPass}').decode(), end='')"`,
          { encoding: 'utf-8', timeout: 10000 }
        ).trim();
      } catch {
        console.error('[SAP] Failed to decrypt SAP password');
        this.password = '';
      }
    } else {
      this.password = encryptedPass;
    }


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

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

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
    });

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
      const select = encodeURIComponent('CardCode,CardName,CardType,FederalTaxID,Phone1,EmailAddress,Address');
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
      return await this.request<SapBusinessPartner>(
        'GET',
        `/BusinessPartners('${cardCode}')`
      );
    } catch (error) {
      console.error('[SAP] Failed to get BP:', error);
      return null;
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
  }): Promise<SapItem[]> {
    await this.ensureSession();
    try {
      const queryParts: string[] = [];
      const select = "ItemCode,ItemName,SalesUnit,ItemPrices,U_ImageUrl,ItemsGroupCode,Valid";
      queryParts.push(`$select=${encodeURIComponent(select)}`);

      if (params?.top) queryParts.push(`$top=${params.top}`);
      if (params?.skip) queryParts.push(`$skip=${params.skip}`);

      const filters: string[] = ["Valid eq 'tYES'"];
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
    } catch (error) {
      console.error('[SAP] Failed to get items:', error);
      return [];
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
   * Create a Draft Sales Order in SAP B1
   */
  async createDraftSalesOrder(draft: SapSalesOrderDraft): Promise<SapDocumentResponse> {
    await this.ensureSession();
    return this.request<SapDocumentResponse>('POST', '/Drafts', draft);
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
