import type { Request, Response, NextFunction } from "express";
import type { PareContext } from "./pareRequestContract";
import { pareRedisFixedWindowAllow } from "../lib/pareRedisRateLimit";

interface SlidingWindowEntry {
  timestamps: number[];
}

interface PareRateLimiterConfig {
  ipWindowMs: number;
  ipMaxRequests: number;
  userWindowMs: number;
  userMaxRequests: number;
}

const DEFAULT_CONFIG: PareRateLimiterConfig = {
  ipWindowMs: 60000,
  ipMaxRequests: parseInt(process.env.PARE_RATE_LIMIT_IP_MAX || "300", 10),
  userWindowMs: 60000,
  userMaxRequests: parseInt(process.env.PARE_RATE_LIMIT_USER_MAX || "150", 10),
};

let pareRedisClient: import("ioredis").default | null = null;
let pareRedisReady = false;

async function initPareRedisForLimiter(): Promise<void> {
  if (process.env.NODE_ENV === "test" && process.env.ENABLE_QUEUES_IN_TEST !== "true") {
    return;
  }
  const url = process.env.REDIS_URL;
  if (!url) return;
  try {
    const { default: IORedis } = await import("ioredis");
    pareRedisClient = new IORedis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
    pareRedisClient.on("ready", () => {
      pareRedisReady = true;
    });
    pareRedisClient.on("error", () => {
      pareRedisReady = false;
    });
  } catch {
    pareRedisClient = null;
  }
}

void initPareRedisForLimiter();

/** Wall-clock bucket so limits reset predictably across replicas. */
function pareRedisKey(prefix: string, windowMs: number): string {
  const bucket = Math.floor(Date.now() / windowMs);
  return `${prefix}:b${bucket}`;
}

async function tryPareRedisAllow(
  prefix: string,
  windowMs: number,
  maxRequests: number
): Promise<boolean | null> {
  if (!pareRedisReady || !pareRedisClient) return null;
  try {
    const key = pareRedisKey(prefix, windowMs);
    return await pareRedisFixedWindowAllow(pareRedisClient, key, windowMs, maxRequests);
  } catch {
    return null;
  }
}

const ipRateLimitStore: Map<string, SlidingWindowEntry> = new Map();
const userRateLimitStore: Map<string, SlidingWindowEntry> = new Map();

if (!process.env.REDIS_URL) {
  console.warn(
    "[PareRateLimiter] REDIS_URL not set — rate limits are per-process. " +
    "Set REDIS_URL to share limits across replicas in multi-instance deployments."
  );
}

const CLEANUP_INTERVAL_MS = 60000;

function getSlidingWindowCount(store: Map<string, SlidingWindowEntry>, key: string, windowMs: number): number {
  const now = Date.now();
  const entry = store.get(key);
  
  if (!entry) {
    return 0;
  }
  
  const windowStart = now - windowMs;
  const validTimestamps = entry.timestamps.filter(ts => ts > windowStart);
  entry.timestamps = validTimestamps;
  
  return validTimestamps.length;
}

function recordRequest(store: Map<string, SlidingWindowEntry>, key: string): void {
  const now = Date.now();
  let entry = store.get(key);
  
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }
  
  entry.timestamps.push(now);
}

function getOldestTimestampInWindow(store: Map<string, SlidingWindowEntry>, key: string, windowMs: number): number | null {
  const now = Date.now();
  const entry = store.get(key);
  
  if (!entry || entry.timestamps.length === 0) {
    return null;
  }
  
  const windowStart = now - windowMs;
  const validTimestamps = entry.timestamps.filter(ts => ts > windowStart);
  
  if (validTimestamps.length === 0) {
    return null;
  }
  
  return Math.min(...validTimestamps);
}

function cleanupExpiredEntries(store: Map<string, SlidingWindowEntry>, windowMs: number): number {
  const now = Date.now();
  let cleanedCount = 0;
  
  for (const [key, entry] of store.entries()) {
    const validTimestamps = entry.timestamps.filter(ts => now - ts < windowMs * 2);
    
    if (validTimestamps.length === 0) {
      store.delete(key);
      cleanedCount++;
    } else {
      entry.timestamps = validTimestamps;
    }
  }
  
  return cleanedCount;
}

setInterval(() => {
  const ipCleaned = cleanupExpiredEntries(ipRateLimitStore, DEFAULT_CONFIG.ipWindowMs);
  const userCleaned = cleanupExpiredEntries(userRateLimitStore, DEFAULT_CONFIG.userWindowMs);
  
  if (ipCleaned > 0 || userCleaned > 0) {
    console.log(JSON.stringify({
      level: "debug",
      event: "PARE_RATE_LIMIT_CLEANUP",
      ipEntriesCleaned: ipCleaned,
      userEntriesCleaned: userCleaned,
      ipEntriesRemaining: ipRateLimitStore.size,
      userEntriesRemaining: userRateLimitStore.size,
      timestamp: new Date().toISOString(),
    }));
  }
}, CLEANUP_INTERVAL_MS);

export function pareRateLimiter(config: Partial<PareRateLimiterConfig> = {}) {
  const {
    ipWindowMs = DEFAULT_CONFIG.ipWindowMs,
    ipMaxRequests = DEFAULT_CONFIG.ipMaxRequests,
    userWindowMs = DEFAULT_CONFIG.userWindowMs,
    userMaxRequests = DEFAULT_CONFIG.userMaxRequests,
  } = config;

  return async function pareRateLimiterMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const pareContext: PareContext | undefined = req.pareContext;

      if (!pareContext) {
        console.error(
          JSON.stringify({
            level: "error",
            event: "PARE_RATE_LIMITER_NO_CONTEXT",
            message: "pareRequestContract middleware must be applied before pareRateLimiter",
            path: req.path,
            timestamp: new Date().toISOString(),
          })
        );
        return next(new Error("PARE context not initialized"));
      }

      const { requestId, clientIp, userId } = pareContext;
      const ipKey = `ip:${clientIp}`;

      let ipUsedRedis = false;
      const redisIpAllow = await tryPareRedisAllow(`pare:rl:${ipKey}`, ipWindowMs, ipMaxRequests);
      if (redisIpAllow === null) {
        const ipCount = getSlidingWindowCount(ipRateLimitStore, ipKey, ipWindowMs);
        if (ipCount >= ipMaxRequests) {
          const oldestTimestamp = getOldestTimestampInWindow(ipRateLimitStore, ipKey, ipWindowMs);
          const retryAfterMs = oldestTimestamp
            ? oldestTimestamp + ipWindowMs - Date.now()
            : ipWindowMs;
          const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
          console.log(
            JSON.stringify({
              level: "warn",
              event: "PARE_RATE_LIMIT_EXCEEDED",
              requestId,
              limitType: "ip",
              clientIp,
              backend: "memory",
              currentCount: ipCount + 1,
              maxRequests: ipMaxRequests,
              windowMs: ipWindowMs,
              retryAfterSeconds,
              timestamp: new Date().toISOString(),
            })
          );
          res.setHeader("Retry-After", retryAfterSeconds.toString());
          res.setHeader("X-RateLimit-Limit", ipMaxRequests.toString());
          res.setHeader("X-RateLimit-Remaining", "0");
          res.setHeader("X-RateLimit-Reset", Math.ceil((Date.now() + retryAfterMs) / 1000).toString());
          res.status(429).json({
            error: {
              code: "TOO_MANY_REQUESTS",
              message: "Rate limit exceeded. Please slow down your requests.",
              requestId,
              retryAfter: retryAfterSeconds,
              limitType: "ip",
            },
          });
          return;
        }
        recordRequest(ipRateLimitStore, ipKey);
      } else if (!redisIpAllow) {
        const retryAfterSeconds = Math.max(1, Math.ceil(ipWindowMs / 1000));
        console.log(
          JSON.stringify({
            level: "warn",
            event: "PARE_RATE_LIMIT_EXCEEDED",
            requestId,
            limitType: "ip",
            clientIp,
            backend: "redis",
            maxRequests: ipMaxRequests,
            windowMs: ipWindowMs,
            retryAfterSeconds,
            timestamp: new Date().toISOString(),
          })
        );
        res.setHeader("Retry-After", retryAfterSeconds.toString());
        res.setHeader("X-RateLimit-Limit", ipMaxRequests.toString());
        res.setHeader("X-RateLimit-Remaining", "0");
        res.setHeader("X-RateLimit-Reset", Math.ceil((Date.now() + ipWindowMs) / 1000).toString());
        res.status(429).json({
          error: {
            code: "TOO_MANY_REQUESTS",
            message: "Rate limit exceeded. Please slow down your requests.",
            requestId,
            retryAfter: retryAfterSeconds,
            limitType: "ip",
          },
        });
        return;
      } else {
        ipUsedRedis = true;
      }

      if (userId) {
        const userKey = `user:${userId}`;
        const redisUserAllow = await tryPareRedisAllow(`pare:rl:${userKey}`, userWindowMs, userMaxRequests);
        if (redisUserAllow === null) {
          const userCount = getSlidingWindowCount(userRateLimitStore, userKey, userWindowMs);
          if (userCount >= userMaxRequests) {
            const oldestTimestamp = getOldestTimestampInWindow(userRateLimitStore, userKey, userWindowMs);
            const retryAfterMs = oldestTimestamp
              ? oldestTimestamp + userWindowMs - Date.now()
              : userWindowMs;
            const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
            console.log(
              JSON.stringify({
                level: "warn",
                event: "PARE_RATE_LIMIT_EXCEEDED",
                requestId,
                limitType: "user",
                userId,
                clientIp,
                backend: "memory",
                currentCount: userCount + 1,
                maxRequests: userMaxRequests,
                windowMs: userWindowMs,
                retryAfterSeconds,
                timestamp: new Date().toISOString(),
              })
            );
            res.setHeader("Retry-After", retryAfterSeconds.toString());
            res.setHeader("X-RateLimit-Limit", userMaxRequests.toString());
            res.setHeader("X-RateLimit-Remaining", "0");
            res.setHeader("X-RateLimit-Reset", Math.ceil((Date.now() + retryAfterMs) / 1000).toString());
            res.status(429).json({
              error: {
                code: "TOO_MANY_REQUESTS",
                message: "User rate limit exceeded. Please slow down your requests.",
                requestId,
                retryAfter: retryAfterSeconds,
                limitType: "user",
              },
            });
            return;
          }
          recordRequest(userRateLimitStore, userKey);
          const userRemaining = Math.max(0, userMaxRequests - userCount - 1);
          res.setHeader("X-RateLimit-Limit", userMaxRequests.toString());
          res.setHeader("X-RateLimit-Remaining", userRemaining.toString());
        } else if (!redisUserAllow) {
          const retryAfterSeconds = Math.max(1, Math.ceil(userWindowMs / 1000));
          console.log(
            JSON.stringify({
              level: "warn",
              event: "PARE_RATE_LIMIT_EXCEEDED",
              requestId,
              limitType: "user",
              userId,
              clientIp,
              backend: "redis",
              maxRequests: userMaxRequests,
              windowMs: userWindowMs,
              retryAfterSeconds,
              timestamp: new Date().toISOString(),
            })
          );
          res.setHeader("Retry-After", retryAfterSeconds.toString());
          res.setHeader("X-RateLimit-Limit", userMaxRequests.toString());
          res.setHeader("X-RateLimit-Remaining", "0");
          res.setHeader("X-RateLimit-Reset", Math.ceil((Date.now() + userWindowMs) / 1000).toString());
          res.status(429).json({
            error: {
              code: "TOO_MANY_REQUESTS",
              message: "User rate limit exceeded. Please slow down your requests.",
              requestId,
              retryAfter: retryAfterSeconds,
              limitType: "user",
            },
          });
          return;
        } else {
          res.setHeader("X-RateLimit-Limit", userMaxRequests.toString());
          res.setHeader("X-RateLimit-Remaining", String(Math.max(0, userMaxRequests - 1)));
        }
      } else if (!ipUsedRedis) {
        const ipCount = getSlidingWindowCount(ipRateLimitStore, ipKey, ipWindowMs);
        const ipRemaining = Math.max(0, ipMaxRequests - ipCount);
        res.setHeader("X-RateLimit-Limit", ipMaxRequests.toString());
        res.setHeader("X-RateLimit-Remaining", ipRemaining.toString());
      } else {
        res.setHeader("X-RateLimit-Limit", ipMaxRequests.toString());
        res.setHeader("X-RateLimit-Remaining", String(Math.max(0, ipMaxRequests - 1)));
      }

      const resetTime = Date.now() + (userId ? userWindowMs : ipWindowMs);
      res.setHeader("X-RateLimit-Reset", Math.ceil(resetTime / 1000).toString());

      next();
    } catch (err) {
      next(err);
    }
  };
}

export function clearPareRateLimitStores(): void {
  ipRateLimitStore.clear();
  userRateLimitStore.clear();
  console.log(JSON.stringify({
    level: "info",
    event: "PARE_RATE_LIMIT_STORES_CLEARED",
    timestamp: new Date().toISOString(),
  }));
}

export function getPareRateLimitStats(): {
  ipEntriesCount: number;
  userEntriesCount: number;
} {
  return {
    ipEntriesCount: ipRateLimitStore.size,
    userEntriesCount: userRateLimitStore.size,
  };
}

export { ipRateLimitStore, userRateLimitStore };
