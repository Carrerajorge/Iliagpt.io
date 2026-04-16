import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock external dependencies before importing the module
vi.mock("./logger", () => ({
  Logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("./dbInfrastructure", () => ({
  getPoolStats: vi.fn(() => ({
    write: { utilizationPercent: 10 },
  })),
}));

import {
  SlidingWindowRateLimiter,
  LoadMonitor,
  loadMonitor,
  quotaManager,
} from "./dynamicRateLimiting";
import type { RateLimitConfig, LoadMetrics, LoadLevel } from "./dynamicRateLimiting";

// ============================================================================
// SlidingWindowRateLimiter
// ============================================================================

describe("SlidingWindowRateLimiter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should allow requests under the limit", () => {
    const limiter = new SlidingWindowRateLimiter({
      windowMs: 60_000,
      maxRequests: 10,
    });
    const result = limiter.isAllowed("user:1");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeGreaterThan(0);
  });

  it("should block requests when the limit is exceeded", () => {
    const limiter = new SlidingWindowRateLimiter({
      windowMs: 60_000,
      maxRequests: 3,
    });

    limiter.isAllowed("user:flood");
    limiter.isAllowed("user:flood");
    limiter.isAllowed("user:flood");

    const result = limiter.isAllowed("user:flood");
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("should track remaining count accurately", () => {
    const limiter = new SlidingWindowRateLimiter({
      windowMs: 60_000,
      maxRequests: 5,
    });

    const r1 = limiter.isAllowed("user:count");
    // After 1 request used, remaining = dynamic_limit - 1 - 1 = at most maxRequests - 2
    // Actually: remaining = dynamicLimit - count - 1, where count = entries so far in window
    // first call: count=0 before push, so remaining = limit - 0 - 1
    expect(r1.remaining).toBeLessThanOrEqual(4);

    limiter.isAllowed("user:count");
    const r3 = limiter.isAllowed("user:count");
    // After 3 requests the remaining should be smaller
    expect(r3.remaining).toBeLessThan(r1.remaining);
  });

  it("should isolate different keys from each other", () => {
    const limiter = new SlidingWindowRateLimiter({
      windowMs: 60_000,
      maxRequests: 2,
    });

    limiter.isAllowed("user:a");
    limiter.isAllowed("user:a");
    const blocked = limiter.isAllowed("user:a");
    expect(blocked.allowed).toBe(false);

    // A different key should still be allowed
    const allowed = limiter.isAllowed("user:b");
    expect(allowed.allowed).toBe(true);
  });

  it("should provide a resetAt timestamp in the future", () => {
    const limiter = new SlidingWindowRateLimiter({
      windowMs: 60_000,
      maxRequests: 5,
    });
    const now = Date.now();
    const result = limiter.isAllowed("user:reset");
    expect(result.resetAt).toBeGreaterThanOrEqual(now);
  });

  it("should return resetAt based on oldest entry when blocked", () => {
    const limiter = new SlidingWindowRateLimiter({
      windowMs: 60_000,
      maxRequests: 1,
    });

    limiter.isAllowed("user:reset-blocked");
    const blocked = limiter.isAllowed("user:reset-blocked");
    expect(blocked.allowed).toBe(false);
    expect(blocked.resetAt).toBeGreaterThan(Date.now() - 1);
  });

  it("middleware() should return a function", () => {
    const limiter = new SlidingWindowRateLimiter({
      windowMs: 60_000,
      maxRequests: 10,
    });
    const mw = limiter.middleware();
    expect(typeof mw).toBe("function");
    expect(mw.length).toBe(3); // (req, res, next)
  });

  it("middleware should skip when skipIf returns true", () => {
    const limiter = new SlidingWindowRateLimiter({
      windowMs: 60_000,
      maxRequests: 1,
      skipIf: () => true,
    });

    const mw = limiter.middleware();
    const req = { path: "/health", ip: "1.2.3.4", socket: { remoteAddress: "1.2.3.4" } } as any;
    const res = {
      setHeader: vi.fn(),
      on: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;
    const next = vi.fn();

    mw(req, res, next);
    expect(next).toHaveBeenCalled();
    // When skipped, setHeader should NOT be called
    expect(res.setHeader).not.toHaveBeenCalled();
  });

  it("middleware should call next() when under the limit", () => {
    const limiter = new SlidingWindowRateLimiter({
      windowMs: 60_000,
      maxRequests: 100,
    });

    const mw = limiter.middleware();
    const req = { ip: "10.0.0.1", socket: { remoteAddress: "10.0.0.1" } } as any;
    const res = {
      setHeader: vi.fn(),
      on: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;
    const next = vi.fn();

    mw(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith("X-RateLimit-Limit", expect.any(Number));
    expect(res.setHeader).toHaveBeenCalledWith("X-RateLimit-Remaining", expect.any(Number));
    expect(res.setHeader).toHaveBeenCalledWith("X-RateLimit-Reset", expect.any(Number));
    expect(res.setHeader).toHaveBeenCalledWith("X-RateLimit-Load", expect.any(String));
  });

  it("middleware should use custom keyGenerator when provided", () => {
    const keyGen = vi.fn(() => "custom-key");
    const limiter = new SlidingWindowRateLimiter({
      windowMs: 60_000,
      maxRequests: 100,
      keyGenerator: keyGen,
    });

    const mw = limiter.middleware();
    const req = {} as any;
    const res = {
      setHeader: vi.fn(),
      on: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;
    const next = vi.fn();

    mw(req, res, next);
    expect(keyGen).toHaveBeenCalledWith(req);
  });

  it("middleware should invoke onLimit callback when rate limited", () => {
    const onLimit = vi.fn();
    const limiter = new SlidingWindowRateLimiter({
      windowMs: 60_000,
      maxRequests: 1,
      onLimit,
    });

    const mw = limiter.middleware();
    const makeReq = () =>
      ({ ip: "5.5.5.5", socket: { remoteAddress: "5.5.5.5" } }) as any;
    const makeRes = () =>
      ({
        setHeader: vi.fn(),
        on: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      }) as any;

    const next1 = vi.fn();
    mw(makeReq(), makeRes(), next1);
    expect(next1).toHaveBeenCalled();

    const next2 = vi.fn();
    mw(makeReq(), makeRes(), next2);
    expect(next2).not.toHaveBeenCalled();
    expect(onLimit).toHaveBeenCalled();
  });
});

// ============================================================================
// QuotaManager
// ============================================================================

describe("quotaManager", () => {
  beforeEach(() => {
    // Reset internal state by setting fresh quotas
  });

  it("should allow usage when under default quota", () => {
    const result = quotaManager.checkQuota("tenant-fresh-1");
    expect(result.allowed).toBe(true);
    expect(result.usage.dailyRemaining).toBeGreaterThan(0);
    expect(result.usage.monthlyRemaining).toBeGreaterThan(0);
  });

  it("should track incremented usage", () => {
    const tenantId = "tenant-incr-" + Date.now();
    quotaManager.incrementUsage(tenantId, 5);

    const usage = quotaManager.getUsage(tenantId);
    expect(usage.dailyUsed).toBe(5);
    expect(usage.monthlyUsed).toBe(5);
  });

  it("should deny when daily quota is exhausted", () => {
    const tenantId = "tenant-daily-exhaust-" + Date.now();
    quotaManager.setQuota(tenantId, { daily: 3, monthly: 100 });
    quotaManager.incrementUsage(tenantId, 3);

    const result = quotaManager.checkQuota(tenantId);
    expect(result.allowed).toBe(false);
    expect(result.usage.dailyRemaining).toBe(0);
  });

  it("should deny when monthly quota is exhausted", () => {
    const tenantId = "tenant-monthly-exhaust-" + Date.now();
    quotaManager.setQuota(tenantId, { daily: 10000, monthly: 5 });
    quotaManager.incrementUsage(tenantId, 5);

    const result = quotaManager.checkQuota(tenantId);
    expect(result.allowed).toBe(false);
    expect(result.usage.monthlyRemaining).toBe(0);
  });

  it("should return usage with reset date information", () => {
    const tenantId = "tenant-reset-" + Date.now();
    const usage = quotaManager.getUsage(tenantId);

    expect(usage.resetAt).toBeDefined();
    expect(usage.resetAt.daily).toBeInstanceOf(Date);
    expect(usage.resetAt.monthly).toBeInstanceOf(Date);
    // Daily reset should be in the future
    expect(usage.resetAt.daily.getTime()).toBeGreaterThan(Date.now());
  });

  it("should allow setting a custom quota", () => {
    const tenantId = "tenant-custom-" + Date.now();
    quotaManager.setQuota(tenantId, { daily: 50, monthly: 500 });

    const usage = quotaManager.getUsage(tenantId);
    expect(usage.dailyRemaining).toBe(50);
    expect(usage.monthlyRemaining).toBe(500);
  });

  it("should preserve existing usage when setQuota is called again", () => {
    const tenantId = "tenant-preserve-" + Date.now();
    quotaManager.setQuota(tenantId, { daily: 100, monthly: 1000 });
    quotaManager.incrementUsage(tenantId, 10);

    // Re-set quota with different limits
    quotaManager.setQuota(tenantId, { daily: 200, monthly: 2000 });

    const usage = quotaManager.getUsage(tenantId);
    expect(usage.dailyUsed).toBe(10);
    expect(usage.monthlyUsed).toBe(10);
    expect(usage.dailyRemaining).toBe(190);
  });

  it("should not go below zero for remaining counts", () => {
    const tenantId = "tenant-overflow-" + Date.now();
    quotaManager.setQuota(tenantId, { daily: 2, monthly: 5 });
    quotaManager.incrementUsage(tenantId, 10); // exceed quota

    const usage = quotaManager.getUsage(tenantId);
    expect(usage.dailyRemaining).toBe(0);
    expect(usage.monthlyRemaining).toBe(0);
  });
});

// ============================================================================
// LoadMonitor (basic)
// ============================================================================

describe("LoadMonitor", () => {
  it("should export loadMonitor singleton", () => {
    expect(loadMonitor).toBeDefined();
    expect(typeof loadMonitor.getMetrics).toBe("function");
    expect(typeof loadMonitor.getLoadLevel).toBe("function");
  });

  it("getMetrics should return LoadMetrics shape", () => {
    const metrics = loadMonitor.getMetrics();
    expect(metrics).toHaveProperty("cpuUsage");
    expect(metrics).toHaveProperty("dbUtilization");
    expect(metrics).toHaveProperty("memoryUsage");
    expect(metrics).toHaveProperty("activeRequests");
    expect(typeof metrics.cpuUsage).toBe("number");
    expect(typeof metrics.memoryUsage).toBe("number");
  });

  it("getLoadLevel should return a valid LoadLevel string", () => {
    const level = loadMonitor.getLoadLevel();
    expect(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).toContain(level);
  });

  it("incrementRequests / decrementRequests should not go below zero", () => {
    // Decrement many times without incrementing
    loadMonitor.decrementRequests();
    loadMonitor.decrementRequests();
    loadMonitor.decrementRequests();

    const metrics = loadMonitor.getMetrics();
    expect(metrics.activeRequests).toBeGreaterThanOrEqual(0);
  });
});
