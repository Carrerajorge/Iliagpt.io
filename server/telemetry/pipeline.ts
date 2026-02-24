import { Logger } from "../lib/logger";
import { telemetryEmitter } from "./emitter";
import type { DashboardEvent } from "./eventSchema";
import { pipelineMetrics } from "./pipelineMetrics";
import { validateEvent } from "./eventSchema";
import { writeBatch } from "./sink";

interface TelemetryPipelineOptions {
  db: unknown;
  batchSize?: number;
  flushIntervalMs?: number;
  maxQueueSize?: number;
  maxRetries?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
}

export interface TelemetryPipelineController {
  stop: () => Promise<void>;
}

interface PipelineConfig {
  batchSize: number;
  flushIntervalMs: number;
  maxQueueSize: number;
  maxRetries: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
}

const DEFAULTS: PipelineConfig = {
  batchSize: 100,
  flushIntervalMs: 2_000,
  maxQueueSize: 5_000,
  maxRetries: 4,
  baseBackoffMs: 500,
  maxBackoffMs: 30_000,
};

type DbLike = {
  execute: (query: unknown) => Promise<unknown>;
};

const eventQueue: DashboardEvent[] = [];
let pipelineConfig: PipelineConfig = DEFAULTS;
let queueDrainTimer: ReturnType<typeof setInterval> | undefined;
let isRunning = false;
let isFlushing = false;
let dbHandle: DbLike | undefined;
let eventHandler: ((payload: unknown) => void) | undefined;
let nextAllowedFlushAt = 0;
let consecutiveErrors = 0;

function clampNumber(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function normalizeConfig(options: TelemetryPipelineOptions): PipelineConfig {
  return {
    batchSize: clampNumber(options.batchSize, DEFAULTS.batchSize, 1, 2_000),
    flushIntervalMs: clampNumber(options.flushIntervalMs, DEFAULTS.flushIntervalMs, 200, 120_000),
    maxQueueSize: clampNumber(options.maxQueueSize, DEFAULTS.maxQueueSize, 200, 500_000),
    maxRetries: clampNumber(options.maxRetries, DEFAULTS.maxRetries, 1, 16),
    baseBackoffMs: clampNumber(options.baseBackoffMs, DEFAULTS.baseBackoffMs, 250, 60_000),
    maxBackoffMs: clampNumber(options.maxBackoffMs, DEFAULTS.maxBackoffMs, 1_000, 300_000),
  };
}

function safeDbHandle(raw: unknown): DbLike | undefined {
  if (!raw || typeof raw !== "object" || !("execute" in raw)) {
    return undefined;
  }
  return raw as DbLike;
}

function emitDroppedEvents(count: number): void {
  for (let i = 0; i < count; i += 1) {
    pipelineMetrics.recordDropped();
  }
}

function computeBackoffDuration(retryIndex: number): number {
  const exponential = pipelineConfig.baseBackoffMs * 2 ** retryIndex;
  return Math.min(pipelineConfig.maxBackoffMs, exponential);
}

function onTelemetryEvent(payload: unknown): void {
  if (!isRunning || !dbHandle) {
    return;
  }

  const validation = validateEvent(payload);
  if (!validation.ok) {
    Logger.warn("[Telemetry] Rejected invalid event", {
      error: validation.error,
    });
    pipelineMetrics.recordFailed();
    return;
  }

  if (eventQueue.length >= pipelineConfig.maxQueueSize) {
    eventQueue.shift();
    pipelineMetrics.recordDropped();
  }

  eventQueue.push(validation.event);
  pipelineMetrics.recordEmitted();

  if (!isFlushing) {
    void flushQueue();
  }
}

async function flushQueue(force = false): Promise<void> {
  if (!dbHandle || isFlushing || !isRunning) {
    return;
  }

  if (!force && Date.now() < nextAllowedFlushAt) {
    return;
  }

  const snapshot = eventQueue.splice(0, pipelineConfig.batchSize);
  if (snapshot.length === 0) {
    return;
  }

  isFlushing = true;
  try {
    const inserted = await writeBatch(dbHandle, snapshot);
    const insertedCount = Number.isFinite(Number(inserted)) ? Number(inserted) : snapshot.length;
    const normalizedInserted = clampNumber(insertedCount, snapshot.length, 0, snapshot.length);

    for (let i = 0; i < normalizedInserted; i += 1) {
      pipelineMetrics.recordFlushed();
    }

    const deduped = snapshot.length - normalizedInserted;
    if (deduped > 0) {
      emitDroppedEvents(deduped);
      Logger.debug("[Telemetry] Batch deduplicated by idempotency key", {
        dropped: deduped,
        requested: snapshot.length,
      });
    }

    consecutiveErrors = 0;
    nextAllowedFlushAt = 0;
  } catch (error) {
    eventQueue.unshift(...snapshot);
    if (eventQueue.length > pipelineConfig.maxQueueSize) {
      const overflow = eventQueue.length - pipelineConfig.maxQueueSize;
      if (overflow > 0) {
        eventQueue.splice(0, overflow);
        emitDroppedEvents(overflow);
      }
    }

    pipelineMetrics.recordFailed();
    consecutiveErrors = Math.min(consecutiveErrors + 1, pipelineConfig.maxRetries);
    const backoff = computeBackoffDuration(consecutiveErrors);
    nextAllowedFlushAt = Date.now() + backoff;

    Logger.warn("[Telemetry] Pipeline flush failed", {
      error: (error as Error)?.message ?? String(error),
      batchSize: snapshot.length,
      retry: consecutiveErrors,
      nextFlushAt: new Date(nextAllowedFlushAt).toISOString(),
    });
  } finally {
    isFlushing = false;
  }
}

/**
 * Start telemetry event ingestion pipeline.
 *
 * - Validates events at boundary
 * - Buffers using bounded in-memory queue
 * - Batches writes to DB
 * - Applies exponential backoff on failures
 */
export function startTelemetryPipeline(options: TelemetryPipelineOptions): TelemetryPipelineController {
  if (isRunning) {
    return {
      stop: async () => {
        // already running with same controller
      },
    };
  }

  const dbCandidate = safeDbHandle(options.db);
  if (!dbCandidate) {
    Logger.warn("[Telemetry] Pipeline disabled: invalid db handle");
    return { stop: async () => {} };
  }

  dbHandle = dbCandidate;
  pipelineConfig = normalizeConfig({
    ...options,
    batchSize: options.batchSize,
    flushIntervalMs: options.flushIntervalMs,
    maxQueueSize: options.maxQueueSize,
    maxRetries: options.maxRetries,
    baseBackoffMs: options.baseBackoffMs,
    maxBackoffMs: options.maxBackoffMs,
  });

  isRunning = true;
  eventHandler = onTelemetryEvent;
  telemetryEmitter.on("event", eventHandler);

  queueDrainTimer = setInterval(() => {
    void flushQueue();
  }, pipelineConfig.flushIntervalMs);
  queueDrainTimer.unref?.();

  Logger.info("[Telemetry] Pipeline started", {
    batchSize: pipelineConfig.batchSize,
    flushIntervalMs: pipelineConfig.flushIntervalMs,
    maxQueueSize: pipelineConfig.maxQueueSize,
  });

  const stop = async (): Promise<void> => {
    if (!isRunning) {
      return;
    }

    isRunning = false;
    if (queueDrainTimer) {
      clearInterval(queueDrainTimer);
      queueDrainTimer = undefined;
    }

    if (eventHandler) {
      telemetryEmitter.removeListener("event", eventHandler);
      eventHandler = undefined;
    }

    await flushQueue(true);
    Logger.info("[Telemetry] Pipeline stopped", {
      queueDepth: eventQueue.length,
    });
  };

  return { stop };
}
