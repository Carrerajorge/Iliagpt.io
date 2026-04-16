import Redis from "ioredis";
import { Logger } from "../lib/logger";
import { env } from "../config/env";
import { pool } from "../db";
import type { TenantLimits } from "./TenantContext";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UsageMetric =
  | "messages"
  | "tokens"
  | "documents"
  | "api_calls"
  | "storage_bytes";

export interface UsageRecord {
  tenantId: string;
  metric: UsageMetric;
  value: number;
  modelId?: string;
  timestamp: Date;
}

export interface BillingPeriod {
  year: number;
  month: number; // 1-12
}

export interface UsageSummary {
  tenantId: string;
  period: BillingPeriod;
  messages: number;
  tokens: number;
  documents: number;
  apiCalls: number;
  storageBytes: number;
}

export interface LimitCheckResult {
  allowed: boolean;
  metric: UsageMetric;
  current: number;
  limit: number;
  remaining: number;
}

export interface BillingLineItem {
  metric: UsageMetric;
  usage: number;
  unitCost: number;
  totalCost: number;
  currency: string;
}

export interface BillingSummary {
  tenantId: string;
  period: BillingPeriod;
  plan: string;
  lineItems: BillingLineItem[];
  totalCost: number;
  currency: string;
  generatedAt: Date;
}

export interface OverageAlert {
  tenantId: string;
  metric: UsageMetric;
  current: number;
  limit: number;
  overagePercent: number;
}

export interface TenantConsumption {
  tenantId: string;
  metric: UsageMetric;
  totalUsage: number;
  period: BillingPeriod;
}

// ---------------------------------------------------------------------------
// Pricing table (cost per unit, in USD cents)
// ---------------------------------------------------------------------------

const PLAN_PRICES: Record<string, Record<UsageMetric, number>> = {
  free: {
    messages: 0,
    tokens: 0,
    documents: 0,
    api_calls: 0,
    storage_bytes: 0,
  },
  pro: {
    messages: 0.1,            // $0.001 per message (in cents)
    tokens: 0.000002,         // $0.00000002 per token (in cents)
    documents: 5,             // $0.05 per document
    api_calls: 0.01,          // $0.0001 per call
    storage_bytes: 0.000001,  // $0.00000001 per byte (~$10/GB)
  },
  enterprise: {
    messages: 0.05,
    tokens: 0.000001,
    documents: 2,
    api_calls: 0.005,
    storage_bytes: 0.0000005,
  },
};

const PLAN_LIMITS: Record<string, TenantLimits> = {
  free: {
    maxUsers: 5,
    maxMessages: 100,
    maxTokens: 50_000,
    maxDocuments: 10,
    maxStorageBytes: 100 * 1024 * 1024,
    maxApiCallsPerMin: 10,
  },
  pro: {
    maxUsers: 50,
    maxMessages: 5_000,
    maxTokens: 2_000_000,
    maxDocuments: 500,
    maxStorageBytes: 5 * 1024 * 1024 * 1024,
    maxApiCallsPerMin: 100,
  },
  enterprise: {
    maxUsers: 10_000,
    maxMessages: 1_000_000,
    maxTokens: 100_000_000,
    maxDocuments: 100_000,
    maxStorageBytes: 1024 * 1024 * 1024 * 1024,
    maxApiCallsPerMin: 5_000,
  },
};

// Map metric name to TenantLimits field
const METRIC_LIMIT_KEY: Record<UsageMetric, keyof TenantLimits> = {
  messages: "maxMessages",
  tokens: "maxTokens",
  documents: "maxDocuments",
  api_calls: "maxApiCallsPerMin",
  storage_bytes: "maxStorageBytes",
};

// ---------------------------------------------------------------------------
// TenantBilling
// ---------------------------------------------------------------------------

class TenantBilling {
  private redis: Redis;
  private readonly KEY_PREFIX = "billing";

  constructor() {
    this.redis = new Redis(env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: 2,
      enableReadyCheck: false,
      lazyConnect: true,
    });

    this.redis.on("error", (err) => {
      Logger.warn("[TenantBilling] Redis error (non-fatal)", { error: err.message });
    });

    this.ensureSchema().catch((err) =>
      Logger.error("[TenantBilling] Schema init error", err)
    );
  }

  // ---------------------------------------------------------------------------
  // Schema bootstrap (idempotent)
  // ---------------------------------------------------------------------------

  private async ensureSchema(): Promise<void> {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tenant_usage (
        id          TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   TEXT NOT NULL,
        metric      TEXT NOT NULL,
        value       BIGINT NOT NULL DEFAULT 0,
        model_id    TEXT,
        recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_tenant_usage_tenant_metric ON tenant_usage (tenant_id, metric, recorded_at)`
    );

    await pool.query(`
      CREATE TABLE IF NOT EXISTS tenant_usage_monthly (
        tenant_id   TEXT NOT NULL,
        metric      TEXT NOT NULL,
        year        INT  NOT NULL,
        month       INT  NOT NULL,
        total_value BIGINT NOT NULL DEFAULT 0,
        PRIMARY KEY (tenant_id, metric, year, month)
      )
    `);
  }

  // ---------------------------------------------------------------------------
  // Recording
  // ---------------------------------------------------------------------------

  async recordUsage(record: UsageRecord): Promise<void> {
    // Persist to DB
    await pool.query(
      `INSERT INTO tenant_usage (tenant_id, metric, value, model_id, recorded_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        record.tenantId,
        record.metric,
        record.value,
        record.modelId ?? null,
        record.timestamp,
      ]
    );

    // Increment real-time Redis counter (day-level key)
    const dayKey = this.buildDayKey(
      record.tenantId,
      record.metric,
      record.timestamp
    );
    try {
      await this.redis.incrby(dayKey, record.value);
      await this.redis.expire(dayKey, 7 * 24 * 3600); // 7-day TTL
    } catch {
      // non-fatal
    }
  }

  // ---------------------------------------------------------------------------
  // Querying
  // ---------------------------------------------------------------------------

  async getUsage(
    tenantId: string,
    metric: UsageMetric,
    period: BillingPeriod
  ): Promise<number> {
    // Try Redis first (current month / day)
    const now = new Date();
    const isCurrentMonth =
      now.getFullYear() === period.year && now.getMonth() + 1 === period.month;

    if (isCurrentMonth) {
      try {
        const dayKeys = this.allDayKeysForMonth(tenantId, metric, period);
        const values = await this.redis.mget(...dayKeys);
        const sum = values.reduce((acc, v) => acc + (parseInt(v ?? "0", 10) || 0), 0);
        if (sum > 0) return sum;
      } catch {
        // fall through
      }
    }

    // Fall back to DB aggregation
    const result = await pool.query<{ total: string }>(
      `SELECT COALESCE(SUM(value), 0) AS total
       FROM tenant_usage
       WHERE tenant_id = $1
         AND metric = $2
         AND EXTRACT(YEAR  FROM recorded_at) = $3
         AND EXTRACT(MONTH FROM recorded_at) = $4`,
      [tenantId, metric, period.year, period.month]
    );
    return parseInt(result.rows[0]?.total ?? "0", 10);
  }

  async getAllUsage(
    tenantId: string,
    period: BillingPeriod
  ): Promise<UsageSummary> {
    const metrics: UsageMetric[] = [
      "messages",
      "tokens",
      "documents",
      "api_calls",
      "storage_bytes",
    ];

    const values = await Promise.all(
      metrics.map((m) => this.getUsage(tenantId, m, period))
    );

    return {
      tenantId,
      period,
      messages: values[0],
      tokens: values[1],
      documents: values[2],
      apiCalls: values[3],
      storageBytes: values[4],
    };
  }

  // ---------------------------------------------------------------------------
  // Limit enforcement
  // ---------------------------------------------------------------------------

  async checkLimits(
    tenantId: string,
    metric: UsageMetric,
    increment: number = 1
  ): Promise<LimitCheckResult> {
    const plan = await this.getTenantPlan(tenantId);
    const limits = this.getPlanLimits(plan);
    const limitKey = METRIC_LIMIT_KEY[metric];
    const limit = limits[limitKey] as number;

    const now = new Date();
    const period: BillingPeriod = {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
    };

    const current = await this.getUsage(tenantId, metric, period);
    const projected = current + increment;
    const allowed = projected <= limit;
    const remaining = Math.max(0, limit - current);

    return { allowed, metric, current, limit, remaining };
  }

  // ---------------------------------------------------------------------------
  // Billing
  // ---------------------------------------------------------------------------

  async getCurrentBill(
    tenantId: string,
    period: BillingPeriod
  ): Promise<BillingSummary> {
    const plan = await this.getTenantPlan(tenantId);
    const usage = await this.getAllUsage(tenantId, period);
    const prices = PLAN_PRICES[plan] ?? PLAN_PRICES.free;

    const metricValues: [UsageMetric, number][] = [
      ["messages", usage.messages],
      ["tokens", usage.tokens],
      ["documents", usage.documents],
      ["api_calls", usage.apiCalls],
      ["storage_bytes", usage.storageBytes],
    ];

    const lineItems: BillingLineItem[] = metricValues.map(([metric, value]) => {
      const unitCost = prices[metric];
      const totalCost = Math.round(value * unitCost * 100) / 100; // cents, 2dp
      return { metric, usage: value, unitCost, totalCost, currency: "USD" };
    });

    const totalCost = lineItems.reduce((sum, li) => sum + li.totalCost, 0);

    return {
      tenantId,
      period,
      plan,
      lineItems,
      totalCost: Math.round(totalCost * 100) / 100,
      currency: "USD",
      generatedAt: new Date(),
    };
  }

  async detectOverage(tenantId: string): Promise<OverageAlert[]> {
    const plan = await this.getTenantPlan(tenantId);
    const limits = this.getPlanLimits(plan);
    const now = new Date();
    const period: BillingPeriod = {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
    };

    const usage = await this.getAllUsage(tenantId, period);
    const alerts: OverageAlert[] = [];

    const checks: [UsageMetric, number, keyof TenantLimits][] = [
      ["messages", usage.messages, "maxMessages"],
      ["tokens", usage.tokens, "maxTokens"],
      ["documents", usage.documents, "maxDocuments"],
      ["storage_bytes", usage.storageBytes, "maxStorageBytes"],
    ];

    for (const [metric, current, limitKey] of checks) {
      const limit = limits[limitKey] as number;
      if (limit <= 0) continue;
      const overagePercent = (current / limit) * 100;

      if (overagePercent >= 80) {
        alerts.push({ tenantId, metric, current, limit, overagePercent });
        Logger.warn(`[TenantBilling] Tenant ${tenantId} at ${overagePercent.toFixed(1)}% of ${metric} limit`);
      }
    }

    return alerts;
  }

  async getTopConsumers(
    limit: number,
    metric: UsageMetric
  ): Promise<TenantConsumption[]> {
    const now = new Date();
    const result = await pool.query<{
      tenant_id: string;
      total: string;
    }>(
      `SELECT tenant_id, SUM(value) AS total
       FROM tenant_usage
       WHERE metric = $1
         AND EXTRACT(YEAR  FROM recorded_at) = $2
         AND EXTRACT(MONTH FROM recorded_at) = $3
       GROUP BY tenant_id
       ORDER BY total DESC
       LIMIT $4`,
      [metric, now.getFullYear(), now.getMonth() + 1, limit]
    );

    const period: BillingPeriod = {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
    };

    return result.rows.map((r) => ({
      tenantId: r.tenant_id,
      metric,
      totalUsage: parseInt(r.total, 10),
      period,
    }));
  }

  // ---------------------------------------------------------------------------
  // Aggregation (run monthly via cron)
  // ---------------------------------------------------------------------------

  async aggregateMonthlyUsage(
    tenantId: string,
    year: number,
    month: number
  ): Promise<void> {
    const metrics: UsageMetric[] = [
      "messages",
      "tokens",
      "documents",
      "api_calls",
      "storage_bytes",
    ];

    for (const metric of metrics) {
      const result = await pool.query<{ total: string }>(
        `SELECT COALESCE(SUM(value), 0) AS total
         FROM tenant_usage
         WHERE tenant_id = $1
           AND metric = $2
           AND EXTRACT(YEAR  FROM recorded_at) = $3
           AND EXTRACT(MONTH FROM recorded_at) = $4`,
        [tenantId, metric, year, month]
      );

      const total = parseInt(result.rows[0]?.total ?? "0", 10);

      await pool.query(
        `INSERT INTO tenant_usage_monthly (tenant_id, metric, year, month, total_value)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, metric, year, month)
         DO UPDATE SET total_value = EXCLUDED.total_value`,
        [tenantId, metric, year, month, total]
      );
    }

    Logger.info(
      `[TenantBilling] Aggregated monthly usage for tenant ${tenantId} (${year}-${month})`
    );
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  getPlanLimits(plan: string): TenantLimits {
    return PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
  }

  calculateCost(metric: UsageMetric, value: number, plan: string): number {
    const unitCost = (PLAN_PRICES[plan] ?? PLAN_PRICES.free)[metric];
    return Math.round(value * unitCost * 100) / 100;
  }

  private async getTenantPlan(tenantId: string): Promise<string> {
    try {
      const result = await pool.query<{ plan: string }>(
        `SELECT plan FROM tenants WHERE id = $1 LIMIT 1`,
        [tenantId]
      );
      return result.rows[0]?.plan ?? "free";
    } catch {
      return "free";
    }
  }

  private buildDayKey(
    tenantId: string,
    metric: string,
    date: Date
  ): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${this.KEY_PREFIX}:${tenantId}:${metric}:${y}${m}${d}`;
  }

  private allDayKeysForMonth(
    tenantId: string,
    metric: string,
    period: BillingPeriod
  ): string[] {
    const days: string[] = [];
    const daysInMonth = new Date(period.year, period.month, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(period.year, period.month - 1, d);
      days.push(this.buildDayKey(tenantId, metric, date));
    }
    return days;
  }
}

export const tenantBilling = new TenantBilling();
