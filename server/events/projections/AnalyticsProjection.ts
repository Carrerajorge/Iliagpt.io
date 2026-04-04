/**
 * AnalyticsProjection: Materialises events into Redis-based analytics counters
 * Improvement 10 – Event-Driven Architecture with CQRS
 */

import Redis from "ioredis";
import { Logger } from "../../lib/logger";
import {
  AppEvent,
  EVENT_TYPES,
  MessageSent,
  AgentTaskCompleted,
  AgentTaskFailed,
  DocumentGenerated,
  UserSignedIn,
  ModelSwitched,
  ModelError,
} from "../types";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface CostBreakdown {
  userId: string;
  period: string;
  totalCostUsd: number;
  messageCostUsd: number;
  agentCostUsd: number;
  costByModel: Record<string, number>;
  topChats: Array<{ chatId: string; costUsd: number }>;
}

export interface ModelMetrics {
  modelId: string;
  period: string;
  requestCount: number;
  successCount: number;
  errorCount: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  totalTokens: number;
  successRate: number;
  avgTokensPerRequest: number;
}

export interface UsagePattern {
  hour: number; // 0-23
  dayOfWeek: number; // 0-6
  requestCount: number;
  avgLatencyMs: number;
}

export interface RevenueData {
  period: string;
  totalRevenueCents: number;
  totalCostUsd: number;
  grossMarginPct: number;
  activeUsers: number;
  newUsers: number;
  arpu: number; // average revenue per user in cents
  revenueByModel: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Redis key helpers
// ---------------------------------------------------------------------------

const costKey = (userId: string, period: string) =>
  `analytics:cost:user:${userId}:${period}`;
const modelKey = (modelId: string, period: string) =>
  `analytics:model:${modelId}:${period}`;
const modelLatencyKey = (modelId: string, period: string) =>
  `analytics:model_latency:${modelId}:${period}`;
const usageHourKey = (period: string) => `analytics:usage_hour:${period}`;
const revenueKey = (period: string) => `analytics:revenue:${period}`;
const globalCounterKey = (event: string, period: string) =>
  `analytics:global:${event}:${period}`;

// Returns period tokens: "2026-04", "2026-04-04", "2026-w14"
function getPeriodKeys(): { day: string; week: string; month: string } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const weekNum = Math.ceil(
    ((now.getTime() - new Date(y, 0, 1).getTime()) / 86_400_000 +
      new Date(y, 0, 1).getDay() +
      1) /
      7
  );
  return {
    day: `${y}-${m}-${d}`,
    week: `${y}-w${String(weekNum).padStart(2, "0")}`,
    month: `${y}-${m}`,
  };
}

const TTL_BY_PERIOD: Record<string, number> = {
  day: 7 * 86_400,
  week: 30 * 86_400,
  month: 90 * 86_400,
};

// ---------------------------------------------------------------------------
// AnalyticsProjection
// ---------------------------------------------------------------------------

export class AnalyticsProjection {
  private redis: Redis;

  constructor(redisUrl?: string) {
    const url = redisUrl ?? process.env.REDIS_URL;
    this.redis = url
      ? new Redis(url, { lazyConnect: true, maxRetriesPerRequest: null })
      : new Redis({ lazyConnect: true, maxRetriesPerRequest: null });

    this.redis.on("error", (err) =>
      Logger.error("AnalyticsProjection redis error", err)
    );
  }

  // -------------------------------------------------------------------------
  // Main dispatcher
  // -------------------------------------------------------------------------

  async handleEvent(event: AppEvent): Promise<void> {
    try {
      switch (event.type) {
        case EVENT_TYPES.MESSAGE_SENT:
          await this.onMessageSent(event as MessageSent);
          break;
        case EVENT_TYPES.AGENT_TASK_COMPLETED:
          await this.onAgentTaskCompleted(event as AgentTaskCompleted);
          break;
        case EVENT_TYPES.AGENT_TASK_FAILED:
          await this.onAgentTaskFailed(event as AgentTaskFailed);
          break;
        case EVENT_TYPES.DOCUMENT_GENERATED:
          await this.onDocumentGenerated(event as DocumentGenerated);
          break;
        case EVENT_TYPES.USER_SIGNED_IN:
          await this.onUserSignedIn(event as UserSignedIn);
          break;
        case EVENT_TYPES.MODEL_SWITCHED:
          await this.onModelSwitched(event as ModelSwitched);
          break;
        case EVENT_TYPES.MODEL_ERROR:
          await this.onModelError(event as ModelError);
          break;
        default:
          // No analytics for other events
          break;
      }
    } catch (err) {
      Logger.error("AnalyticsProjection.handleEvent error", {
        err,
        eventType: event.type,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Event handlers
  // -------------------------------------------------------------------------

  private async onMessageSent(event: MessageSent): Promise<void> {
    const { userId, modelId, tokenCount = 0, costUsd = 0, latencyMs = 0, chatId = "" } =
      event.payload;
    const periods = getPeriodKeys();

    const pipeline = this.redis.pipeline();
    for (const [periodType, periodVal] of Object.entries(periods)) {
      // Cost counters
      const cKey = costKey(userId, periodVal);
      pipeline.hincrbyfloat(cKey, "totalCostUsd", costUsd);
      pipeline.hincrbyfloat(cKey, "messageCostUsd", costUsd);
      if (modelId) {
        pipeline.hincrbyfloat(cKey, `model:${modelId}`, costUsd);
      }
      if (chatId) {
        pipeline.hincrbyfloat(cKey, `chat:${chatId}`, costUsd);
      }
      pipeline.expire(cKey, TTL_BY_PERIOD[periodType]);

      // Model metrics
      if (modelId) {
        const mKey = modelKey(modelId, periodVal);
        pipeline.hincrby(mKey, "requestCount", 1);
        pipeline.hincrby(mKey, "successCount", 1);
        pipeline.hincrby(mKey, "totalTokens", tokenCount);
        pipeline.expire(mKey, TTL_BY_PERIOD[periodType]);

        if (latencyMs > 0) {
          await this.updateModelMetrics(modelId, latencyMs, true);
        }
      }
    }

    // Usage patterns
    const now = new Date();
    const hour = now.getUTCHours();
    const dow = now.getUTCDay();
    const uKey = usageHourKey(periods.day);
    pipeline.hincrby(uKey, `h${hour}`, 1);
    pipeline.hincrby(uKey, `dow${dow}`, 1);
    pipeline.expire(uKey, TTL_BY_PERIOD["day"]);

    await pipeline.exec();
  }

  private async onAgentTaskCompleted(event: AgentTaskCompleted): Promise<void> {
    const { userId, totalCostUsd = 0, durationMs = 0 } = event.payload;
    const periods = getPeriodKeys();
    const pipeline = this.redis.pipeline();

    for (const [periodType, periodVal] of Object.entries(periods)) {
      const cKey = costKey(userId, periodVal);
      pipeline.hincrbyfloat(cKey, "totalCostUsd", totalCostUsd);
      pipeline.hincrbyfloat(cKey, "agentCostUsd", totalCostUsd);
      pipeline.expire(cKey, TTL_BY_PERIOD[periodType]);

      const gKey = globalCounterKey("agent_tasks_completed", periodVal);
      pipeline.incr(gKey);
      pipeline.expire(gKey, TTL_BY_PERIOD[periodType]);
    }

    await pipeline.exec();
  }

  private async onAgentTaskFailed(event: AgentTaskFailed): Promise<void> {
    const periods = getPeriodKeys();
    const pipeline = this.redis.pipeline();

    for (const [periodType, periodVal] of Object.entries(periods)) {
      const gKey = globalCounterKey("agent_tasks_failed", periodVal);
      pipeline.incr(gKey);
      pipeline.expire(gKey, TTL_BY_PERIOD[periodType]);
    }

    await pipeline.exec();
  }

  private async onDocumentGenerated(event: DocumentGenerated): Promise<void> {
    const periods = getPeriodKeys();
    const pipeline = this.redis.pipeline();

    for (const [periodType, periodVal] of Object.entries(periods)) {
      const gKey = globalCounterKey("docs_generated", periodVal);
      pipeline.incr(gKey);
      pipeline.expire(gKey, TTL_BY_PERIOD[periodType]);
    }

    await pipeline.exec();
  }

  private async onUserSignedIn(event: UserSignedIn): Promise<void> {
    const periods = getPeriodKeys();
    const pipeline = this.redis.pipeline();

    for (const [periodType, periodVal] of Object.entries(periods)) {
      const gKey = `analytics:active_users:${periodVal}`;
      pipeline.sadd(gKey, event.payload.userId);
      pipeline.expire(gKey, TTL_BY_PERIOD[periodType]);
    }

    await pipeline.exec();
  }

  private async onModelSwitched(event: ModelSwitched): Promise<void> {
    const periods = getPeriodKeys();
    const pipeline = this.redis.pipeline();

    for (const [periodType, periodVal] of Object.entries(periods)) {
      const gKey = globalCounterKey(`model_switch:${event.payload.toModelId}`, periodVal);
      pipeline.incr(gKey);
      pipeline.expire(gKey, TTL_BY_PERIOD[periodType]);
    }

    await pipeline.exec();
  }

  private async onModelError(event: ModelError): Promise<void> {
    const { modelId } = event.payload;
    const periods = getPeriodKeys();
    const pipeline = this.redis.pipeline();

    for (const [periodType, periodVal] of Object.entries(periods)) {
      const mKey = modelKey(modelId, periodVal);
      pipeline.hincrby(mKey, "errorCount", 1);
      pipeline.expire(mKey, TTL_BY_PERIOD[periodType]);
    }

    await pipeline.exec();
  }

  // -------------------------------------------------------------------------
  // Public query methods
  // -------------------------------------------------------------------------

  async getCostByUser(userId: string, period: string): Promise<CostBreakdown> {
    try {
      const raw = await this.redis.hgetall(costKey(userId, period));
      if (!raw || Object.keys(raw).length === 0) {
        return this.emptyCostBreakdown(userId, period);
      }

      const costByModel: Record<string, number> = {};
      const chatCosts: Array<{ chatId: string; costUsd: number }> = [];

      for (const [k, v] of Object.entries(raw)) {
        if (k.startsWith("model:")) {
          costByModel[k.slice(6)] = parseFloat(v);
        } else if (k.startsWith("chat:")) {
          chatCosts.push({ chatId: k.slice(5), costUsd: parseFloat(v) });
        }
      }

      chatCosts.sort((a, b) => b.costUsd - a.costUsd);

      return {
        userId,
        period,
        totalCostUsd: parseFloat(raw.totalCostUsd ?? "0"),
        messageCostUsd: parseFloat(raw.messageCostUsd ?? "0"),
        agentCostUsd: parseFloat(raw.agentCostUsd ?? "0"),
        costByModel,
        topChats: chatCosts.slice(0, 10),
      };
    } catch (err) {
      Logger.error("AnalyticsProjection.getCostByUser error", err);
      return this.emptyCostBreakdown(userId, period);
    }
  }

  async getModelPerformance(modelId: string, period: string): Promise<ModelMetrics> {
    try {
      const [raw, latencyData] = await Promise.all([
        this.redis.hgetall(modelKey(modelId, period)),
        this.redis.lrange(modelLatencyKey(modelId, period), 0, -1),
      ]);

      const requestCount = parseInt(raw?.requestCount ?? "0", 10);
      const successCount = parseInt(raw?.successCount ?? "0", 10);
      const errorCount = parseInt(raw?.errorCount ?? "0", 10);
      const totalTokens = parseInt(raw?.totalTokens ?? "0", 10);

      const latencies = latencyData.map(Number).filter((n) => n > 0).sort((a, b) => a - b);
      const avgLatencyMs =
        latencies.length > 0
          ? latencies.reduce((a, b) => a + b, 0) / latencies.length
          : 0;
      const p95Index = Math.floor(latencies.length * 0.95);
      const p95LatencyMs = latencies[p95Index] ?? 0;

      return {
        modelId,
        period,
        requestCount,
        successCount,
        errorCount,
        avgLatencyMs: Math.round(avgLatencyMs),
        p95LatencyMs,
        totalTokens,
        successRate: requestCount > 0 ? successCount / requestCount : 0,
        avgTokensPerRequest: requestCount > 0 ? Math.round(totalTokens / requestCount) : 0,
      };
    } catch (err) {
      Logger.error("AnalyticsProjection.getModelPerformance error", err);
      return {
        modelId,
        period,
        requestCount: 0,
        successCount: 0,
        errorCount: 0,
        avgLatencyMs: 0,
        p95LatencyMs: 0,
        totalTokens: 0,
        successRate: 0,
        avgTokensPerRequest: 0,
      };
    }
  }

  async getUsagePatterns(period: string): Promise<UsagePattern[]> {
    try {
      const raw = await this.redis.hgetall(usageHourKey(period));
      if (!raw) return [];

      const patterns: UsagePattern[] = [];
      for (let h = 0; h < 24; h++) {
        for (let dow = 0; dow < 7; dow++) {
          patterns.push({
            hour: h,
            dayOfWeek: dow,
            requestCount: parseInt(raw[`h${h}`] ?? "0", 10),
            avgLatencyMs: 0,
          });
        }
      }

      return patterns;
    } catch (err) {
      Logger.error("AnalyticsProjection.getUsagePatterns error", err);
      return [];
    }
  }

  async getRevenueAnalytics(period: string): Promise<RevenueData> {
    try {
      const [raw, activeUsersRaw] = await Promise.all([
        this.redis.hgetall(revenueKey(period)),
        this.redis.scard(`analytics:active_users:${period}`),
      ]);

      const totalRevenueCents = parseInt(raw?.totalRevenueCents ?? "0", 10);
      const totalCostUsd = parseFloat(raw?.totalCostUsd ?? "0");
      const activeUsers = activeUsersRaw ?? 0;
      const arpu = activeUsers > 0 ? Math.round(totalRevenueCents / activeUsers) : 0;

      const revenueByModel: Record<string, number> = {};
      for (const [k, v] of Object.entries(raw ?? {})) {
        if (k.startsWith("model:")) {
          revenueByModel[k.slice(6)] = parseInt(v, 10);
        }
      }

      const grossMarginPct =
        totalRevenueCents > 0
          ? ((totalRevenueCents / 100 - totalCostUsd) / (totalRevenueCents / 100)) * 100
          : 0;

      return {
        period,
        totalRevenueCents,
        totalCostUsd,
        grossMarginPct: Math.round(grossMarginPct * 100) / 100,
        activeUsers,
        newUsers: parseInt(raw?.newUsers ?? "0", 10),
        arpu,
        revenueByModel,
      };
    } catch (err) {
      Logger.error("AnalyticsProjection.getRevenueAnalytics error", err);
      return {
        period,
        totalRevenueCents: 0,
        totalCostUsd: 0,
        grossMarginPct: 0,
        activeUsers: 0,
        newUsers: 0,
        arpu: 0,
        revenueByModel: {},
      };
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async incrementCostCounter(key: string, amount: number): Promise<void> {
    try {
      await this.redis.hincrbyfloat(key, "totalCostUsd", amount);
    } catch (err) {
      Logger.error("AnalyticsProjection.incrementCostCounter error", err);
    }
  }

  private async updateModelMetrics(
    modelId: string,
    latency: number,
    success: boolean
  ): Promise<void> {
    try {
      const periods = getPeriodKeys();
      const pipeline = this.redis.pipeline();

      for (const [periodType, periodVal] of Object.entries(periods)) {
        const lKey = modelLatencyKey(modelId, periodVal);
        // Keep last 1000 latency samples per period
        pipeline.lpush(lKey, latency.toString());
        pipeline.ltrim(lKey, 0, 999);
        pipeline.expire(lKey, TTL_BY_PERIOD[periodType]);

        if (!success) {
          const mKey = modelKey(modelId, periodVal);
          pipeline.hincrby(mKey, "errorCount", 1);
          pipeline.expire(mKey, TTL_BY_PERIOD[periodType]);
        }
      }

      await pipeline.exec();
    } catch (err) {
      Logger.error("AnalyticsProjection.updateModelMetrics error", err);
    }
  }

  private emptyCostBreakdown(userId: string, period: string): CostBreakdown {
    return {
      userId,
      period,
      totalCostUsd: 0,
      messageCostUsd: 0,
      agentCostUsd: 0,
      costByModel: {},
      topChats: [],
    };
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const analyticsProjection = new AnalyticsProjection();
