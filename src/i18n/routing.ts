import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["vi", "en"],
  defaultLocale: "vi",
  // A URL without /vi or /en always opens in Vietnamese — don't switch to
  // English from the browser's Accept-Language header or a saved
  // NEXT_LOCALE cookie. An explicit /en/... URL still opens in English.
  localeDetection: false,
});
