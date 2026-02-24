/**
 * T21: Security & Rate Limiting (Token Bucket Algorithm)
 * Protege al Daemon hipervisor y al EventBus de saturaciones (Flood / DDoS preventions).
 */
import type { Request, Response, NextFunction } from "express";

export class RateLimiter {
    private requests = new Map<string, { tokens: number; lastRefill: number }>();
    private REFILL_RATE: number; // tokens per millisecond
    private CAPACITY: number;

    constructor(capacity = 50, refillRatePerSec = 5) {
        this.CAPACITY = capacity;
        this.REFILL_RATE = refillRatePerSec / 1000;
    }

    public checkLimit(clientId: string): boolean {
        const now = Date.now();

        if (!this.requests.has(clientId)) {
            this.requests.set(clientId, { tokens: this.CAPACITY - 1, lastRefill: now });
            return true;
        }

        const record = this.requests.get(clientId)!;
        const timePassed = now - record.lastRefill;

        // Refill
        let tokens = record.tokens + (timePassed * this.REFILL_RATE);
        if (tokens > this.CAPACITY) tokens = this.CAPACITY;

        if (tokens >= 1) {
            this.requests.set(clientId, { tokens: tokens - 1, lastRefill: now });
            return true; // Allowed
        }

        return false; // Rate limited
    }
}

export const rpcRateLimiter = new RateLimiter(100, 20); // RPC permite alta frecuencia
export const httpRateLimiter = new RateLimiter(30, 2);  // HTTP (A11y dumps) es estricto

export function rateLimiter(req: Request, res: Response, next: NextFunction): void {
  const actor =
    ((req as any)?.user?.claims?.sub as string | undefined) ||
    ((req as any)?.user?.id as string | undefined) ||
    req.ip ||
    req.socket?.remoteAddress ||
    "unknown";

  if (!httpRateLimiter.checkLimit(actor)) {
    res.status(429).json({ message: "Too many requests" });
    return;
  }
  next();
}

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
    const actor =
      ((req as any)?.user?.claims?.sub as string | undefined) ||
      ((req as any)?.user?.id as string | undefined) ||
      ip;

    const key = `${keyPrefix}:${actor}`;
    const now = Date.now();
    const current = customRateWindows.get(key);

    if (!current || now >= current.resetAt) {
      customRateWindows.set(key, {
        count: 1,
        resetAt: now + windowMs,
      });
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

export function getRateLimitStats(): {
  rpcTrackedClients: number;
  httpTrackedClients: number;
  customTrackedKeys: number;
} {
  const rpcTrackedClients = (rpcRateLimiter as any)?.requests?.size ?? 0;
  const httpTrackedClients = (httpRateLimiter as any)?.requests?.size ?? 0;
  return {
    rpcTrackedClients,
    httpTrackedClients,
    customTrackedKeys: customRateWindows.size,
  };
}
