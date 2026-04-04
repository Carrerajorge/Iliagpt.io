/**
 * Agent GraphQL Resolvers
 * Handles: Agents, Tasks, subscriptions for real-time task progress
 */

import { GraphQLError } from "graphql";
import { eq, desc, and, sql } from "drizzle-orm";
import { db, db as dbRead } from "../../db.js";
import { Logger } from "../../lib/logger.js";
import { agentRuns } from "../../../shared/schema.js";
import { pubsub } from "./chatResolvers.js";
import type { GraphQLContext } from "../middleware/auth.js";

// ─── Topic helpers ────────────────────────────────────────────────────────────
const TOPICS = {
  TASK_PROGRESS: (taskId: string) => `TASK_PROGRESS_${taskId}`,
  AGENT_LOG: (agentId: string) => `AGENT_LOG_${agentId}`,
};

// ─── In-memory agent registry (would be replaced by DB-backed agents table) ──
interface AgentRecord {
  id: string;
  name: string;
  description: string | null;
  type: string;
  status: string;
  capabilities: string[];
  config: Record<string, unknown> | null;
  lastActiveAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// Stub registry — in production, these come from a `agents` DB table
const agentRegistry = new Map<string, AgentRecord>([
  [
    "agent-orchestrator",
    {
      id: "agent-orchestrator",
      name: "Orchestrator",
      description: "Main multi-step task orchestrator",
      type: "orchestrator",
      status: "IDLE",
      capabilities: ["web_search", "code_exec", "file_ops", "llm"],
      config: null,
      lastActiveAt: null,
      createdAt: new Date("2024-01-01"),
      updatedAt: new Date(),
    },
  ],
  [
    "agent-researcher",
    {
      id: "agent-researcher",
      name: "Researcher",
      description: "Deep web research agent",
      type: "researcher",
      status: "IDLE",
      capabilities: ["web_search", "document_analysis", "summarization"],
      config: null,
      lastActiveAt: null,
      createdAt: new Date("2024-01-01"),
      updatedAt: new Date(),
    },
  ],
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

function mapRunToTask(run: typeof agentRuns.$inferSelect) {
  return {
    id: run.id,
    agentId: "system",                           // agentRuns uses conversationId not agentId
    type: run.routerDecision ?? "generic",       // closest field available
    status: (run.status ?? "pending").toUpperCase(),
    input: run.objective ? { objective: run.objective } : null,
    output: null,                                // not stored in agentRuns directly
    error: run.error ?? null,
    progress: 0,                                 // not stored — would derive from agentSteps
    startedAt: run.startedAt ?? null,
    completedAt: run.completedAt ?? null,
    createdAt: run.startedAt,                    // agentRuns has no separate createdAt
  };
}

// ─── Resolvers ────────────────────────────────────────────────────────────────
export const agentResolvers = {
  Query: {
    async agents(_: unknown, __: unknown, ctx: GraphQLContext) {
      assertAuth(ctx);
      Logger.info("[GraphQL] agents query", { userId: ctx.user.id });
      return Array.from(agentRegistry.values());
    },

    async agent(_: unknown, args: { id: string }, ctx: GraphQLContext) {
      assertAuth(ctx);
      Logger.info("[GraphQL] agent query", { agentId: args.id, userId: ctx.user.id });
      return agentRegistry.get(args.id) ?? null;
    },

    async agentTasks(
      _: unknown,
      args: { agentId: string; limit?: number; offset?: number },
      ctx: GraphQLContext
    ) {
      assertAuth(ctx);
      const limit = Math.min(args.limit ?? 20, 100);
      const offset = args.offset ?? 0;

      try {
        Logger.info("[GraphQL] agentTasks query", { agentId: args.agentId, userId: ctx.user.id });

        const rows = await dbRead
          .select()
          .from(agentRuns)
          .where(eq(agentRuns.conversationId, args.agentId))
          .orderBy(desc(agentRuns.startedAt))
          .limit(limit + 1)
          .offset(offset);

        const hasNextPage = rows.length > limit;
        const items = hasNextPage ? rows.slice(0, limit) : rows;

        return {
          edges: items.map((r) => ({ node: mapRunToTask(r), cursor: Buffer.from(r.id).toString("base64") })),
          pageInfo: {
            hasNextPage,
            hasPreviousPage: offset > 0,
            startCursor: items.length > 0 ? Buffer.from(items[0].id).toString("base64") : null,
            endCursor: items.length > 0 ? Buffer.from(items[items.length - 1].id).toString("base64") : null,
            totalCount: items.length,
          },
        };
      } catch (err) {
        Logger.error("[GraphQL] agentTasks query failed", err);
        throw new GraphQLError("Failed to fetch agent tasks");
      }
    },

    async agentHealth(_: unknown, __: unknown, ctx: GraphQLContext) {
      assertAuth(ctx);
      Logger.info("[GraphQL] agentHealth query", { userId: ctx.user.id });

      // Return health for all registered agents
      return Array.from(agentRegistry.values()).map((agent) => ({
        agentId: agent.id,
        status: agent.status,
        uptime: process.uptime(),
        tasksCompleted: 0, // Would query agentRuns WHERE status='completed'
        tasksFailed: 0,    // Would query agentRuns WHERE status='failed'
        averageLatencyMs: 0,
        lastError: null,
        checkedAt: new Date(),
      }));
    },
  },

  Mutation: {
    async createAgent(
      _: unknown,
      args: { input: { name: string; description?: string; type: string; capabilities: string[]; config?: unknown } },
      ctx: GraphQLContext
    ) {
      assertAdmin(ctx);
      Logger.info("[GraphQL] createAgent", { name: args.input.name, userId: ctx.user.id });

      const agent: AgentRecord = {
        id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: args.input.name,
        description: args.input.description ?? null,
        type: args.input.type,
        status: "IDLE",
        capabilities: args.input.capabilities,
        config: (args.input.config as Record<string, unknown>) ?? null,
        lastActiveAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      agentRegistry.set(agent.id, agent);
      Logger.info("[GraphQL] agent created", { agentId: agent.id });
      return agent;
    },

    async executeTask(
      _: unknown,
      args: { input: { agentId: string; type: string; input?: unknown; priority?: number; timeoutMs?: number } },
      ctx: GraphQLContext
    ) {
      assertAuth(ctx);

      const agent = agentRegistry.get(args.input.agentId);
      if (!agent) {
        throw new GraphQLError("Agent not found", { extensions: { code: "NOT_FOUND" } });
      }

      try {
        Logger.info("[GraphQL] executeTask", { agentId: args.input.agentId, type: args.input.type, userId: ctx.user.id });

        const [run] = await db
          .insert(agentRuns)
          .values({
            conversationId: args.input.agentId, // map agentId to conversationId
            status: "pending",
            routerDecision: args.input.type,
            objective: args.input.input ? JSON.stringify(args.input.input) : null,
          })
          .returning();

        const task = mapRunToTask(run);

        // Update agent lastActiveAt
        agentRegistry.set(agent.id, { ...agent, lastActiveAt: new Date(), status: "RUNNING" });

        // Publish initial progress event
        pubsub.publish(TOPICS.TASK_PROGRESS(run.id), {
          taskProgress: {
            taskId: run.id,
            agentId: args.input.agentId,
            progress: 0,
            status: "RUNNING",
            message: "Task queued",
            timestamp: new Date(),
          },
        });

        return task;
      } catch (err) {
        Logger.error("[GraphQL] executeTask failed", err);
        throw new GraphQLError("Failed to execute task");
      }
    },

    async cancelTask(_: unknown, args: { id: string }, ctx: GraphQLContext) {
      assertAuth(ctx);

      try {
        Logger.info("[GraphQL] cancelTask", { taskId: args.id, userId: ctx.user.id });

        const [updated] = await db
          .update(agentRuns)
          .set({ status: "cancelled", completedAt: new Date() })
          .where(eq(agentRuns.id, args.id))
          .returning();

        if (!updated) {
          throw new GraphQLError("Task not found or access denied", { extensions: { code: "NOT_FOUND" } });
        }

        const task = mapRunToTask(updated);

        pubsub.publish(TOPICS.TASK_PROGRESS(args.id), {
          taskProgress: {
            taskId: args.id,
            agentId: updated.conversationId ?? "unknown",
            progress: updated.progress ?? 0,
            status: "CANCELLED",
            message: "Task cancelled by user",
            timestamp: new Date(),
          },
        });

        return task;
      } catch (err) {
        Logger.error("[GraphQL] cancelTask failed", err);
        throw err instanceof GraphQLError ? err : new GraphQLError("Failed to cancel task");
      }
    },

    async configureAgent(
      _: unknown,
      args: { id: string; input: { name?: string; description?: string; config?: unknown; capabilities?: string[] } },
      ctx: GraphQLContext
    ) {
      assertAdmin(ctx);

      const agent = agentRegistry.get(args.id);
      if (!agent) {
        throw new GraphQLError("Agent not found", { extensions: { code: "NOT_FOUND" } });
      }

      Logger.info("[GraphQL] configureAgent", { agentId: args.id, userId: ctx.user.id });

      const updated: AgentRecord = {
        ...agent,
        name: args.input.name ?? agent.name,
        description: args.input.description ?? agent.description,
        capabilities: args.input.capabilities ?? agent.capabilities,
        config: (args.input.config as Record<string, unknown>) ?? agent.config,
        updatedAt: new Date(),
      };

      agentRegistry.set(args.id, updated);
      return updated;
    },
  },

  Subscription: {
    taskProgress: {
      subscribe(_: unknown, args: { taskId: string }, ctx: GraphQLContext) {
        assertAuth(ctx);
        Logger.info("[GraphQL] subscription taskProgress", { taskId: args.taskId, userId: ctx.user?.id });
        return pubsub.asyncIterator(TOPICS.TASK_PROGRESS(args.taskId));
      },
      resolve(payload: { taskProgress: unknown }) {
        return payload.taskProgress;
      },
    },

    agentLog: {
      subscribe(_: unknown, args: { agentId: string }, ctx: GraphQLContext) {
        assertAuth(ctx);
        Logger.info("[GraphQL] subscription agentLog", { agentId: args.agentId, userId: ctx.user?.id });
        return pubsub.asyncIterator(TOPICS.AGENT_LOG(args.agentId));
      },
      resolve(payload: { agentLog: unknown }) {
        return payload.agentLog;
      },
    },
  },

  // Field resolvers
  Agent: {
    async tasks(parent: { id: string }, args: { limit?: number; offset?: number }, ctx: GraphQLContext) {
      if (!ctx.user?.id) return { edges: [], pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null, totalCount: 0 } };
      const limit = Math.min(args.limit ?? 10, 50);
      try {
        const rows = await dbRead
          .select()
          .from(agentRuns)
          .where(eq(agentRuns.conversationId, parent.id))
          .orderBy(desc(agentRuns.startedAt))
          .limit(limit);

        return {
          edges: rows.map((r) => ({ node: mapRunToTask(r), cursor: Buffer.from(r.id).toString("base64") })),
          pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null, totalCount: rows.length },
        };
      } catch {
        return { edges: [], pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null, totalCount: 0 } };
      }
    },

    health(parent: { id: string; status: string }) {
      return {
        agentId: parent.id,
        status: parent.status,
        uptime: process.uptime(),
        tasksCompleted: 0,
        tasksFailed: 0,
        averageLatencyMs: 0,
        lastError: null,
        checkedAt: new Date(),
      };
    },
  },

  AgentTask: {
    agent(parent: { agentId: string }) {
      return agentRegistry.get(parent.agentId) ?? null;
    },
  },
};

// ─── Helper to publish task progress from outside ─────────────────────────────
export function publishTaskProgress(
  taskId: string,
  agentId: string,
  progress: number,
  status: string,
  message?: string
) {
  pubsub.publish(TOPICS.TASK_PROGRESS(taskId), {
    taskProgress: { taskId, agentId, progress, status, message: message ?? null, timestamp: new Date() },
  });
}

export function publishAgentLog(agentId: string, level: string, message: string, data?: unknown) {
  pubsub.publish(TOPICS.AGENT_LOG(agentId), {
    agentLog: { agentId, level, message, data: data ?? null, timestamp: new Date() },
  });
}
