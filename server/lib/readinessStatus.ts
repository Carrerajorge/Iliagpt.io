import type { HealthStatus } from "../db";

export type DbReadinessSnapshot = {
  status: HealthStatus;
  lastCheck: Date | null;
  latencyMs: number;
  consecutiveFailures: number;
};

export type RateLimiterReadinessSnapshot = {
  backend: string;
  initialized: boolean;
};

export type ReadinessStatus = "ready" | "degraded" | "not_ready";

export function buildReadinessResponse(params: {
  db: DbReadinessSnapshot;
  mem: NodeJS.MemoryUsage;
  rateLimiter: RateLimiterReadinessSnapshot;
  uptimeSeconds: number;
  now?: Date;
}) {
  const { db, mem, rateLimiter, uptimeSeconds } = params;
  const now = params.now ?? new Date();
  const status: ReadinessStatus =
    db.status === "HEALTHY"
      ? "ready"
      : db.status === "DEGRADED"
        ? "degraded"
        : "not_ready";

  return {
    httpStatus: status === "not_ready" ? 503 : 200,
    payload: {
      status,
      checks: {
        database: {
          status: db.status,
          latencyMs: db.latencyMs,
          lastCheck: db.lastCheck ? db.lastCheck.toISOString() : null,
          consecutiveFailures: db.consecutiveFailures,
        },
        memory: {
          status: "ok",
          rss: mem.rss,
          heapUsed: mem.heapUsed,
          heapTotal: mem.heapTotal,
        },
        uptime: {
          status: "ok",
          seconds: uptimeSeconds,
        },
        rateLimiter: {
          status: rateLimiter.backend === "redis" ? "ok" : "degraded",
          backend: rateLimiter.backend,
          initialized: rateLimiter.initialized,
        },
      },
      uptime: uptimeSeconds,
      timestamp: now.toISOString(),
    },
  };
}
