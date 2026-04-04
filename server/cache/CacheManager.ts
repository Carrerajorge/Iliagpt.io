/**
 * CacheManager: Multi-tier cache orchestrator (L1 LRU in-memory + L2 Redis)
 * Improvement 11 – Edge Caching for LLM Responses
 */

import { LRUCache } from "lru-cache";
import Redis from "ioredis";
import { Logger } from "../lib/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CacheStats {
  l1Size: number;
  l1MaxSize: number;
  l2Connected: boolean;
  totalGets: number;
  l1Hits: number;
  l2Hits: number;
  misses: number;
  hitRate: number;
  l1HitRate: number;
  evictions: number;
  lastMaintenanceAt?: Date;
}

export interface CacheManagerConfig {
  l1MaxSize?: number;
  l1DefaultTTL?: number; // ms
  l2DefaultTTL?: number; // seconds
  keyPrefix?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_L1_MAX = 2000;
const DEFAULT_L1_TTL = 60_000; // 1 min
const DEFAULT_L2_TTL = 300; // 5 min
const DEFAULT_PREFIX = "cm:";

// ---------------------------------------------------------------------------
// CacheManager
// ---------------------------------------------------------------------------

export class CacheManager {
  private l1: LRUCache<string, any>;
  private redis: Redis;
  private prefix: string;
  private l1DefaultTTL: number;
  private l2DefaultTTL: number;

  // Stats
  private totalGets = 0;
  private l1Hits = 0;
  private l2Hits = 0;
  private misses = 0;
  private evictions = 0;
  private lastMaintenanceAt?: Date;

  constructor(config: CacheManagerConfig = {}) {
    const l1Max = config.l1MaxSize ?? DEFAULT_L1_MAX;
    this.l1DefaultTTL = config.l1DefaultTTL ?? DEFAULT_L1_TTL;
    this.l2DefaultTTL = config.l2DefaultTTL ?? DEFAULT_L2_TTL;
    this.prefix = config.keyPrefix ?? DEFAULT_PREFIX;

    this.l1 = new LRUCache<string, any>({
      max: l1Max,
      ttl: this.l1DefaultTTL,
      updateAgeOnGet: true,
      dispose: (_value, _key) => {
        this.evictions++;
      },
    });

    const redisUrl = process.env.REDIS_URL;
    this.redis = redisUrl
      ? new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: null })
      : new Redis({ lazyConnect: true, maxRetriesPerRequest: null });

    this.redis.on("error", (err) =>
      Logger.error("CacheManager redis error", err)
    );
  }

  // -------------------------------------------------------------------------
  // Core operations
  // -------------------------------------------------------------------------

  async get<T>(key: string): Promise<T | null> {
    this.totalGets++;
    const prefixedKey = this.prefixKey(key);

    // L1 check
    const l1Val = this.l1.get(prefixedKey);
    if (l1Val !== undefined) {
      this.l1Hits++;
      Logger.debug("CacheManager.get: L1 hit", { key });
      return l1Val as T;
    }

    // L2 check
    try {
      const l2Raw = await this.redis.get(prefixedKey);
      if (l2Raw !== null) {
        const parsed = JSON.parse(l2Raw) as T;
        // Promote to L1 with remaining TTL (we use the default L1 TTL here)
        this.l1.set(prefixedKey, parsed);
        this.l2Hits++;
        Logger.debug("CacheManager.get: L2 hit", { key });
        return parsed;
      }
    } catch (err) {
      Logger.warn("CacheManager.get: L2 error, returning miss", err);
    }

    this.misses++;
    return null;
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    const prefixedKey = this.prefixKey(key);
    const l1TTL = ttl != null ? ttl * 1000 : this.l1DefaultTTL;
    const l2TTL = ttl ?? this.l2DefaultTTL;

    // Write to L1
    this.l1.set(prefixedKey, value, { ttl: l1TTL });

    // Write to L2
    try {
      await this.redis.set(
        prefixedKey,
        JSON.stringify(value),
        "EX",
        l2TTL
      );
    } catch (err) {
      Logger.warn("CacheManager.set: L2 write error", err);
    }
  }

  async del(key: string): Promise<void> {
    const prefixedKey = this.prefixKey(key);
    this.l1.delete(prefixedKey);
    try {
      await this.redis.del(prefixedKey);
    } catch (err) {
      Logger.warn("CacheManager.del: L2 error", err);
    }
  }

  async invalidateByPattern(pattern: string): Promise<number> {
    let count = 0;

    // L1 – iterate and delete matching
    const regex = new RegExp(pattern);
    for (const k of this.l1.keys()) {
      if (regex.test(k)) {
        this.l1.delete(k);
        count++;
      }
    }

    // L2 – SCAN
    try {
      let cursor = "0";
      do {
        const [nextCursor, keys] = await this.redis.scan(
          cursor,
          "MATCH",
          `${this.prefix}*${pattern}*`,
          "COUNT",
          "200"
        );
        cursor = nextCursor;
        if (keys.length > 0) {
          await this.redis.del(...keys);
          count += keys.length;
        }
      } while (cursor !== "0");
    } catch (err) {
      Logger.warn("CacheManager.invalidateByPattern: L2 error", err);
    }

    Logger.info("CacheManager.invalidateByPattern", { pattern, count });
    return count;
  }

  async warmCache(
    keys: string[],
    loader: (key: string) => Promise<any>
  ): Promise<void> {
    Logger.info("CacheManager.warmCache started", { count: keys.length });
    let warmed = 0;
    let errors = 0;

    for (const key of keys) {
      try {
        const existing = await this.get(key);
        if (existing !== null) continue; // already cached

        const value = await loader(key);
        if (value !== null && value !== undefined) {
          await this.set(key, value);
          warmed++;
        }
      } catch (err) {
        errors++;
        Logger.warn("CacheManager.warmCache: loader error", { key, err });
      }
    }

    Logger.info("CacheManager.warmCache completed", { warmed, errors });
  }

  async getOrSet<T>(
    key: string,
    loader: () => Promise<T>,
    ttl?: number
  ): Promise<T> {
    const existing = await this.get<T>(key);
    if (existing !== null) return existing;

    const value = await loader();
    await this.set(key, value, ttl);
    return value;
  }

  // -------------------------------------------------------------------------
  // Stats
  // -------------------------------------------------------------------------

  async getStats(): Promise<CacheStats> {
    let l2Connected = false;
    try {
      await this.redis.ping();
      l2Connected = true;
    } catch {
      l2Connected = false;
    }

    const total = this.totalGets;
    const hits = this.l1Hits + this.l2Hits;
    return {
      l1Size: this.l1.size,
      l1MaxSize: this.l1.max,
      l2Connected,
      totalGets: total,
      l1Hits: this.l1Hits,
      l2Hits: this.l2Hits,
      misses: this.misses,
      hitRate: total > 0 ? hits / total : 0,
      l1HitRate: total > 0 ? this.l1Hits / total : 0,
      evictions: this.evictions,
      lastMaintenanceAt: this.lastMaintenanceAt,
    };
  }

  // -------------------------------------------------------------------------
  // Maintenance
  // -------------------------------------------------------------------------

  async runMaintenance(): Promise<void> {
    try {
      Logger.info("CacheManager.runMaintenance started");

      // Purge LRU stale entries (LRUCache does this lazily; force a pass)
      this.l1.purgeStale();

      // Remove orphaned L2 keys that are not in L1 prefix
      // (lightweight - just check a sample via SCAN + TTL)
      let scanCount = 0;
      let removedCount = 0;
      let cursor = "0";
      do {
        const [nextCursor, keys] = await this.redis.scan(
          cursor,
          "MATCH",
          `${this.prefix}*`,
          "COUNT",
          "50"
        );
        cursor = nextCursor;
        scanCount += keys.length;

        // Refresh TTL on very old keys (TTL <= 10s – might be about to expire)
        const ttlPipeline = this.redis.pipeline();
        for (const k of keys) {
          ttlPipeline.ttl(k);
        }
        const ttlResults = await ttlPipeline.exec();

        const toDelete: string[] = [];
        if (ttlResults) {
          for (let i = 0; i < keys.length; i++) {
            const ttlResult = ttlResults[i];
            if (!ttlResult) continue;
            const [err, ttlVal] = ttlResult;
            if (!err && typeof ttlVal === "number" && ttlVal === -1) {
              // Key with no TTL set – set a default to prevent memory leaks
              await this.redis.expire(keys[i], this.l2DefaultTTL);
            } else if (!err && typeof ttlVal === "number" && ttlVal === 0) {
              toDelete.push(keys[i]);
            }
          }
        }

        if (toDelete.length > 0) {
          await this.redis.del(...toDelete);
          removedCount += toDelete.length;
        }
      } while (cursor !== "0");

      this.lastMaintenanceAt = new Date();
      Logger.info("CacheManager.runMaintenance completed", {
        scanned: scanCount,
        removed: removedCount,
      });
    } catch (err) {
      Logger.error("CacheManager.runMaintenance error", err);
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private prefixKey(key: string): string {
    return `${this.prefix}${key}`;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const cacheManager = new CacheManager();
