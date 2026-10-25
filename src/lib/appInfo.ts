import { loadConfig } from "@/lib/config";

/** `admin.companyPrefix` from config.json ("" if unset). */
export function getCompanyPrefix(): string {
  return loadConfig().admin.companyPrefix?.trim() || "";
}

/** `admin.showAvailable` from config.json — shown by default; hidden only when explicitly "No" (case-insensitive). */
export function isShowAvailableEnabled(): boolean {
  return loadConfig().admin.showAvailable?.trim().toLowerCase() !== "no";
}

/**
 * `admin.showDiscounts` from config.json — opt-in (unlike showAvailable
 * above), hidden by default; shown only when explicitly "Yes"
 * (case-insensitive). Drives the storefront's Discount 1/Discount 2
 * hover breakdown on product cards — see ProductCard.tsx.
 */
export function isShowDiscountsEnabled(): boolean {
  return loadConfig().admin.showDiscounts?.trim().toLowerCase() === "yes";
}

/** "IMV - Order Portal", or "IMV - Order Portal (Admin Name)" for the admin area. */
export function formatAppName(name: string, isAdmin = false): string {
  const prefix = getCompanyPrefix();
  return `${prefix ? `${prefix} - ` : ""}${name}${isAdmin ? " (Admin)" : ""}`;
}
