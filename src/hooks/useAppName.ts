"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

let prefixPromise: Promise<string> | null = null;

function fetchCompanyPrefix(): Promise<string> {
  if (!prefixPromise) {
    prefixPromise = fetch("/api/app-info")
      .then((res) => (res.ok ? res.json() : { companyPrefix: "" }))
      .then((data) => (typeof data.companyPrefix === "string" ? data.companyPrefix : ""))
      .catch(() => "");
  }
  return prefixPromise;
}

/** `admin.companyPrefix` from config.json ("" until loaded / if unset). */
export function useCompanyPrefix(): string {
  const [prefix, setPrefix] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchCompanyPrefix().then((p) => {
      if (!cancelled) setPrefix(p);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return prefix;
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
