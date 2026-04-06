/**
 * TaskExecutor
 *
 * Executes individual background tasks by running the AgenticLoop with
 * appropriate tool permissions and resource constraints.
 *
 * Features:
 *   - Per-task tool permission scoping
 *   - Output streaming to BackgroundTaskManager
 *   - Step recording (tool calls, turns)
 *   - Checkpoint / resume support (checkpoints saved to Redis)
 *   - CPU/memory soft limits (via process monitoring)
 *   - Structured result extraction
 */

import path             from 'path';
import os               from 'os';
import { randomUUID }   from 'crypto';
import { Logger }       from '../lib/logger';
import type { TaskRecord, TaskStep } from './BackgroundTaskManager';
import type { AgentMessage }         from '../agentic/toolCalling/UniversalToolCaller';
import type { AgenticEvent }         from '../agentic/core/AgenticLoop';
import {
  ToolRegistry,
  FULL_AGENT_PROFILE,
  SAFE_CODING_PROFILE,
  PERMISSIVE_PROFILE,
  READ_ONLY_PROFILE,
} from '../agentic/toolCalling/ToolRegistry';
import { BUILT_IN_TOOLS }           from '../agentic/toolCalling/BuiltInTools';
import { resolveModel }             from '../integration/modelWiring';

// ─── Executor options ─────────────────────────────────────────────────────────

export interface ExecutorOptions {
  signal?    : AbortSignal;
  onOutput?  : (chunk: string) => void;
  onStep?    : (step: TaskStep) => void;
  onProgress?: (pct: number) => void;
}

// ─── Checkpoint storage ───────────────────────────────────────────────────────

interface TaskCheckpoint {
  taskId      : string;
  turn        : number;
  conversation: AgentMessage[];
  savedAt     : number;
}

async function saveCheckpoint(cp: TaskCheckpoint): Promise<void> {
  try {
    const { redis } = await import('../lib/redis');
    await redis.set(
      `ilia:task:checkpoint:${cp.taskId}`,
      JSON.stringify(cp),
      'EX',
      3600, // 1 hour
    );
  } catch { /* non-fatal */ }
}

async function loadCheckpoint(taskId: string): Promise<TaskCheckpoint | null> {
  try {
    const { redis } = await import('../lib/redis');
    const raw = await redis.get(`ilia:task:checkpoint:${taskId}`);
    if (!raw) return null;
    return JSON.parse(raw) as TaskCheckpoint;
  } catch {
    return null;
  }
}

async function clearCheckpoint(taskId: string): Promise<void> {
  try {
    const { redis } = await import('../lib/redis');
    await redis.del(`ilia:task:checkpoint:${taskId}`);
  } catch { /* non-fatal */ }
}

// ─── Permission scoping ───────────────────────────────────────────────────────

type TaskPermissionProfile = 'read_only' | 'safe_coding' | 'full_agent' | 'permissive';

function resolveTaskPermissionProfile(task: TaskRecord): TaskPermissionProfile {
  const raw = typeof task.metadata?.['permissionProfile'] === 'string'
    ? String(task.metadata?.['permissionProfile']).trim().toLowerCase()
    : '';

  switch (raw) {
    case 'read_only':
    case 'readonly':
    case 'read-only':
      return 'read_only';
    case 'full':
    case 'full_agent':
    case 'agent_full':
      return 'full_agent';
    case 'permissive':
      return 'permissive';
    case 'safe':
    case 'safe_coding':
    case 'coding':
      return 'safe_coding';
    default:
      return 'safe_coding';
  }
}

function buildRegistry(task: TaskRecord): ToolRegistry {
  const registry = new ToolRegistry();
  registry.registerMany(BUILT_IN_TOOLS);

  if (task.allowedTools && task.allowedTools.length > 0) {
    // Only allow explicitly specified tools
    const allowed = new Set(task.allowedTools);
    registry.setProfile({
      allowedCategories: undefined,
      deniedTools: BUILT_IN_TOOLS
        .map(t => t.name)
        .filter(name => !allowed.has(name)),
    });
  } else {
    const permissionProfile = resolveTaskPermissionProfile(task);

    switch (permissionProfile) {
      case 'read_only':
        registry.setProfile(READ_ONLY_PROFILE);
        break;
      case 'full_agent':
        registry.setProfile(FULL_AGENT_PROFILE);
        break;
      case 'permissive':
        registry.setProfile(PERMISSIVE_PROFILE);
        break;
      case 'safe_coding':
      default:
        // Default: safe coding profile (no shell, no agent spawn)
        registry.setProfile(SAFE_CODING_PROFILE);
        break;
    }
  }

  return registry;
}

// ─── System prompt for background tasks ──────────────────────────────────────

function buildTaskSystemPrompt(task: TaskRecord): string {
  const lines = [
    `You are an autonomous AI agent executing a background task.`,
    ``,
    `# Task Objective`,
    task.objective,
  ];

  if (task.instructions) {
    lines.push(``, `# Instructions`, task.instructions);
  }

  lines.push(
    ``,
    `# Guidelines`,
    `- Work methodically through the objective step by step.`,
    `- Use tools to gather information and take actions.`,
    `- After each major step, summarise what you did.`,
    `- If you encounter an error, try to recover or explain why you cannot.`,
    `- When finished, provide a clear FINAL ANSWER that summarises what was accomplished.`,
    `- Prefix your final answer with "FINAL ANSWER:"`,
  );

  return lines.join('\n');
}

function resolveTaskModel(task: TaskRecord): string {
  const metadataModel = typeof task.metadata?.['model'] === 'string'
    ? String(task.metadata?.['model']).trim()
    : '';
  if (metadataModel) {
    return resolveModel(metadataModel);
  }

  const envPreferredModel = typeof process.env['DEFAULT_AGENT_MODEL'] === 'string'
    ? process.env['DEFAULT_AGENT_MODEL'].trim()
    : '';
  if (envPreferredModel) {
    return resolveModel(envPreferredModel);
  }

  return resolveModel();
}

// ─── Resource monitor ─────────────────────────────────────────────────────────

class ResourceMonitor {
  private startMem: number;
  private readonly memLimitMb: number;

  constructor(memLimitMb = 512) {
    this.startMem   = process.memoryUsage().heapUsed;
    this.memLimitMb = memLimitMb;
  }

  check(): { ok: boolean; reason?: string } {
    const heapMb = process.memoryUsage().heapUsed / 1024 / 1024;
    if (heapMb > this.memLimitMb) {
      return { ok: false, reason: `Memory limit exceeded: ${heapMb.toFixed(0)} MB > ${this.memLimitMb} MB` };
    }
    return { ok: true };
  }
}

// ─── TaskExecutor ─────────────────────────────────────────────────────────────

export class TaskExecutor {
  /**
   * Execute a task record. Returns the final result/answer string.
   * Streams output, steps, and progress to the provided callbacks.
   */
  async execute(
    task: TaskRecord,
    opts: ExecutorOptions = {},
  ): Promise<string> {
    Logger.info('[TaskExecutor] starting', { id: task.id, objective: task.objective.slice(0, 60) });

    const registry  = buildRegistry(task);
    const workspace = path.join(
      os.tmpdir(),
      'ilia-tasks',
      task.id,
    );

    // Try to resume from checkpoint
    const checkpoint = await loadCheckpoint(task.id);
    if (checkpoint) {
      Logger.info('[TaskExecutor] resuming from checkpoint', { id: task.id, turn: checkpoint.turn });
      opts.onOutput?.(`[Resuming from checkpoint at turn ${checkpoint.turn}]\n`);
    }

    const systemPrompt  = buildTaskSystemPrompt(task);
    const executionModel = resolveTaskModel(task);
    const initialMessages: AgentMessage[] = checkpoint?.conversation ?? [
      { role: 'user', content: task.objective },
    ];
    let latestConversationSnapshot: AgentMessage[] = checkpoint?.conversation ?? initialMessages;

    let turnCount        = 0;
    let outputAcc        = '';
    const resourceMonitor = new ResourceMonitor();

    const { AgenticLoop } = await import('../agentic/core/AgenticLoop');
    const loop = new AgenticLoop();

    loop.on('event', (event: AgenticEvent) => {
      switch (event.type) {
        case 'content_delta': {
          outputAcc += event.delta;
          opts.onOutput?.(event.delta);
          break;
        }

        case 'tool_call': {
          const stepMsg = `[Tool: ${event.toolName}]`;
          opts.onOutput?.(stepMsg + '\n');
          break;
        }

        case 'tool_result': {
          const stepRecord: TaskStep = {
            index     : turnCount,
            type      : 'tool_call',
            summary   : `${event.toolName} → ${event.success ? 'ok' : 'failed'}`,
            timestamp : Date.now(),
            durationMs: event.durationMs,
            success   : event.success,
          };
          opts.onStep?.(stepRecord);
          const snippet = JSON.stringify(event.output).slice(0, 200);
          opts.onOutput?.(`[Result: ${snippet}]\n`);
          break;
        }

        case 'turn_start': {
          turnCount = event.turn;
          // Estimate progress: assume max 15 turns
          const pct = Math.min(95, Math.round((event.turn / 15) * 100));
          opts.onProgress?.(pct);

          // Check resources every turn
          const res = resourceMonitor.check();
          if (!res.ok) {
            Logger.warn('[TaskExecutor] resource limit hit', { id: task.id, reason: res.reason });
            opts.onOutput?.(`[Warning: ${res.reason}]\n`);
          }
          break;
        }

        case 'turn_end': {
          if (event.conversationSnapshot && event.conversationSnapshot.length > 0) {
            latestConversationSnapshot = event.conversationSnapshot;
            void saveCheckpoint({
              taskId      : task.id,
              turn        : event.turn,
              conversation: latestConversationSnapshot,
              savedAt     : Date.now(),
            });
          }

          const stepRecord: TaskStep = {
            index     : event.turn,
            type      : 'llm_turn',
            summary   : `Turn ${event.turn} — ${event.stopReason}`,
            timestamp : Date.now(),
            durationMs: 0,
            success   : true,
          };
          opts.onStep?.(stepRecord);
          break;
        }

        case 'error': {
          if (latestConversationSnapshot.length > 0) {
            void saveCheckpoint({
              taskId      : task.id,
              turn        : turnCount,
              conversation: latestConversationSnapshot,
              savedAt     : Date.now(),
            });
          }
          opts.onOutput?.(`[Error: ${event.message}]\n`);
          break;
        }
      }
    });

    const finalAnswer = await loop.run(initialMessages, {
      systemPrompt,
      model        : executionModel,
      maxTurns     : 20,
      maxTokens    : 4096,
      userId       : task.userId,
      chatId       : task.chatId,
      runId        : task.id,
      workspaceRoot: workspace,
      signal       : opts.signal,
      toolRegistry : registry,
    });

    opts.onProgress?.(100);
    await clearCheckpoint(task.id);

    Logger.info('[TaskExecutor] complete', { id: task.id, turns: turnCount });
    return finalAnswer;
  }
}

export const taskExecutor = new TaskExecutor();
export { resolveTaskModel };
