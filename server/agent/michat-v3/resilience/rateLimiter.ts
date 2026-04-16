import { MichatError } from "../errors";

export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private capacity: number,
    private refillPerSec: number
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  take(n: number = 1): boolean {
    this.refill();
    
    if (this.tokens >= n) {
      this.tokens -= n;
      return true;
    }
    
    return false;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    const refillAmount = elapsed * this.refillPerSec;
    
    if (refillAmount > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + refillAmount);
      this.lastRefill = now;
    }
  }

  getAvailable(): number {
    this.refill();
    return Math.floor(this.tokens);
  }

  getCapacity(): number {
    return this.capacity;
  }

  reset(): void {
    this.tokens = this.capacity;
    this.lastRefill = Date.now();
  }
}

export class RateLimiter {
  private buckets = new Map<string, TokenBucket>();

  constructor(
    private capacity: number,
    private refillPerSec: number
  ) {}

  allow(key: string, tokens: number = 1): boolean {
    let bucket = this.buckets.get(key);
    
    if (!bucket) {
      bucket = new TokenBucket(this.capacity, this.refillPerSec);
      this.buckets.set(key, bucket);
    }
    
    return bucket.take(tokens);
  }

  getAvailable(key: string): number {
    const bucket = this.buckets.get(key);
    return bucket?.getAvailable() ?? this.capacity;
  }

  reset(key: string): void {
    const bucket = this.buckets.get(key);
    if (bucket) bucket.reset();
  }

  resetAll(): void {
    for (const bucket of Array.from(this.buckets.values())) {
      bucket.reset();
    }
  }

  remove(key: string): void {
    this.buckets.delete(key);
  }

  cleanup(): void {
    this.buckets.clear();
  }

  snapshot(): Record<string, { available: number; capacity: number }> {
    const result: Record<string, { available: number; capacity: number }> = {};
    
    for (const [key, bucket] of Array.from(this.buckets.entries())) {
      result[key] = {
        available: bucket.getAvailable(),
        capacity: bucket.getCapacity(),
      };
    }
    
    return result;
  }
}

export function withRateLimit<T>(
  limiter: RateLimiter,
  key: string,
  fn: () => Promise<T>,
  tokens: number = 1
): Promise<T> {
  if (!limiter.allow(key, tokens)) {
    throw new MichatError("E_RATE_LIMIT", `Rate limit exceeded: ${key}`, {
      key,
      available: limiter.getAvailable(key),
    });
  }
  
  return fn();
}
