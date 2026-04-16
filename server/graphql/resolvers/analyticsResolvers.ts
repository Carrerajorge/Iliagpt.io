/**
 * Analytics GraphQL Resolvers
 * Admin-only: dashboard metrics, usage stats, cost breakdown, model performance
 */

import { GraphQLError } from "graphql";
import { eq, and, sql, desc, count } from "drizzle-orm";
import { db as dbRead } from "../../db.js";
import { Logger } from "../../lib/logger.js";
import { users, chats, chatMessages } from "../../../shared/schema.js";
import type { GraphQLContext } from "../middleware/auth.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────
function assertAuth(ctx: GraphQLContext): asserts ctx is GraphQLContext & { user: NonNullable<GraphQLContext["user"]> } {
  if (!ctx.user?.id) {
    throw new GraphQLError("Unauthorized", { extensions: { code: "UNAUTHENTICATED" } });
  }
}

function assertAdmin(ctx: GraphQLContext) {
  assertAuth(ctx);
  if (ctx.user!.role !== "admin") {
    throw new GraphQLError("Forbidden: Admin access required", { extensions: { code: "FORBIDDEN" } });
  }
}

interface PeriodRange {
  from: Date;
  to: Date;
  label: string;
  buckets: number;
  bucketMs: number;
}

function getPeriodRange(period?: string): PeriodRange {
  const to = new Date();
  const from = new Date();
  let label = "month";
  let buckets = 30;
  let bucketMs = 86_400_000; // 1 day

  switch (period) {
    case "HOUR":
      from.setHours(from.getHours() - 1);
      label = "hour";
      buckets = 12;
      bucketMs = 300_000; // 5 min
      break;
    case "DAY":
      from.setDate(from.getDate() - 1);
      label = "day";
      buckets = 24;
      bucketMs = 3_600_000; // 1 hour
      break;
    case "WEEK":
      from.setDate(from.getDate() - 7);
      label = "week";
      buckets = 7;
      bucketMs = 86_400_000;
      break;
    case "QUARTER":
      from.setMonth(from.getMonth() - 3);
      label = "quarter";
      buckets = 13;
      bucketMs = 7 * 86_400_000; // 1 week
      break;
    case "YEAR":
      from.setFullYear(from.getFullYear() - 1);
      label = "year";
      buckets = 12;
      bucketMs = 30 * 86_400_000; // ~1 month
      break;
    default: // MONTH
      from.setMonth(from.getMonth() - 1);
      break;
  }

  return { from, to, label, buckets, bucketMs };
}

function buildTimeSeries(from: Date, buckets: number, bucketMs: number, data: Array<{ ts: number; val: number }>) {
  const series: Array<{ timestamp: Date; value: number; label: string | null }> = [];
  for (let i = 0; i < buckets; i++) {
    const timestamp = new Date(from.getTime() + i * bucketMs);
    const next = new Date(timestamp.getTime() + bucketMs);
    const val = data.filter((d) => d.ts >= timestamp.getTime() && d.ts < next.getTime()).reduce((s, d) => s + d.val, 0);
    series.push({ timestamp, value: val, label: null });
  }
  return series;
}

// ─── Resolvers ────────────────────────────────────────────────────────────────
export const analyticsResolvers = {
  Query: {
    async dashboardMetrics(_: unknown, args: { period?: string }, ctx: GraphQLContext) {
      assertAdmin(ctx);
      const { from, to, buckets, bucketMs } = getPeriodRange(args.period);

      try {
        Logger.info("[GraphQL] dashboardMetrics", { userId: ctx.user.id, period: args.period });

        // ── Real DB queries ──────────────────────────────────────────────────
        // Total users
        const [totalUsersRow] = await dbRead
          .select({ count: sql<number>`COUNT(*)` })
          .from(users);
        const totalUsers = Number(totalUsersRow?.count ?? 0);

        // New users in period
        const [newUsersRow] = await dbRead
          .select({ count: sql<number>`COUNT(*)` })
          .from(users)
          .where(
            and(
              sql`${users.createdAt} >= ${from}`,
              sql`${users.createdAt} <= ${to}`
            )
          );
        const newUsers = Number(newUsersRow?.count ?? 0);

        // Active users (had a chat in period)
        const [activeUsersRow] = await dbRead
          .select({ count: sql<number>`COUNT(DISTINCT ${chats.userId})` })
          .from(chats)
          .where(
            and(
              sql`${chats.createdAt} >= ${from}`,
              sql`${chats.createdAt} <= ${to}`
            )
          );
        const activeUsers = Number(activeUsersRow?.count ?? 0);

        // Total chats in period
        const [totalChatsRow] = await dbRead
          .select({ count: sql<number>`COUNT(*)` })
          .from(chats)
          .where(
            and(
              sql`${chats.createdAt} >= ${from}`,
              sql`${chats.createdAt} <= ${to}`
            )
          );
        const totalChats = Number(totalChatsRow?.count ?? 0);

        // Total messages in period
        const [totalMsgRow] = await dbRead
          .select({ count: sql<number>`COUNT(*)` })
          .from(chatMessages)
          .where(
            and(
              sql`${chatMessages.createdAt} >= ${from}`,
              sql`${chatMessages.createdAt} <= ${to}`
            )
          );
        const totalMessages = Number(totalMsgRow?.count ?? 0);

        // Total tokens — sum from users.tokens_consumed
        // In production: use a separate analytics_events table
        const [tokensRow] = await dbRead
          .select({ total: sql<number>`COALESCE(SUM(${users.tokensConsumed}), 0)` })
          .from(users);
        const totalTokensConsumed = Number(tokensRow?.total ?? 0);

        // Estimated cost (blended rate: $0.002 per 1k tokens)
        const totalCost = (totalTokensConsumed / 1000) * 0.002;

        // ── Top models ────────────────────────────────────────────────────────
        // In production: query a model_usage_log table
        const topModels = [
          { modelId: "gpt-4o", modelName: "GPT-4o", requests: 0, percentage: 0 },
          { modelId: "claude-3-5-sonnet-20241022", modelName: "Claude 3.5 Sonnet", requests: 0, percentage: 0 },
        ];

        // ── Time series (stub buckets — real: GROUP BY time_bucket()) ─────────
        const userGrowth = buildTimeSeries(from, buckets, bucketMs, []);
        const messageVolume = buildTimeSeries(from, buckets, bucketMs, []);
        const costByDay = buildTimeSeries(from, buckets, bucketMs, []);

        return {
          period: args.period ?? "MONTH",
          totalUsers,
          activeUsers,
          newUsers,
          totalChats,
          totalMessages,
          totalTokensConsumed,
          totalCost,
          averageSessionDuration: 0, // Would compute from session logs
          topModels,
          userGrowth,
          messageVolume,
          costByDay,
          from,
          to,
        };
      } catch (err) {
        Logger.error("[GraphQL] dashboardMetrics failed", err);
        throw new GraphQLError("Failed to compute dashboard metrics");
      }
    },

    async usageStats(_: unknown, args: { userId?: string; period?: string }, ctx: GraphQLContext) {
      assertAuth(ctx);

      const targetUserId = args.userId ?? ctx.user!.id;
      if (targetUserId !== ctx.user!.id && ctx.user!.role !== "admin") {
        throw new GraphQLError("Forbidden", { extensions: { code: "FORBIDDEN" } });
      }

      const { from, to } = getPeriodRange(args.period);

      try {
        Logger.info("[GraphQL] usageStats", { targetUserId, requesterId: ctx.user!.id });

        const chatFilter = args.userId
          ? and(eq(chats.userId, targetUserId), sql`${chats.createdAt} >= ${from}`, sql`${chats.createdAt} <= ${to}`)
          : and(sql`${chats.createdAt} >= ${from}`, sql`${chats.createdAt} <= ${to}`);

        const [chatsRow] = await dbRead.select({ count: sql<number>`COUNT(*)` }).from(chats).where(chatFilter);
        const totalChats = Number(chatsRow?.count ?? 0);

        const msgFilter = and(
          args.userId ? eq(chats.userId, targetUserId) : sql`TRUE`,
          sql`${chatMessages.createdAt} >= ${from}`,
          sql`${chatMessages.createdAt} <= ${to}`
        );

        const [msgsRow] = await dbRead
          .select({ count: sql<number>`COUNT(*)` })
          .from(chatMessages)
          .innerJoin(chats, eq(chatMessages.chatId, chats.id))
          .where(msgFilter);
        const totalMessages = Number(msgsRow?.count ?? 0);

        let tokens = 0;
        if (args.userId) {
          const [userRow] = await dbRead.select({ tokensConsumed: users.tokensConsumed }).from(users).where(eq(users.id, targetUserId)).limit(1);
          tokens = userRow?.tokensConsumed ?? 0;
        }

        return {
          userId: targetUserId,
          period: args.period ?? "MONTH",
          totalChats,
          totalMessages,
          totalTokensConsumed: tokens,
          totalInputTokens: Math.round(tokens * 0.7),
          totalOutputTokens: Math.round(tokens * 0.3),
          estimatedCost: (tokens / 1000) * 0.002,
          modelsUsed: [], // Would aggregate from chats.ai_model_used
          averageMessagesPerChat: totalChats > 0 ? totalMessages / totalChats : 0,
          from,
          to,
        };
      } catch (err) {
        Logger.error("[GraphQL] usageStats failed", err);
        throw new GraphQLError("Failed to compute usage stats");
      }
    },

    async costBreakdown(_: unknown, args: { period?: string }, ctx: GraphQLContext) {
      assertAdmin(ctx);
      const { from, to } = getPeriodRange(args.period);

      try {
        Logger.info("[GraphQL] costBreakdown", { userId: ctx.user!.id, period: args.period });

        // In production: query a cost_ledger or billing_events table
        // Here we return realistic structure with zero-values as placeholders

        return {
          period: args.period ?? "MONTH",
          totalCost: 0,
          byProvider: [
            { provider: "OPENAI", cost: 0, percentage: 0, tokens: 0 },
            { provider: "ANTHROPIC", cost: 0, percentage: 0, tokens: 0 },
            { provider: "GOOGLE", cost: 0, percentage: 0, tokens: 0 },
            { provider: "GROQ", cost: 0, percentage: 0, tokens: 0 },
          ],
          byModel: [
            { modelId: "gpt-4o", modelName: "GPT-4o", cost: 0, percentage: 0, requests: 0 },
            { modelId: "claude-3-5-sonnet-20241022", modelName: "Claude 3.5 Sonnet", cost: 0, percentage: 0, requests: 0 },
          ],
          byUser: [], // Top 10 users by cost — would be paginated in production
          from,
          to,
        };
      } catch (err) {
        Logger.error("[GraphQL] costBreakdown failed", err);
        throw new GraphQLError("Failed to compute cost breakdown");
      }
    },

    async modelPerformance(_: unknown, args: { period?: string }, ctx: GraphQLContext) {
      assertAdmin(ctx);
      const { from, to } = getPeriodRange(args.period);

      try {
        Logger.info("[GraphQL] modelPerformance", { userId: ctx.user!.id, period: args.period });

        // In production: query a model_metrics table that records per-request latency, tokens, errors
        const models = [
          {
            modelId: "gpt-4o",
            modelName: "GPT-4o",
            provider: "OPENAI",
            totalRequests: 0,
            successRate: 1.0,
            averageLatencyMs: 0,
            p95LatencyMs: 0,
            tokensPerSecond: 0,
            costEfficiency: 0,
          },
          {
            modelId: "gpt-4o-mini",
            modelName: "GPT-4o Mini",
            provider: "OPENAI",
            totalRequests: 0,
            successRate: 1.0,
            averageLatencyMs: 0,
            p95LatencyMs: 0,
            tokensPerSecond: 0,
            costEfficiency: 0,
          },
          {
            modelId: "claude-3-5-sonnet-20241022",
            modelName: "Claude 3.5 Sonnet",
            provider: "ANTHROPIC",
            totalRequests: 0,
            successRate: 1.0,
            averageLatencyMs: 0,
            p95LatencyMs: 0,
            tokensPerSecond: 0,
            costEfficiency: 0,
          },
        ];

        return {
          period: args.period ?? "MONTH",
          models,
          from,
          to,
        };
      } catch (err) {
        Logger.error("[GraphQL] modelPerformance failed", err);
        throw new GraphQLError("Failed to compute model performance");
      }
    },
  },
};
