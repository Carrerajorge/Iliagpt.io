/**
 * agenticChatRouter
 *
 * REST + SSE API for the full agentic loop.
 *
 * Routes:
 *   POST   /api/agentic/chat/stream       — Full agent loop, SSE stream
 *   POST   /api/agentic/task              — Spawn background task, returns taskId
 *   GET    /api/agentic/task/:id          — Get task status + result
 *   GET    /api/agentic/tasks             — List tasks for current user
 *   GET    /api/agentic/task/:id/stream   — SSE stream of task output
 *   DELETE /api/agentic/task/:id          — Cancel task
 *   GET    /api/agentic/tools             — List available tools
 *   POST   /api/agentic/tools/invoke      — Invoke a single tool directly
 *
 * SSE event format (NDJSON):
 *   data: {"type":"...", ...}\n\n
 */

import { Router, type Request, type Response } from 'express';
import { randomUUID }                           from 'crypto';
import { z }                                    from 'zod';
import { Logger }                               from '../lib/logger';
import { backgroundTaskManager }                from '../tasks/BackgroundTaskManager';
import { createUnifiedRun }                     from '../agent/unifiedChatHandler';
import { streamAgentRuntime }                   from '../agent/runtime/agentRuntimeFacade';
import { toolRegistry }                         from '../agent/toolRegistry';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getUserId(req: Request): string {
  return (req as { user?: { claims?: { sub?: string } } }).user?.claims?.sub ?? 'anonymous';
}

function sendSse(res: Response, event: Record<string, unknown>): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function sseHeaders(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
}

type AgenticMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

/** Parse messages array from request body into AgenticMessage[] */
function parseMessages(raw: unknown): AgenticMessage[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Array<Record<string, unknown>>).map(m => ({
    role   : ((m['role'] as string) ?? 'user') as AgenticMessage['role'],
    content: (m['content'] as string) ?? '',
  }));
}

// ─── Request schemas ──────────────────────────────────────────────────────────

const ChatStreamSchema = z.object({
  messages      : z.array(z.object({
    role   : z.enum(['user', 'assistant', 'system']),
    content: z.string(),
  })).min(1),
  model         : z.string().optional(),
  systemPrompt  : z.string().optional(),
  maxTurns      : z.number().int().min(1).max(30).optional(),
  temperature   : z.number().min(0).max(2).optional(),
  allowedTools  : z.array(z.string()).optional(),
  chatId        : z.string().optional(),
});

const SpawnTaskSchema = z.object({
  objective    : z.string().min(1),
  instructions : z.string().optional(),
  allowedTools : z.array(z.string()).optional(),
  priority     : z.enum(['low', 'normal', 'high', 'critical']).optional(),
  timeoutMs    : z.number().int().min(1000).max(3_600_000).optional(),
  chatId       : z.string().optional(),
});

const InvokeToolSchema = z.object({
  toolName: z.string().min(1),
  input   : z.record(z.unknown()).optional(),
});

// ─── Router factory ───────────────────────────────────────────────────────────

export function createAgenticChatRouter(): Router {
  const router = Router();

  // ── POST /api/agentic/chat/stream ──────────────────────────────────────────
  // Full agent loop over SSE. Client reads event-stream.

  router.post('/chat/stream', async (req: Request, res: Response) => {
    const parsed = ChatStreamSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
    }

    const userId  = getUserId(req);
    const runId   = randomUUID();
    const { messages, model, systemPrompt, maxTurns, temperature, allowedTools, chatId } = parsed.data;
    const effectiveChatId = chatId ?? `agentic-${runId}`;

    sseHeaders(res);
    sendSse(res, {
      type: 'run_start',
      runId,
      model: model ?? 'auto',
      chatId: effectiveChatId,
    });

    try {
      const initialMessages = parseMessages(messages);
      const agentMessages = systemPrompt
        ? [{ role: 'system' as const, content: systemPrompt }, ...initialMessages]
        : initialMessages;

      const unifiedContext = await createUnifiedRun({
        messages: agentMessages,
        chatId: effectiveChatId,
        userId,
        runId,
        latencyMode: 'deep',
      });

      const executionMode =
        unifiedContext.executionMode === 'conversation'
          ? 'direct_agent_loop'
          : unifiedContext.executionMode;

      if (allowedTools?.length) {
        sendSse(res, {
          type: 'thinking_delta',
          runId,
          thinking: `Restriccion de tools recibida (${allowedTools.length}). El runtime principal aplicara su politica server-side.`,
          metadata: {
            allowedTools,
            executionMode,
          },
        });
      }

      const result = await streamAgentRuntime({
        res,
        runId,
        userId,
        chatId: effectiveChatId,
        requestSpec: unifiedContext.requestSpec,
        executionMode,
        initialMessages: agentMessages,
        maxIterations: maxTurns,
        model,
        transport: 'agentic_json',
      });

      sendSse(res, {
        type: 'run_complete',
        runId,
        finalAnswer: result.finalAnswer,
        executionMode,
        status: result.status,
        temperature,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      Logger.error('[AgenticRouter] stream error', { runId, error: msg });
      sendSse(res, { type: 'error', message: msg });
    } finally {
      res.end();
    }
  });

  // ── POST /api/agentic/task ─────────────────────────────────────────────────
  // Spawn a background task.

  router.post('/task', async (req: Request, res: Response) => {
    const parsed = SpawnTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
    }

    const userId = getUserId(req);
    try {
      const task = await backgroundTaskManager.spawn({
        userId,
        chatId      : parsed.data.chatId ?? '',
        objective   : parsed.data.objective,
        instructions: parsed.data.instructions,
        allowedTools: parsed.data.allowedTools,
        priority    : parsed.data.priority,
        timeoutMs   : parsed.data.timeoutMs,
      });

      res.json({
        taskId   : task.id,
        status   : task.status,
        createdAt: task.createdAt,
      });
    } catch (err) {
      Logger.error('[AgenticRouter] spawn task error', { error: (err as Error).message });
      res.status(500).json({ error: 'Failed to spawn task' });
    }
  });

  // ── GET /api/agentic/task/:id ──────────────────────────────────────────────

  router.get('/task/:id', async (req: Request, res: Response) => {
    const userId = getUserId(req);
    const task   = await backgroundTaskManager.getOrFetch(req.params['id']!);

    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (task.userId !== userId && userId !== 'anonymous') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.json(task);
  });

  // ── GET /api/agentic/tasks ─────────────────────────────────────────────────

  router.get('/tasks', (req: Request, res: Response) => {
    const userId = getUserId(req);
    const status = req.query['status'] as string | undefined;
    const chatId = req.query['chatId'] as string | undefined;
    const limit  = parseInt(req.query['limit'] as string ?? '20', 10);
    const offset = parseInt(req.query['offset'] as string ?? '0', 10);

    const tasks = backgroundTaskManager.list({
      userId,
      chatId,
      status : status as Parameters<typeof backgroundTaskManager.list>[0]['status'],
      limit,
      offset,
    });

    res.json({ tasks, total: tasks.length, limit, offset });
  });

  // ── GET /api/agentic/task/:id/stream ──────────────────────────────────────
  // SSE stream for a running task.

  router.get('/task/:id/stream', async (req: Request, res: Response) => {
    const userId = getUserId(req);
    const taskId = req.params['id']!;
    const task   = await backgroundTaskManager.getOrFetch(taskId);

    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (task.userId !== userId && userId !== 'anonymous') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    sseHeaders(res);

    // Send existing output first
    if (task.output) {
      sendSse(res, { type: 'output_chunk', taskId, chunk: task.output });
    }
    sendSse(res, { type: 'status', taskId, status: task.status, progress: task.progress ?? 0 });

    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
      sendSse(res, { type: 'done', taskId, result: task.result, error: task.error });
      res.end();
      return;
    }

    // Subscribe to live events
    const unsub = backgroundTaskManager.subscribeToTask(taskId, event => {
      sendSse(res, event as Record<string, unknown>);
      if (event.type === 'done' || event.type === 'status_change') {
        const s = (event as { type: string; status?: string }).status;
        if (s === 'completed' || s === 'failed' || s === 'cancelled' || event.type === 'done') {
          res.end();
          unsub();
        }
      }
    });

    req.on('close', () => unsub());
  });

  // ── DELETE /api/agentic/task/:id ───────────────────────────────────────────

  router.delete('/task/:id', async (req: Request, res: Response) => {
    const userId = getUserId(req);
    const task   = await backgroundTaskManager.getOrFetch(req.params['id']!);

    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (task.userId !== userId && userId !== 'anonymous') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const cancelled = backgroundTaskManager.cancel(req.params['id']!);
    res.json({ cancelled, taskId: req.params['id'] });
  });

  // ── GET /api/agentic/tools ─────────────────────────────────────────────────

  router.get('/tools', (_req: Request, res: Response) => {
    const tools = toolRegistry.list().map(t => ({
      name       : t.name,
      description: t.description,
      safetyPolicy: t.safetyPolicy ?? 'safe',
      capabilities: t.capabilities ?? [],
    }));
    res.json({ tools });
  });

  // ── POST /api/agentic/tools/invoke ─────────────────────────────────────────

  router.post('/tools/invoke', async (req: Request, res: Response) => {
    const parsed = InvokeToolSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
    }

    const userId = getUserId(req);
    const { toolName, input } = parsed.data;

    if (!toolRegistry.get(toolName)) {
      return res.status(404).json({ error: `Tool '${toolName}' not found` });
    }

    try {
      const result = await toolRegistry.execute(toolName, input ?? {}, {
        userId,
        chatId: '',
        runId: randomUUID(),
        userPlan: 'free',
      });

      res.json(result);
    } catch (err) {
      Logger.error('[AgenticRouter] tool invoke error', { toolName, error: (err as Error).message });
      res.status(500).json({ error: 'Tool execution failed' });
    }
  });

  // ── GET /api/agentic/stats ─────────────────────────────────────────────────

  router.get('/stats', (_req: Request, res: Response) => {
    const tools = toolRegistry.list();
    const bySafetyPolicy = Object.fromEntries(
      (['safe', 'requires_confirmation', 'dangerous'] as const).map((policy) => [
        policy,
        tools.filter((tool) => (tool.safetyPolicy ?? 'safe') === policy).length,
      ]),
    );

    res.json({
      tasks: backgroundTaskManager.stats(),
      tools: {
        total: tools.length,
        bySafetyPolicy,
      },
    });
  });

  return router;
}
