/**
 * Advanced Analytics & Cost Tracking Service
 *
 * Provides:
 *   - Per-model, per-user cost tracking
 *   - Usage analytics with time-series aggregation
 *   - Performance metrics (latency, success rate)
 *   - Quality scoring for responses
 *   - Dashboard data API
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";

// ── Types ──────────────────────────────────────────────────────────────

export interface UsageRecord {
  id: string;
  userId: string;
  chatId?: string;
  model: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  latencyMs: number;
  createdAt: Date;
}

export interface UsageSummary {
  totalCostUsd: number;
  totalTokens: number;
  totalRequests: number;
  avgLatencyMs: number;
  byModel: Array<{
    model: string;
    provider: string;
    requests: number;
    tokens: number;
    costUsd: number;
    avgLatencyMs: number;
  }>;
  byDay: Array<{
    date: string;
    requests: number;
    tokens: number;
    costUsd: number;
  }>;
  byUser?: Array<{
    userId: string;
    requests: number;
    tokens: number;
    costUsd: number;
  }>;
}

export interface PerformanceMetrics {
  successRate: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  errorRate: number;
  requestsPerMinute: number;
}

// ── Pricing Map ────────────────────────────────────────────────────────

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // OpenAI (per 1M tokens)
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4-turbo": { input: 10, output: 30 },
  "gpt-4": { input: 30, output: 60 },
  "gpt-3.5-turbo": { input: 0.5, output: 1.5 },
  "o1": { input: 15, output: 60 },
  "o1-mini": { input: 3, output: 12 },
  "o3-mini": { input: 1.1, output: 4.4 },

  // Anthropic
  "claude-opus-4-20250514": { input: 15, output: 75 },
  "claude-sonnet-4-20250514": { input: 3, output: 15 },
  "claude-3-5-sonnet-20241022": { input: 3, output: 15 },
  "claude-3-5-haiku-20241022": { input: 0.8, output: 4 },
  "claude-3-haiku-20240307": { input: 0.25, output: 1.25 },

  // Google
  "gemini-2.5-pro": { input: 1.25, output: 10 },
  "gemini-2.5-flash": { input: 0.15, output: 0.6 },
  "gemini-2.0-flash": { input: 0.1, output: 0.4 },
  "gemini-1.5-pro": { input: 1.25, output: 5 },
  "gemini-1.5-flash": { input: 0.075, output: 0.3 },

  // xAI
  "grok-3": { input: 3, output: 15 },
  "grok-3-mini": { input: 0.3, output: 0.5 },
  "grok-2": { input: 2, output: 10 },

  // DeepSeek
  "deepseek-chat": { input: 0.14, output: 0.28 },
  "deepseek-reasoner": { input: 0.55, output: 2.19 },

  // Default fallback
  "_default": { input: 1, output: 3 },
};

// ── Cost Calculator ────────────────────────────────────────────────────

export function calculateCost(model: string, promptTokens: number, completionTokens: number): number {
  // Find best match
  const pricing = MODEL_PRICING[model]
    || Object.entries(MODEL_PRICING).find(([k]) => model.startsWith(k))?.[1]
    || MODEL_PRICING["_default"];

  const inputCost = (promptTokens / 1_000_000) * pricing.input;
  const outputCost = (completionTokens / 1_000_000) * pricing.output;
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000; // 6 decimal places
}

// ── Analytics Service ──────────────────────────────────────────────────

export class AnalyticsService {
  private inMemoryBuffer: UsageRecord[] = [];
  private flushInterval?: NodeJS.Timeout;

  start(): void {
    // Flush buffer to DB every 30 seconds
    this.flushInterval = setInterval(() => this.flush(), 30_000);
  }

  stop(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = undefined;
    }
    this.flush(); // Final flush
  }

  /**
   * Record a model usage event.
   */
  recordUsage(params: {
    userId: string;
    chatId?: string;
    model: string;
    provider: string;
    promptTokens: number;
    completionTokens: number;
    latencyMs: number;
  }): UsageRecord {
    const record: UsageRecord = {
      id: randomUUID(),
      userId: params.userId,
      chatId: params.chatId,
      model: params.model,
      provider: params.provider,
      promptTokens: params.promptTokens,
      completionTokens: params.completionTokens,
      totalTokens: params.promptTokens + params.completionTokens,
      costUsd: calculateCost(params.model, params.promptTokens, params.completionTokens),
      latencyMs: params.latencyMs,
      createdAt: new Date(),
    };

    this.inMemoryBuffer.push(record);
    return record;
  }

  /**
   * Get usage summary for dashboard.
   */
  async getSummary(params: {
    userId?: string;
    days?: number;
    groupBy?: "model" | "user" | "day";
  }): Promise<UsageSummary> {
    const days = params.days || 30;
    const since = new Date(Date.now() - days * 86400000).toISOString();

    try {
      // Total stats
      const totalResult = await db.execute(sql`
        SELECT
          COUNT(*)::int as total_requests,
          COALESCE(SUM(total_tokens), 0)::int as total_tokens,
          COALESCE(SUM(cost_usd), 0)::numeric as total_cost,
          COALESCE(AVG(latency_ms), 0)::int as avg_latency
        FROM model_usage_log
        WHERE created_at >= ${since}::timestamptz
        ${params.userId ? sql`AND user_id = ${params.userId}` : sql``}
      `);

      const totals = (totalResult.rows as any[])[0] || {};

      // By model
      const byModelResult = await db.execute(sql`
        SELECT
          model,
          provider,
          COUNT(*)::int as requests,
          SUM(total_tokens)::int as tokens,
          SUM(cost_usd)::numeric as cost_usd,
          AVG(latency_ms)::int as avg_latency
        FROM model_usage_log
        WHERE created_at >= ${since}::timestamptz
        ${params.userId ? sql`AND user_id = ${params.userId}` : sql``}
        GROUP BY model, provider
        ORDER BY cost_usd DESC
      `);

      // By day
      const byDayResult = await db.execute(sql`
        SELECT
          DATE(created_at) as date,
          COUNT(*)::int as requests,
          SUM(total_tokens)::int as tokens,
          SUM(cost_usd)::numeric as cost_usd
        FROM model_usage_log
        WHERE created_at >= ${since}::timestamptz
        ${params.userId ? sql`AND user_id = ${params.userId}` : sql``}
        GROUP BY DATE(created_at)
        ORDER BY date DESC
      `);

      return {
        totalCostUsd: parseFloat(totals.total_cost) || 0,
        totalTokens: totals.total_tokens || 0,
        totalRequests: totals.total_requests || 0,
        avgLatencyMs: totals.avg_latency || 0,
        byModel: (byModelResult.rows as any[]).map(r => ({
          model: r.model,
          provider: r.provider,
          requests: r.requests,
          tokens: r.tokens,
          costUsd: parseFloat(r.cost_usd),
          avgLatencyMs: r.avg_latency,
        })),
        byDay: (byDayResult.rows as any[]).map(r => ({
          date: r.date,
          requests: r.requests,
          tokens: r.tokens,
          costUsd: parseFloat(r.cost_usd),
        })),
      };
    } catch (err: any) {
      // Fallback to in-memory data
      return this.getInMemorySummary(params.userId);
    }
  }

  /**
   * Get real-time performance metrics.
   */
  getRealtimeMetrics(windowMs = 60_000): PerformanceMetrics {
    const cutoff = Date.now() - windowMs;
    const recent = this.inMemoryBuffer.filter(r => r.createdAt.getTime() > cutoff);

    if (recent.length === 0) {
      return {
        successRate: 1,
        avgLatencyMs: 0,
        p50LatencyMs: 0,
        p95LatencyMs: 0,
        p99LatencyMs: 0,
        errorRate: 0,
        requestsPerMinute: 0,
      };
    }

    const latencies = recent.map(r => r.latencyMs).sort((a, b) => a - b);

    return {
      successRate: 1, // tracked externally
      avgLatencyMs: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
      p50LatencyMs: latencies[Math.floor(latencies.length * 0.5)] || 0,
      p95LatencyMs: latencies[Math.floor(latencies.length * 0.95)] || 0,
      p99LatencyMs: latencies[Math.floor(latencies.length * 0.99)] || 0,
      errorRate: 0,
      requestsPerMinute: recent.length / (windowMs / 60_000),
    };
  }

  /**
   * Flush in-memory buffer to database.
   */
  private async flush(): Promise<void> {
    if (this.inMemoryBuffer.length === 0) return;

    const batch = this.inMemoryBuffer.splice(0, 100);

    try {
      for (const record of batch) {
        await db.execute(sql`
          INSERT INTO model_usage_log (id, user_id, chat_id, model, provider, prompt_tokens, completion_tokens, total_tokens, cost_usd, latency_ms, created_at)
          VALUES (${record.id}, ${record.userId}, ${record.chatId || null}, ${record.model}, ${record.provider},
                  ${record.promptTokens}, ${record.completionTokens}, ${record.totalTokens},
                  ${record.costUsd}, ${record.latencyMs}, ${record.createdAt.toISOString()})
        `);
      }
    } catch {
      // Put records back if DB fails
      this.inMemoryBuffer.unshift(...batch);
    }
  }

  private getInMemorySummary(userId?: string): UsageSummary {
    let records = this.inMemoryBuffer;
    if (userId) records = records.filter(r => r.userId === userId);

    const byModel = new Map<string, { requests: number; tokens: number; costUsd: number; latencies: number[] }>();

    for (const r of records) {
      const key = r.model;
      const entry = byModel.get(key) || { requests: 0, tokens: 0, costUsd: 0, latencies: [] };
      entry.requests++;
      entry.tokens += r.totalTokens;
      entry.costUsd += r.costUsd;
      entry.latencies.push(r.latencyMs);
      byModel.set(key, entry);
    }

    return {
      totalCostUsd: records.reduce((a, r) => a + r.costUsd, 0),
      totalTokens: records.reduce((a, r) => a + r.totalTokens, 0),
      totalRequests: records.length,
      avgLatencyMs: records.length > 0 ? Math.round(records.reduce((a, r) => a + r.latencyMs, 0) / records.length) : 0,
      byModel: Array.from(byModel.entries()).map(([model, data]) => ({
        model,
        provider: records.find(r => r.model === model)?.provider || "unknown",
        requests: data.requests,
        tokens: data.tokens,
        costUsd: data.costUsd,
        avgLatencyMs: Math.round(data.latencies.reduce((a, b) => a + b, 0) / data.latencies.length),
      })),
      byDay: [],
    };
  }
}

// ── Singleton ──────────────────────────────────────────────────────────

export const analyticsService = new AnalyticsService();
