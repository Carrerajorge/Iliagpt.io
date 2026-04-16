/**
 * ActivityProjection: Materialises event stream into Redis-based activity feeds
 * Improvement 10 – Event-Driven Architecture with CQRS
 */

import Redis from "ioredis";
import { Logger } from "../../lib/logger";
import {
  AppEvent,
  EVENT_TYPES,
  ChatCreated,
  MessageSent,
  AgentTaskStarted,
  AgentTaskCompleted,
  AgentTaskFailed,
  DocumentGenerated,
  DocumentAnalyzed,
  UserSignedIn,
  UserSignedOut,
  ModelError,
  ErrorOccurred,
} from "../types";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface ActivityEntry {
  id: string;
  type: string;
  userId?: string;
  description: string;
  severity: "info" | "warning" | "error";
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface UserStats {
  userId: string;
  period: "day" | "week" | "month";
  messageCount: number;
  chatCount: number;
  agentTaskCount: number;
  documentsGenerated: number;
  documentsAnalyzed: number;
  totalTokens: number;
  totalCostUsd: number;
  errorCount: number;
  lastActiveAt?: Date;
}

export interface HealthMetrics {
  activeUsers1h: number;
  messageRate1m: number;
  errorRate5m: number;
  agentTasksInFlight: number;
  avgLatencyMs: number;
  systemHealthScore: number; // 0-100
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Redis key helpers
// ---------------------------------------------------------------------------

const KEY_USER_ACTIVITY = (userId: string) => `activity:user:${userId}`;
const KEY_SYSTEM_ACTIVITY = "activity:system";
const KEY_USER_STATS = (userId: string, period: string) =>
  `stats:user:${userId}:${period}`;
const KEY_ACTIVE_USERS = "health:active_users";
const KEY_HEALTH_METRICS = "health:metrics";
const KEY_MESSAGE_RATE = "health:message_rate";
const KEY_ERROR_RATE = "health:error_rate";
const KEY_AGENT_TASKS_INFLIGHT = "health:agent_tasks_inflight";

const ACTIVITY_FEED_MAX_LEN = 500;
const STATS_TTL: Record<"day" | "week" | "month", number> = {
  day: 86_400,
  week: 604_800,
  month: 2_592_000,
};

// ---------------------------------------------------------------------------
// ActivityProjection
// ---------------------------------------------------------------------------

export class ActivityProjection {
  private redis: Redis;

  constructor(redisUrl?: string) {
    const url = redisUrl ?? process.env.REDIS_URL;
    this.redis = url
      ? new Redis(url, { lazyConnect: true, maxRetriesPerRequest: null })
      : new Redis({ lazyConnect: true, maxRetriesPerRequest: null });

    this.redis.on("error", (err) =>
      Logger.error("ActivityProjection redis error", err)
    );
  }

  // -------------------------------------------------------------------------
  // Main event dispatcher
  // -------------------------------------------------------------------------

  async handleEvent(event: AppEvent): Promise<void> {
    try {
      switch (event.type) {
        case EVENT_TYPES.CHAT_CREATED:
          await this.onChatCreated(event as ChatCreated);
          break;
        case EVENT_TYPES.MESSAGE_SENT:
          await this.onMessageSent(event as MessageSent);
          break;
        case EVENT_TYPES.AGENT_TASK_STARTED:
          await this.onAgentTaskStarted(event as AgentTaskStarted);
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
        case EVENT_TYPES.DOCUMENT_ANALYZED:
          await this.onDocumentAnalyzed(event as DocumentAnalyzed);
          break;
        case EVENT_TYPES.USER_SIGNED_IN:
          await this.onUserSignedIn(event as UserSignedIn);
          break;
        case EVENT_TYPES.USER_SIGNED_OUT:
          await this.onUserSignedOut(event as UserSignedOut);
          break;
        case EVENT_TYPES.MODEL_ERROR:
          await this.onModelError(event as ModelError);
          break;
        case EVENT_TYPES.ERROR_OCCURRED:
          await this.onErrorOccurred(event as ErrorOccurred);
          break;
        default:
          await this.updateActivityFeed("system", {
            id: event.id,
            type: event.type,
            description: `Event: ${event.type}`,
            severity: "info",
            timestamp: event.timestamp,
            userId: event.userId,
          });
      }
    } catch (err) {
      Logger.error("ActivityProjection.handleEvent error", { err, eventType: event.type });
    }
  }

  // -------------------------------------------------------------------------
  // Event handlers
  // -------------------------------------------------------------------------

  private async onChatCreated(event: ChatCreated): Promise<void> {
    const entry: ActivityEntry = {
      id: event.id,
      type: event.type,
      userId: event.payload.userId,
      description: `New chat created: "${event.payload.title}"`,
      severity: "info",
      timestamp: event.timestamp,
      metadata: { chatId: event.payload.chatId, modelId: event.payload.modelId },
    };
    await Promise.all([
      this.updateActivityFeed(event.payload.userId, entry),
      this.updateActivityFeed("system", entry),
      this.incrementUserStat(event.payload.userId, "chatCount"),
    ]);
  }

  private async onMessageSent(event: MessageSent): Promise<void> {
    const entry: ActivityEntry = {
      id: event.id,
      type: event.type,
      userId: event.payload.userId,
      description: `Message sent in chat ${event.payload.chatId} (${event.payload.role})`,
      severity: "info",
      timestamp: event.timestamp,
      metadata: {
        chatId: event.payload.chatId,
        role: event.payload.role,
        tokenCount: event.payload.tokenCount,
        costUsd: event.payload.costUsd,
      },
    };

    const pipeline = this.redis.pipeline();
    pipeline.lpush(KEY_USER_ACTIVITY(event.payload.userId), JSON.stringify(entry));
    pipeline.ltrim(KEY_USER_ACTIVITY(event.payload.userId), 0, ACTIVITY_FEED_MAX_LEN - 1);
    pipeline.lpush(KEY_SYSTEM_ACTIVITY, JSON.stringify(entry));
    pipeline.ltrim(KEY_SYSTEM_ACTIVITY, 0, ACTIVITY_FEED_MAX_LEN - 1);
    pipeline.incr(KEY_MESSAGE_RATE);
    pipeline.expire(KEY_MESSAGE_RATE, 60);
    pipeline.hincrby(KEY_USER_STATS(event.payload.userId, "day"), "messageCount", 1);
    pipeline.hincrby(
      KEY_USER_STATS(event.payload.userId, "day"),
      "totalTokens",
      event.payload.tokenCount ?? 0
    );
    pipeline.zadd(KEY_ACTIVE_USERS, Date.now(), event.payload.userId);
    await pipeline.exec();
  }

  private async onAgentTaskStarted(event: AgentTaskStarted): Promise<void> {
    const entry: ActivityEntry = {
      id: event.id,
      type: event.type,
      userId: event.payload.userId,
      description: `Agent task started: ${event.payload.description}`,
      severity: "info",
      timestamp: event.timestamp,
      metadata: { taskId: event.payload.taskId, agentId: event.payload.agentId },
    };
    await Promise.all([
      this.updateActivityFeed(event.payload.userId, entry),
      this.redis.incr(KEY_AGENT_TASKS_INFLIGHT),
    ]);
  }

  private async onAgentTaskCompleted(event: AgentTaskCompleted): Promise<void> {
    const entry: ActivityEntry = {
      id: event.id,
      type: event.type,
      userId: event.payload.userId,
      description: `Agent task completed in ${event.payload.durationMs}ms`,
      severity: "info",
      timestamp: event.timestamp,
      metadata: {
        taskId: event.payload.taskId,
        durationMs: event.payload.durationMs,
        costUsd: event.payload.totalCostUsd,
      },
    };
    await Promise.all([
      this.updateActivityFeed(event.payload.userId, entry),
      this.incrementUserStat(event.payload.userId, "agentTaskCount"),
      this.redis.decr(KEY_AGENT_TASKS_INFLIGHT),
    ]);
  }

  private async onAgentTaskFailed(event: AgentTaskFailed): Promise<void> {
    const entry: ActivityEntry = {
      id: event.id,
      type: event.type,
      userId: event.payload.userId,
      description: `Agent task failed: ${event.payload.errorMessage}`,
      severity: "error",
      timestamp: event.timestamp,
      metadata: { taskId: event.payload.taskId, errorCode: event.payload.errorCode },
    };
    const pipeline = this.redis.pipeline();
    pipeline.lpush(KEY_USER_ACTIVITY(event.payload.userId), JSON.stringify(entry));
    pipeline.ltrim(KEY_USER_ACTIVITY(event.payload.userId), 0, ACTIVITY_FEED_MAX_LEN - 1);
    pipeline.lpush(KEY_SYSTEM_ACTIVITY, JSON.stringify(entry));
    pipeline.ltrim(KEY_SYSTEM_ACTIVITY, 0, ACTIVITY_FEED_MAX_LEN - 1);
    pipeline.decr(KEY_AGENT_TASKS_INFLIGHT);
    pipeline.incr(KEY_ERROR_RATE);
    pipeline.expire(KEY_ERROR_RATE, 300);
    await pipeline.exec();
    await this.incrementUserStat(event.payload.userId, "errorCount");
  }

  private async onDocumentGenerated(event: DocumentGenerated): Promise<void> {
    const entry: ActivityEntry = {
      id: event.id,
      type: event.type,
      userId: event.payload.userId,
      description: `Document generated: ${event.payload.documentType} (${Math.round(event.payload.sizeBytes / 1024)}KB)`,
      severity: "info",
      timestamp: event.timestamp,
    };
    await Promise.all([
      this.updateActivityFeed(event.payload.userId, entry),
      this.incrementUserStat(event.payload.userId, "documentsGenerated"),
    ]);
  }

  private async onDocumentAnalyzed(event: DocumentAnalyzed): Promise<void> {
    const entry: ActivityEntry = {
      id: event.id,
      type: event.type,
      userId: event.payload.userId,
      description: `Document analyzed: ${event.payload.documentType}`,
      severity: "info",
      timestamp: event.timestamp,
    };
    await Promise.all([
      this.updateActivityFeed(event.payload.userId, entry),
      this.incrementUserStat(event.payload.userId, "documentsAnalyzed"),
    ]);
  }

  private async onUserSignedIn(event: UserSignedIn): Promise<void> {
    const entry: ActivityEntry = {
      id: event.id,
      type: event.type,
      userId: event.payload.userId,
      description: `User signed in via ${event.payload.provider}`,
      severity: "info",
      timestamp: event.timestamp,
    };
    await Promise.all([
      this.updateActivityFeed(event.payload.userId, entry),
      this.updateActivityFeed("system", entry),
      this.redis.zadd(KEY_ACTIVE_USERS, Date.now(), event.payload.userId),
    ]);
  }

  private async onUserSignedOut(event: UserSignedOut): Promise<void> {
    const entry: ActivityEntry = {
      id: event.id,
      type: event.type,
      userId: event.payload.userId,
      description: "User signed out",
      severity: "info",
      timestamp: event.timestamp,
    };
    await this.updateActivityFeed(event.payload.userId, entry);
  }

  private async onModelError(event: ModelError): Promise<void> {
    const entry: ActivityEntry = {
      id: event.id,
      type: event.type,
      userId: event.userId,
      description: `Model error on ${event.payload.modelId}: ${event.payload.errorCode}`,
      severity: "warning",
      timestamp: event.timestamp,
    };
    const pipeline = this.redis.pipeline();
    pipeline.lpush(KEY_SYSTEM_ACTIVITY, JSON.stringify(entry));
    pipeline.ltrim(KEY_SYSTEM_ACTIVITY, 0, ACTIVITY_FEED_MAX_LEN - 1);
    pipeline.incr(KEY_ERROR_RATE);
    pipeline.expire(KEY_ERROR_RATE, 300);
    await pipeline.exec();
  }

  private async onErrorOccurred(event: ErrorOccurred): Promise<void> {
    const severity =
      event.payload.severity === "critical" || event.payload.severity === "high"
        ? "error"
        : "warning";
    const entry: ActivityEntry = {
      id: event.id,
      type: event.type,
      userId: event.userId,
      description: `[${event.payload.severity.toUpperCase()}] ${event.payload.errorMessage}`,
      severity,
      timestamp: event.timestamp,
    };
    const pipeline = this.redis.pipeline();
    pipeline.lpush(KEY_SYSTEM_ACTIVITY, JSON.stringify(entry));
    pipeline.ltrim(KEY_SYSTEM_ACTIVITY, 0, ACTIVITY_FEED_MAX_LEN - 1);
    pipeline.incr(KEY_ERROR_RATE);
    pipeline.expire(KEY_ERROR_RATE, 300);
    await pipeline.exec();
  }

  // -------------------------------------------------------------------------
  // Public query methods
  // -------------------------------------------------------------------------

  async getUserActivity(userId: string, limit = 50): Promise<ActivityEntry[]> {
    try {
      const items = await this.redis.lrange(KEY_USER_ACTIVITY(userId), 0, limit - 1);
      return items.map((s) => {
        const p = JSON.parse(s) as ActivityEntry;
        p.timestamp = new Date(p.timestamp);
        return p;
      });
    } catch (err) {
      Logger.error("ActivityProjection.getUserActivity error", err);
      return [];
    }
  }

  async getSystemActivity(limit = 100): Promise<ActivityEntry[]> {
    try {
      const items = await this.redis.lrange(KEY_SYSTEM_ACTIVITY, 0, limit - 1);
      return items.map((s) => {
        const p = JSON.parse(s) as ActivityEntry;
        p.timestamp = new Date(p.timestamp);
        return p;
      });
    } catch (err) {
      Logger.error("ActivityProjection.getSystemActivity error", err);
      return [];
    }
  }

  async aggregateUserStats(
    userId: string,
    period: "day" | "week" | "month"
  ): Promise<UserStats> {
    try {
      const key = KEY_USER_STATS(userId, period);
      const raw = await this.redis.hgetall(key);

      return {
        userId,
        period,
        messageCount: parseInt(raw.messageCount ?? "0", 10),
        chatCount: parseInt(raw.chatCount ?? "0", 10),
        agentTaskCount: parseInt(raw.agentTaskCount ?? "0", 10),
        documentsGenerated: parseInt(raw.documentsGenerated ?? "0", 10),
        documentsAnalyzed: parseInt(raw.documentsAnalyzed ?? "0", 10),
        totalTokens: parseInt(raw.totalTokens ?? "0", 10),
        totalCostUsd: parseFloat(raw.totalCostUsd ?? "0"),
        errorCount: parseInt(raw.errorCount ?? "0", 10),
        lastActiveAt: raw.lastActiveAt ? new Date(raw.lastActiveAt) : undefined,
      };
    } catch (err) {
      Logger.error("ActivityProjection.aggregateUserStats error", err);
      return {
        userId,
        period,
        messageCount: 0,
        chatCount: 0,
        agentTaskCount: 0,
        documentsGenerated: 0,
        documentsAnalyzed: 0,
        totalTokens: 0,
        totalCostUsd: 0,
        errorCount: 0,
      };
    }
  }

  async getHealthMetrics(): Promise<HealthMetrics> {
    try {
      const now = Date.now();
      const oneHourAgo = now - 3_600_000;

      const [activeUsersRaw, messageRateRaw, errorRateRaw, inflight, cachedMetrics] =
        await Promise.all([
          this.redis.zrangebyscore(KEY_ACTIVE_USERS, oneHourAgo, "+inf"),
          this.redis.get(KEY_MESSAGE_RATE),
          this.redis.get(KEY_ERROR_RATE),
          this.redis.get(KEY_AGENT_TASKS_INFLIGHT),
          this.redis.get(KEY_HEALTH_METRICS),
        ]);

      const activeUsers1h = activeUsersRaw.length;
      const messageRate1m = parseInt(messageRateRaw ?? "0", 10);
      const errorRate5m = parseInt(errorRateRaw ?? "0", 10);
      const agentTasksInFlight = Math.max(0, parseInt(inflight ?? "0", 10));

      let healthScore = 100;
      if (errorRate5m > 50) healthScore -= 40;
      else if (errorRate5m > 10) healthScore -= 20;
      if (agentTasksInFlight > 100) healthScore -= 10;

      const metrics: HealthMetrics = {
        activeUsers1h,
        messageRate1m,
        errorRate5m,
        agentTasksInFlight,
        avgLatencyMs: cachedMetrics
          ? (JSON.parse(cachedMetrics) as HealthMetrics).avgLatencyMs
          : 0,
        systemHealthScore: Math.max(0, healthScore),
        updatedAt: new Date(),
      };

      await this.redis.set(KEY_HEALTH_METRICS, JSON.stringify(metrics), "EX", 30);
      return metrics;
    } catch (err) {
      Logger.error("ActivityProjection.getHealthMetrics error", err);
      return {
        activeUsers1h: 0,
        messageRate1m: 0,
        errorRate5m: 0,
        agentTasksInFlight: 0,
        avgLatencyMs: 0,
        systemHealthScore: 0,
        updatedAt: new Date(),
      };
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async updateActivityFeed(
    target: string,
    entry: ActivityEntry
  ): Promise<void> {
    const key =
      target === "system" ? KEY_SYSTEM_ACTIVITY : KEY_USER_ACTIVITY(target);
    const pipeline = this.redis.pipeline();
    pipeline.lpush(key, JSON.stringify(entry));
    pipeline.ltrim(key, 0, ACTIVITY_FEED_MAX_LEN - 1);
    await pipeline.exec();
  }

  private async incrementUserStat(
    userId: string,
    field: string
  ): Promise<void> {
    try {
      for (const period of ["day", "week", "month"] as const) {
        const key = KEY_USER_STATS(userId, period);
        const pipeline = this.redis.pipeline();
        pipeline.hincrby(key, field, 1);
        pipeline.hset(key, "lastActiveAt", new Date().toISOString());
        pipeline.expire(key, STATS_TTL[period]);
        await pipeline.exec();
      }
    } catch (err) {
      Logger.error("ActivityProjection.incrementUserStat error", err);
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const activityProjection = new ActivityProjection();
