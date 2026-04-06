import { afterEach, describe, expect, it, vi } from "vitest";

async function loadAggregatorModule(health: {
  status: "HEALTHY" | "DEGRADED" | "UNHEALTHY";
  isReconnecting?: boolean;
  reconnectAttempts?: number;
  lastError?: string | null;
}) {
  vi.resetModules();

  const dbRead = {
    execute: vi.fn(),
    select: vi.fn(),
  };
  const storage = {
    getCostBudget: vi.fn(),
    upsertCostBudget: vi.fn(),
    createProviderMetrics: vi.fn(),
    getCostBudgets: vi.fn(),
    createKpiSnapshot: vi.fn(),
  };
  const getHealthStatus = vi.fn(() => ({
    status: health.status,
    lastCheck: new Date(),
    latencyMs: 0,
    consecutiveFailures: health.status === "HEALTHY" ? 0 : 3,
    isReconnecting: health.isReconnecting ?? false,
    reconnectAttempts: health.reconnectAttempts ?? 0,
    lastError: health.lastError ?? null,
    pool: {
      totalCount: 0,
      idleCount: 0,
      waitingCount: 0,
      maxConnections: 20,
    },
  }));

  vi.doMock("../../db", () => ({
    dbRead,
    getHealthStatus,
    isTransientDatabaseError: vi.fn(() => false),
  }));
  vi.doMock("../../storage", () => ({ storage }));
  vi.doMock("@shared/schema", () => ({
    apiLogs: {
      provider: "provider",
      statusCode: "statusCode",
      latencyMs: "latencyMs",
      tokensIn: "tokensIn",
      tokensOut: "tokensOut",
      createdAt: "createdAt",
      userId: "userId",
    },
  }));

  const mod = await import("../analyticsAggregator");
  return { ...mod, dbRead, storage, getHealthStatus };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("analyticsAggregator", () => {
  it("skips aggregation while the database is unhealthy", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { runAggregation, dbRead, storage } = await loadAggregatorModule({
      status: "UNHEALTHY",
      isReconnecting: true,
      reconnectAttempts: 2,
      lastError: "timeout exceeded when trying to connect",
    });

    await runAggregation();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Skipping aggregation while database is unavailable"),
    );
    expect(dbRead.execute).not.toHaveBeenCalled();
    expect(dbRead.select).not.toHaveBeenCalled();
    expect(storage.createProviderMetrics).not.toHaveBeenCalled();
  });

  it("skips KPI calculation until the database is healthy again", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { calculateKpis, dbRead, storage } = await loadAggregatorModule({
      status: "DEGRADED",
      lastError: "Connection terminated unexpectedly",
    });

    await calculateKpis();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Skipping KPI calculation while database is unavailable"),
    );
    expect(dbRead.execute).not.toHaveBeenCalled();
    expect(dbRead.select).not.toHaveBeenCalled();
    expect(storage.createKpiSnapshot).not.toHaveBeenCalled();
  });
});
