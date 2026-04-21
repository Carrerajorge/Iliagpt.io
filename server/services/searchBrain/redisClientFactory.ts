/**
 * redisClientFactory — narrow, lazy Redis handle for SearchBrain.
 *
 * Why a separate factory instead of reusing `server/lib/redis.ts`:
 *   - That shared singleton is disabled in development (by design —
 *     avoids Upstash quota cost during local dev).
 *   - SearchBrain's Redis fast-path is additive. If the operator has
 *     a local Redis, we want to use it; if not, the factory returns
 *     null and callers degrade to Postgres-only.
 *   - Keeping the client ingestion surface tiny lets tests inject a
 *     RedisClientLike stub without pulling `ioredis`.
 *
 * Gated on REDIS_URL — the operator opts in explicitly. The client is
 * built lazily on first use and cached for the process lifetime.
 */

export interface RedisClientLike {
  get(key: string): Promise<string | null>;
  setex(key: string, seconds: number, value: string): Promise<"OK" | string>;
}

let cachedClient: RedisClientLike | null | undefined;

/**
 * Returns a RedisClientLike when REDIS_URL is set and ioredis is
 * available, or null otherwise. Never throws.
 */
export function getRedisClient(): RedisClientLike | null {
  if (cachedClient !== undefined) return cachedClient;
  const url = process.env.REDIS_URL;
  if (!url) {
    cachedClient = null;
    return null;
  }
  try {
    // Lazy require so we don't pay the ioredis import cost unless
    // Redis is actually configured. ioredis is already in the project's
    // dependencies (used by server/lib/redis.ts).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Redis = require("ioredis") as { default?: unknown } | unknown;
    const Ctor = (Redis as { default?: unknown })?.default ?? Redis;
    if (typeof Ctor !== "function") {
      cachedClient = null;
      return null;
    }
    const RedisCtor = Ctor as new (url: string, opts: Record<string, unknown>) => RedisClientLike;
    const instance = new RedisCtor(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
    });
    cachedClient = instance;
    return instance;
  } catch {
    cachedClient = null;
    return null;
  }
}

/** Test-only: reset the cached handle so tests can toggle REDIS_URL. */
export function __resetRedisClient(): void {
  cachedClient = undefined;
}
