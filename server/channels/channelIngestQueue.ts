import { env } from "../config/env";
import crypto from "crypto";
import { Logger } from "../lib/logger";
import { createQueue, QUEUE_NAMES } from "../lib/queueFactory";
import { emitQueueEvent } from "../telemetry/emit";
import { processChannelIngestJob } from "./channelIngestService";
import type { ChannelIngestJob } from "./types";
import { INGEST_RUN_ID_RE, MAX_INGEST_RUN_ID_LENGTH, validateChannelIngestJob } from "./types";

const DEFAULT_MAX_INGEST_JOB_BYTES = 32 * 1024;
const MAX_JOB_BYTES_FLOOR = 4 * 1024;
const MAX_JOB_BYTES_CEILING = 256 * 1024;
const HASH_PAYLOAD_MAX_BYTES = 64 * 1024;
const INGEST_IDEMPOTENCY_TTL_MS = parsePositiveInt(
  env.CHANNEL_INGEST_IDEMPOTENCY_TTL_MS,
  12 * 60 * 1000,
  5_000,
  6 * 60 * 60_000,
);
const MAX_INGEST_IDEMPOTENCY_ENTRIES = parsePositiveInt(
  env.CHANNEL_INGEST_IDEMPOTENCY_MAX_ENTRIES,
  60_000,
  1_000,
  500_000,
);
const INGEST_QUEUE_ATTEMPTS = 4;
const INGEST_QUEUE_BACKOFF_MS = 750;
const INGEST_QUEUE_MAX_ATTEMPTS = 8;
const INGEST_QUEUE_MAX_BACKOFF_MS = 20_000;
const INGEST_QUEUE_FAILURE_THRESHOLD = parsePositiveInt(
  env.CHANNEL_INGEST_QUEUE_FAILURE_THRESHOLD,
  4,
  1,
  20,
);
const INGEST_QUEUE_CIRCUIT_OPEN_MS = parsePositiveInt(
  env.CHANNEL_INGEST_QUEUE_CIRCUIT_OPEN_MS,
  45_000,
  5_000,
  10 * 60_000,
);
const INGEST_DEAD_LETTER_TTL_MS = 12 * 60 * 60 * 1000;
const INGEST_DEAD_LETTER_MAX_ENTRIES = 2_000;
const INGEST_DEAD_LETTER_SAMPLE_LENGTH = 1200;
const INGEST_QUEUE_BACKPRESSURE_LIMIT = parsePositiveInt(
  env.CHANNEL_INGEST_QUEUE_BACKPRESSURE_LIMIT,
  1_200,
  200,
  5_000,
);
const INGEST_QUEUE_OPERATION_TIMEOUT_MS = parsePositiveInt(
  env.CHANNEL_INGEST_QUEUE_OPERATION_TIMEOUT_MS,
  4_000,
  250,
  30_000,
);
const INGEST_RECEIVED_AT_MAX_FUTURE_MS = 5 * 60 * 1000;
const INGEST_RECEIVED_AT_MAX_PAST_MS = 7 * 24 * 60 * 60 * 1000;
const INPROCESS_MAX_CONCURRENCY = parsePositiveInt(
  env.CHANNEL_INGEST_INPROCESS_CONCURRENCY,
  4,
  1,
  128,
);
const INPROCESS_TASK_TIMEOUT_MS = parsePositiveInt(
  env.CHANNEL_INGEST_INPROCESS_TIMEOUT_MS,
  120_000,
  2_000,
  300_000,
);
const INPROCESS_TASK_QUEUE_MAX = parsePositiveInt(
  env.CHANNEL_INGEST_INPROCESS_QUEUE_MAX,
  400,
  32,
  20_000,
);
const INPROCESS_DEDUPE_TTL_MS = parsePositiveInt(
  env.CHANNEL_INGEST_INPROCESS_DEDUPE_TTL_MS,
  10 * 60 * 1000,
  1_000,
  30 * 60 * 1000,
);
const INPROCESS_RESERVATION_TTL_MS = parsePositiveInt(
  env.CHANNEL_INGEST_INPROCESS_RESERVATION_TTL_MS,
  8 * 60_000,
  30_000,
  45 * 60_000,
);
const RUN_SCOPE_KEY_HASH_LEN = 20;

const MAX_INGEST_INPROCESS_RUNS = 10_000;

type IngestDeadLetterEntry = {
  createdAt: string;
  channel: string;
  reason: string;
  runId: string;
  jobId: string;
  traceKey: string;
  error: string;
  payloadSample: string;
};

type InProcessTaskResult = {
  ok: true;
} | {
  ok: false;
  timedOut: boolean;
  error: string;
};

type InProcessTask = {
  job: ChannelIngestJob;
  jobId: string;
  runId: string;
  runScopeKey: string;
  traceKey: string;
  submittedAt: number;
};

function normalizeRunScopeInput(raw: unknown): string {
  return String(raw || "")
    .normalize("NFKC")
    .replace(/\u0000/g, "")
    .replace(/[\x00-\x1F\x7F-\x9F]/g, "")
    .replace(/[^A-Za-z0-9._:\-]/g, "_")
    .slice(0, 128);
}

function buildRunScopeKey(channel: string, runId: string, payloadFingerprint = ""): string {
  const normalizedChannel = normalizeRunScopeInput(channel);
  const normalizedRunId = normalizeRunScopeInput(runId);
  const normalizedFingerprint = normalizeRunScopeInput(payloadFingerprint)
    .replace(/[^a-fA-F0-9]/g, "")
    .toLowerCase()
    .slice(0, RUN_SCOPE_KEY_HASH_LEN);

  return `${normalizedChannel}::${normalizedRunId}::${normalizedFingerprint || "nofp"}`;
}

const INGEST_STATS = {
  submitted: 0,
  queueAccepted: 0,
  queueDuplicate: 0,
  queueRejected: 0,
  queueCircuitOpen: 0,
  queueCircuitRecovered: 0,
  queueFailure: 0,
  queueBackpressured: 0,
  queueFallback: 0,
  inprocessQueued: 0,
  inprocessDuplicate: 0,
  inprocessRejected: 0,
  inprocessCompleted: 0,
  inprocessTimeout: 0,
  inprocessFailed: 0,
  deadLettered: 0,
  idempotencyDuplicate: 0,
};

const INGEST_DEAD_LETTERS: IngestDeadLetterEntry[] = [];
const inProcessQueue: Array<InProcessTask> = [];
const ingestIdempotencyLedger = new Map<string, number>();
const inProcessDedupWindow = new Map<string, number>();
const inProcessTaskReservations = new Map<string, number>();
const queueFailureRecoveryWindow = new Map<string, { attempts: number; lastAttemptAt: number }>();

let inProcessRunning = 0;
let inProcessPumpScheduled = false;
let queueCircuitOpenUntil = 0;
let queueFailureSequence = 0;

export const channelIngestQueue = createQueue<ChannelIngestJob>(QUEUE_NAMES.CHANNEL_INGEST);

function parsePositiveInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(raw || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}

function parseIngestMaxBytes(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  if (parsed < MAX_JOB_BYTES_FLOOR) return MAX_JOB_BYTES_FLOOR;
  if (parsed > MAX_JOB_BYTES_CEILING) return MAX_JOB_BYTES_CEILING;
  return parsed;
}

function normalizeText(value: unknown, maxLength = MAX_INGEST_RUN_ID_LENGTH): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").replace(/\u0000/g, "").replace(/[\x00-\x1f\x7f-\x9f]/g, "").trim();
  if (normalized.length === 0 || normalized.length > maxLength) return null;
  return normalized;
}

function normalizeRunId(raw: unknown): string | null {
  const value = normalizeText(raw, MAX_INGEST_RUN_ID_LENGTH);
  if (!value || !INGEST_RUN_ID_RE.test(value)) return null;
  return value;
}

function parseQueueBackoff(value: string | undefined, fallback: number, min: number, max: number): number {
  return parsePositiveInt(value, fallback, min, max);
}

function resolveReceivedAt(raw: string | undefined): string | null {
  if (!raw) return null;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return null;

  const now = Date.now();
  if (parsed > now + INGEST_RECEIVED_AT_MAX_FUTURE_MS || parsed < now - INGEST_RECEIVED_AT_MAX_PAST_MS) {
    return null;
  }

  return new Date(parsed).toISOString();
}

const MAX_INGEST_JOB_BYTES = parseIngestMaxBytes(env.MAX_CHANNEL_INGEST_JOB_BYTES, DEFAULT_MAX_INGEST_JOB_BYTES);
const INGEST_QUEUE_ATTEMPTS_SAFE = parseQueueBackoff(
  env.CHANNEL_INGEST_ATTEMPTS,
  INGEST_QUEUE_ATTEMPTS,
  1,
  INGEST_QUEUE_MAX_ATTEMPTS,
);
const INGEST_QUEUE_BACKOFF_SAFE = parseQueueBackoff(
  env.CHANNEL_INGEST_BACKOFF_MS,
  INGEST_QUEUE_BACKOFF_MS,
  200,
  INGEST_QUEUE_MAX_BACKOFF_MS,
);

function normalizeErrorMessage(error: unknown): string {
  return String((error as Error)?.message || error || "unknown")
    .normalize("NFKC")
    .replace(/\u0000/g, "")
    .replace(/[\x00-\x1f\x7f-\x9f]/g, "")
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, "")
    .slice(0, 1_000);
}

function pruneDeadLetters(nowMs = Date.now()): void {
  for (let i = INGEST_DEAD_LETTERS.length - 1; i >= 0; i--) {
    const entry = INGEST_DEAD_LETTERS[i];
    const createdAtMs = Date.parse(entry.createdAt);
    if (!Number.isFinite(createdAtMs) || nowMs - createdAtMs > INGEST_DEAD_LETTER_TTL_MS) {
      INGEST_DEAD_LETTERS.splice(i, 1);
    }
  }

  if (INGEST_DEAD_LETTERS.length <= INGEST_DEAD_LETTER_MAX_ENTRIES) return;
  const excess = INGEST_DEAD_LETTERS.length - INGEST_DEAD_LETTER_MAX_ENTRIES;
  if (excess > 0) {
    INGEST_DEAD_LETTERS.splice(0, excess);
  }
}

function isQueueCircuitOpen(nowMs = Date.now()): boolean {
  if (!queueCircuitOpenUntil || nowMs >= queueCircuitOpenUntil) {
    if (queueCircuitOpenUntil) {
      queueFailureRecoveryWindow.clear();
      queueCircuitOpenUntil = 0;
      queueFailureSequence = 0;
    }
    return false;
  }
  return true;
}

function markQueueSuccess(): void {
  if (queueFailureRecoveryWindow.size === 0 && queueCircuitOpenUntil === 0) {
    return;
  }

  queueFailureRecoveryWindow.clear();
  queueFailureSequence = 0;
  if (queueCircuitOpenUntil) {
    queueCircuitOpenUntil = 0;
    INGEST_STATS.queueCircuitRecovered += 1;
    Logger.info("[Channels] ingest queue circuit recovered");
  }
}

function markQueueFailure(error: unknown): void {
  const now = Date.now();
  const sequenceKey = "global";
  const state = queueFailureRecoveryWindow.get(sequenceKey) || { attempts: 0, lastAttemptAt: now };
  const elapsedSinceLast = now - state.lastAttemptAt;
  const decayWindowMs = INGEST_QUEUE_CIRCUIT_OPEN_MS;
  const recovery = elapsedSinceLast > decayWindowMs ? 0 : state.attempts;
  const nextAttempts = recovery + 1;

  queueFailureRecoveryWindow.set(sequenceKey, {
    attempts: nextAttempts,
    lastAttemptAt: now,
  });
  queueFailureSequence += 1;
  INGEST_STATS.queueFailure += 1;

  if (nextAttempts >= INGEST_QUEUE_FAILURE_THRESHOLD) {
    queueCircuitOpenUntil = now + INGEST_QUEUE_CIRCUIT_OPEN_MS;
    INGEST_STATS.queueCircuitOpen += 1;
    Logger.error("[Channels] ingest queue circuit opened", {
      failures: nextAttempts,
      sequence: queueFailureSequence,
      threshold: INGEST_QUEUE_FAILURE_THRESHOLD,
      reopenAt: new Date(queueCircuitOpenUntil).toISOString(),
      error: normalizeErrorMessage(error),
    });
  } else {
    Logger.warn("[Channels] ingest queue operation failed", {
      failures: nextAttempts,
      threshold: INGEST_QUEUE_FAILURE_THRESHOLD,
      error: normalizeErrorMessage(error),
    });
  }
}

function addDeadLetter(
  reason: string,
  job: unknown,
  traceKey: string,
  jobId: string,
  runId: string,
  error?: unknown,
): void {
  pruneDeadLetters();
  const payloadSample = stableStringify(job)
    .replace(/[\\\x00-\x1F\x7F]/g, "")
    .slice(0, INGEST_DEAD_LETTER_SAMPLE_LENGTH);
  const entry: IngestDeadLetterEntry = {
    createdAt: nowIso(),
    channel: (typeof job === "object" && job !== null && "channel" in (job as Record<string, unknown>))
      ? String((job as Record<string, unknown>).channel || "")
      : "unknown",
    reason,
    runId,
    jobId,
    traceKey,
    error: normalizeErrorMessage(error),
    payloadSample,
  };
  INGEST_DEAD_LETTERS.push(entry);
  INGEST_STATS.deadLettered += 1;

  Logger.warn("[Channels] ingest dead-lettered", {
    channel: entry.channel,
    reason,
    runId,
    traceKey,
    jobId,
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

async function withQueueTimeout<T>(operationName: string, task: () => Promise<T>): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`${operationName}_timeout`));
    }, INGEST_QUEUE_OPERATION_TIMEOUT_MS);

    task()
      .then((value) => {
        clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

function shouldUseQueue(): boolean {
  if (env.CHANNEL_INGEST_MODE === "queue") return true;
  if (env.CHANNEL_INGEST_MODE === "inprocess") return false;
  return env.NODE_ENV === "production";
}

function stableStringify(value: unknown, seen = new Set<object>(), depth = 0, maxDepth = 6): string {
  if (depth > maxDepth) {
    return "\"[max-depth-reached]\"";
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
    return JSON.stringify(value);
  }

  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }

  if (Array.isArray(value)) {
    const values = value.slice(0, 256).map((item) => stableStringify(item, seen, depth + 1, maxDepth));
    return `[${values.join(",")}]`;
  }

  if (typeof value === "object" && value !== null) {
    const asObject = value as Record<string, unknown>;
    const keys = Object.keys(asObject).sort();
    const seenObj = value as object;
    if (seen.has(seenObj)) {
      return "\"[circular]\"";
    }

    seen.add(seenObj);
    const entries = keys.slice(0, 256).map((key) => `${JSON.stringify(key)}:${stableStringify(asObject[key], seen, depth + 1, maxDepth)}`);
    seen.delete(seenObj);
    return `{${entries.join(",")}}`;
  }

  return "null";
}

function hashJobForIdempotency(job: ChannelIngestJob): string {
  const digest = crypto.createHash("sha256");
  digest.update(job.channel);

  if (job.channel === "telegram") {
    const update = job.update as any;
    digest.update(stableStringify(update?.message?.message_id || update?.callback_query?.id || update || {}));
  } else if (job.channel === "whatsapp_cloud") {
    const meta = (job as any).whatsappMeta || {};
    digest.update(meta.accountPhoneNumberId || "");
    digest.update(stableStringify((job as any).payload || {}));
  } else if (job.channel === "messenger") {
    const meta = (job as any).pageId || "";
    digest.update(meta);
    digest.update(stableStringify((job as any).payload || {}));
  } else {
    const meta = (job as any).appId || "";
    digest.update(meta);
    digest.update(stableStringify((job as any).payload || ""));
  }

  return digest.digest("hex");
}

function resolveRunId(job: ChannelIngestJob, jobId: string): string {
  return normalizeRunId((job as { runId?: unknown }).runId) || `run_${jobId.slice(0, 52)}`;
}

function pruneIngestIdempotency(nowMs = Date.now()): void {
  for (const [scopeKey, seenAt] of ingestIdempotencyLedger.entries()) {
    if (nowMs - seenAt > INGEST_IDEMPOTENCY_TTL_MS) {
      ingestIdempotencyLedger.delete(scopeKey);
    }
  }

  if (ingestIdempotencyLedger.size <= MAX_INGEST_IDEMPOTENCY_ENTRIES) {
    return;
  }

  const excess = ingestIdempotencyLedger.size - MAX_INGEST_IDEMPOTENCY_ENTRIES;
  let removed = 0;
  for (const key of ingestIdempotencyLedger.keys()) {
    ingestIdempotencyLedger.delete(key);
    removed += 1;
    if (removed >= excess) break;
  }
}

function acquireIngestIdempotency(runScopeKey: string): boolean {
  const now = Date.now();
  pruneIngestIdempotency(now);

  const previous = ingestIdempotencyLedger.get(runScopeKey);
  if (previous && now - previous < INGEST_IDEMPOTENCY_TTL_MS) {
    return false;
  }

  ingestIdempotencyLedger.set(runScopeKey, now);
  return true;
}

function pruneInProcessState(nowMs = Date.now()): void {
  for (const [runId, seenAt] of inProcessDedupWindow.entries()) {
    if (nowMs - seenAt > INPROCESS_DEDUPE_TTL_MS) {
      inProcessDedupWindow.delete(runId);
    }
  }

  for (const [runId, startedAt] of inProcessTaskReservations.entries()) {
    if (nowMs - startedAt > INPROCESS_RESERVATION_TTL_MS) {
      inProcessTaskReservations.delete(runId);
    }
  }

  if (inProcessDedupWindow.size <= MAX_INGEST_INPROCESS_RUNS) {
    return;
  }

  const excess = inProcessDedupWindow.size - MAX_INGEST_INPROCESS_RUNS;
  const keys = Array.from(inProcessDedupWindow.keys()).slice(0, excess);
  for (const key of keys) {
    inProcessDedupWindow.delete(key);
  }
}

export function resetChannelIngestQueueRuntimeForTests(clearStats = true): void {
  if (env.NODE_ENV !== "test") return;

  if (clearStats) {
    INGEST_STATS.submitted = 0;
    INGEST_STATS.queueAccepted = 0;
    INGEST_STATS.queueDuplicate = 0;
    INGEST_STATS.queueRejected = 0;
    INGEST_STATS.queueCircuitOpen = 0;
    INGEST_STATS.queueCircuitRecovered = 0;
    INGEST_STATS.queueFailure = 0;
    INGEST_STATS.queueBackpressured = 0;
    INGEST_STATS.queueFallback = 0;
    INGEST_STATS.inprocessQueued = 0;
    INGEST_STATS.inprocessDuplicate = 0;
    INGEST_STATS.inprocessRejected = 0;
    INGEST_STATS.inprocessCompleted = 0;
    INGEST_STATS.inprocessTimeout = 0;
    INGEST_STATS.inprocessFailed = 0;
    INGEST_STATS.deadLettered = 0;
    INGEST_STATS.idempotencyDuplicate = 0;
  }

  ingestIdempotencyLedger.clear();
  inProcessDedupWindow.clear();
  inProcessTaskReservations.clear();
  queueFailureRecoveryWindow.clear();
  inProcessQueue.length = 0;

  queueCircuitOpenUntil = 0;
  queueFailureSequence = 0;
  inProcessRunning = 0;
  inProcessPumpScheduled = false;
  pruneDeadLetters(0);
}

function reserveInprocessRun(runScopeKey: string): boolean {
  pruneInProcessState();
  if (inProcessTaskReservations.has(runScopeKey) || inProcessDedupWindow.has(runScopeKey)) {
    return false;
  }

  inProcessTaskReservations.set(runScopeKey, Date.now());
  inProcessDedupWindow.set(runScopeKey, Date.now());
  return true;
}

function releaseInprocessRun(runScopeKey: string): void {
  inProcessTaskReservations.delete(runScopeKey);
}

function isInProcessQueueBackpressured(): boolean {
  return inProcessQueue.length >= INPROCESS_TASK_QUEUE_MAX;
}

function markQueueBackpressure(cause: string, channel: string, runId: string): void {
  INGEST_STATS.queueBackpressured += 1;
  Logger.warn("[Channels] queue backpressure active", {
    channel,
    cause,
    runId,
  });
}

async function isQueueBackpressured(): Promise<boolean> {
  if (isQueueCircuitOpen()) {
    Logger.warn("[Channels] queue circuit open, forcing fallback path");
    return true;
  }

  if (!channelIngestQueue) return false;

  try {
    const [waiting, active, delayed] = await withQueueTimeout(
      "ingest_queue_pressure_probe",
      async () => await Promise.all([
        channelIngestQueue.getWaitingCount(),
        channelIngestQueue.getActiveCount(),
        channelIngestQueue.getDelayedCount(),
      ]),
    );

    const total = waiting + active + delayed;
    return total >= INGEST_QUEUE_BACKPRESSURE_LIMIT;
  } catch (error) {
    Logger.warn("[Channels] queue pressure check failed; processing in-process", {
      reason: normalizeErrorMessage(error),
      queueTimeoutMs: INGEST_QUEUE_OPERATION_TIMEOUT_MS,
    });
    return false;
  }
}

function runInProcessExecution(task: InProcessTask): Promise<InProcessTaskResult> {
  const processResult = processChannelIngestJob(task.job)
    .then<InProcessTaskResult>(() => ({ ok: true }))
    .catch((error) => ({
      ok: false,
      timedOut: false,
      error: normalizeErrorMessage(error),
    }));

  const timeoutResult = new Promise<InProcessTaskResult>((resolve) => {
    const timeoutId = setTimeout(() => {
      resolve({
        ok: false,
        timedOut: true,
        error: `in-process ingest timeout after ${INPROCESS_TASK_TIMEOUT_MS}ms`,
      });
    }, INPROCESS_TASK_TIMEOUT_MS);

    void processResult.then(() => clearTimeout(timeoutId)).catch(() => clearTimeout(timeoutId));
  });

  return Promise.race([processResult, timeoutResult]);
}

function enqueueInProcessIngest(task: InProcessTask): "accepted" | "duplicate" | "rejected" {
  if (isInProcessQueueBackpressured()) {
    return "rejected";
  }

  if (!reserveInprocessRun(task.runScopeKey)) {
    return "duplicate";
  }

  inProcessQueue.push(task);
  INGEST_STATS.inprocessQueued += 1;
  scheduleInProcessPump();
  return "accepted";
}

function scheduleInProcessPump(): void {
  if (inProcessPumpScheduled) return;
  inProcessPumpScheduled = true;
  void pumpInProcessQueue();
}

async function pumpInProcessQueue(): Promise<void> {
  try {
    while (inProcessRunning < INPROCESS_MAX_CONCURRENCY) {
      const task = inProcessQueue.shift();
      if (!task) {
        break;
      }

      inProcessRunning += 1;
      void runInProcessExecution(task)
        .then((result) => {
          if (result.ok) {
            INGEST_STATS.inprocessCompleted += 1;
            Logger.debug("[Channels] in-process ingest completed", {
              channel: task.job.channel,
              runId: task.runId,
              runScopeKey: task.runScopeKey,
              elapsedMs: Date.now() - task.submittedAt,
            });
            return;
          }

          if (result.timedOut) {
            INGEST_STATS.inprocessTimeout += 1;
            Logger.warn("[Channels] in-process ingest timed out", {
              channel: task.job.channel,
              runId: task.runId,
              runScopeKey: task.runScopeKey,
              error: result.error,
            });
            addDeadLetter("inprocess_timeout", task.job, task.traceKey, task.jobId, task.runId, result.error);
            return;
          }

          INGEST_STATS.inprocessFailed += 1;
          Logger.error("[Channels] in-process ingest failed", {
            channel: task.job.channel,
            runId: task.runId,
            runScopeKey: task.runScopeKey,
            error: result.error,
          });
          addDeadLetter("inprocess_failed", task.job, task.traceKey, task.jobId, task.runId, result.error);
        })
        .catch((unexpected) => {
          INGEST_STATS.inprocessFailed += 1;
          Logger.error("[Channels] in-process ingest unexpected error", {
            channel: task.job.channel,
            runId: task.runId,
            runScopeKey: task.runScopeKey,
            error: normalizeErrorMessage(unexpected),
          });
          addDeadLetter("inprocess_unexpected", task.job, task.traceKey, task.jobId, task.runId, unexpected);
        })
        .finally(() => {
          inProcessRunning -= 1;
          releaseInprocessRun(task.runScopeKey);
          scheduleInProcessPump();
        });
    }
  } finally {
    inProcessPumpScheduled = false;
    if (inProcessQueue.length > 0 && inProcessRunning < INPROCESS_MAX_CONCURRENCY) {
      scheduleInProcessPump();
    }
  }
}

function submitInProcessFallback(
  sanitizedJob: ChannelIngestJob,
  runId: string,
  traceKey: string,
  jobId: string,
  cause: string,
  runScopeKey: string,
): void {
  const result = enqueueInProcessIngest({
    job: sanitizedJob,
    jobId,
    runId,
    runScopeKey,
    traceKey,
    submittedAt: Date.now(),
  });

  if (result === "accepted") {
    INGEST_STATS.queueFallback += 1;
    Logger.warn("[Channels] Falling back to in-process ingest", {
      channel: sanitizedJob.channel,
      cause,
      runId,
      jobId,
      queueDepth: inProcessQueue.length,
      inProcessRunning,
    });
    return;
  }

  if (result === "duplicate") {
    INGEST_STATS.inprocessDuplicate += 1;
    Logger.info("[Channels] Duplicate in-process ingest ignored", {
      channel: sanitizedJob.channel,
      runScopeKey,
      runId,
      jobId,
      cause: "dedupe_replay",
    });
    return;
  }

  INGEST_STATS.inprocessRejected += 1;
  Logger.error("[Channels] in-process ingest queue saturated, rejecting message", {
    channel: sanitizedJob.channel,
    runScopeKey,
    runId,
    jobId,
    cause,
    queueDepth: inProcessQueue.length,
  });
  addDeadLetter("inprocess_queue_full", sanitizedJob, traceKey, jobId, runId, cause);
}

function validateReceivedAt(raw: string | undefined, channel: string, jobId: string): string | null {
  const parsed = resolveReceivedAt(raw || "");
  if (!parsed) {
    Logger.warn("[Channels] receivedAt dropped due to invalid timestamp", {
      channel,
      runId: jobId,
    });
    return null;
  }

  return parsed;
}

function finalizeIngestJob(job: ChannelIngestJob): ChannelIngestJob {
  const normalizedReceivedAt = validateReceivedAt(job.receivedAt, job.channel, hashJobForIdempotency(job));
  if (normalizedReceivedAt) {
    return { ...job, receivedAt: normalizedReceivedAt };
  }

  return { ...job, receivedAt: new Date().toISOString() };
}

export async function submitChannelIngest(job: unknown): Promise<void> {
  const parsed = validateChannelIngestJob(job);
  if (!parsed.ok) {
    Logger.warn("[Channels] rejected invalid ingest payload", {
      errors: parsed.errors,
      payloadKeys: job && typeof job === "object" ? Object.keys(job as Record<string, unknown>) : [],
    });
    addDeadLetter("invalid_job_schema", job, "ingest:invalid", "invalid", "ingest:invalid", parsed.errors);
    return;
  }

  const sanitizedJob = finalizeIngestJob(parsed.data);
  const canonicalPayload = stableStringify(sanitizedJob);
  const payloadByteLength = Buffer.byteLength(canonicalPayload, "utf8");
  INGEST_STATS.submitted += 1;
  if (payloadByteLength > MAX_INGEST_JOB_BYTES || canonicalPayload.length > HASH_PAYLOAD_MAX_BYTES) {
    const runId = resolveRunId(sanitizedJob, hashJobForIdempotency(sanitizedJob));
    Logger.warn("[Channels] Ingest payload too large to process safely", {
      channel: sanitizedJob.channel,
      runId,
      bytes: payloadByteLength,
    });
    addDeadLetter(
      "payload_too_large",
      sanitizedJob,
      `${sanitizedJob.channel}:${runId}`,
      hashJobForIdempotency(sanitizedJob),
      runId,
      { bytes: payloadByteLength },
    );
    return;
  }

  const useQueue = shouldUseQueue();
  const jobId = hashJobForIdempotency(sanitizedJob);
  const runId = resolveRunId(sanitizedJob, jobId);
  const traceKey = `${sanitizedJob.channel}:${runId}`;
  const runScopeKey = buildRunScopeKey(sanitizedJob.channel, runId, jobId);

  if (!acquireIngestIdempotency(runScopeKey)) {
    INGEST_STATS.idempotencyDuplicate += 1;
    Logger.info("[Channels] duplicate ingest submission ignored (idempotency)", {
      channel: sanitizedJob.channel,
      runId,
      runScopeKey,
      traceKey,
    });
    return;
  }

  if (useQueue && isQueueCircuitOpen()) {
    submitInProcessFallback(
      sanitizedJob,
      runId,
      traceKey,
      jobId,
      "queue_circuit_open",
      runScopeKey,
    );
    return;
  }

  if (useQueue && channelIngestQueue) {
    if (await isQueueBackpressured()) {
      markQueueBackpressure("waiting/active/delayed over limit", sanitizedJob.channel, runId);
      submitInProcessFallback(
        sanitizedJob,
        runId,
        traceKey,
        jobId,
        "queue_backpressured",
        runScopeKey,
      );
      return;
    }

    try {
      await withQueueTimeout(
        "ingest_queue_add",
        async () => await channelIngestQueue.add("ingest", sanitizedJob, {
          jobId,
          attempts: INGEST_QUEUE_ATTEMPTS_SAFE,
          backoff: {
            type: "exponential",
            delay: INGEST_QUEUE_BACKOFF_SAFE,
          },
          removeOnComplete: { age: 24 * 3600, count: 1000 },
          removeOnFail: { age: 7 * 24 * 3600 },
        }),
      );
      INGEST_STATS.queueAccepted += 1;
      markQueueSuccess();
      emitQueueEvent({ queueName: "channel-ingest", action: "accepted", channel: sanitizedJob.channel });
      return;
    } catch (err) {
      const message = normalizeErrorMessage(err);
      INGEST_STATS.queueRejected += 1;
      addDeadLetter("queue_add_failed", sanitizedJob, traceKey, jobId, runId, message);
      markQueueFailure(message);
      emitQueueEvent({ queueName: "channel-ingest", action: "failed", channel: sanitizedJob.channel, errorMessage: message });

      if (/already exists|duplicate/i.test(message)) {
        Logger.warn("[Channels] Duplicate ingest event ignored (queue dedupe)", {
          channel: sanitizedJob.channel,
          runId,
          traceKey,
          jobId,
        });
        INGEST_STATS.queueDuplicate += 1;
        return;
      }

      submitInProcessFallback(
        sanitizedJob,
        runId,
        traceKey,
        jobId,
        message,
        runScopeKey,
      );
      return;
    }
  }

  if (useQueue && !channelIngestQueue) {
    Logger.warn("[Channels] CHANNEL_INGEST_MODE requires Redis, falling back to in-process handler", {
      runId,
      channel: sanitizedJob.channel,
    });
  }

  submitInProcessFallback(
    sanitizedJob,
    runId,
    traceKey,
    jobId,
    "queue_disabled_or_not_configured",
    runScopeKey,
  );
  return;
}

export function getChannelIngestQueueStats() {
  const now = Date.now();
  const queueCircuit = {
    open: isQueueCircuitOpen(now),
    openUntilIso: queueCircuitOpenUntil > now ? new Date(queueCircuitOpenUntil).toISOString() : null,
  };
  return {
    ...INGEST_STATS,
    deadLetterSize: INGEST_DEAD_LETTERS.length,
    inProcessQueueDepth: inProcessQueue.length,
    ingestIdempotencyWindowSize: ingestIdempotencyLedger.size,
    queueCircuit,
  };
}

export function getChannelIngestDeadLetters(): IngestDeadLetterEntry[] {
  pruneDeadLetters();
  return [...INGEST_DEAD_LETTERS];
}
