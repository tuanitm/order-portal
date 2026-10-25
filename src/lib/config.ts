import { readFileSync, statSync } from "fs";
import { execSync } from "child_process";
import { join } from "path";

export interface AppConfig {
  email: {
    emailEnable: string;
    smtpServer: string;
    smtpPort: number;
    useSsl: boolean;
    smtpUser: string;
    smtpPass: string;
    senderEmail: string;
    senderName: string;
  };
  sapb1: {
    baseUrl: string;
    companyID: string;
    userId: string;
    passWrd: string;
  };
  admin: {
    /** Shown in front of the portal name, e.g. "IMV - Ordering Portal". Optional. */
    companyPrefix?: string;
    /** This deployment's multi-tenant key — every row this instance writes
     *  is tagged with it, and every query this instance runs is scoped to
     *  it, so several app instances can share one MySQL database/table set
     *  without seeing each other's data (see getCompanyId()). Deliberately
     *  separate from sapb1.companyID, which is only the SAP Service Layer
     *  login identifier for which SAP company database to connect to. */
    entityID: string;
    email: string;
    password: string;
    /** "Yes"/"No" — whether the storefront shows the available-stock line on
     *  product cards. Optional; shown by default (see isShowAvailableEnabled). */
    showAvailable?: string;
    /** "Yes"/"No" — whether the storefront shows a Discount 1/Discount 2
     *  breakdown tooltip on hover (Discount 1 = contract discount %,
     *  Discount 2 = promotion discount % — labeled generically, never by
     *  their real discount-type names). Optional; hidden by default (see
     *  isShowDiscountsEnabled). */
    showDiscounts?: string;
  };
  mysql: {
    dbIp: string;
    dbPort: number;
    dbName: string;
    dpUser: string;
    encrypted: boolean;
  };
  /** Direct SAP HANA connection (bypasses SAP B1 Service Layer/the app-level
   *  "Query Generator Authorization" restriction entirely) — read-only,
   *  used only for data Service Layer has no access path for at all, e.g.
   *  Promotion Discounts (see src/lib/hana). `hostname` is "host:port". */
  hanadb: {
    hostname: string;
    schema: string;
    userId: string;
    passWrd: string;
  };
  /** SQL-literal filter lists (already comma-separated and quoted, e.g.
   *  "'GT'" or "'D1','L1'") spliced directly into master-data sync queries'
   *  WHERE clauses — see getCustomerGroupHierarchy in sap-b1/client.ts. */
  masterdata: {
    customerGroup: string;
    itemGroup: string;
    wareHouse: string;
    priceList?: string;
  };
  /** Web Push VAPID keypair — publicKey is sent to the browser (not
   *  secret), privateKey stays server-side (see src/lib/webPush.ts). */
  webPush: {
    publicKey: string;
    privateKey: string;
    /** Contact URI required by the Web Push protocol, e.g. "mailto:agent@imv.com.vn". */
    subject: string;
  };
}

let cachedConfig: AppConfig | null = null;
let cachedConfigMtime = 0;

/** Load config.json from the project root (reloads if file modified). */
export function loadConfig(): AppConfig {
  const configPath = join(process.cwd(), "config.json");
  try {
    const mtime = statSync(configPath).mtimeMs;
    if (!cachedConfig || mtime !== cachedConfigMtime) {
      cachedConfig = JSON.parse(readFileSync(configPath, "utf-8"));
      cachedConfigMtime = mtime;
    }
  } catch {
    if (!cachedConfig) {
      cachedConfig = JSON.parse(readFileSync(configPath, "utf-8"));
    }
  }
  return cachedConfig!;
}

/**
 * This deployment's multi-tenant key (config.json's admin.entityID) — every
 * row written anywhere in this app is tagged with it via a `company_id`
 * column, and every query filters/joins on it, so several app
 * instances/containers (each configured for a different company) can share
 * one physical MySQL database and table set without ever reading, writing,
 * or matching across company boundaries. A single process-wide constant,
 * NOT a per-request/per-session value — one running instance always serves
 * exactly one company.
 */
export function getCompanyId(): string {
  return loadConfig().admin.entityID;
}

/**
 * Resolve a secret referenced as "ENV:VAR_NAME" (or a plain "VAR_NAME") to its
 * value in .env, decrypting it with the project's Fernet key if it was
 * encrypted (`FERNET:` prefix or a raw `gAAAAA...` token).
 */
export function resolveEnvSecret(envVarName: string): string {
  const envPath = join(process.cwd(), ".env");
  const envContent = readFileSync(envPath, "utf-8");
  const match = envContent.match(new RegExp(`${envVarName}=["']?([^"'\\r\\n]+)["']?`));
  const rawValue = match ? match[1] : "";

  const token = rawValue.replace(/^FERNET:/, "");
  if (!token.startsWith("gAAAAA")) {
    return rawValue;
  }

  const keyPath = join(process.cwd(), "scripts", ".encryption_key");
  try {
    return execSync(
      `python -c "from cryptography.fernet import Fernet; key = open(r'${keyPath}','rb').read(); f = Fernet(key); print(f.decrypt(b'${token}').decode(), end='')"`,
      { encoding: "utf-8", timeout: 10000 }
    ).trim();
  } catch (error) {
    console.error(`[Config] Failed to decrypt ${envVarName}:`, error);
    return "";
  }
}
