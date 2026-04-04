/**
 * BackgroundTaskManager
 *
 * Manages long-running tasks spawned from agent tool calls or the API.
 *
 * Features:
 *   - Spawn tasks that run independently of the chat session
 *   - In-memory task store + Redis persistence (survives restarts if Redis is up)
 *   - Task status polling and SSE streaming
 *   - Cancel / timeout / resource limiting
 *   - Parent→child task hierarchy
 *   - EventEmitter for real-time status updates
 */

import { EventEmitter } from 'events';
import { randomUUID }   from 'crypto';
import { z }            from 'zod';
import { Logger }       from '../lib/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export const TaskStatusSchema = z.enum([
  'queued', 'running', 'completed', 'failed', 'cancelled', 'timeout',
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskPrioritySchema = z.enum(['low', 'normal', 'high', 'critical']);
export type TaskPriority = z.infer<typeof TaskPrioritySchema>;

export interface TaskRecord {
  id           : string;
  userId       : string;
  chatId       : string;
  parentRunId? : string;
  objective    : string;
  instructions?: string;
  allowedTools?: string[];
  status       : TaskStatus;
  priority     : TaskPriority;
  createdAt    : number;
  startedAt?   : number;
  endedAt?     : number;
  result?      : unknown;
  error?       : string;
  output       : string;      // Accumulated stdout-like output
  progress?    : number;      // 0–100
  steps        : TaskStep[];
  metadata?    : Record<string, unknown>;
}

export interface TaskStep {
  index     : number;
  type      : 'tool_call' | 'llm_turn' | 'checkpoint' | 'message';
  summary   : string;
  timestamp : number;
  durationMs: number;
  success   : boolean;
}

export interface SpawnTaskParams {
  userId       : string;
  chatId       : string;
  objective    : string;
  instructions?: string;
  allowedTools?: string[];
  parentRunId? : string;
  priority?    : TaskPriority;
  timeoutMs?   : number;
  metadata?    : Record<string, unknown>;
}

// ─── Task event types ─────────────────────────────────────────────────────────

export type TaskEvent =
  | { type: 'status_change'; taskId: string; status: TaskStatus }
  | { type: 'output_chunk';  taskId: string; chunk: string }
  | { type: 'step';          taskId: string; step: TaskStep }
  | { type: 'progress';      taskId: string; progress: number }
  | { type: 'done';          taskId: string; result: unknown };

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const MAX_TASKS_IN_MEMORY = 2000;
const REDIS_TTL_SECONDS   = 86400 * 7;    // 7 days
const REDIS_KEY_PREFIX    = 'ilia:task:';

// ─── BackgroundTaskManager ────────────────────────────────────────────────────

export class BackgroundTaskManager extends EventEmitter {
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly aborts = new Map<string, AbortController>();

  // ── Spawn ───────────────────────────────────────────────────────────────────

  async spawn(params: SpawnTaskParams): Promise<TaskRecord> {
    this.evictIfNeeded();

    const task: TaskRecord = {
      id          : `task_${randomUUID()}`,
      userId      : params.userId,
      chatId      : params.chatId,
      parentRunId : params.parentRunId,
      objective   : params.objective,
      instructions: params.instructions,
      allowedTools: params.allowedTools,
      status      : 'queued',
      priority    : params.priority    ?? 'normal',
      createdAt   : Date.now(),
      output      : '',
      steps       : [],
      metadata    : params.metadata,
    };

    this.tasks.set(task.id, task);
    await this._persist(task);

    Logger.info('[TaskManager] spawned', { id: task.id, objective: params.objective.slice(0, 60) });

    // Execute async (detached)
    const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    void this._executeTask(task, timeoutMs);

    return task;
  }

  // ── Query ────────────────────────────────────────────────────────────────────

  get(id: string): TaskRecord | undefined {
    return this.tasks.get(id);
  }

  async getOrFetch(id: string): Promise<TaskRecord | undefined> {
    if (this.tasks.has(id)) return this.tasks.get(id);
    return this._loadFromRedis(id);
  }

  list(params: {
    userId?     : string;
    chatId?     : string;
    status?     : TaskStatus;
    parentRunId?: string;
    limit?      : number;
    offset?     : number;
  } = {}): TaskRecord[] {
    const { userId, chatId, status, parentRunId, limit = 50, offset = 0 } = params;
    return [...this.tasks.values()]
      .filter(t => (!userId     || t.userId     === userId))
      .filter(t => (!chatId     || t.chatId     === chatId))
      .filter(t => (!status     || t.status     === status))
      .filter(t => (!parentRunId || t.parentRunId === parentRunId))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(offset, offset + limit);
  }

  // ── Control ──────────────────────────────────────────────────────────────────

  cancel(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;
    if (task.status !== 'queued' && task.status !== 'running') return false;

    const ctrl = this.aborts.get(id);
    ctrl?.abort();

    this._updateStatus(task, 'cancelled');
    Logger.info('[TaskManager] cancelled', { id });
    return true;
  }

  // ── Append output (called by TaskExecutor) ───────────────────────────────────

  appendOutput(id: string, chunk: string): void {
    const task = this.tasks.get(id);
    if (!task) return;
    task.output += chunk;
    if (task.output.length > 500_000) {
      // Trim to last 400k chars
      task.output = '...[truncated]...\n' + task.output.slice(-400_000);
    }
    this.emit('task:event', { type: 'output_chunk', taskId: id, chunk } satisfies TaskEvent);
  }

  addStep(id: string, step: TaskStep): void {
    const task = this.tasks.get(id);
    if (!task) return;
    task.steps.push(step);
    this.emit('task:event', { type: 'step', taskId: id, step } satisfies TaskEvent);
  }

  setProgress(id: string, progress: number): void {
    const task = this.tasks.get(id);
    if (!task) return;
    task.progress = Math.max(0, Math.min(100, progress));
    this.emit('task:event', { type: 'progress', taskId: id, progress: task.progress } satisfies TaskEvent);
  }

  // ── Execution ────────────────────────────────────────────────────────────────

  private async _executeTask(task: TaskRecord, timeoutMs: number): Promise<void> {
    const ctrl = new AbortController();
    this.aborts.set(task.id, ctrl);

    const timer = setTimeout(() => {
      ctrl.abort();
      this._updateStatus(task, 'timeout');
      task.error = `Timed out after ${timeoutMs}ms`;
      Logger.warn('[TaskManager] task timed out', { id: task.id });
    }, timeoutMs);

    this._updateStatus(task, 'running');
    task.startedAt = Date.now();

    try {
      const { taskExecutor } = await import('./TaskExecutor');
      const result = await taskExecutor.execute(task, {
        signal      : ctrl.signal,
        onOutput    : chunk => this.appendOutput(task.id, chunk),
        onStep      : step  => this.addStep(task.id, step),
        onProgress  : pct   => this.setProgress(task.id, pct),
      });

      clearTimeout(timer);
      if (!ctrl.signal.aborted) {
        task.result  = result;
        task.endedAt = Date.now();
        this._updateStatus(task, 'completed');
        this.emit('task:event', { type: 'done', taskId: task.id, result } satisfies TaskEvent);
        Logger.info('[TaskManager] task completed', { id: task.id, durationMs: task.endedAt - task.startedAt! });
      }
    } catch (err) {
      clearTimeout(timer);
      if (!ctrl.signal.aborted) {
        task.error   = err instanceof Error ? err.message : String(err);
        task.endedAt = Date.now();
        this._updateStatus(task, 'failed');
        Logger.error('[TaskManager] task failed', { id: task.id, error: task.error });
      }
    } finally {
      this.aborts.delete(task.id);
      await this._persist(task);
    }
  }

  // ── State helpers ────────────────────────────────────────────────────────────

  private _updateStatus(task: TaskRecord, status: TaskStatus): void {
    task.status = status;
    this.emit('task:event', { type: 'status_change', taskId: task.id, status } satisfies TaskEvent);
  }

  // ── Persistence ──────────────────────────────────────────────────────────────

  private async _persist(task: TaskRecord): Promise<void> {
    try {
      const { redis } = await import('../lib/redis');
      await redis.set(
        `${REDIS_KEY_PREFIX}${task.id}`,
        JSON.stringify(task),
        'EX',
        REDIS_TTL_SECONDS,
      );
    } catch {
      // Redis unavailable — in-memory only is fine for dev
    }
  }

  private async _loadFromRedis(id: string): Promise<TaskRecord | undefined> {
    try {
      const { redis } = await import('../lib/redis');
      const raw = await redis.get(`${REDIS_KEY_PREFIX}${id}`);
      if (!raw) return undefined;
      const task = JSON.parse(raw) as TaskRecord;
      this.tasks.set(id, task); // warm in-memory cache
      return task;
    } catch {
      return undefined;
    }
  }

  /** Subscribe to real-time events for a specific task. Returns unsubscribe fn. */
  subscribeToTask(taskId: string, handler: (event: TaskEvent) => void): () => void {
    const listener = (event: TaskEvent) => {
      if (event.taskId === taskId) handler(event);
    };
    this.on('task:event', listener);
    return () => this.off('task:event', listener);
  }

  /** Returns running + queued count. */
  stats(): { total: number; running: number; queued: number; completed: number; failed: number } {
    const arr = [...this.tasks.values()];
    return {
      total    : arr.length,
      running  : arr.filter(t => t.status === 'running').length,
      queued   : arr.filter(t => t.status === 'queued').length,
      completed: arr.filter(t => t.status === 'completed').length,
      failed   : arr.filter(t => t.status === 'failed').length,
    };
  }

  // ── Memory management ────────────────────────────────────────────────────────

  private evictIfNeeded(): void {
    if (this.tasks.size < MAX_TASKS_IN_MEMORY) return;
    // Evict oldest completed/failed tasks
    const evictable = [...this.tasks.values()]
      .filter(t => t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled')
      .sort((a, b) => a.createdAt - b.createdAt);
    for (const t of evictable.slice(0, 200)) {
      this.tasks.delete(t.id);
    }
  }
}

export const backgroundTaskManager = new BackgroundTaskManager();
