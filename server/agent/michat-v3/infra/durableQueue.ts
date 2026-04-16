/**
 * MICHAT v3.1 — Durable Queue
 * Interface para BullMQ/Kafka/Cloud Tasks en producción
 */

export interface QueueJob {
  id: string;
  type: string;
  payload: unknown;
  idempotencyKey: string;
  priority?: number;
  retries?: number;
  scheduledFor?: Date;
  createdAt: Date;
}

export interface JobResult {
  jobId: string;
  status: "completed" | "failed" | "cancelled";
  result?: unknown;
  error?: string;
  completedAt: Date;
}

export interface DurableQueue {
  enqueue(job: Omit<QueueJob, "id" | "createdAt">): Promise<string>;
  getJob(jobId: string): Promise<QueueJob | null>;
  getStatus(jobId: string): Promise<"pending" | "processing" | "completed" | "failed" | null>;
  cancel(jobId: string): Promise<boolean>;
  process(handler: (job: QueueJob) => Promise<unknown>): void;
}

export class InMemoryDurableQueue implements DurableQueue {
  private jobs = new Map<string, QueueJob>();
  private results = new Map<string, JobResult>();
  private idempotencyIndex = new Map<string, string>();
  private handlers: Array<(job: QueueJob) => Promise<unknown>> = [];
  private processing = new Set<string>();

  async enqueue(job: Omit<QueueJob, "id" | "createdAt">): Promise<string> {
    const existingJobId = this.idempotencyIndex.get(job.idempotencyKey);
    if (existingJobId) {
      return existingJobId;
    }

    const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const fullJob: QueueJob = {
      ...job,
      id,
      createdAt: new Date(),
    };

    this.jobs.set(id, fullJob);
    this.idempotencyIndex.set(job.idempotencyKey, id);

    setImmediate(() => this.processNext());

    return id;
  }

  async getJob(jobId: string): Promise<QueueJob | null> {
    return this.jobs.get(jobId) ?? null;
  }

  async getStatus(jobId: string): Promise<"pending" | "processing" | "completed" | "failed" | null> {
    const result = this.results.get(jobId);
    if (result) {
      return result.status === "completed" ? "completed" : "failed";
    }
    if (this.processing.has(jobId)) return "processing";
    if (this.jobs.has(jobId)) return "pending";
    return null;
  }

  async cancel(jobId: string): Promise<boolean> {
    if (this.processing.has(jobId)) return false;
    if (this.results.has(jobId)) return false;

    const job = this.jobs.get(jobId);
    if (job) {
      this.jobs.delete(jobId);
      this.idempotencyIndex.delete(job.idempotencyKey);
      this.results.set(jobId, {
        jobId,
        status: "cancelled",
        completedAt: new Date(),
      });
      return true;
    }
    return false;
  }

  process(handler: (job: QueueJob) => Promise<unknown>): void {
    this.handlers.push(handler);
  }

  private async processNext(): Promise<void> {
    if (this.handlers.length === 0) return;

    const entries = Array.from(this.jobs.entries());
    for (const [jobId, job] of entries) {
      if (this.processing.has(jobId) || this.results.has(jobId)) continue;
      if (job.scheduledFor && job.scheduledFor > new Date()) continue;

      this.processing.add(jobId);

      try {
        for (const handler of this.handlers) {
          const result = await handler(job);
          this.results.set(jobId, {
            jobId,
            status: "completed",
            result,
            completedAt: new Date(),
          });
        }
      } catch (error) {
        const retries = job.retries ?? 0;
        if (retries > 0) {
          job.retries = retries - 1;
        } else {
          this.results.set(jobId, {
            jobId,
            status: "failed",
            error: String(error),
            completedAt: new Date(),
          });
        }
      } finally {
        this.processing.delete(jobId);
      }

      break;
    }
  }

  getStats() {
    return {
      pending: this.jobs.size - this.results.size - this.processing.size,
      processing: this.processing.size,
      completed: Array.from(this.results.values()).filter(r => r.status === "completed").length,
      failed: Array.from(this.results.values()).filter(r => r.status === "failed").length,
    };
  }
}

export class NullQueue implements DurableQueue {
  async enqueue(): Promise<string> {
    return `null_${Date.now()}`;
  }
  async getJob(): Promise<null> {
    return null;
  }
  async getStatus(): Promise<null> {
    return null;
  }
  async cancel(): Promise<boolean> {
    return false;
  }
  process(): void {}
}

export const globalDurableQueue = new InMemoryDurableQueue();
