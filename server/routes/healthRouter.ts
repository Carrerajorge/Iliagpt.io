/**
 * Health Check Router
 *
 * Enhanced health check that verifies all subsystems:
 *   GET /api/health          — overall status (fast, for load balancer probes)
 *   GET /api/health/detailed — per-subsystem status with diagnostics
 *   GET /api/health/ready    — Kubernetes readiness probe
 *   GET /api/health/live     — Kubernetes liveness probe
 *   GET /api/health/metrics  — Prometheus metrics for DB pool
 *
 * Status levels:
 *   "healthy"   — all checked systems responding normally
 *   "degraded"  — some non-critical systems down, core works
 *   "unhealthy" — critical systems down, cannot serve traffic
 */

import { Router } from "express";
import { dbRead } from "../db";
import { cache } from "../lib/cache";
import { sql } from "drizzle-orm";
import fs from "fs";
import os from "os";
import pino from "pino";
import { getHealthStatus, isHealthy, getDbMetricsText } from "../db.js";
import { getTaskScheduler } from "../agentic/TaskScheduler.js";

const logger = pino({ name: "HealthRouter" });

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type HealthLevel = "healthy" | "degraded" | "unhealthy";

export interface SubsystemHealth {
  status: HealthLevel | "up" | "down" | "disabled";
  latencyMs?: number;
  message?: string;
  details?: Record<string, unknown>;
  error?: string;
}

export interface DetailedHealthReport {
  status: HealthLevel;
  timestamp: string;
  uptime: number;
  version: string;
  subsystems: Record<string, SubsystemHealth>;
  criticalFailures: string[];
  warnings: string[];
  probeTimeMs?: number;
  system: {
    uptime: number;
    loadavg: number[];
    memory: { total: number; free: number; usedPercent: number };
    nodeVersion: string;
    pid: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Subsystem Checkers
// ─────────────────────────────────────────────────────────────────────────────

async function checkDatabase(): Promise<SubsystemHealth> {
  const start = Date.now();
  try {
    await dbRead.execute(sql`SELECT 1`);
    const latencyMs = Date.now() - start;

    // Also consult internal health tracking
    const dbHealth = getHealthStatus();

    return {
      status: dbHealth.status === "UNHEALTHY" ? "unhealthy" :
              dbHealth.status === "DEGRADED" ? "degraded" : "healthy",
      latencyMs,
      message: `Database responding (${latencyMs}ms)`,
      details: {
        pool: (dbHealth as any).pool ?? null,
        readReplica: !!process.env.DATABASE_READ_URL,
      },
    };
  } catch (err) {
    return {
      status: "unhealthy",
      latencyMs: Date.now() - start,
      message: "Database probe failed",
      error: (err as Error).message,
    };
  }
}

async function checkRedis(): Promise<SubsystemHealth> {
  const start = Date.now();
  try {
    const redis = cache.getRedisClient();
    if (!redis) {
      return {
        status: "disabled",
        latencyMs: 0,
        message: "Redis not configured — using in-memory cache fallback",
        details: { usingFallback: true },
      };
    }
    await redis.ping();
    return {
      status: "up",
      latencyMs: Date.now() - start,
      message: "Redis responding",
    };
  } catch (err) {
    return {
      status: "degraded",
      latencyMs: Date.now() - start,
      message: "Redis unavailable — degraded caching",
      error: (err as Error).message,
    };
  }
}

function checkLLMProviders(): SubsystemHealth {
  const providers: Record<string, boolean> = {
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    openai: !!process.env.OPENAI_API_KEY,
    gemini: !!process.env.GEMINI_API_KEY || !!process.env.GOOGLE_AI_API_KEY,
    groq: !!process.env.GROQ_API_KEY,
    deepseek: !!process.env.DEEPSEEK_API_KEY,
    mistral: !!process.env.MISTRAL_API_KEY,
    xai: !!process.env.XAI_API_KEY,
  };

  const active = Object.entries(providers).filter(([, v]) => v).map(([k]) => k);
  const inactive = Object.entries(providers).filter(([, v]) => !v).map(([k]) => k);

  if (active.length === 0) {
    return {
      status: "unhealthy",
      message: "No LLM provider API keys configured",
      details: { active, inactive },
    };
  }

  const hasPrimary = providers.anthropic;
  return {
    status: hasPrimary ? "healthy" : "degraded",
    message: hasPrimary
      ? `${active.length} provider(s) active`
      : "Anthropic key missing — agentic features limited",
    details: { active, inactive, primaryAvailable: hasPrimary },
  };
}

async function checkToolRegistry(): Promise<SubsystemHealth> {
  const start = Date.now();
  try {
    const mod = await import("../agent/index.js").catch(() => null);
    return {
      status: mod ? "healthy" : "degraded",
      latencyMs: Date.now() - start,
      message: mod ? "Tool registry loaded" : "Tool registry module not loadable",
    };
  } catch (err) {
    return {
      status: "degraded",
      latencyMs: Date.now() - start,
      message: "Tool registry check failed",
      error: (err as Error).message,
    };
  }
}

function checkBackgroundTasks(): SubsystemHealth {
  try {
    const scheduler = getTaskScheduler();
    const stats = scheduler.getStats();
    const healthy = stats.activeRuns <= 50 && (stats.totalRuns === 0 || stats.successRate >= 0.5);

    return {
      status: healthy ? "healthy" : "degraded",
      message: `${stats.totalDefinitions} tasks defined, ${stats.activeRuns} active, ${Math.round(stats.successRate * 100)}% success`,
      details: {
        totalDefinitions: stats.totalDefinitions,
        enabledDefinitions: stats.enabledDefinitions,
        activeRuns: stats.activeRuns,
        successRate: stats.successRate,
        totalRuns: stats.totalRuns,
        failedRuns: stats.failedRuns,
      },
    };
  } catch (err) {
    return {
      status: "degraded",
      message: "Background task check failed",
      error: (err as Error).message,
    };
  }
}

function checkRAGPipeline(): SubsystemHealth {
  const hasDB = !!process.env.DATABASE_URL;
  const hasEmbedding = !!process.env.ANTHROPIC_API_KEY || !!process.env.OPENAI_API_KEY;

  if (!hasDB || !hasEmbedding) {
    return {
      status: "degraded",
      message: "RAG pipeline partially configured",
      details: { vectorStore: hasDB, embeddingProvider: hasEmbedding },
    };
  }

  return {
    status: "healthy",
    message: "RAG pipeline dependencies available",
    details: {
      vectorStore: "postgresql+pgvector",
      embeddingProvider: process.env.ANTHROPIC_API_KEY ? "anthropic" : "openai",
    },
  };
}

function checkDisk(): SubsystemHealth {
  try {
    const testFile = `/tmp/health_${Date.now()}`;
    fs.writeFileSync(testFile, "ok");
    fs.unlinkSync(testFile);
    return { status: "healthy", message: "Disk write access confirmed" };
  } catch (err) {
    return { status: "degraded", message: "Disk write failed", error: (err as Error).message };
  }
}

function checkMemory(): SubsystemHealth {
  const used = process.memoryUsage();
  const heapUsedMB = Math.round(used.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(used.heapTotal / 1024 / 1024);
  const heapPct = heapUsedMB / heapTotalMB;
  const freeSystemMB = Math.round(os.freemem() / 1024 / 1024);

  const status: HealthLevel =
    heapPct > 0.9 ? "unhealthy" :
    heapPct > 0.75 ? "degraded" : "healthy";

  return {
    status,
    message: `Heap ${heapUsedMB}MB / ${heapTotalMB}MB (${Math.round(heapPct * 100)}%), system free: ${freeSystemMB}MB`,
    details: {
      heapUsedMB,
      heapTotalMB,
      heapPercent: Math.round(heapPct * 100),
      rssMB: Math.round(used.rss / 1024 / 1024),
      systemFreeMB: freeSystemMB,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Report Builder
// ─────────────────────────────────────────────────────────────────────────────

async function buildReport(fast = false): Promise<DetailedHealthReport> {
  const startMs = Date.now();

  const [database, redis, toolRegistry] = fast
    ? [
        { status: "healthy" as const, message: "skipped (fast mode)" },
        { status: "healthy" as const, message: "skipped (fast mode)" },
        { status: "healthy" as const, message: "skipped (fast mode)" },
      ]
    : await Promise.all([checkDatabase(), checkRedis(), checkToolRegistry()]);

  const llm = checkLLMProviders();
  const backgroundTasks = checkBackgroundTasks();
  const ragPipeline = checkRAGPipeline();
  const disk = checkDisk();
  const memory = checkMemory();

  const subsystems: Record<string, SubsystemHealth> = {
    database,
    redis,
    llm,
    toolRegistry,
    backgroundTasks,
    ragPipeline,
    disk,
    memory,
  };

  // Critical = must be up for core operation
  const critical = ["database", "llm", "memory"];
  const criticalFailures = critical
    .filter((k) => subsystems[k].status === "unhealthy")
    .map((k) => `${k}: ${subsystems[k].message}`);

  const warnings = Object.entries(subsystems)
    .filter(([k, s]) => s.status === "degraded" && !critical.includes(k))
    .map(([k, s]) => `${k}: ${s.message}`);

  const overallStatus: HealthLevel =
    criticalFailures.length > 0 ? "unhealthy" :
    (warnings.length > 0 || critical.some((k) => subsystems[k].status === "degraded")) ? "degraded" :
    "healthy";

  let version = "1.0.0";
  try {
    const { createRequire } = await import("module");
    const req = createRequire(import.meta.url);
    version = req("../../package.json").version ?? version;
  } catch { /* ignore */ }

  const totalMem = os.totalmem();
  const freeMem = os.freemem();

  return {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
    version,
    subsystems,
    criticalFailures,
    warnings,
    probeTimeMs: Date.now() - startMs,
    system: {
      uptime: Math.round(os.uptime()),
      loadavg: os.loadavg(),
      memory: {
        total: totalMem,
        free: freeMem,
        usedPercent: Math.round(((totalMem - freeMem) / totalMem) * 100),
      },
      nodeVersion: process.version,
      pid: process.pid,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────────────

export const healthRouter = Router();

/** GET /api/health — fast overview */
healthRouter.get("/", async (req, res) => {
  const start = Date.now();
  try {
    const report = await buildReport(/* fast= */ true);
    res.status(report.status === "unhealthy" ? 503 : 200).json({
      status: report.status,
      timestamp: report.timestamp,
      uptime: report.uptime,
      version: report.version,
      latencyMs: Date.now() - start,
    });
  } catch (err) {
    logger.error({ err }, "Fast health check failed");
    res.status(503).json({ status: "unhealthy", error: (err as Error).message });
  }
});

/** GET /api/health/detailed — full subsystem report */
healthRouter.get("/detailed", async (req, res) => {
  try {
    const report = await buildReport(/* fast= */ false);
    res.status(report.status === "unhealthy" ? 503 : 200).json(report);
  } catch (err) {
    logger.error({ err }, "Detailed health check failed");
    res.status(503).json({ status: "unhealthy", error: (err as Error).message });
  }
});

/** GET /api/health/ready — Kubernetes readiness probe */
healthRouter.get("/ready", async (req, res) => {
  try {
    const dbOk = isHealthy();
    const llm = checkLLMProviders();
    const mem = checkMemory();
    const ready = dbOk && llm.status !== "unhealthy" && mem.status !== "unhealthy";

    res.status(ready ? 200 : 503).json({
      ready,
      timestamp: new Date().toISOString(),
      checks: {
        database: dbOk,
        llmConfigured: llm.status !== "unhealthy",
        memoryOk: mem.status !== "unhealthy",
      },
    });
  } catch (err) {
    res.status(503).json({ ready: false, error: (err as Error).message });
  }
});

/** GET /api/health/live — Kubernetes liveness probe */
healthRouter.get("/live", (req, res) => {
  const mem = checkMemory();
  if (mem.status === "unhealthy") {
    return res.status(503).json({
      alive: false,
      reason: "critical_memory_pressure",
      memory: mem.details,
      timestamp: new Date().toISOString(),
    });
  }
  res.status(200).json({
    alive: true,
    pid: process.pid,
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

/** GET /api/health/metrics — Prometheus-format DB metrics */
healthRouter.get("/metrics", async (req, res) => {
  try {
    const metricsText = await getDbMetricsText();
    res.setHeader("Content-Type", "text/plain; version=0.0.4");
    res.send(metricsText);
  } catch (err) {
    res.status(500).json({ error: "Metrics unavailable", message: (err as Error).message });
  }
});

export function createHealthRouter() {
  return healthRouter;
}

export default healthRouter;
