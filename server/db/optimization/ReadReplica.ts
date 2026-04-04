import * as pkg from "pg";
import type { Pool } from "pg";
import { Logger } from "../../lib/logger";
import { env } from "../../config/env";

const { Pool: PgPool } = pkg;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export enum ConsistencyLevel {
  STRONG = "strong",    // always use primary/write pool
  BOUNDED = "bounded",  // use replica only when lag < threshold
  EVENTUAL = "eventual", // always use any available replica
}

export interface ReplicaConfig {
  url: string;
  priority?: number;   // lower = preferred (default 10)
  maxConnections?: number;
  minConnections?: number;
}

export interface ReplicaHealth {
  url: string;
  healthy: boolean;
  lagMs: number;
  lastChecked: Date;
  consecutiveFailures: number;
  pool: Pool;
}

// ---------------------------------------------------------------------------
// ReadReplicaManager
// ---------------------------------------------------------------------------

class ReadReplicaManager {
  private replicas: ReplicaConfig[] = [];
  private healthStatus: Map<string, ReplicaHealth> = new Map();
  private lagThresholdMs: number;
  private lagMonitorInterval: NodeJS.Timeout | null = null;
  private primaryPool: Pool;

  constructor(lagThresholdMs: number = 5_000) {
    this.lagThresholdMs = lagThresholdMs;

    const isProd = env.NODE_ENV === "production";

    // Primary (write) pool used for STRONG consistency and fallback
    this.primaryPool = new PgPool({
      connectionString: env.DATABASE_URL,
      max: env.DB_POOL_MAX || (isProd ? 100 : 5),
      min: env.DB_POOL_MIN || (isProd ? 10 : 0),
      idleTimeoutMillis: isProd ? 10_000 : 3_000,
      connectionTimeoutMillis: isProd ? 5_000 : 3_000,
      allowExitOnIdle: false,
      keepAlive: true,
      application_name: "iliagpt_replica_primary",
    });

    // Seed replicas from env at construction time
    const seedUrls: string[] = [];
    if (env.DATABASE_READ_URL) seedUrls.push(env.DATABASE_READ_URL);
    for (let i = 2; i <= 5; i++) {
      const url = (env as any)[`DATABASE_READ_URL_${i}`];
      if (url) seedUrls.push(url);
    }
    seedUrls.forEach((url, i) =>
      this.addReplica({ url, priority: i + 1 }).catch(() => {})
    );
  }

  // ---------------------------------------------------------------------------
  // Pool selection
  // ---------------------------------------------------------------------------

  async getReplicaPool(
    consistency: ConsistencyLevel = ConsistencyLevel.EVENTUAL
  ): Promise<Pool> {
    if (consistency === ConsistencyLevel.STRONG) {
      return this.primaryPool;
    }

    const healthy = this.getHealthyReplicas();

    if (healthy.length === 0) {
      Logger.warn("[ReadReplica] No healthy replicas — falling back to primary");
      return this.primaryPool;
    }

    if (consistency === ConsistencyLevel.BOUNDED) {
      const withinThreshold = healthy.filter((r) => r.lagMs <= this.lagThresholdMs);
      if (withinThreshold.length === 0) {
        Logger.warn(
          `[ReadReplica] All replicas exceed lag threshold (${this.lagThresholdMs}ms) — falling back to primary`
        );
        return this.primaryPool;
      }
      return this.pickBest(withinThreshold).pool;
    }

    // EVENTUAL — any healthy replica
    return this.pickBest(healthy).pool;
  }

  private pickBest(candidates: ReplicaHealth[]): ReplicaHealth {
    // Prefer lowest lag, then lowest priority number
    return candidates.reduce((best, current) =>
      current.lagMs < best.lagMs ? current : best
    );
  }

  private getHealthyReplicas(): ReplicaHealth[] {
    return Array.from(this.healthStatus.values()).filter(
      (r) => r.healthy && r.consecutiveFailures < 3
    );
  }

  // ---------------------------------------------------------------------------
  // Lag measurement
  // ---------------------------------------------------------------------------

  async measureReplicationLag(replicaUrl: string): Promise<number> {
    const health = this.healthStatus.get(replicaUrl);
    if (!health) throw new Error(`Unknown replica: ${replicaUrl}`);

    const client = await health.pool.connect();
    try {
      const result = await client.query<{ lag_ms: string }>(
        `SELECT EXTRACT(EPOCH FROM (NOW() - pg_last_xact_replay_timestamp())) * 1000 AS lag_ms`
      );
      const lagMs = parseFloat(result.rows[0]?.lag_ms ?? "0");
      return Math.max(0, lagMs);
    } finally {
      client.release();
    }
  }

  // ---------------------------------------------------------------------------
  // Monitoring
  // ---------------------------------------------------------------------------

  async startLagMonitoring(intervalMs: number = 10_000): Promise<void> {
    if (this.lagMonitorInterval) return;
    Logger.info(`[ReadReplica] Starting lag monitoring every ${intervalMs}ms`);

    // Run immediately
    await this.refreshAllHealthStatuses();

    this.lagMonitorInterval = setInterval(() => {
      this.refreshAllHealthStatuses().catch((err) =>
        Logger.error("[ReadReplica] Lag monitoring error", err)
      );
    }, intervalMs);
    this.lagMonitorInterval.unref();
  }

  private async refreshAllHealthStatuses(): Promise<void> {
    const promises = this.replicas.map((r) =>
      this.checkReplicaHealth(r.url).catch((err) => {
        Logger.error(`[ReadReplica] Health check failed for ${r.url}`, err);
      })
    );
    await Promise.all(promises);
  }

  private async checkReplicaHealth(url: string): Promise<ReplicaHealth> {
    const existing = this.healthStatus.get(url);
    if (!existing) throw new Error(`Replica ${url} not registered`);

    try {
      const lagMs = await this.measureReplicationLag(url);
      const updated: ReplicaHealth = {
        ...existing,
        healthy: true,
        lagMs,
        lastChecked: new Date(),
        consecutiveFailures: 0,
      };
      this.healthStatus.set(url, updated);
      Logger.debug(`[ReadReplica] ${url} healthy, lag=${lagMs.toFixed(0)}ms`);
      return updated;
    } catch (err) {
      const updated: ReplicaHealth = {
        ...existing,
        healthy: false,
        lastChecked: new Date(),
        consecutiveFailures: existing.consecutiveFailures + 1,
      };
      this.healthStatus.set(url, updated);
      Logger.warn(
        `[ReadReplica] ${url} unhealthy (failures: ${updated.consecutiveFailures})`
      );
      return updated;
    }
  }

  // ---------------------------------------------------------------------------
  // Failover
  // ---------------------------------------------------------------------------

  async failover(failedReplicaUrl: string): Promise<void> {
    const health = this.healthStatus.get(failedReplicaUrl);
    if (!health) return;

    Logger.warn(`[ReadReplica] Triggering failover for ${failedReplicaUrl}`);

    const updated: ReplicaHealth = {
      ...health,
      healthy: false,
      consecutiveFailures: health.consecutiveFailures + 1,
    };
    this.healthStatus.set(failedReplicaUrl, updated);

    // Schedule a recovery check
    setTimeout(() => {
      this.checkReplicaHealth(failedReplicaUrl).catch(() => {});
    }, 30_000);
  }

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  isReplicaHealthy(url: string): boolean {
    return this.healthStatus.get(url)?.healthy ?? false;
  }

  getHealthStatus(): ReplicaHealth[] {
    return Array.from(this.healthStatus.values()).map(({ pool: _, ...rest }) => ({
      ...rest,
      pool: _ as any, // keep pool reference for internal use only
    }));
  }

  // ---------------------------------------------------------------------------
  // Replica lifecycle
  // ---------------------------------------------------------------------------

  async addReplica(config: ReplicaConfig): Promise<void> {
    if (this.healthStatus.has(config.url)) {
      Logger.warn(`[ReadReplica] Replica ${config.url} already registered`);
      return;
    }

    const isProd = env.NODE_ENV === "production";

    const replicaPool = new PgPool({
      connectionString: config.url,
      max: config.maxConnections ?? env.DB_READ_POOL_MAX ?? (isProd ? 150 : 5),
      min: config.minConnections ?? env.DB_READ_POOL_MIN ?? (isProd ? 20 : 2),
      idleTimeoutMillis: isProd ? 15_000 : 10_000,
      connectionTimeoutMillis: isProd ? 5_000 : 5_000,
      allowExitOnIdle: false,
      keepAlive: true,
      application_name: "iliagpt_replica_read",
    });

    replicaPool.on("error", (err) =>
      Logger.error(`[ReadReplica] Pool error for ${config.url}`, err)
    );

    this.replicas.push(config);
    this.healthStatus.set(config.url, {
      url: config.url,
      healthy: true,
      lagMs: 0,
      lastChecked: new Date(),
      consecutiveFailures: 0,
      pool: replicaPool,
    });

    Logger.info(`[ReadReplica] Added replica: ${config.url}`);
    await this.checkReplicaHealth(config.url).catch(() => {});
  }

  async removeReplica(url: string): Promise<void> {
    const health = this.healthStatus.get(url);
    if (!health) return;

    try {
      await health.pool.end();
    } catch {
      // ignore
    }

    this.healthStatus.delete(url);
    this.replicas = this.replicas.filter((r) => r.url !== url);
    Logger.info(`[ReadReplica] Removed replica: ${url}`);
  }

  getPrimaryPool(): Pool {
    return this.primaryPool;
  }
}

export const readReplicaManager = new ReadReplicaManager();
