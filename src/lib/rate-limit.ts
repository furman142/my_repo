/**
 * Lightweight fixed-window rate limiter.
 *
 * Uses an in-memory store by default (fine for a single instance / local dev).
 * In production, back it with Redis by setting REDIS_URL — see
 * docs/INTEGRATIONS.md for the drop-in Redis adapter. Keeping the interface
 * tiny means swapping the store is a one-file change.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const store = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  const bucket = store.get(key);
  if (!bucket || now >= bucket.resetAt) {
    const resetAt = now + windowMs;
    store.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: limit - 1, resetAt };
  }
  if (bucket.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: bucket.resetAt };
  }
  bucket.count += 1;
  return { allowed: true, remaining: limit - bucket.count, resetAt: bucket.resetAt };
}

/** Best-effort client identifier from request headers. */
export function clientKey(headers: Headers, route: string): string {
  const ip =
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    "anonymous";
  return `${route}:${ip}`;
}

/** Testing helper. */
export function _resetRateLimitStore() {
  store.clear();
}
