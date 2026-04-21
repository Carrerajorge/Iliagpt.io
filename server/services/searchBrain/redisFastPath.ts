/**
 * redisFastPath — optional Redis layer in front of the Postgres
 * search-brain cache.
 *
 * Order of lookup when enabled:
 *   Redis GET (hot, sub-ms) → Postgres exact/semantic → live fan-out.
 * Writes go to both Redis (SETEX with TTL) and Postgres so the
 * semantic-cache path still has rows to search across near-duplicate
 * queries.
 *
 * Gated on REDIS_URL. When unset, every function here is a no-op and
 * the consumer degrades to Postgres-only — same behaviour as before
 * Phase 1c-2.
 *
 * Intentionally stateless / stand-alone: the redisFastPath module
 * doesn't see the Postgres store and doesn't depend on searchCache.ts.
 * Orchestrator composes them. That keeps each layer testable in
 * isolation.
 */

import type { RedisClientLike } from "./redisClientFactory";
import { getRedisClient } from "./redisClientFactory";

export interface FastPathLookupArgs {
  kind: string;
  queryHash: string;
  client?: RedisClientLike; // for tests
}

export interface FastPathWriteArgs {
  kind: string;
  queryHash: string;
  payload: unknown;
  ttlSeconds: number;
  client?: RedisClientLike;
}

function redisKey(kind: string, queryHash: string): string {
  // Namespaced so a search-brain cache flush doesn't nuke unrelated keys.
  return `sb:${kind}:${queryHash}`;
}

/** Returns the cached payload if Redis holds it, else null. */
export async function redisLookup(args: FastPathLookupArgs): Promise<unknown | null> {
  const client = args.client ?? getRedisClient();
  if (!client) return null;
  try {
    const raw = await client.get(redisKey(args.kind, args.queryHash));
    if (!raw) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** Writes the payload to Redis with the given TTL. Silently swallows errors. */
export async function redisWrite(args: FastPathWriteArgs): Promise<void> {
  const client = args.client ?? getRedisClient();
  if (!client) return;
  try {
    const serialised = JSON.stringify(args.payload);
    await client.setex(redisKey(args.kind, args.queryHash), Math.max(60, args.ttlSeconds), serialised);
  } catch {
    // Cache writes must never break the user path.
  }
}

export const REDIS_FAST_PATH_INTERNAL = { redisKey };
