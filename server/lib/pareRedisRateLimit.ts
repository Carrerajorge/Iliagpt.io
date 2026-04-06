/**
 * Fixed-window Redis rate limit for PARE (shared across replicas).
 * Uses INCR + EXPIRE (same idea as userRateLimiter); window aligns to first hit per key.
 */
import type Redis from "ioredis";

export async function pareRedisFixedWindowAllow(
  client: Redis,
  redisKey: string,
  windowMs: number,
  maxRequests: number
): Promise<boolean> {
  const windowSec = Math.max(1, Math.ceil(windowMs / 1000));
  const n = await client.incr(redisKey);
  if (n === 1) {
    await client.expire(redisKey, windowSec);
  }
  return n <= maxRequests;
}
