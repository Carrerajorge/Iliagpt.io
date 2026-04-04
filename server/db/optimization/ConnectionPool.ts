import * as pkg from "pg";
import type { Pool, PoolClient } from "pg";
import { Logger } from "../../lib/logger";
import { env } from "../../config/env";

const { Pool: PgPool } = pkg;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PoolMetrics {
  totalConnections: number;
  idleConnections: number;
  waitingClients: number;
  maxConnections: number;
  connectionErrors: number;
  queryCount: number;
  avgQueryTime: number;
}

export interface PoolHealth {
  healthy: boolean;
  writePool: PoolInstanceHealth;
  readPools: PoolInstanceHealth[];
  metrics: PoolMetrics;
}

export interface PoolInstanceHealth {
  url: string;
  healthy: boolean;
  latencyMs: number;
  totalCount: number;
  idleCount: number;
  waitingCount: number;
  lastChecked: Date;
}

interface ReplicaPoolEntry {
  pool: Pool;
  url: string;
}

// ---------------------------------------------------------------------------
// ConnectionPoolManager
// ---------------------------------------------------------------------------

class ConnectionPoolManager {
  private writePool: Pool;
  private readPools: ReplicaPoolEntry[];
  private currentReadIndex: number = 0;
  private metrics: PoolMetrics;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private totalQueryTime: number = 0;

  constructor() {
    const isProd = env.NODE_ENV === "production";

    this.writePool = new PgPool({
      connectionString: env.DATABASE_URL,
      max: env.DB_POOL_MAX || (isProd ? 100 : 5),
      min: env.DB_POOL_MIN || (isProd ? 10 : 0),
      idleTimeoutMillis: isProd ? 10_000 : 3_000,
      connectionTimeoutMillis: isProd ? 5_000 : 3_000,
      allowExitOnIdle: false,
      keepAlive: true,
      application_name: "iliagpt_cpm_write",
      options: "-c search_path=public -c statement_timeout=15000",
    });

    this.metrics = {
      totalConnections: 0,
      idleConnections: 0,
      waitingClients: 0,
      maxConnections: env.DB_POOL_MAX || (isProd ? 100 : 5),
      connectionErrors: 0,
      queryCount: 0,
      avgQueryTime: 0,
    };

    // Build read replica pool array
    const readUrls: string[] = [];
    if (env.DATABASE_READ_URL) {
      readUrls.push(env.DATABASE_READ_URL);
    }
    // Support additional replicas via DATABASE_READ_URL_2, DATABASE_READ_URL_3 …
    for (let i = 2; i <= 5; i++) {
      const url = (env as any)[`DATABASE_READ_URL_${i}`];
      if (url) readUrls.push(url);
    }

    if (readUrls.length === 0) {
      // Fall back to write pool for reads when no replica is configured
      this.readPools = [{ pool: this.writePool, url: env.DATABASE_URL }];
    } else {
      this.readPools = readUrls.map((url) => ({
        url,
        pool: new PgPool({
          connectionString: url,
          max: env.DB_READ_POOL_MAX || (isProd ? 150 : 5),
          min: env.DB_READ_POOL_MIN || (isProd ? 20 : 2),
          idleTimeoutMillis: isProd ? 15_000 : 10_000,
          connectionTimeoutMillis: isProd ? 5_000 : 5_000,
          allowExitOnIdle: false,
          keepAlive: true,
          application_name: `iliagpt_cpm_read`,
          options: "-c search_path=public -c statement_timeout=30000",
        }),
      }));
    }

    this.attachPoolListeners(this.writePool, "write");
    this.readPools.forEach((r, idx) => this.attachPoolListeners(r.pool, `read-${idx}`));
  }

  // ---------------------------------------------------------------------------
  // Pool event wiring
  // ---------------------------------------------------------------------------

  private attachPoolListeners(pool: Pool, label: string): void {
    pool.on("connect", () => {
      Logger.debug(`[ConnectionPool][${label}] New client connected`);
      this.updateMetrics("connect");
    });
    pool.on("acquire", () => {
      this.updateMetrics("acquire");
    });
    pool.on("remove", () => {
      Logger.debug(`[ConnectionPool][${label}] Client removed`);
      this.updateMetrics("remove");
    });
    pool.on("error", (err) => {
      Logger.error(`[ConnectionPool][${label}] Idle client error`, err);
      this.updateMetrics("error");
    });
  }

  // ---------------------------------------------------------------------------
  // Connection accessors
  // ---------------------------------------------------------------------------

  async getWriteConnection(): Promise<PoolClient> {
    try {
      return await this.writePool.connect();
    } catch (err) {
      this.metrics.connectionErrors++;
      Logger.error("[ConnectionPool] Failed to acquire write connection", err);
      throw err;
    }
  }

  /** Round-robin across all configured read replicas. */
  async getReadConnection(): Promise<PoolClient> {
    const entry = this.readPools[this.currentReadIndex];
    this.currentReadIndex = (this.currentReadIndex + 1) % this.readPools.length;
    try {
      return await entry.pool.connect();
    } catch (err) {
      Logger.warn(
        `[ConnectionPool] Read replica ${entry.url} unavailable, falling back to write pool`
      );
      this.metrics.connectionErrors++;
      return await this.writePool.connect();
    }
  }

  // ---------------------------------------------------------------------------
  // Query executors
  // ---------------------------------------------------------------------------

  async executeWrite<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const start = Date.now();
    const client = await this.getWriteConnection();
    try {
      const result = await client.query<T>(sql, params);
      this.recordQueryTime(Date.now() - start);
      return result.rows;
    } finally {
      client.release();
    }
  }

  async executeRead<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const start = Date.now();
    const client = await this.getReadConnection();
    try {
      const result = await client.query<T>(sql, params);
      this.recordQueryTime(Date.now() - start);
      return result.rows;
    } finally {
      client.release();
    }
  }

  /** Returns true if the SQL string is a pure SELECT (safe for read replica). */
  isReadQuery(sql: string): boolean {
    const normalized = sql.trimStart().toUpperCase();
    return (
      normalized.startsWith("SELECT") ||
      normalized.startsWith("WITH") ||
      normalized.startsWith("EXPLAIN")
    );
  }

  // ---------------------------------------------------------------------------
  // Health checks
  // ---------------------------------------------------------------------------

  async startHealthChecks(intervalMs: number = 30_000): Promise<void> {
    if (this.healthCheckInterval) return;
    Logger.info(`[ConnectionPool] Starting health checks every ${intervalMs}ms`);
    await this.checkPoolHealth();
    this.healthCheckInterval = setInterval(() => {
      this.checkPoolHealth().catch((err) =>
        Logger.error("[ConnectionPool] Health check error", err)
      );
    }, intervalMs);
    this.healthCheckInterval.unref();
  }

  async checkPoolHealth(): Promise<PoolHealth> {
    const writeHealth = await this.pingPool(this.writePool, env.DATABASE_URL);

    const readHealthPromises = this.readPools.map((r) =>
      this.pingPool(r.pool, r.url)
    );
    const readHealthResults = await Promise.all(readHealthPromises);

    const allHealthy =
      writeHealth.healthy && readHealthResults.every((r) => r.healthy);

    if (!allHealthy) {
      Logger.warn("[ConnectionPool] One or more pools are unhealthy", {
        write: writeHealth.healthy,
        reads: readHealthResults.map((r) => ({ url: r.url, healthy: r.healthy })),
      });
    }

    await this.cleanDeadConnections();

    return {
      healthy: allHealthy,
      writePool: writeHealth,
      readPools: readHealthResults,
      metrics: this.getMetrics(),
    };
  }

  private async pingPool(pool: Pool, url: string): Promise<PoolInstanceHealth> {
    const start = Date.now();
    let healthy = false;
    let client: PoolClient | null = null;
    try {
      client = await pool.connect();
      await client.query("SELECT 1");
      healthy = true;
    } catch (err) {
      Logger.error(`[ConnectionPool] Ping failed for ${url}`, err);
    } finally {
      if (client) (client as any).release();
    }

    return {
      url,
      healthy,
      latencyMs: Date.now() - start,
      totalCount: (pool as any).totalCount ?? 0,
      idleCount: (pool as any).idleCount ?? 0,
      waitingCount: (pool as any).waitingCount ?? 0,
      lastChecked: new Date(),
    };
  }

  // ---------------------------------------------------------------------------
  // Metrics
  // ---------------------------------------------------------------------------

  getMetrics(): PoolMetrics {
    const write = this.writePool as any;
    this.metrics.totalConnections = write.totalCount ?? 0;
    this.metrics.idleConnections = write.idleCount ?? 0;
    this.metrics.waitingClients = write.waitingCount ?? 0;
    return { ...this.metrics };
  }

  private recordQueryTime(ms: number): void {
    this.metrics.queryCount++;
    this.totalQueryTime += ms;
    this.metrics.avgQueryTime = Math.round(
      this.totalQueryTime / this.metrics.queryCount
    );
  }

  private updateMetrics(event: "connect" | "acquire" | "remove" | "error"): void {
    if (event === "error") this.metrics.connectionErrors++;
  }

  // ---------------------------------------------------------------------------
  // Drain & cleanup
  // ---------------------------------------------------------------------------

  async drainAll(): Promise<void> {
    Logger.info("[ConnectionPool] Draining all pools");
    const pools = [
      this.writePool,
      ...this.readPools
        .filter((r) => r.pool !== this.writePool)
        .map((r) => r.pool),
    ];
    await Promise.all(pools.map((p) => p.end().catch(() => {})));
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    Logger.info("[ConnectionPool] All pools drained");
  }

  private async cleanDeadConnections(): Promise<void> {
    // pg.Pool handles this internally; we emit a debug log for observability
    const write = this.writePool as any;
    Logger.debug(
      `[ConnectionPool] Pool state — total: ${write.totalCount}, idle: ${write.idleCount}, waiting: ${write.waitingCount}`
    );
  }
}

export const connectionPoolManager = new ConnectionPoolManager();
