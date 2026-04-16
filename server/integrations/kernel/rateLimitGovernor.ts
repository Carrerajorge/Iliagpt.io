/**
 * RateLimitGovernor — Enterprise multi-tier sliding-window rate limiter.
 *
 * Provides per-connector, per-user, and per-operation rate limiting using
 * in-memory sliding windows.  No external deps (no Redis).  Features:
 *
 *  - Three time windows: minute (60 s), hour (3 600 s), day (86 400 s)
 *  - Adaptive throttling (gradual delay instead of hard cutoff)
 *  - Quota reservations for multi-step operations
 *  - Lazy + background cleanup to prevent memory leaks
 */

import type { RateLimitConfig } from "./types";

// ─── Public Types ──────────────────────────────────────────────────

export interface RateLimitTier {
  perMinute: number;
  perHour: number;
  perDay: number;
  burstAllowance: number;
  burstWindowMs: number;
}

export interface CheckLimitResult {
  allowed: boolean;
  remaining: { minute: number; hour: number; day: number };
  retryAfterMs?: number;
  tier: string;
}

export interface UsageSummary {
  connectorId: string;
  userId: string | null;
  minute: { used: number; limit: number };
  hour: { used: number; limit: number };
  day: { used: number; limit: number };
}

export interface GlobalUsageSummary {
  connectorId: string;
  totalMinute: number;
  totalHour: number;
  totalDay: number;
  uniqueUsers: number;
}

export interface QuotaReservation {
  reservationId: string;
  connectorId: string;
  userId: string;
  count: number;
  createdAt: number;
  committed: boolean;
  released: boolean;
}

// ─── Constants ─────────────────────────────────────────────────────

const WINDOW_MINUTE_S = 60;
const WINDOW_HOUR_S = 3_600;
const WINDOW_DAY_S = 86_400;

const BURST_WINDOW_MS_DEFAULT = 5_000;

const CLEANUP_INTERVAL_MS = 5 * 60_000; // 5 minutes

const THROTTLE_80_DELAY_MS = 50;
const THROTTLE_90_DELAY_MS = 100;
const THROTTLE_95_DELAY_MS = 150;

const RESERVATION_TTL_MS = 60_000; // 60 seconds

// ─── Default Limits ────────────────────────────────────────────────

const DEFAULT_CONNECTOR_LIMITS: Record<string, RateLimitTier> = {
  gmail: {
    perMinute: 100,
    perHour: 1_500,
    perDay: 10_000,
    burstAllowance: 20,
    burstWindowMs: BURST_WINDOW_MS_DEFAULT,
  },
  google_drive: {
    perMinute: 60,
    perHour: 1_000,
    perDay: 10_000,
    burstAllowance: 15,
    burstWindowMs: BURST_WINDOW_MS_DEFAULT,
  },
  slack: {
    perMinute: 50,
    perHour: 500,
    perDay: 5_000,
    burstAllowance: 10,
    burstWindowMs: BURST_WINDOW_MS_DEFAULT,
  },
  notion: {
    perMinute: 30,
    perHour: 300,
    perDay: 3_000,
    burstAllowance: 8,
    burstWindowMs: BURST_WINDOW_MS_DEFAULT,
  },
  github: {
    perMinute: 30,
    perHour: 500,
    perDay: 5_000,
    burstAllowance: 10,
    burstWindowMs: BURST_WINDOW_MS_DEFAULT,
  },
  hubspot: {
    perMinute: 40,
    perHour: 400,
    perDay: 4_000,
    burstAllowance: 10,
    burstWindowMs: BURST_WINDOW_MS_DEFAULT,
  },
};

const FALLBACK_TIER: RateLimitTier = {
  perMinute: 30,
  perHour: 300,
  perDay: 3_000,
  burstAllowance: 8,
  burstWindowMs: BURST_WINDOW_MS_DEFAULT,
};

// ─── Internal Structures ───────────────────────────────────────────

interface WindowBucket {
  count: number;
  windowStart: number; // epoch ms
}

type WindowName = "minute" | "hour" | "day";

const WINDOW_SIZES: Record<WindowName, number> = {
  minute: WINDOW_MINUTE_S * 1_000,
  hour: WINDOW_HOUR_S * 1_000,
  day: WINDOW_DAY_S * 1_000,
};

// ─── Helpers ───────────────────────────────────────────────────────

function windowId(nowMs: number, windowMs: number): number {
  return Math.floor(nowMs / windowMs);
}

function buildKey(
  connectorId: string,
  userId: string,
  operationId: string,
  window: WindowName,
): string {
  return `${connectorId}:${userId}:${operationId}:${window}`;
}

function buildGlobalKey(
  connectorId: string,
  window: WindowName,
): string {
  return `${connectorId}:__global__:__all__:${window}`;
}

function tierLimitForWindow(tier: RateLimitTier, window: WindowName): number {
  switch (window) {
    case "minute":
      return tier.perMinute;
    case "hour":
      return tier.perHour;
    case "day":
      return tier.perDay;
  }
}

// ─── RateLimitGovernor ─────────────────────────────────────────────

export class RateLimitGovernor {
  /** user+operation level counters */
  private readonly _buckets = new Map<string, WindowBucket>();

  /** global per-connector counters */
  private readonly _globalBuckets = new Map<string, WindowBucket>();

  /** connector-level overrides (merged on top of defaults) */
  private readonly _overrides = new Map<string, Partial<RateLimitTier>>();

  /** per-operation overrides keyed by `${connectorId}:${operationId}` */
  private readonly _operationOverrides = new Map<string, Partial<RateLimitTier>>();

  /** quota reservations */
  private readonly _reservations = new Map<string, QuotaReservation>();

  /** tracks unique users per connector for globalUsage */
  private readonly _userSets = new Map<string, Set<string>>();

  private _cleanupTimer: ReturnType<typeof setInterval> | null = null;

  /* ---------------------------------------------------------------- */
  /*  Lifecycle                                                        */
  /* ---------------------------------------------------------------- */

  constructor() {
    this._startCleanup();
  }

  /**
   * Stop the background cleanup timer (call when shutting down).
   */
  dispose(): void {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Configuration                                                    */
  /* ---------------------------------------------------------------- */

  /**
   * Register an override tier for a connector.  Partial fields fall back
   * to the hardcoded default for that connector (or FALLBACK_TIER).
   */
  setConnectorLimits(connectorId: string, limits: Partial<RateLimitTier>): void {
    this._overrides.set(connectorId, limits);
  }

  /**
   * Register a per-operation override.  Useful for dangerous ops like
   * `send_email` that should have stricter limits.
   */
  setOperationLimits(
    connectorId: string,
    operationId: string,
    limits: Partial<RateLimitTier>,
  ): void {
    this._operationOverrides.set(`${connectorId}:${operationId}`, limits);
  }

  /**
   * Import limits from a ConnectorManifest's `rateLimit` field.
   */
  importFromManifest(connectorId: string, cfg: RateLimitConfig): void {
    this.setConnectorLimits(connectorId, {
      perMinute: cfg.requestsPerMinute,
      perHour: cfg.requestsPerHour,
      perDay: cfg.requestsPerDay ?? cfg.requestsPerHour * 10,
      burstAllowance: cfg.burstAllowance ?? Math.ceil(cfg.requestsPerMinute * 0.2),
    });
  }

  /* ---------------------------------------------------------------- */
  /*  Tier resolution                                                  */
  /* ---------------------------------------------------------------- */

  private _resolveTier(connectorId: string, operationId?: string): RateLimitTier {
    const base = DEFAULT_CONNECTOR_LIMITS[connectorId] ?? FALLBACK_TIER;
    const connOverride = this._overrides.get(connectorId);
    const merged: RateLimitTier = { ...base, ...connOverride };

    if (operationId) {
      const opOverride = this._operationOverrides.get(`${connectorId}:${operationId}`);
      if (opOverride) {
        return { ...merged, ...opOverride };
      }
    }
    return merged;
  }

  /* ---------------------------------------------------------------- */
  /*  Bucket access (lazy expiry)                                      */
  /* ---------------------------------------------------------------- */

  private _getBucket(
    store: Map<string, WindowBucket>,
    key: string,
    windowMs: number,
    nowMs: number,
  ): WindowBucket {
    const wid = windowId(nowMs, windowMs);
    const existing = store.get(key);

    if (existing && windowId(existing.windowStart, windowMs) === wid) {
      return existing;
    }

    // Expired or non-existent: create fresh
    const bucket: WindowBucket = { count: 0, windowStart: nowMs };
    store.set(key, bucket);
    return bucket;
  }

  private _getCount(
    store: Map<string, WindowBucket>,
    key: string,
    windowMs: number,
    nowMs: number,
  ): number {
    return this._getBucket(store, key, windowMs, nowMs).count;
  }

  private _increment(
    store: Map<string, WindowBucket>,
    key: string,
    windowMs: number,
    nowMs: number,
    amount: number = 1,
  ): void {
    const bucket = this._getBucket(store, key, windowMs, nowMs);
    bucket.count += amount;
  }

  /* ---------------------------------------------------------------- */
  /*  Reserved quota accounting                                        */
  /* ---------------------------------------------------------------- */

  private _activeReservations(connectorId: string, userId: string): number {
    const now = Date.now();
    let total = 0;
    for (const r of this._reservations.values()) {
      if (
        r.connectorId === connectorId &&
        r.userId === userId &&
        !r.committed &&
        !r.released &&
        now - r.createdAt < RESERVATION_TTL_MS
      ) {
        total += r.count;
      }
    }
    return total;
  }

  /* ---------------------------------------------------------------- */
  /*  Core: checkLimit                                                 */
  /* ---------------------------------------------------------------- */

  /**
   * Check whether a request is allowed under all applicable rate limits.
   *
   * Does NOT record usage — call `recordUsage` separately after the
   * operation succeeds.
   */
  checkLimit(
    connectorId: string,
    userId: string,
    operationId: string = "__default__",
  ): CheckLimitResult {
    const now = Date.now();
    const tier = this._resolveTier(connectorId, operationId);
    const reserved = this._activeReservations(connectorId, userId);

    const windows: WindowName[] = ["minute", "hour", "day"];
    const remaining: Record<WindowName, number> = { minute: 0, hour: 0, day: 0 };
    let allowed = true;
    let retryAfterMs: number | undefined;

    for (const w of windows) {
      const wMs = WINDOW_SIZES[w];
      const limit = tierLimitForWindow(tier, w);

      // Per-user per-operation count
      const userKey = buildKey(connectorId, userId, operationId, w);
      const userCount = this._getCount(this._buckets, userKey, wMs, now);

      // Global per-connector count
      const globalKey = buildGlobalKey(connectorId, w);
      const globalCount = this._getCount(this._globalBuckets, globalKey, wMs, now);

      // Effective available = limit - max(userCount, globalCount) - reservations
      // (global count is the aggregate; user count must not exceed individual share)
      const effectiveUsed = Math.max(userCount, 0) + reserved;

      // Burst allowance applies only to the minute window
      const effectiveLimit =
        w === "minute" ? limit + tier.burstAllowance : limit;

      const windowRemaining = Math.max(0, effectiveLimit - effectiveUsed);
      remaining[w] = windowRemaining;

      if (windowRemaining <= 0) {
        allowed = false;
        // Compute retry-after: time until current window resets
        const bucket = this._buckets.get(userKey);
        if (bucket) {
          const windowEnd = windowId(bucket.windowStart, wMs) * wMs + wMs;
          const waitMs = windowEnd - now;
          if (retryAfterMs === undefined || waitMs < retryAfterMs) {
            retryAfterMs = Math.max(0, waitMs);
          }
        }
      }

      // Also check global limits (2x individual to prevent single-user starvation)
      const globalLimit = effectiveLimit * 2;
      if (globalCount >= globalLimit) {
        allowed = false;
        const gBucket = this._globalBuckets.get(globalKey);
        if (gBucket) {
          const windowEnd = windowId(gBucket.windowStart, wMs) * wMs + wMs;
          const waitMs = windowEnd - now;
          if (retryAfterMs === undefined || waitMs < retryAfterMs) {
            retryAfterMs = Math.max(0, waitMs);
          }
        }
      }
    }

    return {
      allowed,
      remaining,
      retryAfterMs: allowed ? undefined : retryAfterMs,
      tier: `${connectorId}${operationId !== "__default__" ? `:${operationId}` : ""}`,
    };
  }

  /* ---------------------------------------------------------------- */
  /*  Core: recordUsage                                                */
  /* ---------------------------------------------------------------- */

  /**
   * Record a completed request against all windows.  Call after the
   * operation has succeeded (or failed in a way that consumed quota).
   */
  recordUsage(
    connectorId: string,
    userId: string,
    operationId: string = "__default__",
  ): void {
    const now = Date.now();
    const windows: WindowName[] = ["minute", "hour", "day"];

    for (const w of windows) {
      const wMs = WINDOW_SIZES[w];

      // Per-user per-operation
      const userKey = buildKey(connectorId, userId, operationId, w);
      this._increment(this._buckets, userKey, wMs, now);

      // Global
      const globalKey = buildGlobalKey(connectorId, w);
      this._increment(this._globalBuckets, globalKey, wMs, now);
    }

    // Track unique users
    let userSet = this._userSets.get(connectorId);
    if (!userSet) {
      userSet = new Set<string>();
      this._userSets.set(connectorId, userSet);
    }
    userSet.add(userId);
  }

  /* ---------------------------------------------------------------- */
  /*  Usage summaries                                                  */
  /* ---------------------------------------------------------------- */

  /**
   * Detailed usage breakdown for a specific connector+user pair.
   */
  getUsageSummary(connectorId: string, userId?: string): UsageSummary {
    const now = Date.now();
    const effectiveUser = userId ?? "__global__";
    const operationId = "__default__";
    const tier = this._resolveTier(connectorId);

    const windows: WindowName[] = ["minute", "hour", "day"];
    const result: UsageSummary = {
      connectorId,
      userId: userId ?? null,
      minute: { used: 0, limit: tier.perMinute },
      hour: { used: 0, limit: tier.perHour },
      day: { used: 0, limit: tier.perDay },
    };

    for (const w of windows) {
      const wMs = WINDOW_SIZES[w];
      if (userId) {
        const key = buildKey(connectorId, effectiveUser, operationId, w);
        result[w].used = this._getCount(this._buckets, key, wMs, now);
      } else {
        const key = buildGlobalKey(connectorId, w);
        result[w].used = this._getCount(this._globalBuckets, key, wMs, now);
      }
      result[w].limit = tierLimitForWindow(tier, w);
    }

    return result;
  }

  /**
   * Aggregate usage across all users for a connector.
   */
  getGlobalUsage(connectorId: string): GlobalUsageSummary {
    const now = Date.now();

    const minuteKey = buildGlobalKey(connectorId, "minute");
    const hourKey = buildGlobalKey(connectorId, "hour");
    const dayKey = buildGlobalKey(connectorId, "day");

    return {
      connectorId,
      totalMinute: this._getCount(this._globalBuckets, minuteKey, WINDOW_SIZES.minute, now),
      totalHour: this._getCount(this._globalBuckets, hourKey, WINDOW_SIZES.hour, now),
      totalDay: this._getCount(this._globalBuckets, dayKey, WINDOW_SIZES.day, now),
      uniqueUsers: this._userSets.get(connectorId)?.size ?? 0,
    };
  }

  /* ---------------------------------------------------------------- */
  /*  Reset                                                            */
  /* ---------------------------------------------------------------- */

  /**
   * Admin reset of counters.  If userId is supplied, only that user's
   * counters are cleared; otherwise the entire connector is reset.
   */
  resetUsage(connectorId: string, userId?: string): void {
    if (userId) {
      for (const key of this._buckets.keys()) {
        if (key.startsWith(`${connectorId}:${userId}:`)) {
          this._buckets.delete(key);
        }
      }
    } else {
      // Clear everything for this connector
      for (const key of this._buckets.keys()) {
        if (key.startsWith(`${connectorId}:`)) {
          this._buckets.delete(key);
        }
      }
      for (const key of this._globalBuckets.keys()) {
        if (key.startsWith(`${connectorId}:`)) {
          this._globalBuckets.delete(key);
        }
      }
      this._userSets.delete(connectorId);
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Adaptive Throttling                                              */
  /* ---------------------------------------------------------------- */

  /**
   * Returns an artificial delay (ms) that should be added before executing
   * a request.  Returns 0 when usage is comfortably below limits.
   *
   *   80-89 % → 50 ms per request
   *   90-94 % → 100 ms per request
   *   95 %+   → 150 ms per request + console warning
   */
  getThrottleDelay(
    connectorId: string,
    userId: string,
    operationId: string = "__default__",
  ): number {
    const now = Date.now();
    const tier = this._resolveTier(connectorId, operationId);
    let maxRatio = 0;

    const windows: WindowName[] = ["minute", "hour", "day"];
    for (const w of windows) {
      const wMs = WINDOW_SIZES[w];
      const key = buildKey(connectorId, userId, operationId, w);
      const used = this._getCount(this._buckets, key, wMs, now);
      const limit = tierLimitForWindow(tier, w);
      if (limit > 0) {
        const ratio = used / limit;
        if (ratio > maxRatio) maxRatio = ratio;
      }
    }

    if (maxRatio >= 0.95) {
      console.warn(
        `[RateLimitGovernor] Usage at ${(maxRatio * 100).toFixed(1)}% ` +
          `for ${connectorId}:${userId}:${operationId} — applying heavy throttle`,
      );
      return THROTTLE_95_DELAY_MS;
    }
    if (maxRatio >= 0.9) return THROTTLE_90_DELAY_MS;
    if (maxRatio >= 0.8) return THROTTLE_80_DELAY_MS;
    return 0;
  }

  /* ---------------------------------------------------------------- */
  /*  Quota Reservations                                               */
  /* ---------------------------------------------------------------- */

  /**
   * Reserve `count` units of quota for a multi-step operation.
   * Reserved quota is deducted from available capacity in `checkLimit`.
   * Auto-expires after 60 seconds if neither committed nor released.
   */
  reserveQuota(
    connectorId: string,
    userId: string,
    count: number,
  ): { reserved: boolean; reservationId: string } {
    // Check that we have enough remaining quota (day window as capacity check)
    const now = Date.now();
    const tier = this._resolveTier(connectorId);
    const dayKey = buildKey(connectorId, userId, "__default__", "day");
    const dayUsed = this._getCount(this._buckets, dayKey, WINDOW_SIZES.day, now);
    const reserved = this._activeReservations(connectorId, userId);
    const available = tier.perDay - dayUsed - reserved;

    if (count > available) {
      // Generate an id even on failure so the caller can reference it
      const failId = `res_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      return { reserved: false, reservationId: failId };
    }

    const reservationId = `res_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    this._reservations.set(reservationId, {
      reservationId,
      connectorId,
      userId,
      count,
      createdAt: Date.now(),
      committed: false,
      released: false,
    });

    return { reserved: true, reservationId };
  }

  /**
   * Release a reservation (operation cancelled or partially completed).
   * Freed quota becomes available again immediately.
   */
  releaseQuota(reservationId: string): void {
    const r = this._reservations.get(reservationId);
    if (r && !r.committed && !r.released) {
      r.released = true;
    }
  }

  /**
   * Commit a reservation (operation fully completed).
   * The reserved count is recorded as actual usage.
   */
  commitQuota(reservationId: string): void {
    const r = this._reservations.get(reservationId);
    if (!r || r.committed || r.released) return;

    r.committed = true;

    // Record the reserved count as actual usage
    const now = Date.now();
    const windows: WindowName[] = ["minute", "hour", "day"];
    for (const w of windows) {
      const wMs = WINDOW_SIZES[w];
      const userKey = buildKey(r.connectorId, r.userId, "__default__", w);
      this._increment(this._buckets, userKey, wMs, now, r.count);
      const globalKey = buildGlobalKey(r.connectorId, w);
      this._increment(this._globalBuckets, globalKey, wMs, now, r.count);
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Cleanup                                                          */
  /* ---------------------------------------------------------------- */

  private _startCleanup(): void {
    this._cleanupTimer = setInterval(() => this._cleanup(), CLEANUP_INTERVAL_MS);
    // Allow the Node process to exit even if the timer is running
    if (this._cleanupTimer && typeof this._cleanupTimer === "object" && "unref" in this._cleanupTimer) {
      (this._cleanupTimer as NodeJS.Timeout).unref();
    }
  }

  private _cleanup(): void {
    const now = Date.now();
    const maxWindowMs = WINDOW_SIZES.day;

    // Evict expired user buckets
    for (const [key, bucket] of this._buckets) {
      if (now - bucket.windowStart > maxWindowMs * 2) {
        this._buckets.delete(key);
      }
    }

    // Evict expired global buckets
    for (const [key, bucket] of this._globalBuckets) {
      if (now - bucket.windowStart > maxWindowMs * 2) {
        this._globalBuckets.delete(key);
      }
    }

    // Evict expired / finalized reservations
    for (const [id, r] of this._reservations) {
      if (r.committed || r.released || now - r.createdAt > RESERVATION_TTL_MS) {
        this._reservations.delete(id);
      }
    }
  }
}

// ─── Singleton ─────────────────────────────────────────────────────

export const rateLimitGovernor = new RateLimitGovernor();
