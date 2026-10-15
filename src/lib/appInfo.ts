import { loadConfig } from "@/lib/config";

/** `admin.companyPrefix` from config.json ("" if unset). */
export function getCompanyPrefix(): string {
  return loadConfig().admin.companyPrefix?.trim() || "";
}

/** `admin.showAvailable` from config.json — shown by default; hidden only when explicitly "No" (case-insensitive). */
export function isShowAvailableEnabled(): boolean {
  return loadConfig().admin.showAvailable?.trim().toLowerCase() !== "no";
}

/** "IMV - Ordering Portal", or "IMV - Ordering Portal (Admin)" for the admin area. */
export function formatAppName(name: string, isAdmin = false): string {
  const prefix = getCompanyPrefix();
  return `${prefix ? `${prefix} - ` : ""}${name}${isAdmin ? " (Admin)" : ""}`;
}
