"use client";

/**
 * One shared GET /api/auth/me for the storefront shell: the layout (auth gate)
 * and the Navbar (user menu) both need it on every page load — one request
 * instead of two. Kept for a few seconds so a page change doesn't refetch it;
 * `fresh: true` (after login / logout / profile changes) always refetches.
 */
export interface AuthMeResult {
  ok: boolean;
  status: number;
  data: { user?: Record<string, unknown> & { mustChangePassword?: boolean } } | null;
}

const KEEP_MS = 10_000;
let inflight: Promise<AuthMeResult> | null = null;
let at = 0;

export function fetchAuthMe(opts: { fresh?: boolean } = {}): Promise<AuthMeResult> {
  if (!opts.fresh && inflight && Date.now() - at < KEEP_MS) return inflight;
  at = Date.now();
  inflight = fetch("/api/auth/me", { cache: "no-store" })
    .then(async (res) => ({ ok: res.ok, status: res.status, data: await res.json().catch(() => null) }))
    .catch(() => ({ ok: false, status: 0, data: null }));
  // A failed call isn't kept — the next caller tries again.
  inflight.then((r) => { if (!r.ok) { inflight = null; } });
  return inflight;
}

/** Forget the shared result (call after logout). */
export function clearAuthMe(): void {
  inflight = null;
  at = 0;
}
