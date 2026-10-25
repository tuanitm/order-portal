"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

interface AppInfo {
  companyPrefix: string;
  showAvailable: boolean;
  showDiscounts: boolean;
}

let appInfoPromise: Promise<AppInfo> | null = null;

/** One shared, memoized fetch of /api/app-info for every hook below. */
function fetchAppInfo(): Promise<AppInfo> {
  if (!appInfoPromise) {
    appInfoPromise = fetch("/api/app-info")
      .then((res) => (res.ok ? res.json() : { companyPrefix: "", showAvailable: true, showDiscounts: false }))
      .then((data) => ({
        companyPrefix: typeof data.companyPrefix === "string" ? data.companyPrefix : "",
        showAvailable: typeof data.showAvailable === "boolean" ? data.showAvailable : true,
        showDiscounts: typeof data.showDiscounts === "boolean" ? data.showDiscounts : false,
      }))
      .catch(() => ({ companyPrefix: "", showAvailable: true, showDiscounts: false }));
  }
  return appInfoPromise;
}

/** `admin.companyPrefix` from config.json ("" until loaded / if unset). */
export function useCompanyPrefix(): string {
  const [prefix, setPrefix] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchAppInfo().then((info) => {
      if (!cancelled) setPrefix(info.companyPrefix);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return prefix;
}

/**
 * Whether the storefront should show the available-stock line on product
 * cards (`admin.showAvailable` in config.json, hidden only when explicitly
 * "No"). Defaults to `true` until loaded, so the line doesn't flash in then
 * disappear for the common case where it's enabled.
 */
export function useShowAvailable(): boolean {
  const [showAvailable, setShowAvailable] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchAppInfo().then((info) => {
      if (!cancelled) setShowAvailable(info.showAvailable);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return showAvailable;
}

/**
 * Whether the storefront shows a Discount 1/Discount 2 hover breakdown on
 * product cards (`admin.showDiscounts` in config.json — opt-in, shown only
 * when explicitly "Yes"). Defaults to `false` until loaded, so the tooltip
 * doesn't briefly appear then disappear for the common (disabled) case.
 */
export function useShowDiscounts(): boolean {
  const [showDiscounts, setShowDiscounts] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchAppInfo().then((info) => {
      if (!cancelled) setShowDiscounts(info.showDiscounts);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return showDiscounts;
}

/**
 * The portal name with the company prefix from config.json in front —
 * "IMV - Order Portal", or "IMV - Order Portal (Admin NO)" when
 * `isAdmin` and `adminName` is provided.
 */
export function useAppName(isAdmin = false, adminName?: string): string {
  const t = useTranslations();
  const prefix = useCompanyPrefix();
  const suffix = isAdmin ? ` (${adminName || "Admin"})` : "";
  return `${prefix ? `${prefix} - ` : ""}${t("common.appName")}${suffix}`;
}

/** Sets the browser tab title to "{prefix} - Order Portal[ (Admin Name)]" — always English, whatever the UI language. */
export function usePageTitle(isAdmin = false, adminName?: string): void {
  const prefix = useCompanyPrefix();
  useEffect(() => {
    const suffix = isAdmin ? ` (${adminName || "Admin"})` : "";
    document.title = `${prefix ? `${prefix} - ` : ""}Order Portal${suffix}`;
  }, [prefix, isAdmin, adminName]);
}
