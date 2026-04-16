/**
 * Token-bucket rate limiter.
 * Uses Redis when available (multi-instance safe) and falls back to an
 * in-process Map when Redis is not configured (local dev / single-node).
 *
 * Configured via env:
 *   USER_RATE_LIMIT_CAPACITY       - max tokens per client (default 50)
 *   USER_RATE_LIMIT_REFILL_PER_SEC - tokens refilled per second (default 5)
 */
import type { Request, Response, NextFunction } from "express";

const CAPACITY = Number(process.env.USER_RATE_LIMIT_CAPACITY) || 50;
const REFILL_PER_SEC = Number(process.env.USER_RATE_LIMIT_REFILL_PER_SEC) || 5;
const REFILL_RATE_MS = REFILL_PER_SEC / 1000;

// ── In-process fallback ───────────────────────────────────────────────────────

const localStore = new Map<string, { tokens: number; lastRefill: number }>();

function checkLocalLimit(clientId: string): boolean {
  const now = Date.now();
  const record = localStore.get(clientId);

  if (!record) {
    localStore.set(clientId, { tokens: CAPACITY - 1, lastRefill: now });
    return true;
  }

  const elapsed = now - record.lastRefill;
  let tokens = Math.min(record.tokens + elapsed * REFILL_RATE_MS, CAPACITY);

  if (tokens >= 1) {
    localStore.set(clientId, { tokens: tokens - 1, lastRefill: now });
    return true;
  }

  return false;
}

// ── Redis-backed implementation ───────────────────────────────────────────────
// Uses INCR + EXPIRE as a sliding window for the refill logic.
// Falls back to local store if Redis is not available.

let redisClient: any | null = null;
let redisReady = false;

async function initRedis(): Promise<void> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return;
  try {
    const { default: IORedis } = await import("ioredis");
    redisClient = new IORedis(redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
    redisClient.on("ready", () => { redisReady = true; });
    redisClient.on("error", () => { redisReady = false; });
  } catch {
    // ioredis unavailable; stay with in-process store
  }
}

initRedis().catch(() => {});

async function checkRedisLimit(clientId: string): Promise<boolean | null> {
  if (!redisReady || !redisClient) return null;
  try {
    const windowMs = Math.ceil((1 / REFILL_PER_SEC) * 1000);
    const key = `rl:user:${clientId}`;
    const count = await redisClient.incr(key);
    if (count === 1) {
      await redisClient.pexpire(key, windowMs * CAPACITY);
    }
    return count <= CAPACITY;
  } catch {
    return null;
  }
}

// ── Public middleware ─────────────────────────────────────────────────────────

function getActor(req: Request): string {
  return (
    ((req as any)?.user?.claims?.sub as string | undefined) ||
    ((req as any)?.user?.id as string | undefined) ||
    req.ip ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

export async function rateLimiter(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const actor = getActor(req);

    const redisResult = await checkRedisLimit(actor);
    const allowed = redisResult !== null ? redisResult : checkLocalLimit(actor);

    if (!allowed) {
      res.status(429).json({ message: "Too many requests" });
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
}

// Legacy sync export — calls local fallback immediately
export class RateLimiter {
  checkLimit(clientId: string): boolean {
    return checkLocalLimit(clientId);
  }
}

export const rpcRateLimiter = new RateLimiter();
export const httpRateLimiter = new RateLimiter();

export function getRateLimitStats(): {
  rpcTrackedClients: number;
  httpTrackedClients: number;
  customTrackedKeys: number;
} {
  return {
    rpcTrackedClients: localStore.size,
    httpTrackedClients: localStore.size,
    customTrackedKeys: 0,
  };
}

// Sliding-window custom rate limiter (unchanged but with Retry-After header)
type CustomRateLimiterOptions = {
  windowMs: number;
  maxRequests: number;
  keyPrefix?: string;
  message?: string;
};

const customRateWindows = new Map<string, { count: number; resetAt: number }>();

export function createCustomRateLimiter(options: CustomRateLimiterOptions) {
  const {
    windowMs,
    maxRequests,
    keyPrefix = "rate-limit",
    message = "Rate limit exceeded",
  } = options;

  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    const actor = getActor(req) || ip;
    const key = `${keyPrefix}:${actor}`;
    const now = Date.now();
    const current = customRateWindows.get(key);

    if (!current || now >= current.resetAt) {
      customRateWindows.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    if (current.count >= maxRequests) {
      const retryAfterSec = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSec));
      res.status(429).json({ error: message });
      return;
    }

    current.count += 1;
    customRateWindows.set(key, current);
    next();
  };
}
