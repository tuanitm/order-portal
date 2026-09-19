import type { NextRequest } from "next/server";

/**
 * Whether the client reached us over HTTPS (directly, or through a TLS-
 * terminating reverse proxy that sets X-Forwarded-Proto). Auth cookies are only
 * marked `Secure` in that case: browsers silently discard a `Secure` cookie set
 * over plain http, which would make login "succeed" but never stick (every
 * later /api/auth/me → 401) — as happens for a production build served on http.
 */
export function isHttpsRequest(request: NextRequest): boolean {
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0].trim();
  return (forwarded || request.nextUrl.protocol.replace(":", "")) === "https";
}
