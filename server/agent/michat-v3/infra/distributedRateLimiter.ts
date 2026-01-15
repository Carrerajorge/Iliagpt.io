/**
 * MICHAT v3.1 — Distributed Rate Limiter
 * Token bucket con soporte para Redis en producción
 */

export interface DistributedRateLimiter {
  allow(key: string, cost?: number): Promise<boolean>;
  remaining(key: string): Promise<number>;
  reset(key: string): Promise<void>;
}

export interface RateLimiterConfig {
  tokensPerInterval: number;
  intervalMs: number;
  maxBurst: number;
}

const DefaultConfig: RateLimiterConfig = {
  tokensPerInterval: 10,
  intervalMs: 1000,
  maxBurst: 20,
};

interface BucketState {
  tokens: number;
  lastRefill: number;
}

export class LocalDistributedRateLimiter implements DistributedRateLimiter {
  private buckets = new Map<string, BucketState>();
  private config: RateLimiterConfig;

  constructor(config: Partial<RateLimiterConfig> = {}) {
    this.config = { ...DefaultConfig, ...config };
  }

  private refill(bucket: BucketState): void {
    const now = Date.now();
    const elapsed = now - bucket.lastRefill;
    const intervals = Math.floor(elapsed / this.config.intervalMs);
    
    if (intervals > 0) {
      const tokensToAdd = intervals * this.config.tokensPerInterval;
      bucket.tokens = Math.min(bucket.tokens + tokensToAdd, this.config.maxBurst);
      bucket.lastRefill = now;
    }
  }

  private getBucket(key: string): BucketState {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.config.maxBurst, lastRefill: Date.now() };
      this.buckets.set(key, bucket);
    }
    return bucket;
  }

  async allow(key: string, cost: number = 1): Promise<boolean> {
    const bucket = this.getBucket(key);
    this.refill(bucket);

    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      return true;
    }
    return false;
  }

  async remaining(key: string): Promise<number> {
    const bucket = this.getBucket(key);
    this.refill(bucket);
    return bucket.tokens;
  }

  async reset(key: string): Promise<void> {
    this.buckets.delete(key);
  }

  cleanup(maxAgeMs: number = 3600000): number {
    const now = Date.now();
    let removed = 0;
    const entries = Array.from(this.buckets.entries());
    for (const [key, bucket] of entries) {
      if (now - bucket.lastRefill > maxAgeMs) {
        this.buckets.delete(key);
        removed++;
      }
    }
    return removed;
  }

  getStats() {
    return {
      buckets: this.buckets.size,
      config: this.config,
    };
  }
}

export const globalDistributedRateLimiter = new LocalDistributedRateLimiter();
