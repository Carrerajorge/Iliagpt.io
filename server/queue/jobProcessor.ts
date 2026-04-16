import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';

export type JobStatus = 'pending' | 'active' | 'completed' | 'failed' | 'dead';

export type JobType =
  | 'document_generation'
  | 'file_processing'
  | 'code_execution'
  | 'web_search'
  | 'email_notification'
  | 'webhook_delivery';

export interface QueueStats {
  pending: number;
  active: number;
  completed: number;
  failed: number;
  dead: number;
}

export type JobHandler = (job: Job) => Promise<unknown>;

export class Job {
  readonly id: string;
  readonly type: string;
  readonly data: unknown;
  readonly priority: number;
  readonly createdAt: Date;
  status: JobStatus = 'pending';
  progress = 0;
  result: unknown = null;
  error: string | null = null;
  attempts = 0;
  readonly maxRetries: number;
  private readonly emitter: EventEmitter;
  scheduledAt: number;

  constructor(
    type: string,
    data: unknown,
    opts: { priority?: number; delay?: number; maxRetries?: number },
    emitter: EventEmitter,
  ) {
    this.id = randomUUID();
    this.type = type;
    this.data = data;
    this.priority = opts.priority ?? 0;
    this.maxRetries = opts.maxRetries ?? 3;
    this.createdAt = new Date();
    this.scheduledAt = Date.now() + (opts.delay ?? 0);
    this.emitter = emitter;
  }

  updateProgress(percent: number, message?: string): void {
    this.progress = Math.max(0, Math.min(100, percent));
    this.emitter.emit('progress', { jobId: this.id, progress: this.progress, message });
  }
}

export class JobQueue extends EventEmitter {
  readonly name: string;
  private readonly concurrency: number;
  private readonly maxRetries: number;
  private readonly jobs = new Map<string, Job>();
  private readonly pending: Job[] = [];
  private activeCount = 0;
  private readonly handlers = new Map<string, JobHandler>();
  private readonly stats: QueueStats = { pending: 0, active: 0, completed: 0, failed: 0, dead: 0 };
  private drainResolvers: Array<() => void> = [];
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(name: string, options?: { concurrency?: number; maxRetries?: number }) {
    super();
    this.name = name;
    this.concurrency = options?.concurrency ?? 5;
    this.maxRetries = options?.maxRetries ?? 3;
  }

  async add(type: string, data: unknown, opts?: { priority?: number; delay?: number }): Promise<Job> {
    const job = new Job(type, data, { ...opts, maxRetries: this.maxRetries }, this);
    this.jobs.set(job.id, job);
    this.pending.push(job);
    this.pending.sort((a, b) => b.priority - a.priority);
    this.stats.pending++;
    this.tick();
    return job;
  }

  process(type: string, handler: JobHandler): void {
    this.handlers.set(type, handler);
    this.startPolling();
    this.tick();
  }

  async getJob(id: string): Promise<Job | null> {
    return this.jobs.get(id) ?? null;
  }

  getStats(): QueueStats {
    return { ...this.stats };
  }

  async drain(): Promise<void> {
    if (this.activeCount === 0 && this.stats.pending === 0) return;
    return new Promise((resolve) => this.drainResolvers.push(resolve));
  }

  private startPolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => this.tick(), 500);
  }

  private tick(): void {
    const now = Date.now();
    while (this.activeCount < this.concurrency && this.pending.length > 0) {
      const idx = this.pending.findIndex((j) => j.scheduledAt <= now);
      if (idx === -1) break;
      const [job] = this.pending.splice(idx, 1);
      this.stats.pending--;
      this.run(job);
    }
    this.checkDrain();
  }

  private async run(job: Job): Promise<void> {
    const handler = this.handlers.get(job.type);
    if (!handler) {
      job.status = 'failed';
      job.error = `No handler registered for job type "${job.type}"`;
      this.stats.failed++;
      this.emit('failed', { jobId: job.id, error: job.error, attempt: job.attempts });
      this.checkDrain();
      return;
    }

    job.status = 'active';
    job.attempts++;
    this.activeCount++;
    this.stats.active++;

    try {
      job.result = await handler(job);
      job.status = 'completed';
      job.progress = 100;
      this.stats.active--;
      this.stats.completed++;
      this.activeCount--;
      this.emit('completed', { jobId: job.id, result: job.result });
    } catch (err) {
      this.stats.active--;
      this.activeCount--;
      const message = err instanceof Error ? err.message : String(err);

      if (job.attempts < job.maxRetries) {
        const backoff = Math.pow(4, job.attempts - 1) * 1000; // 1s, 4s, 16s
        job.status = 'pending';
        job.scheduledAt = Date.now() + backoff;
        job.error = message;
        this.pending.push(job);
        this.pending.sort((a, b) => b.priority - a.priority);
        this.stats.pending++;
        this.emit('failed', { jobId: job.id, error: message, attempt: job.attempts });
      } else {
        job.status = 'dead';
        job.error = message;
        this.stats.dead++;
        this.emit('failed', { jobId: job.id, error: message, attempt: job.attempts });
      }
    }

    this.tick();
  }

  private checkDrain(): void {
    if (this.activeCount === 0 && this.stats.pending === 0 && this.drainResolvers.length > 0) {
      for (const resolve of this.drainResolvers) resolve();
      this.drainResolvers = [];
    }
  }
}

// Singleton queues
export const documentQueue = new JobQueue('documents', { concurrency: 3 });
export const processingQueue = new JobQueue('processing', { concurrency: 5 });
export const notificationQueue = new JobQueue('notifications', { concurrency: 10 });
