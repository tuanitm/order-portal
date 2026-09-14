import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

export default createMiddleware(routing);

export const config = {
  // Match all pathnames except for API routes, static files, etc.
  matcher: [
    "/",
    "/(vi|en)/:path*",
    // Exclude API routes, Next.js internals, and static files
    "/((?!api|_next|_vercel|.*\\..*).*)",
  ],
};
