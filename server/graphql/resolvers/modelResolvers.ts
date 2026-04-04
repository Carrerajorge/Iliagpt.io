import { GraphQLError } from 'graphql';
import { eq, and, sql, gte, lte } from 'drizzle-orm';
import { db } from '../../db';
import { Logger } from '../../lib/logger';
import type { GraphQLContext } from '../index';

// ─── Inline model registry (in production, backed by DB table) ────────────────

interface ModelRecord {
  id: string;
  provider: string;
  name: string;
  displayName: string;
  contextWindow: number;
  capabilities: string[];
  pricing: { inputPer1kTokens: number; outputPer1kTokens: number; currency: string };
  enabled: boolean;
  isDefault: boolean;
  maxOutputTokens: number | null;
  supportsStreaming: boolean;
  supportsVision: boolean;
  supportsFunctionCalling: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Runtime in-memory model registry — replace with DB table reads as needed
const MODEL_REGISTRY: ModelRecord[] = [
  {
    id: 'gpt-4o',
    provider: 'OPENAI',
    name: 'gpt-4o',
    displayName: 'GPT-4o',
    contextWindow: 128000,
    capabilities: ['CHAT', 'FUNCTION_CALLING', 'IMAGE_ANALYSIS', 'CODE_GENERATION'],
    pricing: { inputPer1kTokens: 0.005, outputPer1kTokens: 0.015, currency: 'USD' },
    enabled: true,
    isDefault: true,
    maxOutputTokens: 4096,
    supportsStreaming: true,
    supportsVision: true,
    supportsFunctionCalling: true,
    createdAt: new Date('2024-05-13'),
    updatedAt: new Date('2024-05-13'),
  },
  {
    id: 'gpt-4o-mini',
    provider: 'OPENAI',
    name: 'gpt-4o-mini',
    displayName: 'GPT-4o Mini',
    contextWindow: 128000,
    capabilities: ['CHAT', 'FUNCTION_CALLING', 'CODE_GENERATION'],
    pricing: { inputPer1kTokens: 0.00015, outputPer1kTokens: 0.0006, currency: 'USD' },
    enabled: true,
    isDefault: false,
    maxOutputTokens: 16384,
    supportsStreaming: true,
    supportsVision: false,
    supportsFunctionCalling: true,
    createdAt: new Date('2024-07-18'),
    updatedAt: new Date('2024-07-18'),
  },
  {
    id: 'claude-3-5-sonnet-20241022',
    provider: 'ANTHROPIC',
    name: 'claude-3-5-sonnet-20241022',
    displayName: 'Claude 3.5 Sonnet',
    contextWindow: 200000,
    capabilities: ['CHAT', 'FUNCTION_CALLING', 'IMAGE_ANALYSIS', 'CODE_GENERATION', 'REASONING'],
    pricing: { inputPer1kTokens: 0.003, outputPer1kTokens: 0.015, currency: 'USD' },
    enabled: true,
    isDefault: false,
    maxOutputTokens: 8192,
    supportsStreaming: true,
    supportsVision: true,
    supportsFunctionCalling: true,
    createdAt: new Date('2024-10-22'),
    updatedAt: new Date('2024-10-22'),
  },
  {
    id: 'claude-3-5-haiku-20241022',
    provider: 'ANTHROPIC',
    name: 'claude-3-5-haiku-20241022',
    displayName: 'Claude 3.5 Haiku',
    contextWindow: 200000,
    capabilities: ['CHAT', 'FUNCTION_CALLING', 'CODE_GENERATION'],
    pricing: { inputPer1kTokens: 0.0008, outputPer1kTokens: 0.004, currency: 'USD' },
    enabled: true,
    isDefault: false,
    maxOutputTokens: 8192,
    supportsStreaming: true,
    supportsVision: false,
    supportsFunctionCalling: true,
    createdAt: new Date('2024-10-22'),
    updatedAt: new Date('2024-10-22'),
  },
  {
    id: 'gemini-1.5-pro',
    provider: 'GOOGLE',
    name: 'gemini-1.5-pro',
    displayName: 'Gemini 1.5 Pro',
    contextWindow: 1000000,
    capabilities: ['CHAT', 'FUNCTION_CALLING', 'IMAGE_ANALYSIS', 'AUDIO_TRANSCRIPTION', 'CODE_GENERATION'],
    pricing: { inputPer1kTokens: 0.00125, outputPer1kTokens: 0.005, currency: 'USD' },
    enabled: true,
    isDefault: false,
    maxOutputTokens: 8192,
    supportsStreaming: true,
    supportsVision: true,
    supportsFunctionCalling: true,
    createdAt: new Date('2024-02-15'),
    updatedAt: new Date('2024-02-15'),
  },
  {
    id: 'mistral-large-latest',
    provider: 'MISTRAL',
    name: 'mistral-large-latest',
    displayName: 'Mistral Large',
    contextWindow: 128000,
    capabilities: ['CHAT', 'FUNCTION_CALLING', 'CODE_GENERATION'],
    pricing: { inputPer1kTokens: 0.003, outputPer1kTokens: 0.009, currency: 'USD' },
    enabled: false,
    isDefault: false,
    maxOutputTokens: 8192,
    supportsStreaming: true,
    supportsVision: false,
    supportsFunctionCalling: true,
    createdAt: new Date('2024-11-01'),
    updatedAt: new Date('2024-11-01'),
  },
];

// Mutable copy to support enable/disable/config updates at runtime
const modelStore = new Map<string, ModelRecord>(
  MODEL_REGISTRY.map((m) => [m.id, { ...m }]),
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function requireAuth(ctx: GraphQLContext): string {
  if (!ctx.userId) {
    throw new GraphQLError('Not authenticated', {
      extensions: { code: 'UNAUTHENTICATED' },
    });
  }
  return ctx.userId;
}

function requireAdmin(ctx: GraphQLContext): void {
  requireAuth(ctx);
  if (ctx.role !== 'ADMIN') {
    throw new GraphQLError('Admin access required', {
      extensions: { code: 'FORBIDDEN' },
    });
  }
}

function getModelOrThrow(id: string): ModelRecord {
  const model = modelStore.get(id);
  if (!model) {
    throw new GraphQLError(`Model not found: ${id}`, {
      extensions: { code: 'NOT_FOUND' },
    });
  }
  return model;
}

interface ModelFilterInput {
  provider?: string | null;
  capability?: string | null;
  enabled?: boolean | null;
  supportsVision?: boolean | null;
  supportsFunctionCalling?: boolean | null;
}

interface UpdateModelConfigInput {
  displayName?: string | null;
  enabled?: boolean | null;
  isDefault?: boolean | null;
  pricing?: { inputPer1kTokens: number; outputPer1kTokens: number; currency: string } | null;
  maxOutputTokens?: number | null;
  capabilities?: string[] | null;
}

interface TimeRangeInput {
  from: Date;
  to: Date;
}

// ─── Query Resolvers ──────────────────────────────────────────────────────────

const modelQueryResolvers = {
  models(_: unknown, args: { filter?: ModelFilterInput | null }, ctx: GraphQLContext) {
    requireAuth(ctx);

    let results = [...modelStore.values()];

    if (args.filter) {
      const f = args.filter;
      if (f.provider != null) {
        results = results.filter((m) => m.provider === f.provider);
      }
      if (f.capability != null) {
        results = results.filter((m) => m.capabilities.includes(f.capability!));
      }
      if (f.enabled != null) {
        results = results.filter((m) => m.enabled === f.enabled);
      }
      if (f.supportsVision != null) {
        results = results.filter((m) => m.supportsVision === f.supportsVision);
      }
      if (f.supportsFunctionCalling != null) {
        results = results.filter((m) => m.supportsFunctionCalling === f.supportsFunctionCalling);
      }
    }

    return results.sort((a, b) => {
      // Default model first, then by provider name, then by display name
      if (a.isDefault && !b.isDefault) return -1;
      if (!a.isDefault && b.isDefault) return 1;
      return a.displayName.localeCompare(b.displayName);
    });
  },

  model(_: unknown, args: { id: string }, ctx: GraphQLContext) {
    requireAuth(ctx);
    const model = modelStore.get(args.id);
    return model ?? null;
  },

  availableModels(_: unknown, _args: { userId?: string | null }, ctx: GraphQLContext) {
    requireAuth(ctx);
    // Return only enabled models; admins see all
    const results = [...modelStore.values()].filter(
      (m) => m.enabled || ctx.role === 'ADMIN',
    );
    return results.sort((a, b) => a.displayName.localeCompare(b.displayName));
  },

  modelPricing(_: unknown, _args: unknown, ctx: GraphQLContext) {
    requireAuth(ctx);
    return [...modelStore.values()].filter((m) => m.enabled);
  },

  async modelUsageStats(
    _: unknown,
    args: { modelId: string; timeRange: TimeRangeInput },
    ctx: GraphQLContext,
  ) {
    requireAuth(ctx);
    getModelOrThrow(args.modelId); // validate model exists

    const from = new Date(args.timeRange.from);
    const to = new Date(args.timeRange.to);

    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      throw new GraphQLError('Invalid time range', {
        extensions: { code: 'BAD_USER_INPUT' },
      });
    }

    if (from >= to) {
      throw new GraphQLError('Time range "from" must be before "to"', {
        extensions: { code: 'BAD_USER_INPUT' },
      });
    }

    try {
      // Query usage from messages table (or a dedicated usage_stats table)
      // This is a representative query — adapt column names to your schema
      const result = await db.execute<{
        total_requests: string;
        total_tokens: string;
        total_cost: string;
        avg_latency_ms: string;
        error_count: string;
      }>(sql`
        SELECT
          COUNT(*)::int AS total_requests,
          COALESCE(SUM((metadata->>'totalTokens')::int), 0)::int AS total_tokens,
          COALESCE(SUM((metadata->>'cost')::float), 0.0) AS total_cost,
          COALESCE(AVG((metadata->>'latencyMs')::int), 0.0) AS avg_latency_ms,
          COUNT(*) FILTER (WHERE metadata->>'error' IS NOT NULL)::int AS error_count
        FROM messages
        WHERE
          metadata->>'model' = ${args.modelId}
          AND timestamp >= ${from}
          AND timestamp <= ${to}
      `);

      const row = (result as unknown as Array<{
        total_requests: string;
        total_tokens: string;
        total_cost: string;
        avg_latency_ms: string;
        error_count: string;
      }>)[0] ?? {
        total_requests: '0',
        total_tokens: '0',
        total_cost: '0',
        avg_latency_ms: '0',
        error_count: '0',
      };

      const totalRequests = parseInt(row.total_requests, 10) || 0;
      const errorCount = parseInt(row.error_count, 10) || 0;

      const period = `${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)}`;

      Logger.info('Model usage stats fetched', {
        modelId: args.modelId,
        totalRequests,
        period,
      });

      return {
        modelId: args.modelId,
        totalRequests,
        totalTokens: parseInt(row.total_tokens, 10) || 0,
        totalCost: parseFloat(row.total_cost) || 0,
        avgLatencyMs: parseFloat(row.avg_latency_ms) || 0,
        errorRate: totalRequests > 0 ? errorCount / totalRequests : 0,
        period,
      };
    } catch (err) {
      if (err instanceof GraphQLError) throw err;
      Logger.error('Failed to fetch model usage stats', err);
      throw new GraphQLError('Failed to fetch model usage stats', {
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
      });
    }
  },
};

// ─── Mutation Resolvers (admin-only) ─────────────────────────────────────────

const modelMutationResolvers = {
  enableModel(_: unknown, args: { id: string }, ctx: GraphQLContext) {
    requireAdmin(ctx);
    const model = getModelOrThrow(args.id);

    if (model.enabled) {
      throw new GraphQLError('Model is already enabled', {
        extensions: { code: 'BAD_USER_INPUT' },
      });
    }

    const updated: ModelRecord = { ...model, enabled: true, updatedAt: new Date() };
    modelStore.set(args.id, updated);
    Logger.info('Model enabled', { modelId: args.id, adminId: ctx.userId });
    return updated;
  },

  disableModel(_: unknown, args: { id: string }, ctx: GraphQLContext) {
    requireAdmin(ctx);
    const model = getModelOrThrow(args.id);

    if (!model.enabled) {
      throw new GraphQLError('Model is already disabled', {
        extensions: { code: 'BAD_USER_INPUT' },
      });
    }

    if (model.isDefault) {
      throw new GraphQLError(
        'Cannot disable the default model. Set a new default model first.',
        { extensions: { code: 'BAD_USER_INPUT' } },
      );
    }

    const updated: ModelRecord = { ...model, enabled: false, updatedAt: new Date() };
    modelStore.set(args.id, updated);
    Logger.info('Model disabled', { modelId: args.id, adminId: ctx.userId });
    return updated;
  },

  updateModelConfig(
    _: unknown,
    args: { id: string; input: UpdateModelConfigInput },
    ctx: GraphQLContext,
  ) {
    requireAdmin(ctx);
    const model = getModelOrThrow(args.id);
    const input = args.input;

    if (input.pricing) {
      const { inputPer1kTokens, outputPer1kTokens } = input.pricing;
      if (inputPer1kTokens < 0 || outputPer1kTokens < 0) {
        throw new GraphQLError('Pricing values must be non-negative', {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }
    }

    if (input.maxOutputTokens != null && input.maxOutputTokens <= 0) {
      throw new GraphQLError('maxOutputTokens must be a positive integer', {
        extensions: { code: 'BAD_USER_INPUT' },
      });
    }

    if (input.capabilities != null && input.capabilities.length === 0) {
      throw new GraphQLError('Model must have at least one capability', {
        extensions: { code: 'BAD_USER_INPUT' },
      });
    }

    const updated: ModelRecord = {
      ...model,
      displayName: input.displayName?.trim() ?? model.displayName,
      enabled: input.enabled ?? model.enabled,
      isDefault: input.isDefault ?? model.isDefault,
      pricing: input.pricing ?? model.pricing,
      maxOutputTokens: input.maxOutputTokens ?? model.maxOutputTokens,
      capabilities: input.capabilities ?? model.capabilities,
      updatedAt: new Date(),
    };

    modelStore.set(args.id, updated);
    Logger.info('Model config updated', { modelId: args.id, adminId: ctx.userId });
    return updated;
  },

  setDefaultModel(_: unknown, args: { id: string }, ctx: GraphQLContext) {
    requireAdmin(ctx);
    const model = getModelOrThrow(args.id);

    if (!model.enabled) {
      throw new GraphQLError('Cannot set a disabled model as default', {
        extensions: { code: 'BAD_USER_INPUT' },
      });
    }

    // Clear current default
    for (const [key, m] of modelStore.entries()) {
      if (m.isDefault && key !== args.id) {
        modelStore.set(key, { ...m, isDefault: false, updatedAt: new Date() });
      }
    }

    const updated: ModelRecord = { ...model, isDefault: true, updatedAt: new Date() };
    modelStore.set(args.id, updated);
    Logger.info('Default model updated', { modelId: args.id, adminId: ctx.userId });
    return updated;
  },
};

// ─── Export ───────────────────────────────────────────────────────────────────

export const modelResolvers = {
  Query: modelQueryResolvers,
  Mutation: modelMutationResolvers,
};

export { modelStore };
