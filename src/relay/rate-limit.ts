/**
 * Simple in-memory token-bucket rate limiter.
 */

export interface RateLimitConfig {
  capacity: number;
  /** Tokens added per second. */
  refillPerSecond: number;
}

interface Bucket {
  tokens: number;
  lastRefill: number;
}

export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig) {
    this.config = config;
  }

  check(key: string, cost = 1): void {
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (bucket === undefined) {
      bucket = { tokens: this.config.capacity, lastRefill: now };
      this.buckets.set(key, bucket);
    }

    const elapsedSeconds = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(
      this.config.capacity,
      bucket.tokens + elapsedSeconds * this.config.refillPerSecond,
    );
    bucket.lastRefill = now;

    if (bucket.tokens < cost) {
      throw new Error('RATE_LIMITED');
    }
    bucket.tokens -= cost;
  }
}
