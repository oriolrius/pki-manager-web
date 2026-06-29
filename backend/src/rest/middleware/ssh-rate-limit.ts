/**
 * Dependency-free in-memory rate limiter (SSH-MON) for the public KRL and
 * external signing endpoints. Fixed-window counter keyed by an arbitrary string
 * (per-IP for KRL pulls, per-token for signing). Returns false when exceeded.
 */
interface Bucket {
  count: number;
  reset: number;
}
const buckets = new Map<string, Bucket>();

export function rateLimitOk(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset <= now) {
    b = { count: 0, reset: now + windowMs };
    buckets.set(key, b);
  }
  b.count += 1;
  // Opportunistic cleanup to bound memory.
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (v.reset <= now) buckets.delete(k);
  }
  return b.count <= limit;
}

/** Reset all buckets (tests). */
export function resetRateLimits(): void {
  buckets.clear();
}
