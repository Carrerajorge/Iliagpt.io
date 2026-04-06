import type { Request, Response, NextFunction } from "express";
import type { PareContext } from "./pareRequestContract";

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

// NOTE: These stores are in-process (per-replica) when Redis is not configured.
// For multi-instance deployments, set REDIS_URL to share state across replicas
// (Redis-backed PARE rate limiting can be added here via redis INCRBY + EXPIRE).
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

  return function pareRateLimiterMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    const pareContext: PareContext | undefined = req.pareContext;
    
    if (!pareContext) {
      console.error(JSON.stringify({
        level: "error",
        event: "PARE_RATE_LIMITER_NO_CONTEXT",
        message: "pareRequestContract middleware must be applied before pareRateLimiter",
        path: req.path,
        timestamp: new Date().toISOString(),
      }));
      return next(new Error("PARE context not initialized"));
    }
    
    const { requestId, clientIp, userId } = pareContext;
    
    const ipKey = `ip:${clientIp}`;
    const ipCount = getSlidingWindowCount(ipRateLimitStore, ipKey, ipWindowMs);
    
    if (ipCount >= ipMaxRequests) {
      const oldestTimestamp = getOldestTimestampInWindow(ipRateLimitStore, ipKey, ipWindowMs);
      const retryAfterMs = oldestTimestamp 
        ? (oldestTimestamp + ipWindowMs) - Date.now()
        : ipWindowMs;
      const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
      
      console.log(JSON.stringify({
        level: "warn",
        event: "PARE_RATE_LIMIT_EXCEEDED",
        requestId,
        limitType: "ip",
        clientIp,
        currentCount: ipCount + 1,
        maxRequests: ipMaxRequests,
        windowMs: ipWindowMs,
        retryAfterSeconds,
        timestamp: new Date().toISOString(),
      }));
      
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
        }
      });
      return;
    }
    
    recordRequest(ipRateLimitStore, ipKey);
    
    if (userId) {
      const userKey = `user:${userId}`;
      const userCount = getSlidingWindowCount(userRateLimitStore, userKey, userWindowMs);
      
      if (userCount >= userMaxRequests) {
        const oldestTimestamp = getOldestTimestampInWindow(userRateLimitStore, userKey, userWindowMs);
        const retryAfterMs = oldestTimestamp 
          ? (oldestTimestamp + userWindowMs) - Date.now()
          : userWindowMs;
        const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
        
        console.log(JSON.stringify({
          level: "warn",
          event: "PARE_RATE_LIMIT_EXCEEDED",
          requestId,
          limitType: "user",
          userId,
          clientIp,
          currentCount: userCount + 1,
          maxRequests: userMaxRequests,
          windowMs: userWindowMs,
          retryAfterSeconds,
          timestamp: new Date().toISOString(),
        }));
        
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
          }
        });
        return;
      }
      
      recordRequest(userRateLimitStore, userKey);
      
      const userRemaining = Math.max(0, userMaxRequests - userCount - 1);
      res.setHeader("X-RateLimit-Limit", userMaxRequests.toString());
      res.setHeader("X-RateLimit-Remaining", userRemaining.toString());
    } else {
      const ipRemaining = Math.max(0, ipMaxRequests - ipCount - 1);
      res.setHeader("X-RateLimit-Limit", ipMaxRequests.toString());
      res.setHeader("X-RateLimit-Remaining", ipRemaining.toString());
    }
    
    const resetTime = Date.now() + (userId ? userWindowMs : ipWindowMs);
    res.setHeader("X-RateLimit-Reset", Math.ceil(resetTime / 1000).toString());
    
    next();
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
