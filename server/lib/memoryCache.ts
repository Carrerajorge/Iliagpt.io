/**
 * Production-grade in-memory LRU cache with optional Redis backend.
 * Falls back gracefully when Redis is unavailable.
 */
import { LRUCache } from "lru-cache";
import { createClient, RedisClientType } from "redis";
import * as crypto from "crypto";

const REDIS_URL = process.env.REDIS_URL || "";
const CACHE_DEFAULT_TTL_MS = parseInt(process.env.CACHE_DEFAULT_TTL_MS || "300000", 10);
const CACHE_MAX_ITEMS = parseInt(process.env.CACHE_MAX_ITEMS || "10000", 10);
const CACHE_MAX_SIZE_MB = parseInt(process.env.CACHE_MAX_SIZE_MB || "100", 10);

export interface CacheEntry<T = unknown> {
  value: T;
  createdAt: number;
  ttl: number;
  hits: number;
  size: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  evictions: number;
  hitRate: number;
  itemCount: number;
  memoryUsedBytes: number;
  redisConnected: boolean;
}

export interface CacheOptions {
  ttl?: number;
  namespace?: string;
  useRedis?: boolean;
  compressionThreshold?: number;
}

type CacheValue<T> = {
  v: T;
  c: number;
  h: number;
};

class MemoryCache {
  private static instance: MemoryCache | null = null;
  private localCache: LRUCache<string, CacheValue<unknown>>;
  private redisClient: RedisClientType | null = null;
  private redisConnected = false;
  private redisConnecting = false;
  private _rateLimitSuppressed = false;
  private stats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    evictions: 0,
  };

  private constructor() {
    this.localCache = new LRUCache<string, CacheValue<unknown>>({
      max: CACHE_MAX_ITEMS,
      maxSize: CACHE_MAX_SIZE_MB * 1024 * 1024,
      sizeCalculation: (value) => {
        return JSON.stringify(value).length;
      },
      ttl: CACHE_DEFAULT_TTL_MS,
      updateAgeOnGet: true,
      updateAgeOnHas: false,
      dispose: (_value, _key, reason) => {
        if (reason === "evict") {
          this.stats.evictions++;
        }
      },
    });

    this.initializeRedis();
  }

  static getInstance(): MemoryCache {
    if (!MemoryCache.instance) {
      MemoryCache.instance = new MemoryCache();
    }
    return MemoryCache.instance;
  }

  private async initializeRedis(): Promise<void> {
    if (!REDIS_URL || this.redisConnecting || this.redisConnected) {
      return;
    }

    this.redisConnecting = true;

    try {
      this.redisClient = createClient({
        url: REDIS_URL,
        socket: {
          connectTimeout: 5000,
          reconnectStrategy: (retries) => {
            if (retries > 5) {
              console.log("[MemoryCache] Max Redis reconnection attempts reached, using local cache only");
              return false;
            }
            return Math.min(retries * 100, 3000);
          },
        },
      });

      this.redisClient.on("error", (err) => {
        if (this.redisConnected) {
          console.error("[MemoryCache] Redis error:", err.message);
          this.redisConnected = false;
        }
      });

      this.redisClient.on("connect", () => {
        console.log("[MemoryCache] Redis connected");
        this.redisConnected = true;
      });

      this.redisClient.on("end", () => {
        console.log("[MemoryCache] Redis disconnected");
        this.redisConnected = false;
      });

      await this.redisClient.connect();
    } catch (error: any) {
      console.log("[MemoryCache] Redis not available, using local cache only:", error.message);
      this.redisClient = null;
      this.redisConnected = false;
    } finally {
      this.redisConnecting = false;
    }
  }

  private buildKey(key: string, namespace?: string): string {
    const prefix = namespace ? `${namespace}:` : "cache:";
    return `${prefix}${key}`;
  }

  async get<T>(key: string, options: CacheOptions = {}): Promise<T | null> {
    const fullKey = this.buildKey(key, options.namespace);

    const localValue = this.localCache.get(fullKey) as CacheValue<T> | undefined;
    if (localValue) {
      localValue.h++;
      this.stats.hits++;
      return localValue.v;
    }

    if (options.useRedis !== false && this.redisConnected && this.redisClient) {
      try {
        const redisValue = await this.redisClient.get(fullKey);
        if (redisValue) {
          const parsed = JSON.parse(redisValue) as CacheValue<T>;
          parsed.h++;
          this.localCache.set(fullKey, parsed);
          this.stats.hits++;
          return parsed.v;
        }
      } catch (error: any) {
        this.handleRedisError("get", error);
      }
    }

    this.stats.misses++;
    return null;
  }

  async set<T>(key: string, value: T, options: CacheOptions = {}): Promise<void> {
    const fullKey = this.buildKey(key, options.namespace);
    const ttl = options.ttl || CACHE_DEFAULT_TTL_MS;

    const cacheValue: CacheValue<T> = {
      v: value,
      c: Date.now(),
      h: 0,
    };

    this.localCache.set(fullKey, cacheValue, { ttl });
    this.stats.sets++;

    if (options.useRedis !== false && this.redisConnected && this.redisClient) {
      try {
        await this.redisClient.setEx(
          fullKey,
          Math.ceil(ttl / 1000),
          JSON.stringify(cacheValue)
        );
      } catch (error: any) {
        this.handleRedisError("set", error);
      }
    }
  }

  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    options: CacheOptions = {}
  ): Promise<T> {
    const cached = await this.get<T>(key, options);
    if (cached !== null) {
      return cached;
    }

    const value = await factory();
    await this.set(key, value, options);
    return value;
  }

  async delete(key: string, options: CacheOptions = {}): Promise<boolean> {
    const fullKey = this.buildKey(key, options.namespace);

    const existed = this.localCache.delete(fullKey);
    this.stats.deletes++;

    if (options.useRedis !== false && this.redisConnected && this.redisClient) {
      try {
        await this.redisClient.del(fullKey);
      } catch (error: any) {
        this.handleRedisError("delete", error);
      }
    }

    return existed;
  }

  async deletePattern(pattern: string, namespace?: string): Promise<number> {
    const prefix = namespace ? `${namespace}:` : "cache:";
    let count = 0;

    const keys = Array.from(this.localCache.keys());
    for (const key of keys) {
      if (key.startsWith(prefix) && key.includes(pattern)) {
        this.localCache.delete(key);
        count++;
      }
    }

    if (this.redisConnected && this.redisClient) {
      try {
        const keys = await this.redisClient.keys(`${prefix}*${pattern}*`);
        if (keys.length > 0) {
          await this.redisClient.del(keys);
          count += keys.length;
        }
      } catch (error: any) {
        console.warn("[MemoryCache] Redis deletePattern error:", error.message);
      }
    }

    return count;
  }

  async has(key: string, options: CacheOptions = {}): Promise<boolean> {
    const fullKey = this.buildKey(key, options.namespace);

    if (this.localCache.has(fullKey)) {
      return true;
    }

    if (options.useRedis !== false && this.redisConnected && this.redisClient) {
      try {
        const exists = await this.redisClient.exists(fullKey);
        return exists === 1;
      } catch (error: any) {
        console.warn("[MemoryCache] Redis has error:", error.message);
      }
    }

    return false;
  }

  clear(namespace?: string): void {
    if (namespace) {
      const prefix = `${namespace}:`;
      const keys = Array.from(this.localCache.keys());
      for (const key of keys) {
        if (key.startsWith(prefix)) {
          this.localCache.delete(key);
        }
      }
    } else {
      this.localCache.clear();
    }
  }

  private handleRedisError(op: string, error: any): void {
    if (error?.message?.includes("max requests limit")) {
      if (!this._rateLimitSuppressed) {
        console.warn(`[MemoryCache] Upstash rate limit reached — disabling Redis (${op})`);
        this._rateLimitSuppressed = true;
        this.redisConnected = false;
      }
    } else {
      console.warn(`[MemoryCache] Redis ${op} error:`, error?.message);
    }
  }

  getStats(): CacheStats {
    const totalRequests = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      hitRate: totalRequests > 0 ? this.stats.hits / totalRequests : 0,
      itemCount: this.localCache.size,
      memoryUsedBytes: this.localCache.calculatedSize || 0,
      redisConnected: this.redisConnected,
    };
  }

  resetStats(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      evictions: 0,
    };
  }

  isRedisConnected(): boolean {
    return this.redisConnected;
  }

  async close(): Promise<void> {
    if (this.redisClient) {
      try {
        await this.redisClient.quit();
      } catch {}
      this.redisClient = null;
      this.redisConnected = false;
    }
    this.localCache.clear();
  }
}

export const memoryCache = MemoryCache.getInstance();

export function generateCacheKey(...parts: (string | number | boolean | object)[]): string {
  const normalized = parts.map((part) => {
    if (typeof part === "object") {
      return JSON.stringify(part);
    }
    return String(part);
  });
  return crypto.createHash("md5").update(normalized.join(":")).digest("hex");
}

export function createNamespacedCache(namespace: string) {
  return {
    get: <T>(key: string, options?: Omit<CacheOptions, "namespace">) =>
      memoryCache.get<T>(key, { ...options, namespace }),
    set: <T>(key: string, value: T, options?: Omit<CacheOptions, "namespace">) =>
      memoryCache.set(key, value, { ...options, namespace }),
    getOrSet: <T>(
      key: string,
      factory: () => Promise<T>,
      options?: Omit<CacheOptions, "namespace">
    ) => memoryCache.getOrSet(key, factory, { ...options, namespace }),
    delete: (key: string, options?: Omit<CacheOptions, "namespace">) =>
      memoryCache.delete(key, { ...options, namespace }),
    has: (key: string, options?: Omit<CacheOptions, "namespace">) =>
      memoryCache.has(key, { ...options, namespace }),
    clear: () => memoryCache.clear(namespace),
  };
}

export async function withCache<T>(
  key: string,
  factory: () => Promise<T>,
  options: CacheOptions = {}
): Promise<T> {
  return memoryCache.getOrSet(key, factory, options);
}
