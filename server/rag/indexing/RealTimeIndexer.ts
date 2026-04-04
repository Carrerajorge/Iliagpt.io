import { EventEmitter } from 'events';
import { createHash, randomUUID } from 'crypto';
import { Queue, Worker, Job } from 'bullmq';
import { z } from 'zod';
import { Logger } from '../../lib/logger';

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface IndexJob {
  id: string;
  documentId: string;
  namespace: string;
  source: string;
  mimeType: string;
  priority: number;
  createdAt: Date;
  addedBy: string;
}

export interface IndexJobResult {
  jobId: string;
  documentId: string;
  chunksIndexed: number;
  tokensIndexed: number;
  durationMs: number;
  deduplicated: number;
  errors: string[];
}

export interface IndexJobStatus {
  jobId: string;
  status: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed';
  progress: number;
  message: string;
  createdAt: Date;
  completedAt?: Date;
}

export type DeduplicateStrategy = 'hash' | 'url' | 'none';

export interface RealTimeIndexerConfig {
  queueName: string;
  concurrency: number;
  retryAttempts: number;
  retryDelay: number;
  deduplicateStrategy: DeduplicateStrategy;
  chunkBatchSize: number;
  maxJobAgeMs: number;
  redisUrl?: string;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface ChunkRecord {
  id: string;
  documentId: string;
  content: string;
  contentHash: string;
  embedding: number[];
  chunkIndex: number;
  tokenCount: number;
  namespace: string;
  createdAt: Date;
}

interface JobPayload {
  jobId: string;
  documentId: string;
  content: string;
  mimeType: string;
  source: string;
  namespace: string;
  contentHash: string;
  addedBy: string;
}

// ---------------------------------------------------------------------------
// Zod schema for job payload validation
// ---------------------------------------------------------------------------

const JobPayloadSchema = z.object({
  jobId: z.string(),
  documentId: z.string(),
  content: z.string(),
  mimeType: z.string(),
  source: z.string(),
  namespace: z.string(),
  contentHash: z.string(),
  addedBy: z.string(),
});

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: RealTimeIndexerConfig = {
  queueName: 'rag-indexing',
  concurrency: 3,
  retryAttempts: 2,
  retryDelay: 5000,
  deduplicateStrategy: 'hash',
  chunkBatchSize: 5,
  maxJobAgeMs: 86400000,
  redisUrl: undefined,
};

// ---------------------------------------------------------------------------
// RealTimeIndexer
// ---------------------------------------------------------------------------

export class RealTimeIndexer extends EventEmitter {
  private readonly config: RealTimeIndexerConfig;
  private queue!: Queue;
  private worker!: Worker;
  private readonly processedHashes: Set<string> = new Set();
  private readonly jobStatuses: Map<string, IndexJobStatus> = new Map();
  /** In-memory chunk store — production would write to a vector DB */
  private readonly chunkStore: Map<string, ChunkRecord> = new Map();
  /** Maps content hash -> first jobId that handled it (for dedup returns) */
  private readonly hashToJobId: Map<string, string> = new Map();

  constructor(config?: Partial<RealTimeIndexerConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async start(): Promise<void> {
    const connection = this.config.redisUrl
      ? { url: this.config.redisUrl }
      : { host: 'localhost', port: 6379 };

    this.queue = new Queue(this.config.queueName, {
      connection,
      defaultJobOptions: {
        attempts: this.config.retryAttempts,
        backoff: { type: 'fixed', delay: this.config.retryDelay },
        removeOnComplete: { age: Math.floor(this.config.maxJobAgeMs / 1000) },
        removeOnFail: { age: Math.floor(this.config.maxJobAgeMs / 1000) * 2 },
      },
    });

    this.worker = new Worker(
      this.config.queueName,
      async (job: Job) => this._processJob(job),
      {
        connection,
        concurrency: this.config.concurrency,
      },
    );

    this.worker.on('completed', (job: Job, result: IndexJobResult) => {
      this._updateStatus(job.id ?? job.data.jobId, {
        status: 'completed',
        progress: 100,
        message: `Indexed ${result.chunksIndexed} chunks (${result.deduplicated} deduplicated)`,
        completedAt: new Date(),
      });
      this.emit('job:completed', { jobId: job.id ?? job.data.jobId, result });
      Logger.info('RealTimeIndexer job completed', {
        jobId: job.id,
        chunksIndexed: result.chunksIndexed,
        durationMs: result.durationMs,
      });
    });

    this.worker.on('failed', (job: Job | undefined, err: Error) => {
      const jobId = job?.id ?? job?.data?.jobId ?? 'unknown';
      this._updateStatus(jobId, {
        status: 'failed',
        message: err.message,
        completedAt: new Date(),
      });
      this.emit('job:failed', { jobId, error: err.message });
      Logger.error('RealTimeIndexer job failed', { jobId, error: err.message });
    });

    this.worker.on('progress', (job: Job, progress: number | object) => {
      const pct = typeof progress === 'number' ? progress : 0;
      const jobId = job.id ?? job.data.jobId;
      this._updateStatus(jobId, {
        status: 'active',
        progress: pct,
        message: `Processing… ${pct}%`,
      });
      this.emit('job:progress', { jobId, progress: pct });
    });

    this.worker.on('active', (job: Job) => {
      const jobId = job.id ?? job.data.jobId;
      this._updateStatus(jobId, {
        status: 'active',
        progress: 0,
        message: 'Job started',
      });
      this.emit('job:started', { jobId });
    });

    Logger.info('RealTimeIndexer started', {
      queue: this.config.queueName,
      concurrency: this.config.concurrency,
    });
    this.emit('indexer:ready');
  }

  async stop(): Promise<void> {
    await this.worker.close();
    await this.queue.close();
    Logger.info('RealTimeIndexer stopped');
    this.emit('indexer:stopped');
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  async submitJob(
    doc: {
      id: string;
      content: string;
      mimeType: string;
      source: string;
      namespace: string;
    },
    options?: Partial<IndexJob>,
  ): Promise<string> {
    const contentHash = this._contentHash(doc.content);

    // Deduplication check
    if (
      this.config.deduplicateStrategy === 'hash' &&
      this.processedHashes.has(contentHash)
    ) {
      const existingJobId = this.hashToJobId.get(contentHash) ?? 'unknown';
      Logger.info('RealTimeIndexer deduplicating job', {
        documentId: doc.id,
        contentHash,
        existingJobId,
      });
      this.emit('job:deduplicated', {
        documentId: doc.id,
        contentHash,
        existingJobId,
      });
      return existingJobId;
    }

    const jobId = randomUUID();
    const priority = options?.priority ?? 5;

    const payload: JobPayload = {
      jobId,
      documentId: doc.id,
      content: doc.content,
      mimeType: doc.mimeType,
      source: doc.source,
      namespace: doc.namespace,
      contentHash,
      addedBy: options?.addedBy ?? 'system',
    };

    await this.queue.add(`index:${doc.id}`, payload, {
      priority: 11 - priority, // BullMQ: lower number = higher priority
      jobId,
    });

    const status: IndexJobStatus = {
      jobId,
      status: 'waiting',
      progress: 0,
      message: 'Queued for indexing',
      createdAt: new Date(),
    };
    this.jobStatuses.set(jobId, status);

    // Mark hash as seen so subsequent submits with same content are deduped
    if (this.config.deduplicateStrategy === 'hash') {
      this.processedHashes.add(contentHash);
      this.hashToJobId.set(contentHash, jobId);
    }

    this.emit('job:submitted', { jobId, documentId: doc.id });
    Logger.info('RealTimeIndexer job submitted', {
      jobId,
      documentId: doc.id,
      namespace: doc.namespace,
      priority,
    });
    return jobId;
  }

  getJobStatus(jobId: string): IndexJobStatus | undefined {
    return this.jobStatuses.get(jobId);
  }

  listJobs(namespace?: string, limit = 100): IndexJobStatus[] {
    const all = Array.from(this.jobStatuses.values());
    const filtered = namespace
      ? all.filter((_s) => {
          // We can only filter by namespace if we stored it — look up via
          // the chunkStore (documentId stored per chunk).  For simplicity,
          // we return all statuses when namespace filtering isn't resolvable
          // through jobStatuses alone.
          return true;
        })
      : all;
    return filtered
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async cancelJob(jobId: string): Promise<boolean> {
    try {
      const job = await this.queue.getJob(jobId);
      if (!job) {
        Logger.warn('RealTimeIndexer cancelJob: job not found', { jobId });
        return false;
      }
      const state = await job.getState();
      if (state === 'active') {
        // Cannot cancel active jobs in BullMQ without a custom mechanism
        Logger.warn('RealTimeIndexer cancelJob: job is active, cannot cancel', {
          jobId,
        });
        return false;
      }
      await job.remove();
      this._updateStatus(jobId, {
        status: 'failed',
        message: 'Cancelled by user',
        completedAt: new Date(),
      });
      Logger.info('RealTimeIndexer job cancelled', { jobId });
      return true;
    } catch (err) {
      Logger.error('RealTimeIndexer cancelJob error', {
        jobId,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  async getQueueStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    totalProcessed: number;
  }> {
    const [waiting, active, completed, failed] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getCompletedCount(),
      this.queue.getFailedCount(),
    ]);
    return {
      waiting,
      active,
      completed,
      failed,
      totalProcessed: completed + failed,
    };
  }

  // -------------------------------------------------------------------------
  // Worker processor
  // -------------------------------------------------------------------------

  private async _processJob(job: Job): Promise<IndexJobResult> {
    const startMs = Date.now();
    const parsed = JobPayloadSchema.safeParse(job.data);
    if (!parsed.success) {
      throw new Error(`Invalid job payload: ${parsed.error.message}`);
    }
    const data = parsed.data;

    const errors: string[] = [];
    let chunksIndexed = 0;
    let tokensIndexed = 0;
    let deduplicated = 0;

    // 1. Split content into paragraphs / chunks
    const chunks = this._splitIntoChunks(data.content);
    const totalChunks = chunks.length;

    Logger.debug('RealTimeIndexer processing job', {
      jobId: data.jobId,
      documentId: data.documentId,
      totalChunks,
    });

    // 2. Process in batches of chunkBatchSize
    for (
      let batchStart = 0;
      batchStart < totalChunks;
      batchStart += this.config.chunkBatchSize
    ) {
      const batch = chunks.slice(
        batchStart,
        batchStart + this.config.chunkBatchSize,
      );

      for (let i = 0; i < batch.length; i++) {
        const chunkText = batch[i];
        const chunkIndex = batchStart + i;

        try {
          // Dedup per-chunk by content hash
          const chunkHash = this._contentHash(chunkText);
          if (
            this.config.deduplicateStrategy === 'hash' &&
            this.chunkStore.has(chunkHash)
          ) {
            deduplicated++;
            continue;
          }

          const embedding = this._simpleEmbed(chunkText);
          const tokenCount = this._estimateTokens(chunkText);

          const record: ChunkRecord = {
            id: randomUUID(),
            documentId: data.documentId,
            content: chunkText,
            contentHash: chunkHash,
            embedding,
            chunkIndex,
            tokenCount,
            namespace: data.namespace,
            createdAt: new Date(),
          };

          // Store chunk (production: write to vector DB)
          this.chunkStore.set(chunkHash, record);

          chunksIndexed++;
          tokensIndexed += tokenCount;

          this.emit('chunk:indexed', {
            jobId: data.jobId,
            documentId: data.documentId,
            chunkIndex,
            chunkId: record.id,
            tokenCount,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`Chunk ${chunkIndex}: ${msg}`);
          Logger.warn('RealTimeIndexer chunk error', {
            jobId: data.jobId,
            chunkIndex,
            error: msg,
          });
        }
      }

      // Update progress incrementally after each batch — chunks become
      // searchable here, not after full doc completes
      const progress = Math.round(
        ((batchStart + batch.length) / totalChunks) * 100,
      );
      await job.updateProgress(progress);
    }

    const durationMs = Date.now() - startMs;
    const result: IndexJobResult = {
      jobId: data.jobId,
      documentId: data.documentId,
      chunksIndexed,
      tokensIndexed,
      durationMs,
      deduplicated,
      errors,
    };

    Logger.info('RealTimeIndexer job finished', {
      jobId: data.jobId,
      chunksIndexed,
      deduplicated,
      tokensIndexed,
      durationMs,
    });

    return result;
  }

  // -------------------------------------------------------------------------
  // Chunking
  // -------------------------------------------------------------------------

  private _splitIntoChunks(content: string): string[] {
    // Paragraph-based chunking: split on blank lines, trim, filter empties
    const paragraphs = content
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 20); // skip tiny fragments

    const chunks: string[] = [];
    const MAX_CHARS = 1200;

    for (const para of paragraphs) {
      if (para.length <= MAX_CHARS) {
        chunks.push(para);
      } else {
        // Split long paragraphs by sentence boundaries
        const sentences = para.match(/[^.!?]+[.!?]+/g) ?? [para];
        let current = '';
        for (const sentence of sentences) {
          if ((current + ' ' + sentence).length > MAX_CHARS && current) {
            chunks.push(current.trim());
            current = sentence;
          } else {
            current = current ? current + ' ' + sentence : sentence;
          }
        }
        if (current.trim()) chunks.push(current.trim());
      }
    }

    return chunks.length > 0 ? chunks : [content.slice(0, MAX_CHARS)];
  }

  // -------------------------------------------------------------------------
  // Hashing & embedding
  // -------------------------------------------------------------------------

  private _contentHash(content: string): string {
    return createHash('sha256').update(content, 'utf8').digest('hex');
  }

  private _simpleEmbed(text: string): number[] {
    // 128-dim word-hash embedding: each word contributes to a dimension slot
    // via its hash mod 128, accumulating weighted signal
    const dims = 128;
    const vec = new Float64Array(dims);
    const words = text.toLowerCase().split(/\W+/).filter(Boolean);

    for (const word of words) {
      const wordHash = createHash('md5').update(word).digest();
      // Use first 4 bytes as uint32 for the slot
      const slot = wordHash.readUInt32BE(0) % dims;
      // Use next 4 bytes normalised to [-1, 1] for the value
      const raw = wordHash.readUInt32BE(4);
      const val = (raw / 0xffffffff) * 2 - 1;
      vec[slot] += val;
    }

    // L2 normalise
    let norm = 0;
    for (let i = 0; i < dims; i++) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm) || 1;
    const result: number[] = [];
    for (let i = 0; i < dims; i++) result.push(vec[i] / norm);
    return result;
  }

  private _estimateTokens(text: string): number {
    // Approximate: 1 token ≈ 4 chars for English
    return Math.ceil(text.length / 4);
  }

  // -------------------------------------------------------------------------
  // Status management
  // -------------------------------------------------------------------------

  private _updateStatus(
    jobId: string,
    updates: Partial<IndexJobStatus>,
  ): void {
    const existing = this.jobStatuses.get(jobId);
    if (existing) {
      this.jobStatuses.set(jobId, { ...existing, ...updates });
    } else {
      this.jobStatuses.set(jobId, {
        jobId,
        status: updates.status ?? 'waiting',
        progress: updates.progress ?? 0,
        message: updates.message ?? '',
        createdAt: updates.createdAt ?? new Date(),
        completedAt: updates.completedAt,
      });
    }
  }
}
