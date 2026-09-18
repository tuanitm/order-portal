import { readFileSync } from "fs";
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
    email: string;
    password: string;
  };
  mysql: {
    dbIp: string;
    dbPort: number;
    dbName: string;
    dpUser: string;
    encrypted: boolean;
  };
}

let cachedConfig: AppConfig | null = null;

/** Load config.json from the project root (cached after first read). */
export function loadConfig(): AppConfig {
  if (!cachedConfig) {
    const configPath = join(process.cwd(), "config.json");
    cachedConfig = JSON.parse(readFileSync(configPath, "utf-8"));
  }
  return cachedConfig!;
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
