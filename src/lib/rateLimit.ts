import { NextResponse, type NextRequest } from "next/server";

/**
 * Small in-memory, per-IP fixed-window rate limiter for public (no-login)
 * endpoints such as /api/bp/lookup and /api/auth/identify, so they can't be
 * looped to enumerate customers. Per server process — enough for one app
 * container; it resets on restart.
 */
interface Bucket { count: number; resetAt: number }

const g = globalThis as typeof globalThis & { __rateLimitBuckets?: Map<string, Bucket> };
const buckets = (g.__rateLimitBuckets ??= new Map());

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

/**
 * Counts this request against `name` for the caller's IP. Returns a 429
 * response when over `limit` requests per `windowSeconds`, otherwise null.
 */
export function rateLimit(request: NextRequest, name: string, limit: number, windowSeconds: number): NextResponse | null {
  const now = Date.now();
  // Drop expired buckets now and then so the map can't grow without bound.
  if (buckets.size > 10_000) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }
  const key = `${name}:${clientIp(request)}`;
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowSeconds * 1000 };
    buckets.set(key, bucket);
  }
  bucket.count++;
  if (bucket.count <= limit) return null;
  const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
  return NextResponse.json(
    { error: "too_many_requests", message: "Too many requests — please wait a moment and try again." },
    { status: 429, headers: { "Retry-After": String(retryAfter) } }
  );
}
