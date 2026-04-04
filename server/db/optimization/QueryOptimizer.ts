import Redis from "ioredis";
import { Logger } from "../../lib/logger";
import { env } from "../../config/env";
import { pool } from "../../db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SlowQuery {
  sql: string;
  normalizedSql: string;
  params: any[];
  duration: number;
  timestamp: Date;
  stackTrace?: string;
  queryPlan?: any;
}

export interface QueryStats {
  normalizedSql: string;
  count: number;
  totalDuration: number;
  avgDuration: number;
  minDuration: number;
  maxDuration: number;
  lastSeen: Date;
}

export interface SlowQueryReport {
  generatedAt: Date;
  threshold: number;
  totalSlowQueries: number;
  topSlowQueries: SlowQuery[];
  topByFrequency: QueryStats[];
  topByAvgDuration: QueryStats[];
}

export interface IndexSuggestion {
  table: string;
  columns: string[];
  reason: string;
  estimatedImprovementMs?: number;
}

export interface QueryPlan {
  sql: string;
  plan: any;
  planningTime?: number;
  executionTime?: number;
}

interface QueryOptimizerOptions {
  slowQueryThreshold?: number;
  maxSlowQueryLog?: number;
  captureStackTrace?: boolean;
  captureQueryPlan?: boolean;
  redisKeyPrefix?: string;
}

// ---------------------------------------------------------------------------
// QueryOptimizer
// ---------------------------------------------------------------------------

class QueryOptimizer {
  private slowQueryThreshold: number;
  private maxSlowQueryLog: number;
  private captureStackTrace: boolean;
  private captureQueryPlan: boolean;
  private slowQueryLog: SlowQuery[] = [];
  private queryStats: Map<string, QueryStats> = new Map();
  private redis: Redis;
  private redisKeyPrefix: string;

  constructor(options: QueryOptimizerOptions = {}) {
    this.slowQueryThreshold = options.slowQueryThreshold ?? 1_000;
    this.maxSlowQueryLog = options.maxSlowQueryLog ?? 500;
    this.captureStackTrace = options.captureStackTrace ?? (env.NODE_ENV !== "production");
    this.captureQueryPlan = options.captureQueryPlan ?? false;
    this.redisKeyPrefix = options.redisKeyPrefix ?? "qopt";

    this.redis = new Redis(env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: 2,
      enableReadyCheck: false,
      lazyConnect: true,
    });

    this.redis.on("error", (err) => {
      Logger.warn("[QueryOptimizer] Redis error (non-fatal)", { error: err.message });
    });
  }

  // ---------------------------------------------------------------------------
  // Core wrapper
  // ---------------------------------------------------------------------------

  async wrapQuery<T>(
    sql: string,
    params: any[],
    executor: () => Promise<T>
  ): Promise<T> {
    const start = Date.now();
    const normalized = this.normalizeQuery(sql);

    let result: T;
    let queryError: Error | null = null;
    try {
      result = await executor();
    } catch (err: any) {
      queryError = err;
      throw err;
    } finally {
      const duration = Date.now() - start;
      this.recordStats(normalized, duration);

      if (duration >= this.slowQueryThreshold) {
        const slowQuery: SlowQuery = {
          sql,
          normalizedSql: normalized,
          params,
          duration,
          timestamp: new Date(),
          stackTrace: this.captureStackTrace
            ? new Error().stack?.split("\n").slice(3).join("\n")
            : undefined,
        };

        if (this.captureQueryPlan && !queryError) {
          try {
            slowQuery.queryPlan = await this.explainQuery(sql, params);
          } catch {
            // non-fatal
          }
        }

        await this.recordSlowQuery(slowQuery);
      }
    }

    return result!;
  }

  // ---------------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------------

  private recordStats(normalizedSql: string, duration: number): void {
    const existing = this.queryStats.get(normalizedSql);
    if (existing) {
      existing.count++;
      existing.totalDuration += duration;
      existing.avgDuration = existing.totalDuration / existing.count;
      existing.minDuration = Math.min(existing.minDuration, duration);
      existing.maxDuration = Math.max(existing.maxDuration, duration);
      existing.lastSeen = new Date();
    } else {
      this.queryStats.set(normalizedSql, {
        normalizedSql,
        count: 1,
        totalDuration: duration,
        avgDuration: duration,
        minDuration: duration,
        maxDuration: duration,
        lastSeen: new Date(),
      });
    }
  }

  private async recordSlowQuery(query: SlowQuery): Promise<void> {
    // In-memory ring buffer
    this.slowQueryLog.push(query);
    if (this.slowQueryLog.length > this.maxSlowQueryLog) {
      this.slowQueryLog.shift();
    }

    Logger.warn("[QueryOptimizer] Slow query detected", {
      duration: query.duration,
      threshold: this.slowQueryThreshold,
      sql: query.normalizedSql.slice(0, 200),
    });

    await this.alertOnSlowQuery(query);
  }

  // ---------------------------------------------------------------------------
  // Analysis
  // ---------------------------------------------------------------------------

  async analyzeSlowQueries(): Promise<SlowQueryReport> {
    const stats = this.getTopQueries(20);

    return {
      generatedAt: new Date(),
      threshold: this.slowQueryThreshold,
      totalSlowQueries: this.slowQueryLog.length,
      topSlowQueries: this.getSlowQueryLog(10),
      topByFrequency: stats.sort((a, b) => b.count - a.count).slice(0, 10),
      topByAvgDuration: stats.sort((a, b) => b.avgDuration - a.avgDuration).slice(0, 10),
    };
  }

  async suggestIndexes(tableName: string): Promise<IndexSuggestion[]> {
    const suggestions: IndexSuggestion[] = [];

    try {
      const unusedIndexes = await pool.query<{
        indexname: string;
        tablename: string;
        idx_scan: string;
      }>(
        `SELECT indexname, tablename, idx_scan
         FROM pg_stat_user_indexes
         WHERE tablename = $1
           AND idx_scan < 10
           AND indexname NOT LIKE '%_pkey'`,
        [tableName]
      );

      for (const row of unusedIndexes.rows) {
        suggestions.push({
          table: tableName,
          columns: [row.indexname],
          reason: `Index "${row.indexname}" has only ${row.idx_scan} scans — consider dropping it`,
        });
      }

      // Suggest indexes for slow queries touching this table
      const relevantSlowQueries = this.slowQueryLog.filter((q) =>
        q.normalizedSql.toLowerCase().includes(tableName.toLowerCase())
      );
      for (const q of relevantSlowQueries.slice(0, 5)) {
        suggestions.push({
          table: tableName,
          columns: [],
          reason: `Slow query (${q.duration}ms) references this table. Review query plan.`,
          estimatedImprovementMs: q.duration,
        });
      }
    } catch (err) {
      Logger.error("[QueryOptimizer] suggestIndexes error", err);
    }

    return suggestions;
  }

  async explainQuery(sql: string, params: any[] = []): Promise<QueryPlan> {
    const client = await pool.connect();
    try {
      const explainSql = `EXPLAIN (FORMAT JSON, ANALYZE false) ${sql}`;
      const result = await client.query(explainSql, params);
      const plan = result.rows[0]["QUERY PLAN"]?.[0];
      return {
        sql,
        plan: plan?.Plan ?? plan,
        planningTime: plan?.["Planning Time"],
        executionTime: plan?.["Execution Time"],
      };
    } finally {
      client.release();
    }
  }

  async getQueryPlan(sql: string): Promise<string> {
    const client = await pool.connect();
    try {
      const result = await client.query(`EXPLAIN ${sql}`);
      return result.rows.map((r) => r["QUERY PLAN"]).join("\n");
    } finally {
      client.release();
    }
  }

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  getSlowQueryLog(limit: number = 50): SlowQuery[] {
    return this.slowQueryLog.slice(-limit).reverse();
  }

  clearSlowQueryLog(): void {
    this.slowQueryLog = [];
    Logger.info("[QueryOptimizer] Slow query log cleared");
  }

  getTopQueries(limit: number = 20): QueryStats[] {
    return Array.from(this.queryStats.values())
      .sort((a, b) => b.totalDuration - a.totalDuration)
      .slice(0, limit);
  }

  // ---------------------------------------------------------------------------
  // Alerting
  // ---------------------------------------------------------------------------

  async alertOnSlowQuery(query: SlowQuery): Promise<void> {
    try {
      const key = `${this.redisKeyPrefix}:slow_queries`;
      const payload = JSON.stringify({
        normalizedSql: query.normalizedSql.slice(0, 500),
        duration: query.duration,
        timestamp: query.timestamp.toISOString(),
      });
      await this.redis.lpush(key, payload);
      await this.redis.ltrim(key, 0, 999); // keep last 1000
      await this.redis.expire(key, 7 * 24 * 3600); // 7-day TTL
    } catch {
      // Redis unavailable — log only
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  normalizeQuery(sql: string): string {
    return sql
      .replace(/\$\d+/g, "?")                        // positional params
      .replace(/'[^']*'/g, "'?'")                    // string literals
      .replace(/\b\d+\b/g, "N")                      // numeric literals
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }
}

export const queryOptimizer = new QueryOptimizer({ slowQueryThreshold: 1_000 });
