import type { WsRequest } from '../types';
import { createResponse, createErrorResponse } from './protocol';
import { openclawSessionManager } from './sessionManager';
import { toolRegistry } from '../../agent/toolRegistry';
import { hookSystem } from '../plugins/hookSystem';
import { skillRegistry } from '../skills/skillRegistry';
import { openclawSubagentService } from '../agents/subagentService';

type RpcHandler = (req: WsRequest, ctx: { userId: string }) => Promise<any>;

const handlers = new Map<string, RpcHandler>();

handlers.set('health', async () => ({
  status: 'ok',
  uptime: process.uptime(),
  timestamp: Date.now(),
  modules: {
    gateway: true,
    tools: process.env.ENABLE_OPENCLAW_TOOLS === 'true',
    plugins: process.env.ENABLE_OPENCLAW_PLUGINS === 'true',
    skills: process.env.ENABLE_OPENCLAW_SKILLS !== 'false',
    streaming: process.env.ENABLE_OPENCLAW_STREAMING === 'true',
  },
}));

handlers.set('sessions.list', async () => {
  return { sessions: openclawSessionManager.list() };
});

handlers.set('tools.catalog', async () => {
  const tools = toolRegistry.list().map(t => ({
    name: t.name,
    description: t.description,
  }));
  return { tools };
});

handlers.set('tools.invoke', async (req, ctx) => {
  const params = req.params as { name?: string; input?: any } | undefined;
  if (!params?.name) {
    throw Object.assign(new Error('Missing tool name'), { code: 'INVALID_PARAMS' });
  }

  await hookSystem.dispatch('before_tool_call', {
    toolName: params.name,
    toolInput: params.input,
    userId: ctx.userId,
  });

  const result = await toolRegistry.execute(params.name, params.input || {}, {
    userId: ctx.userId,
    chatId: '',
    runId: `ws-${Date.now()}`,
  });

  await hookSystem.dispatch('after_tool_call', {
    toolName: params.name,
    toolResult: result,
    userId: ctx.userId,
  });

  return result;
});

handlers.set('skills.list', async () => {
  const skills = skillRegistry.list().map(skill => ({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    tools: skill.tools || [],
    source: skill.source || 'builtin',
    status: skill.status || 'ready',
    filePath: skill.filePath,
    updatedAt: skill.updatedAt,
  }));
  return {
    skills,
    total: skills.length,
    ready: skills.filter(s => s.status === 'ready').length,
    needsSetup: skills.filter(s => s.status === 'needs_setup').length,
  };
});

handlers.set('skills.reload', async () => {
  const { getOpenClawConfig } = await import('../config');
  const { initSkills } = await import('../skills/skillLoader');
  const config = getOpenClawConfig();
  await initSkills(config);
  return {
    reloaded: true,
    count: skillRegistry.list().length,
  };
});

handlers.set('skills.prompt', async (req) => {
  const params = req.params as { skillIds?: string[] } | undefined;
  const resolved = skillRegistry.resolve(params?.skillIds);
  return {
    prompt: resolved.prompt,
    tools: resolved.tools,
    skills: resolved.skills.map(skill => ({
      id: skill.id,
      name: skill.name,
      source: skill.source || 'builtin',
    })),
  };
});

handlers.set('skills.resolve', async (req) => {
  const params = req.params as { skillIds?: string[] } | undefined;
  const selectedIds = Array.isArray(params?.skillIds)
    ? params?.skillIds.map(id => String(id).trim()).filter(Boolean)
    : undefined;
  const resolved = skillRegistry.resolve(selectedIds);
  return {
    prompt: resolved.prompt,
    tools: resolved.tools,
    count: resolved.skills.length,
    skills: resolved.skills.map(skill => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      tools: skill.tools || [],
      source: skill.source || 'builtin',
      filePath: skill.filePath,
    })),
  };
});

handlers.set('subagents.spawn', async (req, ctx) => {
  const params = req.params as {
    objective?: string;
    planHint?: string[];
    parentRunId?: string;
    chatId?: string;
  } | undefined;

  const objective = params?.objective?.trim();
  if (!objective) {
    throw Object.assign(new Error('Missing subagent objective'), { code: 'INVALID_PARAMS' });
  }

  const run = await openclawSubagentService.spawn({
    requesterUserId: ctx.userId,
    chatId: params?.chatId || params?.parentRunId || 'openclaw-gateway',
    objective,
    planHint: Array.isArray(params?.planHint)
      ? params?.planHint.map(step => String(step).trim()).filter(Boolean)
      : [],
    parentRunId: params?.parentRunId,
    permissionProfile: 'full_agent',
  });

  return run;
});

handlers.set('subagents.list', async (req, ctx) => {
  const params = req.params as { parentRunId?: string; chatId?: string; status?: any; limit?: number } | undefined;
  const runs = await openclawSubagentService.list({
    requesterUserId: ctx.userId,
    chatId: params?.chatId,
    parentRunId: params?.parentRunId,
    status: params?.status,
    limit: params?.limit,
  });
  return { runs };
});

handlers.set('subagents.get', async (req, ctx) => {
  const params = req.params as { runId?: string } | undefined;
  if (!params?.runId) {
    throw Object.assign(new Error('Missing runId'), { code: 'INVALID_PARAMS' });
  }
  const run = await openclawSubagentService.get(params.runId);
  if (!run || run.requesterUserId !== ctx.userId) {
    throw Object.assign(new Error('Subagent run not found'), { code: 'NOT_FOUND' });
  }
  return run;
});

handlers.set('subagents.cancel', async (req, ctx) => {
  const params = req.params as { runId?: string } | undefined;
  if (!params?.runId) {
    throw Object.assign(new Error('Missing runId'), { code: 'INVALID_PARAMS' });
  }
  const run = await openclawSubagentService.get(params.runId);
  if (!run || run.requesterUserId !== ctx.userId) {
    throw Object.assign(new Error('Subagent run not found'), { code: 'NOT_FOUND' });
  }
  const cancelled = await openclawSubagentService.cancel(params.runId);
  return { runId: params.runId, cancelled };
});

handlers.set('rag.search', async (req, ctx) => {
  const params = req.params as {
    query?: string;
    limit?: number;
    chatId?: string;
    minScore?: number;
  } | undefined;

  const query = params?.query?.trim();
  if (!query) {
    throw Object.assign(new Error('Missing query'), { code: 'INVALID_PARAMS' });
  }

  const { RAGService } = await import('../../services/ragService');
  const ragService = new RAGService();
  const results = await ragService.search(ctx.userId, query, {
    limit: params?.limit,
    chatId: params?.chatId,
    minScore: params?.minScore,
  });
  return { results };
});

handlers.set('rag.context', async (req, ctx) => {
  const params = req.params as { message?: string; currentChatId?: string } | undefined;
  const message = params?.message?.trim();
  if (!message) {
    throw Object.assign(new Error('Missing message'), { code: 'INVALID_PARAMS' });
  }

  const { RAGService } = await import('../../services/ragService');
  const ragService = new RAGService();
  const contextBlock = await ragService.getContextForMessage(ctx.userId, message, params?.currentChatId);
  return { context: contextBlock };
});

handlers.set('orchestrator.plan', async (req) => {
  const params = req.params as { objective?: string; complexity?: number } | undefined;
  const objective = params?.objective?.trim();
  if (!objective) {
    throw Object.assign(new Error('Missing objective'), { code: 'INVALID_PARAMS' });
  }
  const complexity = Number.isFinite(Number(params?.complexity))
    ? Number(params?.complexity)
    : Math.min(10, Math.max(1, Math.ceil(objective.length / 120)));

  const { orchestrationEngine } = await import('../../services/orchestrationEngine');
  const subtasks = await orchestrationEngine.decomposeTask(objective, complexity);
  const plan = orchestrationEngine.buildExecutionPlan(subtasks);
  return { subtasks, plan };
});

handlers.set('orchestrator.run', async (req) => {
  const params = req.params as { objective?: string; complexity?: number } | undefined;
  const objective = params?.objective?.trim();
  if (!objective) {
    throw Object.assign(new Error('Missing objective'), { code: 'INVALID_PARAMS' });
  }
  const complexity = Number.isFinite(Number(params?.complexity))
    ? Number(params?.complexity)
    : Math.min(10, Math.max(1, Math.ceil(objective.length / 120)));

  const { orchestrationEngine } = await import('../../services/orchestrationEngine');
  const subtasks = await orchestrationEngine.decomposeTask(objective, complexity);
  const plan = orchestrationEngine.buildExecutionPlan(subtasks);
  const execution = await orchestrationEngine.executeParallel(plan);
  return {
    subtasks,
    plan,
    execution,
    combined: orchestrationEngine.combineResults(execution),
  };
});

export function registerRpcHandler(method: string, handler: RpcHandler): void {
  handlers.set(method, handler);
}

export async function handleRpc(
  req: WsRequest,
  ctx: { userId: string },
): Promise<any> {
  const handler = handlers.get(req.method);
  if (!handler) {
    return createErrorResponse(req.id, 'METHOD_NOT_FOUND', `Unknown method: ${req.method}`);
  }

  try {
    const result = await handler(req, ctx);
    return createResponse(req.id, result);
  } catch (err: any) {
    if (err.code === 'INVALID_PARAMS') {
      return createErrorResponse(req.id, 'INVALID_PARAMS', err.message);
    }
    if (err.code === 'NOT_FOUND') {
      return createErrorResponse(req.id, 'NOT_FOUND', err.message);
    }
    return createErrorResponse(req.id, 'INTERNAL_ERROR', err.message || 'Internal error');
  }
}
