/**
 * In-Memory Cache Service
 * Simple caching layer with TTL support
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  createdAt: number;
  hits: number;
}

interface CacheStats {
  size: number;
  hits: number;
  misses: number;
  hitRate: number;
}

class CacheService {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private stats = { hits: 0, misses: 0 };
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes
  private readonly MAX_ENTRIES = 10000;

  constructor() {
    // Cleanup expired entries every 30 seconds
    this.cleanupInterval = setInterval(() => this.cleanup(), 30000);
  }

  /**
   * Get value from cache
   */
  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.stats.misses++;
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.stats.misses++;
      return undefined;
    }

    entry.hits++;
    this.stats.hits++;
    return entry.value as T;
  }

  /**
   * Set value in cache with optional TTL
   */
  set<T>(key: string, value: T, ttlMs?: number): void {
    // Evict oldest entries if at max capacity
    if (this.cache.size >= this.MAX_ENTRIES) {
      this.evictOldest(Math.floor(this.MAX_ENTRIES * 0.1));
    }

    const now = Date.now();
    this.cache.set(key, {
      value,
      expiresAt: now + (ttlMs || this.DEFAULT_TTL),
      createdAt: now,
      hits: 0
    });
  }

  /**
   * Get or set - returns cached value or fetches and caches new value
   */
  async getOrSet<T>(
    key: string, 
    fetcher: () => Promise<T>, 
    ttlMs?: number
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) {
      return cached;
    }

    const value = await fetcher();
    this.set(key, value, ttlMs);
    return value;
  }

  /**
   * Delete a key from cache
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Delete all keys matching a pattern
   */
  deletePattern(pattern: string): number {
    const regex = new RegExp(pattern.replace(/\*/g, '.*'));
    let deleted = 0;
    
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        deleted++;
      }
    }
    
    return deleted;
  }

  /**
   * Check if key exists and is not expired
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
    this.stats = { hits: 0, misses: 0 };
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const total = this.stats.hits + this.stats.misses;
    return {
      size: this.cache.size,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: total > 0 ? (this.stats.hits / total) * 100 : 0
    };
  }

  /**
   * Get all keys (for debugging)
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  private evictOldest(count: number): void {
    const entries = Array.from(this.cache.entries())
      .sort((a, b) => a[1].createdAt - b[1].createdAt);
    
    for (let i = 0; i < Math.min(count, entries.length); i++) {
      this.cache.delete(entries[i][0]);
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.cache.clear();
  }
}

// Singleton instance
export const cache = new CacheService();

// Convenience functions for common cache patterns

/**
 * Cache user data
 */
export const userCache = {
  get: (userId: string) => cache.get(`user:${userId}`),
  set: (userId: string, user: any) => cache.set(`user:${userId}`, user, 5 * 60 * 1000),
  delete: (userId: string) => cache.delete(`user:${userId}`),
  invalidateAll: () => cache.deletePattern('user:*')
};

/**
 * Cache AI models list
 */
export const modelsCache = {
  get: () => cache.get<any[]>('models:all'),
  set: (models: any[]) => cache.set('models:all', models, 10 * 60 * 1000),
  delete: () => cache.delete('models:all')
};

/**
 * Cache system settings
 */
export const settingsCache = {
  get: () => cache.get<Record<string, any>>('settings:all'),
  set: (settings: Record<string, any>) => cache.set('settings:all', settings, 15 * 60 * 1000),
  delete: () => cache.delete('settings:all')
};

/**
 * Cache dashboard stats
 */
export const dashboardCache = {
  get: () => cache.get('dashboard:stats'),
  set: (stats: any) => cache.set('dashboard:stats', stats, 30 * 1000), // 30 seconds
  delete: () => cache.delete('dashboard:stats')
};

/**
 * Memoization decorator for class methods
 */
export function memoize(ttlMs: number = 60000) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const key = `memo:${propertyKey}:${JSON.stringify(args)}`;
      
      return cache.getOrSet(key, () => originalMethod.apply(this, args), ttlMs);
    };

    return descriptor;
  };
}
