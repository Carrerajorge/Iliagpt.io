import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import pino from "pino";

const logger = pino({ name: "ParallelToolExecutor" });

// ─── Types ────────────────────────────────────────────────────────────────────

export type ToolExecutionStatus =
  | "pending"
  | "waiting"   // waiting for dependencies
  | "running"
  | "completed"
  | "failed"
  | "skipped"   // dependency failed and skipOnDependencyFailure = true
  | "cancelled";

export interface ToolTask {
  taskId: string;
  toolName: string;
  input: Record<string, unknown>;
  /** taskIds that must complete before this task can run */
  dependencies: string[];
  /** If true, skip this task (instead of failing) when a dependency fails */
  skipOnDependencyFailure: boolean;
  /** Max ms to wait before marking as failed */
  timeoutMs: number;
  /** Max retries on transient failure */
  maxRetries: number;
  retryCount: number;
  /** Priority — higher runs first when multiple tasks become ready */
  priority: number;
  metadata?: Record<string, unknown>;
}

export interface ToolExecutionResult {
  taskId: string;
  toolName: string;
  status: ToolExecutionStatus;
  result?: unknown;
  error?: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  retryCount: number;
  input: Record<string, unknown>;
}

export interface ExecutionPlan {
  planId: string;
  tasks: ToolTask[];
  /** Topologically sorted waves for parallel execution */
  waves: string[][];
  /** Total estimated time if all independent tasks run in parallel */
  estimatedParallelMs: number;
  /** Total estimated time if all tasks run sequentially */
  estimatedSequentialMs: number;
  /** Parallelism ratio */
  parallelismGain: number;
}

export interface ExecutionSession {
  sessionId: string;
  plan: ExecutionPlan;
  status: "running" | "completed" | "failed" | "cancelled";
  results: Map<string, ToolExecutionResult>;
  startedAt: number;
  completedAt?: number;
  failedTaskIds: string[];
  skippedTaskIds: string[];
}

export interface ExecutorOptions {
  maxConcurrentTasks?: number; // default 10
  defaultTimeoutMs?: number; // default 30_000
  defaultMaxRetries?: number; // default 2
  retryDelayMs?: number; // default 500
}

export type ToolHandler = (
  toolName: string,
  input: Record<string, unknown>,
  context: { taskId: string; sessionId: string; dependencyResults: Map<string, unknown> }
) => Promise<unknown>;

// ─── DAG analysis ─────────────────────────────────────────────────────────────

function buildExecutionWaves(tasks: ToolTask[]): {
  waves: string[][];
  hasCycle: boolean;
} {
  const taskIds = new Set(tasks.map((t) => t.taskId));
  const inDegree = new Map(tasks.map((t) => [t.taskId, 0]));
  const graph = new Map<string, string[]>(); // id → dependents

  for (const task of tasks) {
    if (!graph.has(task.taskId)) graph.set(task.taskId, []);
    for (const dep of task.dependencies) {
      if (!taskIds.has(dep)) {
        // Unknown dependency — treat as already satisfied
        continue;
      }
      if (!graph.has(dep)) graph.set(dep, []);
      graph.get(dep)!.push(task.taskId);
      inDegree.set(task.taskId, (inDegree.get(task.taskId) ?? 0) + 1);
    }
  }

  const waves: string[][] = [];
  const visited = new Set<string>();

  while (visited.size < tasks.length) {
    const wave = Array.from(inDegree.entries())
      .filter(([id, deg]) => deg === 0 && !visited.has(id))
      // Sort by priority (higher priority first)
      .sort(([idA], [idB]) => {
        const pA = tasks.find((t) => t.taskId === idA)?.priority ?? 0;
        const pB = tasks.find((t) => t.taskId === idB)?.priority ?? 0;
        return pB - pA;
      })
      .map(([id]) => id);

    if (wave.length === 0) {
      // Cycle detected
      return { waves, hasCycle: true };
    }

    waves.push(wave);
    for (const id of wave) {
      visited.add(id);
      for (const dep of graph.get(id) ?? []) {
        inDegree.set(dep, (inDegree.get(dep) ?? 1) - 1);
      }
    }
  }

  return { waves, hasCycle: false };
}

// ─── ParallelToolExecutor ─────────────────────────────────────────────────────

export class ParallelToolExecutor extends EventEmitter {
  private handlers = new Map<string, ToolHandler>();
  private sessions = new Map<string, ExecutionSession>();
  private activeSessions = new Set<string>();

  constructor(
    private readonly options: ExecutorOptions = {}
  ) {
    super();
    const {
      maxConcurrentTasks = 10,
      defaultTimeoutMs = 30_000,
      defaultMaxRetries = 2,
      retryDelayMs = 500,
    } = options;

    this.options = {
      maxConcurrentTasks,
      defaultTimeoutMs,
      defaultMaxRetries,
      retryDelayMs,
    };

    logger.info("[ParallelToolExecutor] Initialized");
  }

  // ── Handler registration ──────────────────────────────────────────────────────

  registerHandler(toolName: string, handler: ToolHandler): void {
    this.handlers.set(toolName, handler);
    logger.debug({ toolName }, "[ParallelToolExecutor] Handler registered");
  }

  registerHandlers(handlers: Record<string, ToolHandler>): void {
    for (const [name, handler] of Object.entries(handlers)) {
      this.registerHandler(name, handler);
    }
  }

  // ── Plan analysis ─────────────────────────────────────────────────────────────

  analyze(tasks: ToolTask[]): ExecutionPlan {
    const { waves, hasCycle } = buildExecutionWaves(tasks);

    if (hasCycle) {
      logger.warn(
        { tasks: tasks.length },
        "[ParallelToolExecutor] Circular dependency detected — some tasks may not run"
      );
    }

    // Estimate times (assume 1s per task as baseline)
    const avgTaskMs = 1_000;
    const estimatedParallelMs = waves.length * avgTaskMs;
    const estimatedSequentialMs = tasks.length * avgTaskMs;
    const parallelismGain =
      estimatedSequentialMs > 0
        ? estimatedSequentialMs / Math.max(estimatedParallelMs, 1)
        : 1;

    return {
      planId: randomUUID(),
      tasks,
      waves,
      estimatedParallelMs,
      estimatedSequentialMs,
      parallelismGain,
    };
  }

  // ── Execution ─────────────────────────────────────────────────────────────────

  async execute(
    tasks: ToolTask[],
    sessionId = randomUUID()
  ): Promise<ExecutionSession> {
    const plan = this.analyze(tasks);

    const session: ExecutionSession = {
      sessionId,
      plan,
      status: "running",
      results: new Map(),
      startedAt: Date.now(),
      failedTaskIds: [],
      skippedTaskIds: [],
    };

    this.sessions.set(sessionId, session);
    this.activeSessions.add(sessionId);

    logger.info(
      {
        sessionId,
        tasks: tasks.length,
        waves: plan.waves.length,
        parallelismGain: plan.parallelismGain.toFixed(1) + "x",
      },
      "[ParallelToolExecutor] Execution started"
    );

    this.emit("execution:started", { sessionId, taskCount: tasks.length });

    try {
      await this.runWaves(session, plan);

      session.status =
        session.failedTaskIds.length > 0 ? "failed" : "completed";
    } catch (err) {
      session.status = "failed";
      logger.error({ err, sessionId }, "[ParallelToolExecutor] Execution error");
    } finally {
      session.completedAt = Date.now();
      this.activeSessions.delete(sessionId);

      logger.info(
        {
          sessionId,
          status: session.status,
          completed: [...session.results.values()].filter((r) => r.status === "completed").length,
          failed: session.failedTaskIds.length,
          skipped: session.skippedTaskIds.length,
          durationMs: session.completedAt - session.startedAt,
        },
        "[ParallelToolExecutor] Execution finished"
      );

      this.emit("execution:finished", {
        sessionId,
        status: session.status,
        results: Object.fromEntries(session.results),
      });
    }

    return session;
  }

  private async runWaves(
    session: ExecutionSession,
    plan: ExecutionPlan
  ): Promise<void> {
    const taskMap = new Map(plan.tasks.map((t) => [t.taskId, t]));

    for (const wave of plan.waves) {
      if (session.status === "cancelled") break;

      // Filter out tasks that should be skipped due to failed deps
      const tasksToRun: ToolTask[] = [];
      for (const taskId of wave) {
        const task = taskMap.get(taskId);
        if (!task) continue;

        const hasFailed = task.dependencies.some((dep) =>
          session.failedTaskIds.includes(dep)
        );

        if (hasFailed) {
          if (task.skipOnDependencyFailure) {
            session.skippedTaskIds.push(taskId);
            session.results.set(taskId, this.buildSkippedResult(task));
            this.emit("task:skipped", { sessionId: session.sessionId, taskId });
          } else {
            const err = `Dependency failed: ${task.dependencies.find((d) => session.failedTaskIds.includes(d))}`;
            session.failedTaskIds.push(taskId);
            session.results.set(taskId, this.buildFailedResult(task, err));
            this.emit("task:failed", { sessionId: session.sessionId, taskId, error: err });
          }
          continue;
        }

        tasksToRun.push(task);
      }

      if (tasksToRun.length === 0) continue;

      this.emit("wave:started", {
        sessionId: session.sessionId,
        wave: plan.waves.indexOf(wave),
        taskCount: tasksToRun.length,
      });

      // Respect concurrency limit
      const maxConcurrent = this.options.maxConcurrentTasks ?? 10;
      const chunks = this.chunkArray(tasksToRun, maxConcurrent);

      for (const chunk of chunks) {
        const chunkResults = await Promise.allSettled(
          chunk.map((task) => this.runTask(task, session))
        );

        for (let i = 0; i < chunkResults.length; i++) {
          const settled = chunkResults[i];
          const task = chunk[i];

          if (settled.status === "rejected") {
            // Unexpected executor-level error
            const error = String(settled.reason);
            session.failedTaskIds.push(task.taskId);
            session.results.set(task.taskId, this.buildFailedResult(task, error));
            logger.error(
              { taskId: task.taskId, error },
              "[ParallelToolExecutor] Unexpected executor error"
            );
          }
          // Successful results are already stored inside runTask
        }
      }

      this.emit("wave:completed", {
        sessionId: session.sessionId,
        wave: plan.waves.indexOf(wave),
      });
    }
  }

  // ── Single task execution ─────────────────────────────────────────────────────

  private async runTask(
    task: ToolTask,
    session: ExecutionSession
  ): Promise<void> {
    const startedAt = Date.now();

    logger.debug(
      { taskId: task.taskId, tool: task.toolName },
      "[ParallelToolExecutor] Task started"
    );

    this.emit("task:started", {
      sessionId: session.sessionId,
      taskId: task.taskId,
      toolName: task.toolName,
    });

    const handler = this.handlers.get(task.toolName);

    if (!handler) {
      const error = `No handler registered for tool '${task.toolName}'`;
      session.failedTaskIds.push(task.taskId);
      session.results.set(
        task.taskId,
        this.buildFailedResult(task, error, startedAt)
      );
      this.emit("task:failed", {
        sessionId: session.sessionId,
        taskId: task.taskId,
        error,
      });
      return;
    }

    // Collect dependency results to pass as context
    const dependencyResults = new Map<string, unknown>();
    for (const depId of task.dependencies) {
      const depResult = session.results.get(depId);
      if (depResult?.result !== undefined) {
        dependencyResults.set(depId, depResult.result);
      }
    }

    let attempt = 0;
    const maxRetries =
      task.maxRetries ?? this.options.defaultMaxRetries ?? 2;

    while (attempt <= maxRetries) {
      try {
        const result = await this.withTimeout(
          handler(task.toolName, task.input, {
            taskId: task.taskId,
            sessionId: session.sessionId,
            dependencyResults,
          }),
          task.timeoutMs ?? this.options.defaultTimeoutMs ?? 30_000,
          task.taskId
        );

        const completedAt = Date.now();
        session.results.set(task.taskId, {
          taskId: task.taskId,
          toolName: task.toolName,
          status: "completed",
          result,
          startedAt,
          completedAt,
          durationMs: completedAt - startedAt,
          retryCount: attempt,
          input: task.input,
        });

        logger.debug(
          { taskId: task.taskId, durationMs: completedAt - startedAt },
          "[ParallelToolExecutor] Task completed"
        );

        this.emit("task:completed", {
          sessionId: session.sessionId,
          taskId: task.taskId,
          result,
        });
        return;
      } catch (err) {
        attempt++;
        const isTransient = this.isTransientError(err);

        if (attempt <= maxRetries && isTransient) {
          logger.warn(
            { taskId: task.taskId, attempt, error: String(err) },
            "[ParallelToolExecutor] Retrying task"
          );
          this.emit("task:retry", {
            sessionId: session.sessionId,
            taskId: task.taskId,
            attempt,
          });
          await this.delay(this.options.retryDelayMs ?? 500);
        } else {
          const error = String(err);
          session.failedTaskIds.push(task.taskId);
          session.results.set(
            task.taskId,
            this.buildFailedResult(task, error, startedAt)
          );

          logger.warn(
            { taskId: task.taskId, attempts: attempt, error },
            "[ParallelToolExecutor] Task failed"
          );

          this.emit("task:failed", {
            sessionId: session.sessionId,
            taskId: task.taskId,
            error,
          });
          return;
        }
      }
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    taskId: string
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Task '${taskId}' timed out after ${timeoutMs}ms`)),
        timeoutMs
      );
      promise.then(
        (value) => { clearTimeout(timer); resolve(value); },
        (err) => { clearTimeout(timer); reject(err); }
      );
    });
  }

  private isTransientError(err: unknown): boolean {
    const msg = String(err).toLowerCase();
    return (
      msg.includes("timeout") ||
      msg.includes("econnreset") ||
      msg.includes("econnrefused") ||
      msg.includes("rate limit") ||
      msg.includes("503") ||
      msg.includes("429")
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private chunkArray<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }

  private buildFailedResult(
    task: ToolTask,
    error: string,
    startedAt = Date.now()
  ): ToolExecutionResult {
    return {
      taskId: task.taskId,
      toolName: task.toolName,
      status: "failed",
      error,
      startedAt,
      completedAt: Date.now(),
      durationMs: Date.now() - startedAt,
      retryCount: task.retryCount,
      input: task.input,
    };
  }

  private buildSkippedResult(task: ToolTask): ToolExecutionResult {
    const now = Date.now();
    return {
      taskId: task.taskId,
      toolName: task.toolName,
      status: "skipped",
      startedAt: now,
      completedAt: now,
      durationMs: 0,
      retryCount: 0,
      input: task.input,
    };
  }

  // ── Session control ───────────────────────────────────────────────────────────

  cancelSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== "running") return;
    session.status = "cancelled";
    this.emit("execution:cancelled", { sessionId });
    logger.info({ sessionId }, "[ParallelToolExecutor] Session cancelled");
  }

  // ── Queries ───────────────────────────────────────────────────────────────────

  getSession(sessionId: string): ExecutionSession | null {
    return this.sessions.get(sessionId) ?? null;
  }

  getTaskResult(sessionId: string, taskId: string): ToolExecutionResult | null {
    return this.sessions.get(sessionId)?.results.get(taskId) ?? null;
  }

  getProgress(sessionId: string): {
    total: number;
    completed: number;
    failed: number;
    skipped: number;
    running: number;
    percentage: number;
  } | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const total = session.plan.tasks.length;
    const results = [...session.results.values()];
    const completed = results.filter((r) => r.status === "completed").length;
    const failed = results.filter((r) => r.status === "failed").length;
    const skipped = results.filter((r) => r.status === "skipped").length;
    const finished = completed + failed + skipped;

    return {
      total,
      completed,
      failed,
      skipped,
      running: Math.max(0, total - finished),
      percentage: total > 0 ? Math.round((finished / total) * 100) : 0,
    };
  }

  /** Build task array from tool_use blocks returned by ClaudeAgentBackbone */
  static buildTasksFromToolUse(
    toolUseBlocks: Array<{
      id: string;
      name: string;
      input: Record<string, unknown>;
    }>,
    dependencyMap: Record<string, string[]> = {},
    opts: Partial<ToolTask> = {}
  ): ToolTask[] {
    return toolUseBlocks.map((block) => ({
      taskId: block.id,
      toolName: block.name,
      input: block.input,
      dependencies: dependencyMap[block.id] ?? [],
      skipOnDependencyFailure: false,
      timeoutMs: 30_000,
      maxRetries: 2,
      retryCount: 0,
      priority: 0,
      ...opts,
    }));
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

let _instance: ParallelToolExecutor | null = null;

export function getParallelToolExecutor(
  opts?: ExecutorOptions
): ParallelToolExecutor {
  if (!_instance) _instance = new ParallelToolExecutor(opts);
  return _instance;
}
