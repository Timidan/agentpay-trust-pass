export type FixedWindowRateLimiterOptions = {
  limit: number;
  windowMs: number;
  maxKeys: number;
};

export type RateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; remaining: 0; retryAfterSeconds: number };

type RateLimitBucket = {
  count: number;
  startedAt: number;
};

export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, RateLimitBucket>();

  constructor(private readonly options: FixedWindowRateLimiterOptions) {
    requirePositiveInteger(options.limit, "rate limit");
    requirePositiveInteger(options.windowMs, "rate limit window");
    requirePositiveInteger(options.maxKeys, "rate limit key capacity");
  }

  consume(key: string, now = Date.now()): RateLimitResult {
    let bucket = this.buckets.get(key);
    if (bucket && now - bucket.startedAt >= this.options.windowMs) {
      this.buckets.delete(key);
      bucket = undefined;
    }

    if (!bucket) {
      this.makeRoom(now);
      bucket = { count: 0, startedAt: now };
      this.buckets.set(key, bucket);
    }

    if (bucket.count >= this.options.limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.startedAt + this.options.windowMs - now) / 1_000))
      };
    }

    bucket.count += 1;
    return { allowed: true, remaining: this.options.limit - bucket.count };
  }

  private makeRoom(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.startedAt >= this.options.windowMs) this.buckets.delete(key);
    }
    while (this.buckets.size >= this.options.maxKeys) {
      const oldestKey = this.buckets.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      this.buckets.delete(oldestKey);
    }
  }
}

export function setBoundedMapEntry<K, V>(
  map: Map<K, V>,
  key: K,
  value: V,
  maximumEntries: number
): [K, V] | null {
  requirePositiveInteger(maximumEntries, "map capacity");
  if (map.has(key)) map.delete(key);

  let evicted: [K, V] | null = null;
  if (map.size >= maximumEntries) {
    const oldest = map.entries().next().value as [K, V] | undefined;
    if (oldest) {
      evicted = oldest;
      map.delete(oldest[0]);
    }
  }
  map.set(key, value);
  return evicted;
}

function requirePositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer`);
  }
}
