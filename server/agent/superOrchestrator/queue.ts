import { createQueue, createWorker, QUEUE_NAMES } from "../../lib/queueFactory";
import { EventEmitter } from "events";

const QUEUE_NAME = "super-orchestrator-tasks";

export interface OrchestratorJobData {
  runId: string;
  taskId: string;
  agentRole: string;
  input: any;
  retryCount: number;
  maxRetries: number;
  riskLevel: string;
  budgetLimitUsd?: number;
}

export interface OrchestratorJobResult {
  taskId: string;
  status: "completed" | "failed" | "approval_required";
  output?: any;
  error?: string;
  costUsd: number;
  durationMs: number;
  artifacts?: Array<{ name: string; type: string; content: any; sizeBytes: number }>;
}

export const orchestratorEvents = new EventEmitter();
orchestratorEvents.setMaxListeners(100);

let taskQueue: ReturnType<typeof createQueue<OrchestratorJobData>> = null;
let taskWorker: ReturnType<typeof createWorker<OrchestratorJobData, OrchestratorJobResult>> = null;

let processorFn: ((job: any) => Promise<OrchestratorJobResult>) | null = null;

export function getOrchestratorQueue() {
  if (!taskQueue) {
    taskQueue = createQueue<OrchestratorJobData>(QUEUE_NAME);
  }
  return taskQueue;
}

export function registerTaskProcessor(processor: (job: any) => Promise<OrchestratorJobResult>) {
  processorFn = processor;
}

export function startOrchestratorWorker(concurrency: number = 10) {
  if (taskWorker) return taskWorker;
  if (!processorFn) {
    console.warn("[SuperOrchestrator] No processor registered, worker not started");
    return null;
  }

  taskWorker = createWorker<OrchestratorJobData, OrchestratorJobResult>(
    QUEUE_NAME,
    async (job: any) => {
      const startTime = Date.now();
      try {
        orchestratorEvents.emit("task:started", {
          runId: job.data.runId,
          taskId: job.data.taskId,
          agentRole: job.data.agentRole,
        });

        const result = await processorFn!(job);

        orchestratorEvents.emit("task:completed", {
          runId: job.data.runId,
          taskId: job.data.taskId,
          result,
          durationMs: Date.now() - startTime,
        });

        return result;
      } catch (error: any) {
        const result: OrchestratorJobResult = {
          taskId: job.data.taskId,
          status: "failed",
          error: error.message || String(error),
          costUsd: 0,
          durationMs: Date.now() - startTime,
        };

        orchestratorEvents.emit("task:failed", {
          runId: job.data.runId,
          taskId: job.data.taskId,
          error: error.message,
          retryCount: job.attemptsMade || 0,
          maxRetries: job.data.maxRetries,
        });

        throw error;
      }
    }
  );

  if (taskWorker) {
    console.log(`[SuperOrchestrator] Worker started with concurrency=${concurrency}`);
  }

  return taskWorker;
}

export async function enqueueTask(data: OrchestratorJobData, priority: number = 5): Promise<string | null> {
  const queue = getOrchestratorQueue();
  if (!queue) {
    console.warn("[SuperOrchestrator] Queue unavailable, executing inline");
    return null;
  }

  const job = await queue.add(`task-${data.taskId}`, data, {
    priority,
    attempts: data.maxRetries + 1,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: { age: 48 * 3600, count: 5000 },
    removeOnFail: { age: 7 * 24 * 3600 },
  });

  return job.id || null;
}

export async function getQueueStats() {
  const queue = getOrchestratorQueue();
  if (!queue) return { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };

  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ]);

  return { waiting, active, completed, failed, delayed };
}

export async function drainQueue() {
  const queue = getOrchestratorQueue();
  if (!queue) return;
  await queue.drain();
}
