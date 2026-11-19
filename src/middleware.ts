import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "./i18n/routing";

const intlMiddleware = createMiddleware(routing);

/**
 * Looks like a language code in the URL's first segment: "fr", "zh",
 * "en-US", "zh_CN". No portal route is a 2-letter word, so this never
 * catches a real page (e.g. /login, /admin, /checkout).
 */
const LANG_CODE_SEGMENT = /^[a-z]{2}(?:[-_][a-z0-9]{2,4})?$/i;

export default function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const [, first = "", ...rest] = pathname.split("/");

  // /vi and /en open in that language (handled by next-intl below). Any other
  // language code — /fr, /zh, /en-US, /VI — goes to the same page in that
  // language when it's a supported one regardless of case, otherwise in the
  // default language (Vietnamese): /fr/login -> /vi/login.
  if (LANG_CODE_SEGMENT.test(first) && !(routing.locales as readonly string[]).includes(first)) {
    const lower = first.toLowerCase();
    const locale = (routing.locales as readonly string[]).includes(lower) ? lower : routing.defaultLocale;
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}${rest.length ? `/${rest.join("/")}` : ""}`;
    url.search = search;
    return NextResponse.redirect(url);
  }

  return intlMiddleware(request);
}

export const config = {
  // Match all pathnames except for API routes, static files, etc.
  matcher: [
    "/",
    "/(vi|vn|en)/:path*",
    // Exclude API routes, Next.js internals, and static files
    "/((?!api|_next|_vercel|.*\\..*).*)",
  ],
};
