/**
 * Model GraphQL Resolvers
 * Handles: AI model catalog, health checks, usage stats, provider management
 */

import { GraphQLError } from "graphql";
import { Logger } from "../../lib/logger.js";
import type { GraphQLContext } from "../middleware/auth.js";

// ─── Model registry (in production this comes from a DB table + live API checks) ─
export interface ModelRecord {
  id: string;
  name: string;
  displayName: string;
  provider: string;
  contextWindow: number;
  maxOutputTokens: number | null;
  supportsVision: boolean;
  supportsTools: boolean;
  supportsStreaming: boolean;
  costPer1kInputTokens: number | null;
  costPer1kOutputTokens: number | null;
  enabled: boolean;
  isDefault: boolean;
  config: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  config?: Record<string, unknown>;
  enabled: boolean;
}

const modelRegistry = new Map<string, ModelRecord>([
  [
    "gpt-4o",
    {
      id: "gpt-4o",
      name: "gpt-4o",
      displayName: "GPT-4o",
      provider: "OPENAI",
      contextWindow: 128000,
      maxOutputTokens: 4096,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      costPer1kInputTokens: 0.005,
      costPer1kOutputTokens: 0.015,
      enabled: true,
      isDefault: true,
      config: null,
      createdAt: new Date("2024-01-01"),
      updatedAt: new Date(),
    },
  ],
  [
    "gpt-4o-mini",
    {
      id: "gpt-4o-mini",
      name: "gpt-4o-mini",
      displayName: "GPT-4o Mini",
      provider: "OPENAI",
      contextWindow: 128000,
      maxOutputTokens: 4096,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      costPer1kInputTokens: 0.00015,
      costPer1kOutputTokens: 0.0006,
      enabled: true,
      isDefault: false,
      config: null,
      createdAt: new Date("2024-01-01"),
      updatedAt: new Date(),
    },
  ],
  [
    "claude-3-5-sonnet-20241022",
    {
      id: "claude-3-5-sonnet-20241022",
      name: "claude-3-5-sonnet-20241022",
      displayName: "Claude 3.5 Sonnet",
      provider: "ANTHROPIC",
      contextWindow: 200000,
      maxOutputTokens: 8192,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      costPer1kInputTokens: 0.003,
      costPer1kOutputTokens: 0.015,
      enabled: true,
      isDefault: false,
      config: null,
      createdAt: new Date("2024-01-01"),
      updatedAt: new Date(),
    },
  ],
  [
    "gemini-1.5-pro",
    {
      id: "gemini-1.5-pro",
      name: "gemini-1.5-pro",
      displayName: "Gemini 1.5 Pro",
      provider: "GOOGLE",
      contextWindow: 1000000,
      maxOutputTokens: 8192,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      costPer1kInputTokens: 0.00125,
      costPer1kOutputTokens: 0.005,
      enabled: true,
      isDefault: false,
      config: null,
      createdAt: new Date("2024-01-01"),
      updatedAt: new Date(),
    },
  ],
  [
    "mixtral-8x7b",
    {
      id: "mixtral-8x7b",
      name: "mixtral-8x7b-32768",
      displayName: "Mixtral 8x7B",
      provider: "GROQ",
      contextWindow: 32768,
      maxOutputTokens: 4096,
      supportsVision: false,
      supportsTools: true,
      supportsStreaming: true,
      costPer1kInputTokens: 0.00027,
      costPer1kOutputTokens: 0.00027,
      enabled: true,
      isDefault: false,
      config: null,
      createdAt: new Date("2024-01-01"),
      updatedAt: new Date(),
    },
  ],
]);

const providerConfigs = new Map<string, ProviderConfig>([
  ["OPENAI", { enabled: true }],
  ["ANTHROPIC", { enabled: true }],
  ["GOOGLE", { enabled: true }],
  ["GROQ", { enabled: true }],
  ["MISTRAL", { enabled: false }],
  ["LOCAL", { enabled: false }],
]);

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

function getPeriodDates(period?: string): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date();
  switch (period) {
    case "HOUR": from.setHours(from.getHours() - 1); break;
    case "DAY": from.setDate(from.getDate() - 1); break;
    case "WEEK": from.setDate(from.getDate() - 7); break;
    case "QUARTER": from.setMonth(from.getMonth() - 3); break;
    case "YEAR": from.setFullYear(from.getFullYear() - 1); break;
    default: from.setMonth(from.getMonth() - 1); // MONTH
  }
  return { from, to };
}

// ─── Resolvers ────────────────────────────────────────────────────────────────
export const modelResolvers = {
  Query: {
    async models(_: unknown, __: unknown, ctx: GraphQLContext) {
      assertAuth(ctx);
      Logger.info("[GraphQL] models query", { userId: ctx.user.id });
      return Array.from(modelRegistry.values()).filter((m) => m.enabled || ctx.user!.role === "admin");
    },

    async modelHealth(_: unknown, args: { modelId: string }, ctx: GraphQLContext) {
      assertAuth(ctx);
      Logger.info("[GraphQL] modelHealth query", { modelId: args.modelId, userId: ctx.user.id });

      const model = modelRegistry.get(args.modelId);
      if (!model) {
        throw new GraphQLError("Model not found", { extensions: { code: "NOT_FOUND" } });
      }

      // In production: ping the provider API, check latency, track error rates from DB
      return {
        modelId: args.modelId,
        available: model.enabled,
        latencyMs: Math.random() * 200 + 50, // Would be measured from real health check
        errorRate: 0.01,                      // Would aggregate from error logs
        requestsLastHour: 42,                 // Would query tool_call_logs or similar
        checkedAt: new Date(),
      };
    },

    async modelUsage(_: unknown, args: { modelId: string; period?: string }, ctx: GraphQLContext) {
      assertAuth(ctx);
      Logger.info("[GraphQL] modelUsage query", { modelId: args.modelId, userId: ctx.user.id });

      const model = modelRegistry.get(args.modelId);
      if (!model) {
        throw new GraphQLError("Model not found", { extensions: { code: "NOT_FOUND" } });
      }

      const { from, to } = getPeriodDates(args.period);

      // In production: SELECT SUM(input_tokens), SUM(output_tokens), COUNT(*) FROM tool_call_logs
      //   WHERE model_id = ? AND created_at BETWEEN from AND to
      return {
        modelId: args.modelId,
        period: args.period ?? "MONTH",
        totalRequests: 1240,
        totalInputTokens: 2_500_000,
        totalOutputTokens: 850_000,
        totalCost: (2500 * (model.costPer1kInputTokens ?? 0)) + (850 * (model.costPer1kOutputTokens ?? 0)),
        averageLatencyMs: 1200,
        errorCount: 12,
        from,
        to,
      };
    },

    async providerStatus(_: unknown, __: unknown, ctx: GraphQLContext) {
      assertAuth(ctx);
      Logger.info("[GraphQL] providerStatus query", { userId: ctx.user.id });

      const providers = ["OPENAI", "ANTHROPIC", "GOOGLE", "GROQ", "MISTRAL", "LOCAL"];
      return providers.map((provider) => {
        const cfg = providerConfigs.get(provider) ?? { enabled: false };
        const models = Array.from(modelRegistry.values()).filter((m) => m.provider === provider);
        return {
          provider,
          available: cfg.enabled && models.some((m) => m.enabled),
          models: cfg.enabled ? models : [],
          rateLimitRemaining: null, // Would come from provider-specific rate limit headers
          rateLimitReset: null,
          checkedAt: new Date(),
        };
      });
    },
  },

  Mutation: {
    async setDefaultModel(_: unknown, args: { modelId: string }, ctx: GraphQLContext) {
      assertAdmin(ctx);
      Logger.info("[GraphQL] setDefaultModel", { modelId: args.modelId, userId: ctx.user.id });

      const model = modelRegistry.get(args.modelId);
      if (!model) {
        throw new GraphQLError("Model not found", { extensions: { code: "NOT_FOUND" } });
      }
      if (!model.enabled) {
        throw new GraphQLError("Cannot set disabled model as default", { extensions: { code: "BAD_REQUEST" } });
      }

      // Clear existing default
      for (const [id, m] of modelRegistry.entries()) {
        if (m.isDefault) {
          modelRegistry.set(id, { ...m, isDefault: false, updatedAt: new Date() });
        }
      }

      const updated = { ...model, isDefault: true, updatedAt: new Date() };
      modelRegistry.set(args.modelId, updated);
      Logger.info("[GraphQL] default model updated", { modelId: args.modelId });
      return updated;
    },

    async configureProvider(
      _: unknown,
      args: {
        input: {
          provider: string;
          apiKey?: string;
          baseUrl?: string;
          config?: unknown;
          enabled?: boolean;
        };
      },
      ctx: GraphQLContext
    ) {
      assertAdmin(ctx);
      Logger.info("[GraphQL] configureProvider", { provider: args.input.provider, userId: ctx.user.id });

      const existing = providerConfigs.get(args.input.provider) ?? { enabled: false };
      const updated: ProviderConfig = {
        ...existing,
        ...(args.input.apiKey !== undefined && { apiKey: args.input.apiKey }),
        ...(args.input.baseUrl !== undefined && { baseUrl: args.input.baseUrl }),
        ...(args.input.config !== undefined && { config: args.input.config as Record<string, unknown> }),
        ...(args.input.enabled !== undefined && { enabled: args.input.enabled }),
      };

      providerConfigs.set(args.input.provider, updated);

      const models = Array.from(modelRegistry.values()).filter((m) => m.provider === args.input.provider);
      return {
        provider: args.input.provider,
        available: updated.enabled && models.some((m) => m.enabled),
        models: updated.enabled ? models : [],
        rateLimitRemaining: null,
        rateLimitReset: null,
        checkedAt: new Date(),
      };
    },

    async enableModel(_: unknown, args: { modelId: string; enabled: boolean }, ctx: GraphQLContext) {
      assertAdmin(ctx);
      Logger.info("[GraphQL] enableModel", { modelId: args.modelId, enabled: args.enabled, userId: ctx.user.id });

      const model = modelRegistry.get(args.modelId);
      if (!model) {
        throw new GraphQLError("Model not found", { extensions: { code: "NOT_FOUND" } });
      }

      // If disabling the default model, clear default flag
      let isDefault = model.isDefault;
      if (!args.enabled && isDefault) {
        isDefault = false;
        Logger.warn("[GraphQL] Disabling default model — default cleared", { modelId: args.modelId });
      }

      const updated = { ...model, enabled: args.enabled, isDefault, updatedAt: new Date() };
      modelRegistry.set(args.modelId, updated);
      return updated;
    },
  },

  // Field resolvers
  Model: {
    async health(parent: ModelRecord) {
      return {
        modelId: parent.id,
        available: parent.enabled,
        latencyMs: null, // Lazy — would fetch on demand
        errorRate: 0,
        requestsLastHour: 0,
        checkedAt: new Date(),
      };
    },

    async usage(parent: ModelRecord, args: { period?: string }) {
      const { from, to } = getPeriodDates(args.period);
      // In production: query real analytics tables
      return {
        modelId: parent.id,
        period: args.period ?? "MONTH",
        totalRequests: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCost: 0,
        averageLatencyMs: 0,
        errorCount: 0,
        from,
        to,
      };
    },
  },
};
