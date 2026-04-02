import { RateLimiterRedis, RateLimiterMemory } from "rate-limiter-flexible";
import { Request, Response, NextFunction } from "express";
import { createClient } from "redis";
import crypto from "crypto";
import { getSecureUserId } from "../lib/anonUserHelper";

// Cliente Redis para Rate Limiter — with aggressive timeouts to prevent startup hangs
const REDIS_CONNECT_TIMEOUT_MS = 3_000;
const redisClient = createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
  password: process.env.REDIS_PASSWORD,
  socket: {
    connectTimeoutMs: REDIS_CONNECT_TIMEOUT_MS,
    reconnectStrategy: (retries: number) => {
      // Give up after 3 retries to avoid blocking startup
      if (retries > 3) return false as unknown as number;
      return Math.min(retries * 200, 1000);
    },
  },
});

redisClient.on("error", (error) => {
  // Only log once per minute to avoid log spam
  const now = Date.now();
  if (now - _lastRedisErrorLog > 60_000) {
    console.error("[RateLimiter] Redis client error:", error?.message || error);
    _lastRedisErrorLog = now;
  }
});
let _lastRedisErrorLog = 0;

let rateLimiterGlobal: RateLimiterRedis | RateLimiterMemory;
let rateLimiterAuth: RateLimiterRedis | RateLimiterMemory;
let rateLimiterAi: RateLimiterRedis | RateLimiterMemory;
const MAX_KEY_LENGTH = 256;
const MAX_IP_LENGTH = 128;
const MAX_USER_ID_LENGTH = 128;

// Health endpoints must NEVER be blocked by rate limiting
const RATE_LIMIT_EXEMPT_PREFIXES: ReadonlyArray<string> = [
  "/api/health",
  "/health",
];

function isExemptPath(req: Request): boolean {
  const url = req.originalUrl || req.url;
  return RATE_LIMIT_EXEMPT_PREFIXES.some(
    (prefix) => url === prefix || url.startsWith(prefix + "/") || url.startsWith(prefix + "?")
  );
}

// Observability: track which backend is active
let rateLimiterBackend: "redis" | "memory" | "initializing" = "initializing";

export function getRateLimiterStatus(): {
  initialized: boolean;
  backend: "redis" | "memory" | "initializing";
} {
  return { initialized, backend: rateLimiterBackend };
}

function sanitizeRateLimitKey(part: unknown): string {
  const raw = String(part || "").trim().toLowerCase();
  if (!raw) return "";
  return raw.slice(0, MAX_KEY_LENGTH);
}

// Track initialization state
let initialized = false;

// Inicialización asíncrona segura
const initLimiterPromise = (async () => {
  try {
    const isDev = process.env.NODE_ENV !== "production";
    if (process.env.REDIS_URL && !isDev) {
      // Race the connect against a hard timeout to prevent indefinite hangs
      const connectWithTimeout = Promise.race([
        redisClient.connect(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Redis connect timeout")), REDIS_CONNECT_TIMEOUT_MS + 1_000)
        ),
      ]);
      await connectWithTimeout;
      console.log("[RateLimiter] Redis connected");

      rateLimiterGlobal = new RateLimiterRedis({
        storeClient: redisClient,
        keyPrefix: "middleware_global",
        points: 600,
        duration: 60,
        blockDuration: 0,
        insuranceLimiter: new RateLimiterMemory({ points: 600, duration: 60 }),
      });

      rateLimiterAuth = new RateLimiterRedis({
        storeClient: redisClient,
        keyPrefix: "middleware_auth",
        points: 15,
        duration: 60 * 15,
        blockDuration: 60 * 5,
        insuranceLimiter: new RateLimiterMemory({ points: 15, duration: 60 * 15 }),
      });

      rateLimiterAi = new RateLimiterRedis({
        storeClient: redisClient,
        keyPrefix: "middleware_ai",
        points: 120,
        duration: 60,
        blockDuration: 0,
        insuranceLimiter: new RateLimiterMemory({ points: 120, duration: 60 }),
      });

      rateLimiterBackend = "redis";
    } else {
      throw new Error("No Redis URL");
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[RateLimiter] Redis connection failed, falling back to in-memory rate limiting: ${reason}`);
    // Fallback to memory — better to have per-process rate limits than no site at all
    rateLimiterGlobal = new RateLimiterMemory({
      points: 600,
      duration: 60,
    });
    rateLimiterAuth = new RateLimiterMemory({
      points: 15,
      duration: 60 * 15,
    });
    rateLimiterAi = new RateLimiterMemory({
      points: 120,
      duration: 60,
    });
    rateLimiterBackend = "memory";
  }
  initialized = true;
})();

async function waitForRateLimiterInit(timeoutMs = 5000): Promise<boolean> {
  const start = Date.now();
  while (!initialized && Date.now() - start < timeoutMs) {
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  return initialized;
}

/**
 * Security: extract the real client IP behind reverse proxies.
 * Trusts X-Forwarded-For only when app.set('trust proxy') is enabled,
 * which makes req.ip return the correct client IP.
 * As a fallback, we use req.ip which Express resolves based on trust proxy setting.
 */
function getClientKey(req: Request): string {
    // Prefer stable user/session identity when available.
    const userId = sanitizeRateLimitKey(getSecureUserId(req));
    if (userId) {
      if (userId.length <= MAX_USER_ID_LENGTH) {
        return `user:${userId}`;
      }
    }

  // Prefer authenticated user ID for per-user limiting
  // Use req.ip which respects Express 'trust proxy' setting
  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  const normalizedIp = sanitizeRateLimitKey(
    typeof ip === "string" && ip.length <= MAX_IP_LENGTH
      ? ip
      : String(ip).slice(0, MAX_IP_LENGTH)
  );

  if (!normalizedIp) {
    return "unknown";
  }

  // Security: normalize IPv6-mapped IPv4 addresses and sanitize brackets
  if (normalizedIp.startsWith("::ffff:")) {
    return `ip:${normalizedIp.slice(7)}`;
  }

  if (normalizedIp.startsWith("[") && normalizedIp.includes("]")) {
    return `ip:${normalizedIp.replace("[", "").replace("]", "")}`;
  }

  return `ip:${normalizedIp}`;
}

const consumeLimiter = async (
  getLimiter: () => RateLimiterRedis | RateLimiterMemory | undefined,
  req: Request,
  res: Response,
  next: NextFunction
) => {
    // Force bypass in development to avoid Upstash quota issues
    if (process.env.NODE_ENV === "development" || process.env.BYPASS_RATE_LIMIT === "true") {
      return next();
    }
  
  // Bypass rate limiting in development
  if (process.env.NODE_ENV === "development") {
    return next();
  }

  // Security: during startup/init issues, fail closed for a short window.
  let limiter = getLimiter();
  if (!initialized || !limiter) {
    const ready = await waitForRateLimiterInit();
    limiter = getLimiter();
    if (!ready || !limiter) {
      console.error("[RateLimiter] Not initialized, request blocked to preserve security guarantees.");
      res.status(503).json({
        status: "error",
        message: "Rate limiter not ready. Retry in a few seconds.",
      });
      return;
    }
  }

  const key = getClientKey(req);
  if (!key || key.length > MAX_KEY_LENGTH) {
    res.status(400).json({
      status: "error",
      message: "Invalid client key",
    });
    return;
  }

  const keyHash = key.length > 64 ? crypto.createHash("sha256").update(key).digest("hex") : key;

  limiter
    .consume(keyHash)
    .then(() => next())
    .catch((rateLimiterRes) => {
      const retryAfter = Math.round((rateLimiterRes?.msBeforeNext || 60000) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      res.setHeader("X-RateLimit-Limit", String((limiter as any).points));
      res.setHeader("X-RateLimit-Remaining", "0");
      res.setHeader("X-RateLimit-Reset", String(Math.ceil(Date.now() / 1000) + retryAfter));
      res.status(429).json({
        status: "error",
        message: "Too Many Requests",
        retryAfter,
      });
    });
};

// Billing/Stripe: tighter limits — 20 requests per 15 min per user/IP
let rateLimiterBilling: RateLimiterRedis | RateLimiterMemory;

(async () => {
  // Wait for main init to finish, then create billing limiter with same store
  const waitForInit = () => new Promise<void>((resolve) => {
    const check = () => { if (initialized) resolve(); else setTimeout(check, 50); };
    check();
  });
  await waitForInit();

  if (rateLimiterGlobal instanceof RateLimiterRedis) {
    rateLimiterBilling = new RateLimiterRedis({
      storeClient: redisClient,
      keyPrefix: "middleware_billing",
      points: 20,
      duration: 60 * 15,
      insuranceLimiter: new RateLimiterMemory({ points: 20, duration: 60 * 15 }),
    });
  } else {
    rateLimiterBilling = new RateLimiterMemory({
      points: 20,
      duration: 60 * 15,
    });
  }
})();

export const globalLimiter = async (req: Request, res: Response, next: NextFunction) => {
  if (isExemptPath(req)) return next();
  await consumeLimiter(() => rateLimiterGlobal, req, res, next);
};

export const authLimiter = async (req: Request, res: Response, next: NextFunction) => {
  if (isExemptPath(req)) return next();
  // Google OAuth redirects/callbacks should not be blocked — users can trigger
  // multiple redirects during normal sign-in flows and 429 locks them out.
  const url = req.originalUrl || req.url;
  if (url.startsWith("/api/auth/google") || url.startsWith("/auth/google")) return next();
  await consumeLimiter(() => rateLimiterAuth, req, res, next);
};

export const aiLimiter = async (req: Request, res: Response, next: NextFunction) => {
  if (isExemptPath(req)) return next();
  await consumeLimiter(() => rateLimiterAi, req, res, next);
};

export const billingLimiter = async (req: Request, res: Response, next: NextFunction) => {
  if (isExemptPath(req)) return next();
  await consumeLimiter(() => rateLimiterBilling, req, res, next);
};
