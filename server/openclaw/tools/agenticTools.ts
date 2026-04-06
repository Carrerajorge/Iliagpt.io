import { z } from 'zod';
import type { ToolContext, ToolDefinition, ToolResult } from '../../agent/toolRegistry';
import { openclawSubagentService } from '../agents/subagentService';

type RagServiceLike = {
  search: (
    userId: string,
    query: string,
    options?: { limit?: number; chatId?: string; minScore?: number },
  ) => Promise<Array<{ content: string; score: number; chatId: string }>>;
  getContextForMessage: (
    userId: string,
    message: string,
    currentChatId?: string,
  ) => Promise<string>;
};

let ragServiceSingleton: RagServiceLike | null = null;

async function getRagService(): Promise<RagServiceLike> {
  if (ragServiceSingleton) {
    return ragServiceSingleton;
  }
  const { RAGService } = await import('../../services/ragService');
  ragServiceSingleton = new RAGService();
  return ragServiceSingleton;
}

function ok(output: unknown): ToolResult {
  return { success: true, output };
}

function fail(code: string, message: string, retryable = false): ToolResult {
  return {
    success: false,
    output: null,
    error: { code, message, retryable },
  };
}

export function createAgenticTools(): ToolDefinition[] {
  const spawnSubagent: ToolDefinition = {
    name: 'openclaw_spawn_subagent',
    description: 'Spawn a delegated subagent run for complex or parallel work.',
    inputSchema: z.object({
      objective: z.string().min(1),
      planHint: z.array(z.string()).optional(),
      parentRunId: z.string().optional(),
    }),
    capabilities: ['long_running'],
    execute: async (input: any, context: ToolContext): Promise<ToolResult> => {
      const run = await openclawSubagentService.spawn({
        requesterUserId: context.userId,
        chatId: context.chatId,
        objective: input.objective,
        planHint: input.planHint,
        parentRunId: input.parentRunId || context.runId,
        permissionProfile: 'full_agent',
      });
      return ok(run);
    },
  };

  const subagentStatus: ToolDefinition = {
    name: 'openclaw_subagent_status',
    description: 'Get status/result of a subagent run.',
    inputSchema: z.object({
      runId: z.string().min(1),
    }),
    execute: async (input: any, context: ToolContext): Promise<ToolResult> => {
      const run = await openclawSubagentService.get(input.runId);
      if (!run || run.requesterUserId !== context.userId) {
        return fail('NOT_FOUND', 'Subagent run not found', false);
      }
      return ok(run);
    },
  };

  const subagentList: ToolDefinition = {
    name: 'openclaw_subagent_list',
    description: 'List subagent runs for the current user.',
    inputSchema: z.object({
      parentRunId: z.string().optional(),
      status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']).optional(),
      limit: z.number().int().min(1).max(500).optional().default(50),
    }),
    execute: async (input: any, context: ToolContext): Promise<ToolResult> => {
      const runs = await openclawSubagentService.list({
        requesterUserId: context.userId,
        parentRunId: input.parentRunId,
        status: input.status,
        limit: input.limit,
      });
      return ok(runs);
    },
  };

  const subagentCancel: ToolDefinition = {
    name: 'openclaw_subagent_cancel',
    description: 'Cancel a running subagent.',
    inputSchema: z.object({
      runId: z.string().min(1),
    }),
    capabilities: ['high_risk'],
    execute: async (input: any, context: ToolContext): Promise<ToolResult> => {
      const run = await openclawSubagentService.get(input.runId);
      if (!run || run.requesterUserId !== context.userId) {
        return fail('NOT_FOUND', 'Subagent run not found', false);
      }
      const cancelled = await openclawSubagentService.cancel(input.runId);
      if (!cancelled) {
        return fail('CANNOT_CANCEL', `Run ${input.runId} cannot be cancelled`, false);
      }
      return ok({ runId: input.runId, cancelled: true });
    },
  };

  const ragSearch: ToolDefinition = {
    name: 'openclaw_rag_search',
    description: 'Search user memory/context using RAG.',
    inputSchema: z.object({
      query: z.string().min(1),
      limit: z.number().int().min(1).max(20).optional().default(5),
      minScore: z.number().min(0).max(1).optional().default(0.3),
      chatId: z.string().optional(),
    }),
    capabilities: ['reads_files', 'accesses_external_api'],
    execute: async (input: any, context: ToolContext): Promise<ToolResult> => {
      try {
        const ragService = await getRagService();
        const results = await ragService.search(context.userId, input.query, {
          limit: input.limit,
          chatId: input.chatId,
          minScore: input.minScore,
        });
        return ok(results);
      } catch (error: any) {
        return fail('RAG_SEARCH_ERROR', error?.message || 'RAG search failed', true);
      }
    },
  };

  const ragContext: ToolDefinition = {
    name: 'openclaw_rag_context',
    description: 'Build contextual RAG memory block for a message.',
    inputSchema: z.object({
      message: z.string().min(1),
      currentChatId: z.string().optional(),
    }),
    capabilities: ['reads_files'],
    execute: async (input: any, context: ToolContext): Promise<ToolResult> => {
      try {
        const ragService = await getRagService();
        const memoryContext = await ragService.getContextForMessage(
          context.userId,
          input.message,
          input.currentChatId,
        );
        return ok({ context: memoryContext });
      } catch (error: any) {
        return fail('RAG_CONTEXT_ERROR', error?.message || 'RAG context failed', true);
      }
    },
  };

  return [
    spawnSubagent,
    subagentStatus,
    subagentList,
    subagentCancel,
    ragSearch,
    ragContext,
  ];
}
