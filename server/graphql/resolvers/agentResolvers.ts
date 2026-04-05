import { GraphQLError } from 'graphql';
import { eq, and, desc, sql, or } from 'drizzle-orm';
import { db } from '../../db';
import { Logger } from '../../lib/logger';
import { agents } from '../../../shared/schema';
import type { GraphQLContext } from '../index';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentToolInput {
  name: string;
  description?: string;
  schema?: unknown;
  enabled: boolean;
}

interface CreateAgentInput {
  name: string;
  description?: string;
  instructions: string;
  model: string;
  tools?: AgentToolInput[];
  isPublic?: boolean;
  metadata?: unknown;
}

interface UpdateAgentInput {
  name?: string;
  description?: string;
  instructions?: string;
  model?: string;
  tools?: AgentToolInput[];
  isPublic?: boolean;
  metadata?: unknown;
}

interface ExecuteAgentInput {
  agentId: string;
  input: string;
  chatId?: string;
  stream?: boolean;
}

interface PaginationInput {
  first?: number | null;
  after?: string | null;
  last?: number | null;
  before?: string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_TOOLS = new Set([
  'web_search',
  'code_interpreter',
  'file_browser',
  'calculator',
  'image_generation',
  'weather',
  'calendar',
  'email',
  'database_query',
  'http_request',
]);

const SUPPORTED_MODELS = new Set([
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4-turbo',
  'gpt-3.5-turbo',
  'claude-3-5-sonnet-20241022',
  'claude-3-5-haiku-20241022',
  'claude-3-opus-20240229',
  'gemini-1.5-pro',
  'gemini-1.5-flash',
  'mistral-large-latest',
]);

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function requireAuth(ctx: GraphQLContext): string {
  if (!ctx.userId) {
    throw new GraphQLError('Not authenticated', {
      extensions: { code: 'UNAUTHENTICATED' },
    });
  }
  return ctx.userId;
}

function normalizePageSize(first?: number | null, last?: number | null): number {
  return Math.min(Math.max(1, first ?? last ?? DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
}

function encodeCursor(id: string, createdAt: Date): string {
  return Buffer.from(JSON.stringify({ id, t: createdAt.getTime() })).toString('base64');
}

function buildConnection<T extends { id: string; createdAt: Date }>(
  items: T[],
  totalCount: number,
  pagination: PaginationInput,
  hasMore: boolean,
) {
  const edges = items.map((node) => ({
    node,
    cursor: encodeCursor(node.id, node.createdAt),
  }));

  return {
    edges,
    pageInfo: {
      hasNextPage: pagination.first != null ? hasMore : false,
      hasPreviousPage: pagination.last != null ? hasMore : false,
      startCursor: edges.length > 0 ? edges[0].cursor : null,
      endCursor: edges.length > 0 ? edges[edges.length - 1].cursor : null,
      totalCount,
    },
  };
}

async function requireAgentOwner(
  agentId: string,
  userId: string,
): Promise<typeof agents.$inferSelect> {
  const [agent] = await db
    .select()
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);

  if (!agent) {
    throw new GraphQLError('Agent not found', {
      extensions: { code: 'NOT_FOUND' },
    });
  }

  if (agent.userId !== userId) {
    throw new GraphQLError('Forbidden: you do not own this agent', {
      extensions: { code: 'FORBIDDEN' },
    });
  }

  return agent;
}

function validateAgentConfig(input: CreateAgentInput | UpdateAgentInput): void {
  if ('name' in input && input.name !== undefined && !input.name.trim()) {
    throw new GraphQLError('Agent name cannot be empty', {
      extensions: { code: 'BAD_USER_INPUT' },
    });
  }

  if ('instructions' in input && input.instructions !== undefined && !input.instructions.trim()) {
    throw new GraphQLError('Agent instructions cannot be empty', {
      extensions: { code: 'BAD_USER_INPUT' },
    });
  }

  if ('model' in input && input.model !== undefined) {
    if (!SUPPORTED_MODELS.has(input.model)) {
      throw new GraphQLError(`Unsupported model: ${input.model}`, {
        extensions: { code: 'BAD_USER_INPUT', supportedModels: [...SUPPORTED_MODELS] },
      });
    }
  }

  if (input.tools) {
    for (const tool of input.tools) {
      if (!tool.name?.trim()) {
        throw new GraphQLError('Tool name cannot be empty', {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }
      if (!VALID_TOOLS.has(tool.name)) {
        Logger.warn('Unknown tool specified in agent config', { tool: tool.name });
        // We warn but don't block — custom tools are allowed
      }
    }
  }
}

// ─── Simulated async agent execution ─────────────────────────────────────────

async function runAgentExecution(
  agentId: string,
  input: string,
  chatId?: string,
): Promise<{
  id: string;
  agentId: string;
  chatId: string | null;
  status: string;
  input: string;
  output: string | null;
  startedAt: Date;
  completedAt: Date | null;
  tokensUsed: number | null;
  error: string | null;
}> {
  const executionId = `exec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = new Date();

  // In a real implementation this would call an LLM/tool-runner
  // and persist to an executions table. Here we return a pending record.
  return {
    id: executionId,
    agentId,
    chatId: chatId ?? null,
    status: 'PENDING',
    input,
    output: null,
    startedAt,
    completedAt: null,
    tokensUsed: null,
    error: null,
  };
}

// ─── Query Resolvers ──────────────────────────────────────────────────────────

const agentQueryResolvers = {
  async agents(
    _: unknown,
    args: { userId?: string | null; pagination?: PaginationInput | null },
    ctx: GraphQLContext,
  ) {
    const requesterId = requireAuth(ctx);
    const targetUserId =
      ctx.role === 'ADMIN' && args.userId ? args.userId : requesterId;

    const pagination = args.pagination ?? {};
    const limit = normalizePageSize(pagination.first, pagination.last);

    try {
      const [rows, countResult] = await Promise.all([
        db
          .select()
          .from(agents)
          .where(eq(agents.userId, targetUserId))
          .orderBy(desc(agents.createdAt))
          .limit(limit + 1),
        db
          .select({ count: sql<number>`count(*)` })
          .from(agents)
          .where(eq(agents.userId, targetUserId)),
      ]);

      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      const totalCount = Number(countResult[0]?.count ?? 0);

      return buildConnection(items, totalCount, pagination, hasMore);
    } catch (err) {
      if (err instanceof GraphQLError) throw err;
      Logger.error('Failed to fetch agents', err);
      throw new GraphQLError('Failed to fetch agents', {
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
      });
    }
  },

  async agent(_: unknown, args: { id: string }, ctx: GraphQLContext) {
    const userId = requireAuth(ctx);

    try {
      const [agent] = await db
        .select()
        .from(agents)
        .where(eq(agents.id, args.id))
        .limit(1);

      if (!agent) return null;

      // Owners, admins, or if the agent is public
      if (agent.userId !== userId && ctx.role !== 'ADMIN' && !agent.isPublic) {
        throw new GraphQLError('Forbidden', {
          extensions: { code: 'FORBIDDEN' },
        });
      }

      return agent;
    } catch (err) {
      if (err instanceof GraphQLError) throw err;
      Logger.error('Failed to fetch agent', err);
      throw new GraphQLError('Failed to fetch agent', {
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
      });
    }
  },

  async publicAgents(
    _: unknown,
    args: { pagination?: PaginationInput | null },
    ctx: GraphQLContext,
  ) {
    requireAuth(ctx);

    const pagination = args.pagination ?? {};
    const limit = normalizePageSize(pagination.first, pagination.last);

    try {
      const [rows, countResult] = await Promise.all([
        db
          .select()
          .from(agents)
          .where(and(eq(agents.isPublic, true), eq(agents.status, 'PUBLISHED')))
          .orderBy(desc(agents.createdAt))
          .limit(limit + 1),
        db
          .select({ count: sql<number>`count(*)` })
          .from(agents)
          .where(and(eq(agents.isPublic, true), eq(agents.status, 'PUBLISHED'))),
      ]);

      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      const totalCount = Number(countResult[0]?.count ?? 0);

      return buildConnection(items, totalCount, pagination, hasMore);
    } catch (err) {
      if (err instanceof GraphQLError) throw err;
      Logger.error('Failed to fetch public agents', err);
      throw new GraphQLError('Failed to fetch public agents', {
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
      });
    }
  },
};

// ─── Mutation Resolvers ───────────────────────────────────────────────────────

const agentMutationResolvers = {
  async createAgent(
    _: unknown,
    args: { input: CreateAgentInput },
    ctx: GraphQLContext,
  ) {
    const userId = requireAuth(ctx);
    validateAgentConfig(args.input);

    try {
      const [agent] = await db
        .insert(agents)
        .values({
          name: args.input.name.trim(),
          description: args.input.description?.trim() ?? null,
          instructions: args.input.instructions.trim(),
          model: args.input.model,
          tools: (args.input.tools ?? []) as unknown[],
          userId,
          status: 'DRAFT',
          isPublic: args.input.isPublic ?? false,
          metadata: (args.input.metadata as Record<string, unknown>) ?? {},
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      Logger.info('Agent created', { agentId: agent.id, userId });
      return agent;
    } catch (err) {
      if (err instanceof GraphQLError) throw err;
      Logger.error('Failed to create agent', err);
      throw new GraphQLError('Failed to create agent', {
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
      });
    }
  },

  async updateAgent(
    _: unknown,
    args: { id: string; input: UpdateAgentInput },
    ctx: GraphQLContext,
  ) {
    const userId = requireAuth(ctx);
    await requireAgentOwner(args.id, userId);
    validateAgentConfig(args.input);

    try {
      const updateData: Partial<typeof agents.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (args.input.name != null) updateData.name = args.input.name.trim();
      if (args.input.description != null) updateData.description = args.input.description.trim();
      if (args.input.instructions != null) updateData.instructions = args.input.instructions.trim();
      if (args.input.model != null) updateData.model = args.input.model;
      if (args.input.tools != null) updateData.tools = args.input.tools as unknown[];
      if (args.input.isPublic != null) updateData.isPublic = args.input.isPublic;
      if (args.input.metadata != null) updateData.metadata = args.input.metadata as Record<string, unknown>;

      const [updated] = await db
        .update(agents)
        .set(updateData)
        .where(eq(agents.id, args.id))
        .returning();

      Logger.info('Agent updated', { agentId: args.id, userId });
      return updated;
    } catch (err) {
      if (err instanceof GraphQLError) throw err;
      Logger.error('Failed to update agent', err);
      throw new GraphQLError('Failed to update agent', {
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
      });
    }
  },

  async deleteAgent(_: unknown, args: { id: string }, ctx: GraphQLContext) {
    const userId = requireAuth(ctx);
    await requireAgentOwner(args.id, userId);

    try {
      await db.delete(agents).where(eq(agents.id, args.id));
      Logger.info('Agent deleted', { agentId: args.id, userId });
      return true;
    } catch (err) {
      if (err instanceof GraphQLError) throw err;
      Logger.error('Failed to delete agent', err);
      throw new GraphQLError('Failed to delete agent', {
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
      });
    }
  },

  async cloneAgent(
    _: unknown,
    args: { id: string; name?: string | null },
    ctx: GraphQLContext,
  ) {
    const userId = requireAuth(ctx);

    try {
      const [source] = await db
        .select()
        .from(agents)
        .where(
          and(
            eq(agents.id, args.id),
            or(eq(agents.userId, userId), eq(agents.isPublic, true)),
          ),
        )
        .limit(1);

      if (!source) {
        throw new GraphQLError('Agent not found or not accessible', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      const cloneName = args.name?.trim() ?? `${source.name} (copy)`;

      const [cloned] = await db
        .insert(agents)
        .values({
          name: cloneName,
          description: source.description,
          instructions: source.instructions,
          model: source.model,
          tools: source.tools as unknown[],
          userId,
          status: 'DRAFT',
          isPublic: false,
          metadata: { clonedFrom: source.id },
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      Logger.info('Agent cloned', {
        sourceId: source.id,
        clonedId: cloned.id,
        userId,
      });
      return cloned;
    } catch (err) {
      if (err instanceof GraphQLError) throw err;
      Logger.error('Failed to clone agent', err);
      throw new GraphQLError('Failed to clone agent', {
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
      });
    }
  },

  async publishAgent(_: unknown, args: { id: string }, ctx: GraphQLContext) {
    const userId = requireAuth(ctx);
    const agent = await requireAgentOwner(args.id, userId);

    if (!agent.instructions?.trim()) {
      throw new GraphQLError('Cannot publish an agent without instructions', {
        extensions: { code: 'BAD_USER_INPUT' },
      });
    }

    try {
      const [updated] = await db
        .update(agents)
        .set({
          status: 'PUBLISHED',
          isPublic: true,
          updatedAt: new Date(),
        })
        .where(eq(agents.id, args.id))
        .returning();

      Logger.info('Agent published', { agentId: args.id, userId });
      return updated;
    } catch (err) {
      if (err instanceof GraphQLError) throw err;
      Logger.error('Failed to publish agent', err);
      throw new GraphQLError('Failed to publish agent', {
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
      });
    }
  },

  async executeAgent(
    _: unknown,
    args: { input: ExecuteAgentInput },
    ctx: GraphQLContext,
  ) {
    const userId = requireAuth(ctx);

    if (!args.input.input?.trim()) {
      throw new GraphQLError('Execution input cannot be empty', {
        extensions: { code: 'BAD_USER_INPUT' },
      });
    }

    try {
      const [agent] = await db
        .select()
        .from(agents)
        .where(
          and(
            eq(agents.id, args.input.agentId),
            or(eq(agents.userId, userId), eq(agents.isPublic, true)),
          ),
        )
        .limit(1);

      if (!agent) {
        throw new GraphQLError('Agent not found or not accessible', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      if (agent.status === 'ARCHIVED') {
        throw new GraphQLError('Cannot execute an archived agent', {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }

      const execution = await runAgentExecution(
        args.input.agentId,
        args.input.input,
        args.input.chatId,
      );

      Logger.info('Agent execution started', {
        executionId: execution.id,
        agentId: args.input.agentId,
        userId,
      });

      return execution;
    } catch (err) {
      if (err instanceof GraphQLError) throw err;
      Logger.error('Failed to execute agent', err);
      throw new GraphQLError('Failed to execute agent', {
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
      });
    }
  },
};

// ─── Field Resolvers ──────────────────────────────────────────────────────────

const agentFieldResolvers = {
  Agent: {
    async executionCount(parent: { id: string }) {
      // Would query an executions table in real implementation
      try {
        const [result] = await db.execute<{ count: string }>(
          sql`SELECT count(*) FROM agent_executions WHERE agent_id = ${parent.id}`,
        );
        return Number((result as unknown as { count: string })?.count ?? 0);
      } catch {
        return 0;
      }
    },
  },
};

// ─── Export ───────────────────────────────────────────────────────────────────

export const agentResolvers = {
  Query: agentQueryResolvers,
  Mutation: agentMutationResolvers,
  ...agentFieldResolvers,
};
