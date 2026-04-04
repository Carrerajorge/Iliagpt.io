/**
 * RealTimeIndexer — Background indexing via BullMQ with priority queues.
 * Chunks become searchable incrementally as they are processed.
 * Supports deduplication, progress tracking, and stale chunk removal.
 *
 * Priority levels:
 *   1 = user-uploaded document (highest)
 *   5 = re-indexing job
 *  10 = background crawl (lowest)
 */

import crypto from "crypto";
import { createLogger } from "../../utils/logger";
import { db } from "../../db";
import { ragChunks } from "@shared/schema/rag";
import { eq, and, lt, sql } from "drizzle-orm";
import { QUEUE_NAMES } from "../../lib/queueFactory";

const logger = createLogger("RealTimeIndexer");

// ─── Types ────────────────────────────────────────────────────────────────────

export type IndexPriority = 1 | 5 | 10;

export interface IndexJobPayload {
  jobId: string;
  userId: string;
  tenantId: string;
  sourceId: string;
  source: string;
  text: string;
  mimeType?: string;
  fileName?: string;
  language?: string;
  priority: IndexPriority;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface IndexProgress {
  jobId: string;
  sourceId: string;
  status: "queued" | "processing" | "chunking" | "embedding" | "indexing" | "done" | "failed";
  chunksTotal?: number;
  chunksIndexed: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
}

export interface IndexResult {
  jobId: string;
  chunksCreated: number;
  chunksSkipped: number;
  durationMs: number;
}

// ─── In-memory progress store (extend to Redis in production) ────────────────

const progressStore = new Map<string, IndexProgress>();

export function getIndexProgress(jobId: string): IndexProgress | undefined {
  return progressStore.get(jobId);
}

export function listActiveJobs(): IndexProgress[] {
  return [...progressStore.values()].filter(
    (p) => p.status !== "done" && p.status !== "failed"
  );
}

// ─── Content deduplication ────────────────────────────────────────────────────

function contentHash(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 64);
}

async function findDuplicateChunks(userId: string, hashes: string[]): Promise<Set<string>> {
  if (hashes.length === 0) return new Set();
  try {
    const existing = await db
      .select({ contentHash: ragChunks.contentHash })
      .from(ragChunks)
      .where(
        and(
          eq(ragChunks.userId, userId),
          sql`${ragChunks.contentHash} = ANY(${hashes})`
        )
      );
    return new Set(existing.map((r) => r.contentHash));
  } catch (err) {
    logger.warn("Duplicate check failed, proceeding without dedup", { error: String(err) });
    return new Set();
  }
}

// ─── Core indexing logic ──────────────────────────────────────────────────────

async function processIndexJob(payload: IndexJobPayload): Promise<IndexResult> {
  const { jobId, userId, tenantId, sourceId, source, text, mimeType, fileName, tags, metadata, language } = payload;
  const startTime = Date.now();

  updateProgress(jobId, { status: "chunking", startedAt: startTime });

  // Dynamic imports to avoid circular dependencies
  const { SemanticChunker } = await import("../chunking/SemanticChunker");
  const { CodeChunker } = await import("../chunking/CodeChunker");
  const { generateEmbeddingsBatch } = await import("../../services/ragPipeline");

  // Choose chunker based on mime type
  const isCode = mimeType
    ? ["text/typescript", "text/javascript", "text/x-python", "text/x-go", "text/x-rust"].includes(mimeType)
    : /\.(ts|tsx|js|jsx|py|go|rs|java|cpp|c)$/i.test(fileName ?? "");

  const chunker = isCode
    ? new CodeChunker({ includeImports: true })
    : new SemanticChunker({ useSemanticBoundaries: false }); // Skip semantic refinement for speed

  let chunks;
  try {
    chunks = await chunker.chunk(text, { sourceFile: fileName ?? sourceId });
  } catch (err) {
    updateProgress(jobId, { status: "failed", error: String(err) });
    throw new Error(`Chunking failed: ${err}`);
  }

  updateProgress(jobId, {
    status: "embedding",
    chunksTotal: chunks.length,
  });

  // Compute content hashes for deduplication
  const chunkHashes = chunks.map((c) => contentHash(c.content));
  const duplicateHashes = await findDuplicateChunks(userId, chunkHashes);
  const newChunks = chunks.filter((_, i) => !duplicateHashes.has(chunkHashes[i]));
  const skipped = chunks.length - newChunks.length;

  if (newChunks.length === 0) {
    logger.info("All chunks are duplicates, skipping indexing", { sourceId, userId });
    updateProgress(jobId, { status: "done", chunksIndexed: 0, completedAt: Date.now() });
    return { jobId, chunksCreated: 0, chunksSkipped: skipped, durationMs: Date.now() - startTime };
  }

  // Embed in batches of 10
  const batchSize = 10;
  let indexed = 0;

  for (let i = 0; i < newChunks.length; i += batchSize) {
    const batch = newChunks.slice(i, i + batchSize);
    const batchHashes = chunkHashes.slice(i, i + batchSize).filter((_, j) => !duplicateHashes.has(chunkHashes[i + j]));

    let embeddings: number[][];
    try {
      embeddings = await generateEmbeddingsBatch(batch.map((c) => c.content));
    } catch (err) {
      logger.warn("Embedding batch failed, using zero vectors", { batchStart: i, error: String(err) });
      embeddings = batch.map(() => new Array(768).fill(0));
    }

    // Insert chunks into DB — individually to allow partial success
    for (let j = 0; j < batch.length; j++) {
      const chunk = batch[j];
      const embedding = embeddings[j];
      const hash = batchHashes[j] ?? contentHash(chunk.content);

      try {
        await db.insert(ragChunks).values({
          userId,
          tenantId,
          source,
          sourceId,
          content: chunk.content,
          contentHash: hash,
          embedding: embedding as unknown as any,
          chunkIndex: chunk.chunkIndex,
          totalChunks: newChunks.length,
          chunkType: chunk.metadata.chunkType,
          sectionTitle: chunk.metadata.sectionTitle ?? null,
          pageNumber: chunk.metadata.pageNumber ?? null,
          language: language ?? chunk.metadata.language ?? null,
          title: chunk.metadata.sectionTitle ?? null,
          tags: tags ?? [],
          importance: chunk.score ?? 0.5,
          metadata: {
            ...metadata,
            ...chunk.metadata,
          } as any,
          isActive: true,
        }).onConflictDoNothing();

        indexed++;
      } catch (err) {
        logger.warn("Failed to insert chunk", {
          chunkIndex: chunk.chunkIndex,
          sourceId,
          error: String(err),
        });
      }
    }

    updateProgress(jobId, { status: "indexing", chunksIndexed: indexed });
    logger.debug("Indexing progress", { jobId, indexed, total: newChunks.length });
  }

  const durationMs = Date.now() - startTime;
  updateProgress(jobId, { status: "done", chunksIndexed: indexed, completedAt: Date.now() });

  logger.info("Index job complete", {
    jobId,
    sourceId,
    chunksCreated: indexed,
    chunksSkipped: skipped,
    durationMs,
  });

  return { jobId, chunksCreated: indexed, chunksSkipped: skipped, durationMs };
}

function updateProgress(jobId: string, update: Partial<IndexProgress>): void {
  const current = progressStore.get(jobId) ?? {
    jobId,
    sourceId: "",
    status: "queued" as const,
    chunksIndexed: 0,
  };
  progressStore.set(jobId, { ...current, ...update });
}

// ─── RealTimeIndexer ──────────────────────────────────────────────────────────

export class RealTimeIndexer {
  private queue: any | null = null;
  private worker: any | null = null;
  private isInitialized = false;

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    const { createQueue, createWorker } = await import("../../lib/queueFactory");

    this.queue = createQueue<IndexJobPayload>("rag-index-queue");
    this.worker = createWorker<IndexJobPayload, IndexResult>(
      "rag-index-queue",
      async (job: any) => {
        logger.info("Processing index job", { jobId: job.data.jobId, sourceId: job.data.sourceId });
        return processIndexJob(job.data);
      }
    );

    if (this.worker) {
      this.worker.on("completed", (job: any, result: IndexResult) => {
        logger.info("Index job completed via worker", {
          jobId: result.jobId,
          chunksCreated: result.chunksCreated,
        });
      });

      this.worker.on("failed", (job: any, err: Error) => {
        logger.error("Index job failed", {
          jobId: job?.data?.jobId,
          error: err.message,
        });
        if (job?.data?.jobId) {
          updateProgress(job.data.jobId, { status: "failed", error: err.message });
        }
      });
    }

    this.isInitialized = true;
    logger.info("RealTimeIndexer initialized", { queueAvailable: !!this.queue });
  }

  /**
   * Enqueue a document for background indexing.
   * If Redis is unavailable, falls back to synchronous processing.
   */
  async enqueue(
    payload: Omit<IndexJobPayload, "jobId">,
    priority: IndexPriority = 5
  ): Promise<{ jobId: string; queued: boolean }> {
    const jobId = crypto.randomUUID();
    const fullPayload: IndexJobPayload = { ...payload, jobId, priority };

    updateProgress(jobId, {
      jobId,
      sourceId: payload.sourceId,
      status: "queued",
      chunksIndexed: 0,
    });

    if (this.queue) {
      try {
        await this.queue.add("index", fullPayload, {
          priority,
          attempts: 2,
          backoff: { type: "exponential", delay: 1000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 50 },
        });
        logger.info("Index job enqueued", { jobId, sourceId: payload.sourceId, priority });
        return { jobId, queued: true };
      } catch (err) {
        logger.warn("Queue unavailable, falling back to sync indexing", { error: String(err) });
      }
    }

    // Synchronous fallback
    try {
      await processIndexJob(fullPayload);
    } catch (err) {
      logger.error("Sync indexing failed", { jobId, error: String(err) });
    }

    return { jobId, queued: false };
  }

  /**
   * Remove stale chunks for a source (used when a document is re-uploaded).
   */
  async removeStaleChunks(userId: string, sourceId: string): Promise<number> {
    try {
      const result = await db
        .delete(ragChunks)
        .where(and(eq(ragChunks.userId, userId), eq(ragChunks.sourceId, sourceId)));
      const count = (result as any).rowCount ?? 0;
      logger.info("Stale chunks removed", { userId, sourceId, count });
      return count;
    } catch (err) {
      logger.error("Failed to remove stale chunks", { userId, sourceId, error: String(err) });
      return 0;
    }
  }

  /**
   * Periodic maintenance: deactivate expired chunks.
   */
  async runMaintenance(): Promise<{ deactivated: number }> {
    try {
      const result = await db
        .update(ragChunks)
        .set({ isActive: false })
        .where(
          and(
            eq(ragChunks.isActive, true),
            lt(ragChunks.expiresAt, new Date())
          )
        );
      const deactivated = (result as any).rowCount ?? 0;
      logger.info("Maintenance complete", { deactivated });
      return { deactivated };
    } catch (err) {
      logger.error("Maintenance failed", { error: String(err) });
      return { deactivated: 0 };
    }
  }

  async close(): Promise<void> {
    if (this.worker) await this.worker.close();
    if (this.queue) await this.queue.close();
    this.isInitialized = false;
  }
}

export const realTimeIndexer = new RealTimeIndexer();
