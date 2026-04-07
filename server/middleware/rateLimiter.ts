import type { Request, Response, NextFunction } from "express";

interface WindowEntry {
  count: number;
  expiresAt: number;
}

interface TierLimits {
  normal: number;
  premium: number;
}

const TIERS: Record<string, TierLimits> = {
  chat:   { normal: 60,  premium: 120 },
  upload: { normal: 20,  premium: 40 },
  docgen: { normal: 10,  premium: 30 },
  api:    { normal: 100, premium: 200 },
};

const WINDOW_MS = 60_000;

// key: `${userId}:${category}`
const windows = new Map<string, WindowEntry>();

// Periodic cleanup of expired windows
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of windows) {
    if (entry.expiresAt <= now) windows.delete(key);
  }
}, 30_000).unref();

function resolveUser(req: Request): { id: string; tier: "normal" | "premium" } {
  const user = (req as any).user;
  const id = user?.id?.toString() ?? (req.headers["x-anonymous-user-id"] as string) ?? "anon";
  const plan = user?.plan as string | undefined;
  const tier = plan === "pro" || plan === "admin" ? "premium" : "normal";
  return { id, tier };
}

function getOrCreateWindow(key: string): WindowEntry {
  const now = Date.now();
  let entry = windows.get(key);
  if (!entry || entry.expiresAt <= now) {
    entry = { count: 0, expiresAt: now + WINDOW_MS };
    windows.set(key, entry);
  }
  return entry;
}

export function rateLimiter(category: string) {
  const limits = TIERS[category] ?? TIERS.api;

  return (req: Request, res: Response, next: NextFunction) => {
    const { id, tier } = resolveUser(req);
    const key = `${id}:${category}`;
    const entry = getOrCreateWindow(key);
    const limit = limits[tier];
    const remaining = Math.max(0, limit - entry.count);
    const resetMs = entry.expiresAt;

    res.setHeader("X-RateLimit-Limit", limit);
    res.setHeader("X-RateLimit-Reset", Math.ceil(resetMs / 1000));

    if (entry.count >= limit) {
      const retryAfterMs = entry.expiresAt - Date.now();
      res.setHeader("X-RateLimit-Remaining", 0);
      return res.status(429).json({
        error: { code: "RATE_LIMIT", retryAfterMs: Math.max(0, retryAfterMs) },
      });
    }

    entry.count++;
    res.setHeader("X-RateLimit-Remaining", remaining - 1);
    next();
  };
}

export interface UsageStats {
  [category: string]: { count: number; limit: number; remaining: number; resetsAt: number };
}

export function getUsage(userId: string): UsageStats {
  const now = Date.now();
  const stats: UsageStats = {};

  for (const category of Object.keys(TIERS)) {
    const key = `${userId}:${category}`;
    const entry = windows.get(key);
    const limit = TIERS[category].normal; // default to normal for lookup
    if (entry && entry.expiresAt > now) {
      stats[category] = {
        count: entry.count,
        limit,
        remaining: Math.max(0, limit - entry.count),
        resetsAt: entry.expiresAt,
      };
    } else {
      stats[category] = { count: 0, limit, remaining: limit, resetsAt: 0 };
    }
  }

  return stats;
}
