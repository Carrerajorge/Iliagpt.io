import type { Cache } from "../types";

interface CacheEntry<T> {
  value: T;
  expiresAt: number | null;
  createdAt: number;
}

export class TTLCache implements Cache {
  private store = new Map<string, CacheEntry<unknown>>();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly defaultTtlMs: number;
  private readonly maxEntries: number;

  constructor(options?: { defaultTtlMs?: number; maxEntries?: number; cleanupIntervalMs?: number }) {
    this.defaultTtlMs = options?.defaultTtlMs ?? 300000;
    this.maxEntries = options?.maxEntries ?? 10000;

    if (options?.cleanupIntervalMs) {
      this.startCleanup(options.cleanupIntervalMs);
    }
  }

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    
    if (!entry) return undefined;
    
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs?: number): void {
    const now = Date.now();
    const effectiveTtl = ttlMs ?? this.defaultTtlMs;
    
    if (this.store.size >= this.maxEntries && !this.store.has(key)) {
      this.evictOldest();
    }
    
    this.store.set(key, {
      value,
      expiresAt: effectiveTtl > 0 ? now + effectiveTtl : null,
      createdAt: now,
    });
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  has(key: string): boolean {
    const value = this.get(key);
    return value !== undefined;
  }

  size(): number {
    return this.store.size;
  }

  keys(): string[] {
    return Array.from(this.store.keys());
  }

  getOrSet<T>(key: string, factory: () => T, ttlMs?: number): T {
    const existing = this.get<T>(key);
    if (existing !== undefined) return existing;
    
    const value = factory();
    this.set(key, value, ttlMs);
    return value;
  }

  async getOrSetAsync<T>(key: string, factory: () => Promise<T>, ttlMs?: number): Promise<T> {
    const existing = this.get<T>(key);
    if (existing !== undefined) return existing;
    
    const value = await factory();
    this.set(key, value, ttlMs);
    return value;
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    
    for (const [key, entry] of Array.from(this.store.entries())) {
      if (entry.createdAt < oldestTime) {
        oldestTime = entry.createdAt;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      this.store.delete(oldestKey);
    }
  }

  cleanup(): number {
    const now = Date.now();
    let removed = 0;
    
    for (const [key, entry] of Array.from(this.store.entries())) {
      if (entry.expiresAt !== null && now > entry.expiresAt) {
        this.store.delete(key);
        removed++;
      }
    }
    
    return removed;
  }

  private startCleanup(intervalMs: number): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, intervalMs);
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.clear();
  }

  stats(): {
    size: number;
    maxEntries: number;
    defaultTtlMs: number;
  } {
    return {
      size: this.store.size,
      maxEntries: this.maxEntries,
      defaultTtlMs: this.defaultTtlMs,
    };
  }
}

export const globalCache = new TTLCache({
  defaultTtlMs: 300000,
  maxEntries: 5000,
  cleanupIntervalMs: 60000,
});
