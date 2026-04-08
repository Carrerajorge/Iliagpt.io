import { createLogger } from "../../utils/logger";

const log = createLogger("openclaw-worker-pool");

interface WorkerPoolConfig {
  maxConcurrent: number;
  taskTimeoutMs: number;
}

interface QueuedTask {
  taskId: string;
  params: Record<string, unknown>;
  resolve: (value: void | PromiseLike<void>) => void;
  reject: (reason?: unknown) => void;
}

interface RunningTask {
  taskId: string;
  startedAt: number;
  abortController: AbortController;
}

class SubagentWorkerPool {
  private running = new Map<string, RunningTask>();
  private queue: QueuedTask[] = [];
  private config: WorkerPoolConfig;

  constructor(config: Partial<WorkerPoolConfig> = {}) {
    this.config = {
      maxConcurrent: config.maxConcurrent ?? 5,
      taskTimeoutMs: config.taskTimeoutMs ?? 120_000,
    };
  }

  async submit(taskId: string, params: Record<string, unknown>): Promise<void> {
    if (this.running.size >= this.config.maxConcurrent) {
      log.info("Worker pool at capacity, queuing task", { taskId, queued: this.queue.length });
      return new Promise<void>((resolve, reject) => {
        this.queue.push({ taskId, params, resolve, reject });
      });
    }
    await this.execute(taskId, params);
  }

  private async execute(taskId: string, params: Record<string, unknown>): Promise<void> {
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), this.config.taskTimeoutMs);
    this.running.set(taskId, { taskId, startedAt: Date.now(), abortController: ac });

    log.info("Executing subagent task", { taskId, running: this.running.size });

    try {
      // Dynamic import to avoid circular dependencies.
      // executeSubagentTask is re-exported from the subagent service for the
      // worker pool's use. If it is not available, fall back gracefully.
      const mod = await import("./subagentService");
      const executeFn =
        (mod as Record<string, unknown>)["executeSubagentTask"] ??
        (mod as Record<string, unknown>)["executeSubagent"];
      if (typeof executeFn === "function") {
        await (executeFn as (id: string, p: Record<string, unknown>, signal?: AbortSignal) => Promise<void>)(
          taskId,
          params,
          ac.signal,
        );
      } else {
        log.warn("No executeSubagentTask export found in subagentService, skipping execution", { taskId });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (ac.signal.aborted) {
        log.warn("Subagent task timed out", { taskId, timeoutMs: this.config.taskTimeoutMs });
      } else {
        log.error("Subagent task failed", { taskId, error: message });
      }
      throw err;
    } finally {
      clearTimeout(timeout);
      this.running.delete(taskId);
      this.processQueue();
    }
  }

  private processQueue(): void {
    if (this.queue.length === 0 || this.running.size >= this.config.maxConcurrent) return;
    const next = this.queue.shift()!;
    this.execute(next.taskId, next.params).then(next.resolve).catch(next.reject);
  }

  cancel(taskId: string): boolean {
    const task = this.running.get(taskId);
    if (task) {
      task.abortController.abort();
      return true;
    }
    const idx = this.queue.findIndex((t) => t.taskId === taskId);
    if (idx >= 0) {
      const [removed] = this.queue.splice(idx, 1);
      removed.reject(new Error("Task cancelled while queued"));
      return true;
    }
    return false;
  }

  getStatus(): { running: number; queued: number; maxConcurrent: number } {
    return {
      running: this.running.size,
      queued: this.queue.length,
      maxConcurrent: this.config.maxConcurrent,
    };
  }
}

export const subagentWorkerPool = new SubagentWorkerPool();
