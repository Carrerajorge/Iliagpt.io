import { createHash } from 'crypto';
import type Redis from 'ioredis';

export interface CacheStats {
  hits: number;
  misses: number;
  memorySize: number;
}

interface MemEntry { value: unknown; expiresAt: number }

/** TTL presets in milliseconds */
export const TTL = {
  EMBEDDINGS: 24 * 60 * 60 * 1000,
  USER_SESSIONS: 15 * 60 * 1000,
  MODEL_CONFIGS: 5 * 60 * 1000,
  RESPONSE_CACHE: 10 * 60 * 1000,
} as const;

export class CacheManager {
  private l1 = new Map<string, MemEntry>();
  private redis: Redis | null = null;
  private namespace: string;
  private hits = 0;
  private misses = 0;
  private cleanupTimer: ReturnType<typeof setInterval>;
  private eventMap = new Map<string, string[]>();

  constructor(namespace = 'cache:') {
    this.namespace = namespace;
    // Import the Redis singleton; degrade gracefully if unavailable
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { redis } = require('../lib/redis');
      if (redis && typeof redis.get === 'function') this.redis = redis;
    } catch {
      /* Redis not available — memory-only mode */
    }
    // Periodic L1 cleanup every 60s
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
  }

  // -- Core API -------------------------------------------------------------

  async get<T>(key: string): Promise<T | null> {
    const k = this.namespace + key;
    // L1 (memory)
    const entry = this.l1.get(k);
    if (entry && entry.expiresAt > Date.now()) { this.hits++; return entry.value as T; }
    if (entry) this.l1.delete(k);
    // L2 (Redis)
    if (this.redis) {
      try {
        const raw = await this.redis.get(k);
        if (raw !== null) { this.hits++; return JSON.parse(raw) as T; }
      } catch { /* Redis error — ignore */ }
    }
    this.misses++;
    return null;
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    const k = this.namespace + key;
    const ttl = ttlMs ?? TTL.RESPONSE_CACHE;
    this.l1.set(k, { value, expiresAt: Date.now() + ttl });
    if (this.redis) {
      try {
        await this.redis.set(k, JSON.stringify(value), 'EX', Math.max(1, Math.ceil(ttl / 1000)));
      } catch { /* Redis error — ignore */ }
    }
  }

  async del(key: string): Promise<void> {
    const k = this.namespace + key;
    this.l1.delete(k);
    if (this.redis) {
      try { await this.redis.del(k); } catch { /* ignore */ }
    }
  }

  async invalidatePattern(pattern: string): Promise<number> {
    let count = 0;
    const fullPattern = this.namespace + pattern;
    const regex = new RegExp('^' + fullPattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
    for (const k of this.l1.keys()) {
      if (regex.test(k)) { this.l1.delete(k); count++; }
    }
    if (this.redis) {
      try {
        let cursor = '0';
        do {
          const [next, keys] = await this.redis.scan(cursor, 'MATCH', fullPattern, 'COUNT', 200);
          cursor = next;
          if (keys.length) { await this.redis.del(...keys); count += keys.length; }
        } while (cursor !== '0');
      } catch { /* ignore */ }
    }
    return count;
  }

  getStats(): CacheStats {
    return { hits: this.hits, misses: this.misses, memorySize: this.l1.size };
  }

  // -- Convenience ----------------------------------------------------------

  async getOrSet<T>(key: string, factory: () => Promise<T>, ttlMs?: number): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;
    const value = await factory();
    await this.set(key, value, ttlMs);
    return value;
  }

  async cachedEmbedding(text: string, embedFn: () => Promise<number[]>): Promise<number[]> {
    const hash = createHash('sha256').update(text).digest('hex');
    return this.getOrSet<number[]>(`emb:${hash}`, embedFn, TTL.EMBEDDINGS);
  }

  // -- Event-based invalidation ---------------------------------------------

  onEvent(event: string, patterns: string[]): void {
    const existing = this.eventMap.get(event) ?? [];
    this.eventMap.set(event, [...existing, ...patterns]);
  }

  async emitEvent(event: string): Promise<void> {
    const patterns = this.eventMap.get(event);
    if (!patterns) return;
    await Promise.all(patterns.map((p) => this.invalidatePattern(p)));
  }

  // -- Internal -------------------------------------------------------------

  private cleanup(): void {
    const now = Date.now();
    for (const [k, entry] of this.l1) {
      if (entry.expiresAt <= now) this.l1.delete(k);
    }
  }

  destroy(): void {
    clearInterval(this.cleanupTimer);
  }
}

export const cacheManager = new CacheManager();
