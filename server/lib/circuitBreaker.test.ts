import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  TenantCircuitBreaker,
  CircuitBreakerRegistry,
  CircuitBreakerOpenError,
  CircuitState,
} from "./circuitBreaker";

describe("CircuitBreakerOpenError", () => {
  it("should have correct name, message, tenantId, and provider", () => {
    const err = new CircuitBreakerOpenError("open!", "t1", "openai");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("CircuitBreakerOpenError");
    expect(err.message).toBe("open!");
    expect(err.tenantId).toBe("t1");
    expect(err.provider).toBe("openai");
  });
});

describe("TenantCircuitBreaker", () => {
  let breaker: TenantCircuitBreaker;

  beforeEach(() => {
    breaker = new TenantCircuitBreaker("tenant-1", "provider-a", {
      failureThreshold: 3,
      successThreshold: 2,
      timeout: 100, // 100ms for fast test transitions
      resetTimeout: 300000,
    });
  });

  it("should start in CLOSED state", () => {
    expect(breaker.getState()).toBe(CircuitState.CLOSED);
  });

  it("should return correct initial stats", () => {
    const stats = breaker.getStats();
    expect(stats.state).toBe(CircuitState.CLOSED);
    expect(stats.failures).toBe(0);
    expect(stats.successes).toBe(0);
    expect(stats.consecutiveSuccesses).toBe(0);
    expect(stats.totalRequests).toBe(0);
    expect(stats.lastFailureTime).toBeNull();
    expect(stats.lastSuccessTime).toBeNull();
    expect(stats.openedAt).toBeNull();
    expect(stats.tenantId).toBe("tenant-1");
    expect(stats.provider).toBe("provider-a");
  });

  it("should transition from CLOSED to OPEN after reaching failure threshold", () => {
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getState()).toBe(CircuitState.CLOSED);

    breaker.recordFailure(); // 3rd failure = threshold
    expect(breaker.getState()).toBe(CircuitState.OPEN);
  });

  it("should transition from OPEN to HALF_OPEN after timeout elapses", async () => {
    // Drive to OPEN
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getState()).toBe(CircuitState.OPEN);

    // Wait for timeout
    await new Promise((r) => setTimeout(r, 150));

    // getState checks the transition
    expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);
  });

  it("should transition from HALF_OPEN to CLOSED after consecutive successes", async () => {
    // Drive CLOSED -> OPEN
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();

    // Wait for OPEN -> HALF_OPEN
    await new Promise((r) => setTimeout(r, 150));
    expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);

    // Record successes to meet successThreshold (2)
    breaker.recordSuccess();
    breaker.recordSuccess();
    expect(breaker.getState()).toBe(CircuitState.CLOSED);
  });

  it("should transition from HALF_OPEN back to OPEN on any failure", async () => {
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    await new Promise((r) => setTimeout(r, 150));
    expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);

    breaker.recordFailure();
    expect(breaker.getState()).toBe(CircuitState.OPEN);
  });

  it("should execute successfully when circuit is CLOSED", async () => {
    const result = await breaker.execute(() => Promise.resolve(42));
    expect(result).toBe(42);
    expect(breaker.getStats().totalRequests).toBe(1);
    expect(breaker.getStats().successes).toBe(1);
  });

  it("should throw CircuitBreakerOpenError when circuit is OPEN", async () => {
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getState()).toBe(CircuitState.OPEN);

    await expect(
      breaker.execute(() => Promise.resolve("nope"))
    ).rejects.toThrow(CircuitBreakerOpenError);
  });

  it("should propagate operation errors and record failures", async () => {
    await expect(
      breaker.execute(() => Promise.reject(new Error("boom")))
    ).rejects.toThrow("boom");
    expect(breaker.getStats().failures).toBe(1);
  });

  it("should decay failures on success in CLOSED state", () => {
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getStats().failures).toBe(2);

    breaker.recordSuccess();
    expect(breaker.getStats().failures).toBe(1);

    breaker.recordSuccess();
    expect(breaker.getStats().failures).toBe(0);
  });

  it("forceOpen should transition to OPEN from CLOSED", () => {
    expect(breaker.getState()).toBe(CircuitState.CLOSED);
    breaker.forceOpen();
    expect(breaker.getState()).toBe(CircuitState.OPEN);
  });

  it("forceClose should transition to CLOSED from OPEN", () => {
    breaker.forceOpen();
    expect(breaker.getState()).toBe(CircuitState.OPEN);
    breaker.forceClose();
    expect(breaker.getState()).toBe(CircuitState.CLOSED);
  });

  it("reset should clear all stats and return to CLOSED", () => {
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getState()).toBe(CircuitState.OPEN);

    breaker.reset();
    const stats = breaker.getStats();
    expect(stats.state).toBe(CircuitState.CLOSED);
    expect(stats.failures).toBe(0);
    expect(stats.successes).toBe(0);
    expect(stats.totalRequests).toBe(0);
    expect(stats.openedAt).toBeNull();
    expect(stats.lastFailureTime).toBeNull();
    expect(stats.lastSuccessTime).toBeNull();
  });

  it("should track lastActivityTime", () => {
    const before = Date.now();
    breaker.recordSuccess();
    const after = Date.now();
    expect(breaker.getLastActivityTime()).toBeGreaterThanOrEqual(before);
    expect(breaker.getLastActivityTime()).toBeLessThanOrEqual(after);
  });
});

describe("CircuitBreakerRegistry", () => {
  let registry: CircuitBreakerRegistry;

  beforeEach(() => {
    registry = new CircuitBreakerRegistry({
      maxBreakers: 5,
      staleTimeoutMs: 200,
      cleanupIntervalMs: 600000, // large to avoid auto cleanup
    });
  });

  afterEach(() => {
    registry.stopCleanupInterval();
  });

  it("getBreaker should create a new breaker if one does not exist", () => {
    const b = registry.getBreaker("t1", "p1");
    expect(b).toBeInstanceOf(TenantCircuitBreaker);
    expect(b.tenantId).toBe("t1");
    expect(b.provider).toBe("p1");
  });

  it("getBreaker should return the same breaker on repeated calls", () => {
    const b1 = registry.getBreaker("t1", "p1");
    const b2 = registry.getBreaker("t1", "p1");
    expect(b1).toBe(b2);
  });

  it("hasBreaker should return true for existing and false for missing", () => {
    registry.getBreaker("t1", "p1");
    expect(registry.hasBreaker("t1", "p1")).toBe(true);
    expect(registry.hasBreaker("t99", "p99")).toBe(false);
  });

  it("removeBreaker should remove an existing breaker", () => {
    registry.getBreaker("t1", "p1");
    expect(registry.removeBreaker("t1", "p1")).toBe(true);
    expect(registry.hasBreaker("t1", "p1")).toBe(false);
  });

  it("removeBreaker should return false for non-existing breaker", () => {
    expect(registry.removeBreaker("nope", "nope")).toBe(false);
  });

  it("getAllStats should return stats for all breakers", () => {
    registry.getBreaker("t1", "p1");
    registry.getBreaker("t2", "p2");

    const allStats = registry.getAllStats();
    expect(Object.keys(allStats)).toHaveLength(2);
    expect(allStats["t1:p1"]).toBeDefined();
    expect(allStats["t2:p2"]).toBeDefined();
  });

  it("resetAll should reset all breakers to CLOSED", () => {
    const b1 = registry.getBreaker("t1", "p1");
    b1.forceOpen();

    registry.resetAll();
    expect(b1.getState()).toBe(CircuitState.CLOSED);
  });

  it("cleanupStale should remove breakers with old activity", async () => {
    registry.getBreaker("t1", "p1");
    // Wait beyond staleTimeoutMs (200ms)
    await new Promise((r) => setTimeout(r, 250));

    const removed = registry.cleanupStale();
    expect(removed).toBe(1);
    expect(registry.hasBreaker("t1", "p1")).toBe(false);
  });

  it("getMetrics should return correct state counts and totals", () => {
    const b1 = registry.getBreaker("t1", "p1");
    registry.getBreaker("t2", "p2");
    b1.forceOpen();

    const metrics = registry.getMetrics();
    expect(metrics.totalBreakers).toBe(2);
    expect(metrics.byState[CircuitState.OPEN]).toBe(1);
    expect(metrics.byState[CircuitState.CLOSED]).toBe(1);
    expect(metrics.oldestActivity).not.toBeNull();
    expect(metrics.newestActivity).not.toBeNull();
  });

  it("should evict LRU breaker when maxBreakers is exceeded", () => {
    // Fill to capacity (5)
    registry.getBreaker("a", "1");
    registry.getBreaker("b", "2");
    registry.getBreaker("c", "3");
    registry.getBreaker("d", "4");
    registry.getBreaker("e", "5");
    expect(registry.getSize()).toBe(5);

    // Adding one more should evict the LRU (a:1)
    registry.getBreaker("f", "6");
    expect(registry.getSize()).toBe(5);
    expect(registry.hasBreaker("a", "1")).toBe(false);
    expect(registry.hasBreaker("f", "6")).toBe(true);
  });
});

