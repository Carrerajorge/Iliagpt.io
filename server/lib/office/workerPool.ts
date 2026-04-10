/**
 * Office Engine worker pool — preprovisioned worker_threads pool.
 *
 * Replaces the previous stub which fake-executed via setTimeout. Real
 * mechanics:
 *
 *   - Spawns N workers at `init()` (default 4, capped at cpu count, env
 *     `OFFICE_ENGINE_WORKERS`). Reused across all dispatches.
 *   - Round-robin over idle workers; otherwise queues with bounded
 *     backpressure (default 64, env `OFFICE_ENGINE_QUEUE_MAX`). Overflow
 *     throws `QueueFullError`.
 *   - Per-call timeout + AbortSignal cancellation. On either, the offending
 *     worker is `terminate()`d and replaced.
 *   - Crash recovery: a worker that exits non-zero is respawned and the
 *     in-flight task is retried once.
 *   - Recycling: after `OFFICE_ENGINE_MAX_TASKS_PER_WORKER` (default 200)
 *     successful tasks, a worker is voluntarily recycled to bound native
 *     leak accumulation from `jszip`.
 *   - Binary buffers travel as `ArrayBuffer` on `transferList`.
 *
 * Build / dev resolution:
 *   - Production: `dist/server/lib/office/worker-entry.js` (CJS) produced
 *     by `tsconfig.officeWorker.json`.
 *   - Development: spawns the TS source directly via `tsx` using
 *     `execArgv: ["--import", "tsx"]`, matching the existing pattern in
 *     `npm run worker` / `npm run daemon`. No `npm install` per request.
 */

import { Worker } from "node:worker_threads";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { randomUUID } from "node:crypto";
import { Logger } from "../logger";
import type { WorkerTaskEnvelope, WorkerTaskName, WorkerTaskResult } from "./types";
import { OfficeEngineError } from "./types";
import {
  workerPoolRestarts,
  workerTaskCounter,
  workerTaskLatency,
  snapshotPoolGauges,
} from "./metrics";

export class QueueFullError extends Error {
  constructor() {
    super("Office engine worker queue is full");
    this.name = "QueueFullError";
  }
}

interface PendingTask {
  taskId: string;
  task: WorkerTaskName;
  payload: unknown;
  transferList: ArrayBuffer[];
  timeoutMs: number;
  signal?: AbortSignal;
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
  retried: boolean;
  /** ms epoch when the task was assigned to a worker (not enqueued). */
  startedAt?: number;
}

interface WorkerSlot {
  id: number;
  worker: Worker;
  busy: boolean;
  tasksRun: number;
  inFlight: PendingTask | null;
  timer: NodeJS.Timeout | null;
  abortHandler: (() => void) | null;
  /** Consecutive crashes without a single successful task. Used to break respawn loops. */
  consecutiveBootFailures: number;
  /** Permanently dead — pool refuses to spawn this slot id again. */
  dead: boolean;
}

/** A slot that crashes this many times in a row without a successful task is marked dead. */
const MAX_BOOT_FAILURES = 3;

const DEFAULT_TIMEOUTS: Record<WorkerTaskName, number> = {
  "docx.unpack": 30_000,
  "docx.parse": 30_000,
  "docx.validate": 60_000,
  "docx.repack": 30_000,
  "docx.roundtrip_diff": 90_000,
};

export class OfficeWorkerPool {
  private slots: WorkerSlot[] = [];
  private queue: PendingTask[] = [];
  private maxWorkers: number;
  private maxQueue: number;
  private maxTasksPerWorker: number;
  private restarts = 0;
  private initialized = false;
  private workerEntryPath: string | null = null;
  private workerExecArgv: string[] = [];

  constructor() {
    this.maxWorkers = clamp(
      Number(process.env.OFFICE_ENGINE_WORKERS ?? 4),
      1,
      Math.max(1, os.cpus().length),
    );
    this.maxQueue = Math.max(1, Number(process.env.OFFICE_ENGINE_QUEUE_MAX ?? 64));
    this.maxTasksPerWorker = Math.max(1, Number(process.env.OFFICE_ENGINE_MAX_TASKS_PER_WORKER ?? 200));
  }

  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.resolveWorkerEntry();
    for (let i = 0; i < this.maxWorkers; i++) {
      this.spawnSlot(i);
    }
    Logger.info(
      `[OfficeWorkerPool] Initialized with ${this.maxWorkers} workers (queueMax=${this.maxQueue}, recycleAfter=${this.maxTasksPerWorker}, entry=${this.workerEntryPath})`,
    );
  }

  stats() {
    const stats = {
      busy: this.slots.filter((s) => s && s.busy).length,
      idle: this.slots.filter((s) => s && !s.busy && !s.dead).length,
      dead: this.slots.filter((s) => s && s.dead).length,
      queueDepth: this.queue.length,
      restarts: this.restarts,
    };
    snapshotPoolGauges(stats);
    return stats;
  }

  async dispatch<TIn, TOut>(
    task: WorkerTaskName,
    payload: TIn,
    opts: {
      signal?: AbortSignal;
      timeoutMs?: number;
      transferList?: ArrayBuffer[];
    } = {},
  ): Promise<TOut> {
    if (!this.initialized) this.init();

    // Fail fast if every worker is dead — otherwise the dispatch would queue
    // forever waiting for an idle worker that will never come.
    const liveCount = this.slots.filter((s) => s && !s.dead).length;
    if (liveCount === 0) {
      throw new OfficeEngineError(
        "WORKER_CRASH",
        "All Office Engine workers are dead. Check the boot log for the worker crash that triggered this. Worker entry: " +
          (this.workerEntryPath ?? "(unresolved)"),
      );
    }

    const taskId = randomUUID();
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUTS[task];

    return new Promise<TOut>((resolve, reject) => {
      const pending: PendingTask = {
        taskId,
        task,
        payload,
        transferList: opts.transferList ?? [],
        timeoutMs,
        signal: opts.signal,
        resolve: (v) => resolve(v as TOut),
        reject,
        retried: false,
      };
      if (opts.signal?.aborted) {
        reject(new OfficeEngineError("CANCELLED", "Aborted before dispatch"));
        return;
      }
      const slot = this.pickIdle();
      if (slot) {
        this.assign(slot, pending);
      } else {
        if (this.queue.length >= this.maxQueue) {
          reject(new QueueFullError());
          return;
        }
        this.queue.push(pending);
      }
    });
  }

  async shutdown(): Promise<void> {
    this.queue.length = 0;
    await Promise.all(
      this.slots.map(async (s) => {
        try {
          await s.worker.terminate();
        } catch {
          /* ignore */
        }
      }),
    );
    this.slots = [];
    this.initialized = false;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private resolveWorkerEntry(): void {
    const distPath = path.join(
      process.cwd(),
      "dist",
      "server",
      "lib",
      "office",
      "worker-entry.js",
    );
    if (fs.existsSync(distPath)) {
      this.workerEntryPath = distPath;
      this.workerExecArgv = [];
      return;
    }
    // Dev fallback: run the TS source via tsx, matching `npm run worker` pattern.
    const tsPath = path.join(
      process.cwd(),
      "server",
      "lib",
      "office",
      "worker-entry.ts",
    );
    this.workerEntryPath = tsPath;
    this.workerExecArgv = ["--import", "tsx"];
  }

  private spawnSlot(id: number, prior?: WorkerSlot): WorkerSlot {
    if (!this.workerEntryPath) this.resolveWorkerEntry();
    const worker = new Worker(this.workerEntryPath!, {
      execArgv: this.workerExecArgv,
    });
    const slot: WorkerSlot = {
      id,
      worker,
      busy: false,
      tasksRun: 0,
      inFlight: null,
      timer: null,
      abortHandler: null,
      consecutiveBootFailures: prior?.consecutiveBootFailures ?? 0,
      dead: false,
    };
    worker.on("message", (msg: WorkerTaskResult) => this.onMessage(slot, msg));
    worker.on("error", (err) => this.onWorkerError(slot, err));
    worker.on("exit", (code) => this.onWorkerExit(slot, code));
    this.slots[id] = slot;
    return slot;
  }

  private pickIdle(): WorkerSlot | null {
    for (const s of this.slots) {
      if (s && !s.busy && !s.dead) return s;
    }
    return null;
  }

  private assign(slot: WorkerSlot, pending: PendingTask): void {
    slot.busy = true;
    slot.inFlight = pending;
    pending.startedAt = Date.now();
    if (pending.timeoutMs > 0) {
      slot.timer = setTimeout(() => this.onTimeout(slot), pending.timeoutMs);
    }
    if (pending.signal) {
      const handler = () => this.onAbort(slot);
      slot.abortHandler = handler;
      pending.signal.addEventListener("abort", handler, { once: true });
    }
    const env: WorkerTaskEnvelope = {
      taskId: pending.taskId,
      task: pending.task,
      payload: pending.payload,
    };
    try {
      if (pending.transferList.length > 0) {
        slot.worker.postMessage(env, pending.transferList);
      } else {
        slot.worker.postMessage(env);
      }
    } catch (err) {
      this.cleanupSlot(slot);
      pending.reject(err);
      this.maybeDrain();
    }
  }

  private onMessage(slot: WorkerSlot, msg: WorkerTaskResult): void {
    const pending = slot.inFlight;
    if (!pending || pending.taskId !== msg.taskId) {
      // Stale message — ignore.
      return;
    }
    this.cleanupSlot(slot);
    slot.tasksRun++;

    if (msg.ok) {
      slot.consecutiveBootFailures = 0; // a successful task clears the boot-failure counter
      const dur = pending.startedAt ? (Date.now() - pending.startedAt) / 1000 : 0;
      workerTaskLatency.labels(pending.task).observe(dur);
      workerTaskCounter.labels(pending.task, "success").inc();
      pending.resolve(msg.result);
    } else {
      workerTaskCounter.labels(pending.task, "error").inc();
      pending.reject(
        new OfficeEngineError("WORKER_CRASH", msg.error.message, {
          details: msg.error,
        }),
      );
    }

    if (slot.tasksRun >= this.maxTasksPerWorker) {
      this.recycle(slot);
    } else {
      this.maybeDrain();
    }
  }

  private onWorkerError(slot: WorkerSlot, err: Error): void {
    Logger.warn(`[OfficeWorkerPool] worker ${slot.id} error: ${err.message}`);
    const pending = slot.inFlight;
    if (pending) {
      this.cleanupSlot(slot);
      this.retryOrFail(pending, err);
    }
  }

  private onWorkerExit(slot: WorkerSlot, code: number): void {
    if (code !== 0) {
      Logger.warn(`[OfficeWorkerPool] worker ${slot.id} exited with code ${code}`);
    }
    const pending = slot.inFlight;
    if (pending) {
      this.cleanupSlot(slot);
      this.retryOrFail(pending, new Error(`worker exited with code ${code}`));
    }
    this.restarts++;
    workerPoolRestarts.inc();

    // Respawn-loop guard: if a worker keeps crashing without ever processing
    // a successful task, mark it permanently dead. The pool can keep running
    // with the surviving workers; if they all die, dispatch() will eventually
    // throw QueueFullError when the queue saturates and the route returns 503.
    if (code !== 0 && slot.tasksRun === 0) {
      slot.consecutiveBootFailures++;
      if (slot.consecutiveBootFailures >= MAX_BOOT_FAILURES) {
        Logger.error(
          `[OfficeWorkerPool] worker ${slot.id} marked DEAD after ${slot.consecutiveBootFailures} consecutive boot failures. Worker entry: ${this.workerEntryPath}`,
        );
        slot.dead = true;
        // Do NOT respawn. Leave the slot in place so its dead state is visible to pickIdle().
        return;
      }
    }

    this.spawnSlot(slot.id, slot);
    this.maybeDrain();
  }

  private onTimeout(slot: WorkerSlot): void {
    const pending = slot.inFlight;
    if (!pending) return;
    Logger.warn(
      `[OfficeWorkerPool] worker ${slot.id} task ${pending.task} timed out after ${pending.timeoutMs}ms`,
    );
    pending.reject(
      new OfficeEngineError("WORKER_TIMEOUT", `Task ${pending.task} exceeded ${pending.timeoutMs}ms`),
    );
    this.cleanupSlot(slot);
    void slot.worker.terminate(); // exit handler will respawn
  }

  private onAbort(slot: WorkerSlot): void {
    const pending = slot.inFlight;
    if (!pending) return;
    pending.reject(new OfficeEngineError("CANCELLED", "Aborted by signal"));
    this.cleanupSlot(slot);
    void slot.worker.terminate(); // exit handler will respawn
  }

  private cleanupSlot(slot: WorkerSlot): void {
    if (slot.timer) {
      clearTimeout(slot.timer);
      slot.timer = null;
    }
    if (slot.abortHandler && slot.inFlight?.signal) {
      slot.inFlight.signal.removeEventListener("abort", slot.abortHandler);
    }
    slot.abortHandler = null;
    slot.inFlight = null;
    slot.busy = false;
  }

  private retryOrFail(pending: PendingTask, err: unknown): void {
    if (pending.retried) {
      pending.reject(
        err instanceof OfficeEngineError
          ? err
          : new OfficeEngineError("WORKER_CRASH", err instanceof Error ? err.message : String(err)),
      );
      return;
    }
    pending.retried = true;
    // Try to assign to an idle worker right away; otherwise re-queue at the front.
    const next = this.pickIdle();
    if (next) {
      this.assign(next, pending);
    } else {
      this.queue.unshift(pending);
    }
  }

  private recycle(slot: WorkerSlot): void {
    Logger.info(`[OfficeWorkerPool] recycling worker ${slot.id} after ${slot.tasksRun} tasks`);
    void slot.worker.terminate(); // exit handler will respawn + maybeDrain
  }

  private maybeDrain(): void {
    while (this.queue.length > 0) {
      const slot = this.pickIdle();
      if (!slot) break;
      const next = this.queue.shift();
      if (!next) break;
      this.assign(slot, next);
    }
  }
}

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

export const officeWorkerPool = new OfficeWorkerPool();
