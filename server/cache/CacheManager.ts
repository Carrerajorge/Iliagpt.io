import Redis from 'ioredis';
import { LRUCache } from 'lru-cache';
import pkg from 'pg';
import { Logger } from '../lib/logger';

const { Pool } = pkg;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CacheTier = 'L1' | 'L2' | 'L3';

export interface GetOptions {
  /** Which tiers to consult (in order). Defaults to all three. */
  tiers?: CacheTier[];
  /** Skip populating upper tiers on a miss (default: false). */
  noBackfill?: boolean;
}

export interface SetOptions {
  /** Time-to-live in seconds. Defaults to 300. */
  ttl?: number;
  /** Which tiers to write to. Defaults to all three. */
  tiers?: CacheTier[];
  /** Arbitrary tags used for bulk invalidation. */
  tags?: string[];
}

export interface TierStats {
  hits: number;
  misses: number;
  hitRate: number;
  size: number;
}

export interface CacheStats {
  L1: TierStats;
  L2: TierStats;
  L3: TierStats;
}

// Internal structure stored in L1
interface L1Entry<T> {
  value: T;
  expiresAt: number; // ms timestamp
  tags: string[];
}

// Internal structure stored in L2 (serialised to JSON)
interface L2Envelope<T> {
  value: T;
  tags: string[];
  storedAt: number; // ms timestamp
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TTL = 300; // seconds
const L1_MAX_SIZE = 1_000; // items
const L3_TABLE = 'cache_store';

// Redis key helpers
const redisValueKey = (ns: string, key: string) => `cache:${ns}:v:${key}`;
const redisTagKey = (ns: string, tag: string) => `cache:${ns}:tag:${tag}`;
const redisTierStatsKey = (ns: string) => `cache:${ns}:stats:L2`;

// ---------------------------------------------------------------------------
// CacheManager
// ---------------------------------------------------------------------------

export class CacheManager {
  private readonly namespace: string;

  // L1 — in-process LRU
  private readonly l1: LRUCache<string, L1Entry<unknown>>;
  private l1Hits = 0;
  private l1Misses = 0;

  // L2 — Redis
  private readonly redis: Redis;
  private l2Hits = 0;
  private l2Misses = 0;

  // L3 — PostgreSQL
  private readonly pool: Pool;
  private l3Hits = 0;
  private l3Misses = 0;
  private l3Ready = false;

  constructor(namespace = 'default') {
    this.namespace = namespace;

    // ---- L1 ----------------------------------------------------------------
    this.l1 = new LRUCache<string, L1Entry<unknown>>({
      max: L1_MAX_SIZE,
      // lru-cache v10: use `sizeCalculation` + `maxSize` for byte-based sizing,
      // or just `max` for item-count limiting (simpler, chosen here).
    });

    // ---- L2 ----------------------------------------------------------------
    this.redis = new Redis(process.env.REDIS_URL as string);
    this.redis.on('error', (err) =>
      Logger.error('[CacheManager] Redis error', err),
    );

    // ---- L3 ----------------------------------------------------------------
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    });

    // Ensure the L3 table exists without blocking the constructor
    this.ensureL3Table().catch((err) =>
      Logger.error('[CacheManager] Failed to initialise L3 table', err),
    );

    Logger.info('[CacheManager] Initialised', { namespace });
  }

  // -------------------------------------------------------------------------
  // Core API
  // -------------------------------------------------------------------------

  /**
   * Read from L1 → L2 → L3 in order.
   * Populates higher tiers automatically (cache-aside) unless `noBackfill`.
   */
  async get<T>(key: string, options: GetOptions = {}): Promise<T | null> {
    const tiers = options.tiers ?? ['L1', 'L2', 'L3'];
    const noBackfill = options.noBackfill ?? false;

    // ---- L1 ----------------------------------------------------------------
    if (tiers.includes('L1')) {
      const hit = this.l1Get<T>(key);
      if (hit !== null) {
        this.l1Hits++;
        return hit;
      }
      this.l1Misses++;
    }

    // ---- L2 ----------------------------------------------------------------
    if (tiers.includes('L2')) {
      const hit = await this.l2Get<T>(key);
      if (hit !== null) {
        this.l2Hits++;
        if (!noBackfill && tiers.includes('L1')) {
          // We don't know the original TTL; use a sensible default for backfill
          this.l1Set(key, hit.value, DEFAULT_TTL, hit.tags);
        }
        return hit.value;
      }
      this.l2Misses++;
    }

    // ---- L3 ----------------------------------------------------------------
    if (tiers.includes('L3') && this.l3Ready) {
      const hit = await this.l3Get<T>(key);
      if (hit !== null) {
        this.l3Hits++;
        if (!noBackfill) {
          const backfillOpts: SetOptions = {
            ttl: DEFAULT_TTL,
            tiers: tiers.filter((t) => t !== 'L3') as CacheTier[],
            tags: hit.tags,
          };
          // Fire-and-forget: don't delay the response
          this.set(key, hit.value, backfillOpts).catch((err) =>
            Logger.error('[CacheManager] L3->upper backfill failed', err),
          );
        }
        return hit.value;
      }
      this.l3Misses++;
    }

    return null;
  }

  /**
   * Write-through: stores the value in all specified tiers simultaneously.
   */
  async set<T>(key: string, value: T, options: SetOptions = {}): Promise<void> {
    const ttl = options.ttl ?? DEFAULT_TTL;
    const tiers = options.tiers ?? ['L1', 'L2', 'L3'];
    const tags = options.tags ?? [];

    const writes: Promise<void>[] = [];

    if (tiers.includes('L1')) {
      this.l1Set(key, value, ttl, tags);
    }

    if (tiers.includes('L2')) {
      writes.push(this.l2Set(key, value, ttl, tags));
    }

    if (tiers.includes('L3') && this.l3Ready) {
      writes.push(this.l3Set(key, value, ttl, tags));
    }

    await Promise.all(writes);
  }

  /** Remove an entry from all tiers. */
  async delete(key: string): Promise<void> {
    const full = this.fullKey(key);
    this.l1.delete(full);

    await Promise.all([
      this.redis.del(redisValueKey(this.namespace, key)),
      this.l3Delete(key),
    ]);

    Logger.info('[CacheManager] Deleted key', { key, namespace: this.namespace });
  }

  /**
   * Invalidate all entries carrying a given tag across every tier.
   * Returns the total number of entries removed.
   */
  async invalidateByTag(tag: string): Promise<number> {
    let removed = 0;

    // --- L1: scan in-process LRU -------------------------------------------
    for (const [k, entry] of this.l1.entries()) {
      if ((entry as L1Entry<unknown>).tags.includes(tag)) {
        this.l1.delete(k);
        removed++;
      }
    }

    // --- L2: use Redis SET to track keys per tag ---------------------------
    const tagKey = redisTagKey(this.namespace, tag);
    const members = await this.redis.smembers(tagKey);

    if (members.length > 0) {
      const pipeline = this.redis.pipeline();
      for (const member of members) {
        pipeline.del(redisValueKey(this.namespace, member));
      }
      pipeline.del(tagKey);
      await pipeline.exec();
      removed += members.length;
    }

    // --- L3 ----------------------------------------------------------------
    if (this.l3Ready) {
      const result = await this.l3DeleteByTag(tag);
      removed += result;
    }

    Logger.info('[CacheManager] Invalidated by tag', {
      tag,
      namespace: this.namespace,
      removed,
    });

    return removed;
  }

  /**
   * Returns the cached value for `key`, or — on a miss — calls `factory`,
   * stores its result, and returns it.
   */
  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    options: SetOptions = {},
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    const value = await factory();
    await this.set(key, value, options);
    return value;
  }

  /** Per-tier statistics snapshot. */
  stats(): CacheStats {
    const l1Total = this.l1Hits + this.l1Misses;
    const l2Total = this.l2Hits + this.l2Misses;
    const l3Total = this.l3Hits + this.l3Misses;

    return {
      L1: {
        hits: this.l1Hits,
        misses: this.l1Misses,
        hitRate: l1Total > 0 ? this.l1Hits / l1Total : 0,
        size: this.l1.size,
      },
      L2: {
        hits: this.l2Hits,
        misses: this.l2Misses,
        hitRate: l2Total > 0 ? this.l2Hits / l2Total : 0,
        size: 0, // Redis size not tracked locally
      },
      L3: {
        hits: this.l3Hits,
        misses: this.l3Misses,
        hitRate: l3Total > 0 ? this.l3Hits / l3Total : 0,
        size: 0, // PG row count not tracked locally
      },
    };
  }

  /**
   * Flush one tier (or all tiers if omitted).
   * L1 flush is synchronous; L2/L3 are async.
   */
  async flush(tier?: CacheTier): Promise<void> {
    const targets = tier ? [tier] : (['L1', 'L2', 'L3'] as CacheTier[]);

    if (targets.includes('L1')) {
      this.l1.clear();
      Logger.info('[CacheManager] L1 flushed', { namespace: this.namespace });
    }

    if (targets.includes('L2')) {
      // Only flush keys in this namespace
      const pattern = `cache:${this.namespace}:*`;
      await this.redisScanAndDelete(pattern);
      Logger.info('[CacheManager] L2 flushed', { namespace: this.namespace });
    }

    if (targets.includes('L3') && this.l3Ready) {
      await this.pool.query(
        `DELETE FROM ${L3_TABLE} WHERE namespace = $1`,
        [this.namespace],
      );
      Logger.info('[CacheManager] L3 flushed', { namespace: this.namespace });
    }
  }

  /**
   * Returns a new CacheManager bound to a different namespace while sharing
   * the same underlying connections.
   */
  withNamespace(ns: string): CacheManager {
    return new CacheManager(ns);
  }

  // -------------------------------------------------------------------------
  // L1 helpers (synchronous)
  // -------------------------------------------------------------------------

  private l1Set<T>(key: string, value: T, ttlSeconds: number, tags: string[]): void {
    const full = this.fullKey(key);
    const entry: L1Entry<T> = {
      value,
      expiresAt: Date.now() + ttlSeconds * 1_000,
      tags,
    };
    this.l1.set(full, entry as L1Entry<unknown>, {
      // lru-cache v10 per-item TTL support
      ttl: ttlSeconds * 1_000,
    });
  }

  private l1Get<T>(key: string): T | null {
    const full = this.fullKey(key);
    const entry = this.l1.get(full) as L1Entry<T> | undefined;
    if (!entry) return null;
    // Double-check expiry (lru-cache handles it, but be explicit)
    if (Date.now() > entry.expiresAt) {
      this.l1.delete(full);
      return null;
    }
    return entry.value;
  }

  // -------------------------------------------------------------------------
  // L2 helpers (Redis)
  // -------------------------------------------------------------------------

  private async l2Set<T>(
    key: string,
    value: T,
    ttlSeconds: number,
    tags: string[],
  ): Promise<void> {
    const vKey = redisValueKey(this.namespace, key);
    const envelope: L2Envelope<T> = {
      value,
      tags,
      storedAt: Date.now(),
    };

    const pipeline = this.redis.pipeline();
    pipeline.set(vKey, JSON.stringify(envelope), 'EX', ttlSeconds);

    // Register the key under each tag SET (with matching TTL)
    for (const tag of tags) {
      const tKey = redisTagKey(this.namespace, tag);
      pipeline.sadd(tKey, key);
      pipeline.expire(tKey, ttlSeconds * 2);
    }

    await pipeline.exec();
  }

  private async l2Get<T>(
    key: string,
  ): Promise<{ value: T; tags: string[] } | null> {
    const raw = await this.redis.get(redisValueKey(this.namespace, key));
    if (!raw) return null;

    try {
      const envelope = JSON.parse(raw) as L2Envelope<T>;
      return { value: envelope.value, tags: envelope.tags };
    } catch (err) {
      Logger.error('[CacheManager] L2 JSON parse error', err);
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // L3 helpers (PostgreSQL)
  // -------------------------------------------------------------------------

  private async ensureL3Table(): Promise<void> {
    const ddl = `
      CREATE TABLE IF NOT EXISTS ${L3_TABLE} (
        id          BIGSERIAL     PRIMARY KEY,
        namespace   TEXT          NOT NULL,
        cache_key   TEXT          NOT NULL,
        value       JSONB         NOT NULL,
        tags        TEXT[]        NOT NULL DEFAULT '{}',
        expires_at  TIMESTAMPTZ   NOT NULL,
        created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        UNIQUE (namespace, cache_key)
      );

      CREATE INDEX IF NOT EXISTS idx_${L3_TABLE}_ns_key
        ON ${L3_TABLE} (namespace, cache_key);

      CREATE INDEX IF NOT EXISTS idx_${L3_TABLE}_tags
        ON ${L3_TABLE} USING GIN (tags);

      CREATE INDEX IF NOT EXISTS idx_${L3_TABLE}_expires
        ON ${L3_TABLE} (expires_at);
    `;

    await this.pool.query(ddl);
    this.l3Ready = true;
    Logger.info('[CacheManager] L3 table ready');
  }

  private async l3Set<T>(
    key: string,
    value: T,
    ttlSeconds: number,
    tags: string[],
  ): Promise<void> {
    if (!this.l3Ready) return;

    const sql = `
      INSERT INTO ${L3_TABLE} (namespace, cache_key, value, tags, expires_at)
      VALUES ($1, $2, $3::jsonb, $4, NOW() + ($5 || ' seconds')::interval)
      ON CONFLICT (namespace, cache_key) DO UPDATE
        SET value      = EXCLUDED.value,
            tags       = EXCLUDED.tags,
            expires_at = EXCLUDED.expires_at,
            created_at = NOW()
    `;

    await this.pool.query(sql, [
      this.namespace,
      key,
      JSON.stringify(value),
      tags,
      ttlSeconds.toString(),
    ]);
  }

  private async l3Get<T>(
    key: string,
  ): Promise<{ value: T; tags: string[] } | null> {
    if (!this.l3Ready) return null;

    const sql = `
      SELECT value, tags
      FROM   ${L3_TABLE}
      WHERE  namespace = $1
        AND  cache_key = $2
        AND  expires_at > NOW()
      LIMIT  1
    `;

    const result = await this.pool.query(sql, [this.namespace, key]);
    if (result.rowCount === 0) return null;

    const row = result.rows[0];
    return { value: row.value as T, tags: row.tags as string[] };
  }

  private async l3Delete(key: string): Promise<void> {
    if (!this.l3Ready) return;

    await this.pool.query(
      `DELETE FROM ${L3_TABLE} WHERE namespace = $1 AND cache_key = $2`,
      [this.namespace, key],
    );
  }

  private async l3DeleteByTag(tag: string): Promise<number> {
    if (!this.l3Ready) return 0;

    const result = await this.pool.query(
      `DELETE FROM ${L3_TABLE} WHERE namespace = $1 AND $2 = ANY(tags)`,
      [this.namespace, tag],
    );

    return result.rowCount ?? 0;
  }

  // -------------------------------------------------------------------------
  // Misc helpers
  // -------------------------------------------------------------------------

  /** Namespaced L1 key (avoids collisions across CacheManager instances). */
  private fullKey(key: string): string {
    return `${this.namespace}:${key}`;
  }

  /**
   * SCAN-based deletion for Redis namespace flush.
   * Uses SCAN to avoid blocking the server with KEYS.
   */
  private async redisScanAndDelete(pattern: string): Promise<void> {
    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        200,
      );
      cursor = nextCursor;

      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } while (cursor !== '0');
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const cacheManager = new CacheManager();
