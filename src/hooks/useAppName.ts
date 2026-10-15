"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

interface AppInfo {
  companyPrefix: string;
  showAvailable: boolean;
}

let appInfoPromise: Promise<AppInfo> | null = null;

/** One shared, memoized fetch of /api/app-info for every hook below. */
function fetchAppInfo(): Promise<AppInfo> {
  if (!appInfoPromise) {
    appInfoPromise = fetch("/api/app-info")
      .then((res) => (res.ok ? res.json() : { companyPrefix: "", showAvailable: true }))
      .then((data) => ({
        companyPrefix: typeof data.companyPrefix === "string" ? data.companyPrefix : "",
        showAvailable: typeof data.showAvailable === "boolean" ? data.showAvailable : true,
      }))
      .catch(() => ({ companyPrefix: "", showAvailable: true }));
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
 * The portal name with the company prefix from config.json in front —
 * "IMV - Ordering Portal", or "IMV - Ordering Portal (Admin)" when
 * `isAdmin`. The name follows the selected language (for on-screen
 * headings); the browser TAB title never does — it's always English, see
 * `usePageTitle`.
 */
export function useAppName(isAdmin = false): string {
  const t = useTranslations();
  const prefix = useCompanyPrefix();
  return `${prefix ? `${prefix} - ` : ""}${t("common.appName")}${isAdmin ? " (Admin)" : ""}`;
}

/** Sets the browser tab title to "{prefix} - Ordering Portal[ (Admin)]" — always English, whatever the UI language. */
export function usePageTitle(isAdmin = false): void {
  const prefix = useCompanyPrefix();
  useEffect(() => {
    document.title = `${prefix ? `${prefix} - ` : ""}Ordering Portal${isAdmin ? " (Admin)" : ""}`;
  }, [prefix, isAdmin]);
}
