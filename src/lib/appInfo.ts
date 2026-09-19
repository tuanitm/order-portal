import { loadConfig } from "@/lib/config";

/** `admin.companyPrefix` from config.json ("" if unset). */
export function getCompanyPrefix(): string {
  return loadConfig().admin.companyPrefix?.trim() || "";
}

/** "IMV - Ordering Portal", or "IMV - Ordering Portal (Admin)" for the admin area. */
export function formatAppName(name: string, isAdmin = false): string {
  const prefix = getCompanyPrefix();
  return `${prefix ? `${prefix} - ` : ""}${name}${isAdmin ? " (Admin)" : ""}`;
}
