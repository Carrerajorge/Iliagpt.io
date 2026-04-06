import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import * as pkg from "pg";
import * as schema from "../shared/schema";
import { Registry, Histogram, Counter, Gauge } from "prom-client";
import { env } from "./config/env";
import { Logger } from "./lib/logger";

const { Pool } = pkg;

const isProd = env.NODE_ENV === 'production';

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DB_POOL_MAX || (isProd ? 100 : 5),
  min: env.DB_POOL_MIN || (isProd ? 10 : 0),
  idleTimeoutMillis: isProd ? 10000 : 3000,
  connectionTimeoutMillis: isProd ? 5000 : 3000,
  allowExitOnIdle: false,
  keepAlive: true,
  application_name: 'iliagpt_server_write',
  options: '-c search_path=public -c statement_timeout=15000',
});

const poolRead = env.DATABASE_READ_URL ? new Pool({
  connectionString: env.DATABASE_READ_URL,
  max: env.DB_READ_POOL_MAX || (isProd ? 150 : 5),
  min: env.DB_READ_POOL_MIN || (isProd ? 20 : 2),
  idleTimeoutMillis: isProd ? 15000 : 10000,
  connectionTimeoutMillis: isProd ? 5000 : 5000,
  allowExitOnIdle: false,
  keepAlive: true,
  application_name: 'iliagpt_server_read',
  options: '-c search_path=public -c statement_timeout=30000',
}) : pool;

pool.on("error", (err: unknown) => {
  const errorCode =
    typeof err === "object" && err !== null && "code" in err
      ? String((err as { code?: unknown }).code ?? "")
      : "";
  const errorMessage = err instanceof Error ? err.message : String(err);

  if (errorCode === "57P01") {
    Logger.warn('[DB Write] Connection terminated by administrator, pool will reconnect automatically');
  } else {
    Logger.error("[DB Write] Unexpected error on idle client:", errorMessage);
  }
  healthState.consecutiveFailures++;
  updateHealthStatus();
});

if (env.DATABASE_READ_URL) {
  poolRead.on("error", (err: unknown) => {
    const errorMessage = err instanceof Error ? err.message : String(err);
    Logger.error("[DB Read] Unexpected error on idle client:", errorMessage);
  });
  poolRead.on('connect', () => {
    Logger.info('[DB Read] New client connected to read pool');
  });
}

pool.on('connect', () => {
  Logger.info('[DB Write] New client connected to pool');
});

export { pool, poolRead };

export const db = drizzle(pool, { schema });
export const dbRead = drizzle(poolRead, { schema });

export async function runMigrations(): Promise<void> {
  await pool.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');
  await pool.query("CREATE EXTENSION IF NOT EXISTS vector;");
  await migrate(db, { migrationsFolder: "./migrations" });
}

export type HealthStatus = "HEALTHY" | "DEGRADED" | "UNHEALTHY";

interface PoolSnapshot {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
  maxConnections: number;
}

interface HealthState {
  status: HealthStatus;
  lastCheck: Date | null;
  latencyMs: number;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  isReconnecting: boolean;
  reconnectAttempts: number;
  lastError: string | null;
}

interface HealthCheckResult {
  status: HealthStatus;
  lastCheck: Date | null;
  latencyMs: number;
  consecutiveFailures: number;
  isReconnecting: boolean;
  reconnectAttempts: number;
  lastError: string | null;
  pool: PoolSnapshot;
}

const HEALTH_CHECK_INTERVAL_MS = process.env.NODE_ENV === 'production' ? 30000 : 120000;
const HEALTHY_THRESHOLD = 3;
const MAX_RECONNECT_DELAY_MS = 30000;
const INITIAL_RECONNECT_DELAY_MS = 1000;

let healthCheckIntervalId: NodeJS.Timeout | null = null;
let reconnectTimeoutId: NodeJS.Timeout | null = null;
let activeHealthCheck: Promise<boolean> | null = null;
let isShuttingDown = false;

const healthState: HealthState = {
  status: "HEALTHY",
  lastCheck: null,
  latencyMs: 0,
  consecutiveFailures: 0,
  consecutiveSuccesses: 0,
  isReconnecting: false,
  reconnectAttempts: 0,
  lastError: null,
};

const dbMetricsRegistry = new Registry();

const dbHealthStatusGauge = new Gauge({
  name: 'db_health_status',
  help: 'Database health status (0=unhealthy, 1=degraded, 2=healthy)',
  registers: [dbMetricsRegistry],
});

const dbQueryLatencyHistogram = new Histogram({
  name: 'db_query_latency_ms',
  help: 'Database query latency in milliseconds',
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
  registers: [dbMetricsRegistry],
});

const dbConnectionFailuresCounter = new Counter({
  name: 'db_connection_failures_total',
  help: 'Total number of database connection failures',
  registers: [dbMetricsRegistry],
});

function updateHealthStatus(): void {
  let newStatus: HealthStatus;

  if (healthState.consecutiveFailures >= 3) {
    newStatus = 'UNHEALTHY';
  } else if (healthState.consecutiveFailures >= 1) {
    newStatus = 'DEGRADED';
  } else if (healthState.consecutiveSuccesses >= HEALTHY_THRESHOLD) {
    newStatus = 'HEALTHY';
  } else {
    newStatus = healthState.status;
  }

  if (newStatus !== healthState.status) {
    console.log(`[DB Health] Status changed: ${healthState.status} -> ${newStatus}`);
  }
  healthState.status = newStatus;

  const statusValue = newStatus === 'HEALTHY' ? 2 : newStatus === 'DEGRADED' ? 1 : 0;
  dbHealthStatusGauge.set(statusValue);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getPoolSnapshot(targetPool: {
  totalCount?: number;
  idleCount?: number;
  waitingCount?: number;
  options?: { max?: number };
} | null | undefined): PoolSnapshot {
  return {
    totalCount: targetPool?.totalCount ?? 0,
    idleCount: targetPool?.idleCount ?? 0,
    waitingCount: targetPool?.waitingCount ?? 0,
    maxConnections: targetPool?.options?.max ?? env.DB_POOL_MAX ?? 0,
  };
}

export function isTransientDatabaseError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code ?? "").toLowerCase()
      : "";

  if (
    [
      "57p01",
      "57p02",
      "57p03",
      "08000",
      "08003",
      "08006",
      "53300",
      "econnreset",
      "econnrefused",
      "etimedout",
    ].includes(code)
  ) {
    return true;
  }

  return [
    "connection terminated unexpectedly",
    "connection terminated due to connection timeout",
    "timeout exceeded when trying to connect",
    "health check timeout",
    "could not connect",
    "terminating connection",
    "connection timeout",
    "database system is starting up",
  ].some((fragment) => message.includes(fragment));
}

function clearReconnectTimer(): void {
  if (!reconnectTimeoutId) {
    return;
  }

  clearTimeout(reconnectTimeoutId);
  reconnectTimeoutId = null;
}

export async function performHealthCheck(): Promise<boolean> {
  if (isShuttingDown) {
    return false;
  }

  if (activeHealthCheck) {
    return activeHealthCheck;
  }

  activeHealthCheck = (async () => {
    const startTime = Date.now();

    try {
      await pool.query("SELECT 1");

      const latencyMs = Date.now() - startTime;
      healthState.latencyMs = latencyMs;
      healthState.lastCheck = new Date();
      healthState.consecutiveFailures = 0;
      healthState.consecutiveSuccesses++;
      healthState.isReconnecting = false;
      healthState.reconnectAttempts = 0;
      healthState.lastError = null;

      clearReconnectTimer();
      dbQueryLatencyHistogram.observe(latencyMs);
      updateHealthStatus();

      console.log(`[DB Health] Check OK - ${latencyMs}ms (status: ${healthState.status})`);
      return true;
    } catch (error: unknown) {
      const latencyMs = Date.now() - startTime;
      const errorMessage = getErrorMessage(error);

      healthState.latencyMs = latencyMs;
      healthState.lastCheck = new Date();
      healthState.consecutiveFailures++;
      healthState.consecutiveSuccesses = 0;
      healthState.lastError = errorMessage;

      dbConnectionFailuresCounter.inc();
      dbQueryLatencyHistogram.observe(latencyMs);
      updateHealthStatus();

      console.error(
        `[DB Health] Check FAILED - ${errorMessage} (failures: ${healthState.consecutiveFailures}, status: ${healthState.status})`,
      );

      if (healthState.status === "UNHEALTHY" && !healthState.isReconnecting) {
        scheduleReconnect();
      }

      return false;
    } finally {
      activeHealthCheck = null;
    }
  })();

  return activeHealthCheck;
}

function calculateBackoffDelay(): number {
  const baseDelay = INITIAL_RECONNECT_DELAY_MS;
  const exponentialDelay = baseDelay * Math.pow(2, healthState.reconnectAttempts);
  return Math.min(exponentialDelay, MAX_RECONNECT_DELAY_MS);
}

async function attemptReconnect(): Promise<void> {
  if (isShuttingDown) {
    healthState.isReconnecting = false;
    return;
  }

  healthState.reconnectAttempts++;
  const delay = calculateBackoffDelay();

  console.log(`[DB Health] Attempting reconnection (attempt ${healthState.reconnectAttempts}, delay: ${delay}ms)`);

  try {
    await pool.query("SELECT 1");

    console.log(`[DB Health] Reconnection successful after ${healthState.reconnectAttempts} attempts`);
    healthState.isReconnecting = false;
    healthState.consecutiveFailures = 0;
    healthState.consecutiveSuccesses = 1;
    healthState.reconnectAttempts = 0;
    healthState.lastError = null;
    updateHealthStatus();

  } catch (error: unknown) {
    const errorMessage = getErrorMessage(error);

    healthState.lastError = errorMessage;
    console.error(`[DB Health] Reconnection failed: ${errorMessage}`);
    dbConnectionFailuresCounter.inc();

    if (!isShuttingDown && healthState.status === "UNHEALTHY") {
      scheduleReconnect();
    }
  }
}

function scheduleReconnect(): void {
  if (isShuttingDown || reconnectTimeoutId) {
    return;
  }

  healthState.isReconnecting = true;
  const delay = calculateBackoffDelay();

  console.log(`[DB Health] Scheduling reconnection in ${delay}ms`);

  reconnectTimeoutId = setTimeout(() => {
    reconnectTimeoutId = null;
    attemptReconnect();
  }, delay);
}

export function getHealthStatus(): HealthCheckResult {
  return {
    status: healthState.status,
    lastCheck: healthState.lastCheck,
    latencyMs: healthState.latencyMs,
    consecutiveFailures: healthState.consecutiveFailures,
    isReconnecting: healthState.isReconnecting,
    reconnectAttempts: healthState.reconnectAttempts,
    lastError: healthState.lastError,
    pool: getPoolSnapshot(pool),
  };
}

export function isHealthy(): boolean {
  return healthState.status === 'HEALTHY';
}

export async function waitForHealthy(timeoutMs: number = 30000): Promise<boolean> {
  if (healthState.status === 'HEALTHY') {
    return true;
  }

  const startTime = Date.now();
  const pollInterval = 1000;

  return new Promise((resolve) => {
    const checkHealth = () => {
      if (healthState.status === 'HEALTHY') {
        resolve(true);
        return;
      }

      if (Date.now() - startTime >= timeoutMs) {
        resolve(false);
        return;
      }

      setTimeout(checkHealth, pollInterval);
    };

    checkHealth();
  });
}

export function startHealthChecks(): void {
  if (healthCheckIntervalId) {
    console.log('[DB Health] Health checks already running');
    return;
  }

  isShuttingDown = false;
  console.log(`[DB Health] Starting periodic health checks (interval: ${HEALTH_CHECK_INTERVAL_MS}ms)`);

  void performHealthCheck();

  healthCheckIntervalId = setInterval(() => {
    void performHealthCheck();
  }, HEALTH_CHECK_INTERVAL_MS);

  healthCheckIntervalId.unref();
}

export function stopHealthChecks(): void {
  console.log('[DB Health] Stopping health checks');
  isShuttingDown = true;

  if (healthCheckIntervalId) {
    clearInterval(healthCheckIntervalId);
    healthCheckIntervalId = null;
  }

  if (reconnectTimeoutId) {
    clearTimeout(reconnectTimeoutId);
    reconnectTimeoutId = null;
  }
}

export async function drainConnections(): Promise<void> {
  console.log('[DB Health] Draining database connections');

  try {
    const pools = poolRead === pool ? [pool] : [pool, poolRead];
    await Promise.all(pools.map((targetPool) => targetPool.end()));
    console.log('[DB Health] All database connections drained');
  } catch (error: unknown) {
    console.error("[DB Health] Error draining connections:", getErrorMessage(error));
  }
}

export function getDbMetrics(): Registry {
  return dbMetricsRegistry;
}

export async function getDbMetricsText(): Promise<string> {
  return dbMetricsRegistry.metrics();
}

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts: { label: string; retries: number; delayMs: number; maxDelayMs: number }
): Promise<T> {
  let attempt = 0;
  let delay = opts.delayMs;
  while (true) {
    try {
      return await fn();
    } catch (err: unknown) {
      attempt += 1;
      const msg = getErrorMessage(err);
      console.warn(`[Startup] ${opts.label} failed (${attempt}/${opts.retries}): ${msg}`);
      if (attempt >= opts.retries) throw err;
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(opts.maxDelayMs, Math.round(delay * 1.6));
    }
  }
}

export async function verifyDatabaseConnection(): Promise<boolean> {
  const startTime = Date.now();

  try {
    const result = await retryWithBackoff(
      async () => pool.query("SELECT current_database(), NOW() as server_time"),
      { label: "DB connect", retries: 10, delayMs: 300, maxDelayMs: 3000 }
    );

    console.log(`[DB] Connected to database: ${result.rows[0].current_database}`);

    healthState.lastCheck = new Date();
    healthState.latencyMs = Date.now() - startTime;
    healthState.consecutiveFailures = 0;
    healthState.consecutiveSuccesses = HEALTHY_THRESHOLD;
    healthState.status = "HEALTHY";
    healthState.isReconnecting = false;
    healthState.reconnectAttempts = 0;
    healthState.lastError = null;
    clearReconnectTimer();
    updateHealthStatus();

    return true;
  } catch (error: unknown) {
    const errorMessage = getErrorMessage(error);

    console.error("[DB] Failed to connect to database:", errorMessage);
    healthState.lastCheck = new Date();
    healthState.latencyMs = Date.now() - startTime;
    healthState.consecutiveFailures++;
    healthState.consecutiveSuccesses = 0;
    healthState.lastError = errorMessage;
    updateHealthStatus();

    if (env.NODE_ENV === "production") {
      console.error('[FATAL] Cannot start production server without database connection');
      process.exit(1);
    }
    return false;
  }
}
