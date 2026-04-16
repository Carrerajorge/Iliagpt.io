import { nanoid } from "nanoid";
import type { IntentType, SupportedLocale } from "../../../shared/schemas/intent";
import { logStructured } from "./telemetry";

export type FeedbackType =
  | "correction"
  | "rephrase"
  | "format_change"
  | "early_stop"
  | "clarification_accepted"
  | "clarification_rejected";

export interface FeedbackSignal {
  id: string;
  type: FeedbackType;
  original_text: string;
  original_intent: IntentType;
  corrected_intent?: IntentType;
  corrected_format?: string;
  rephrased_text?: string;
  locale: SupportedLocale;
  timestamp: Date;
  session_id?: string;
  confidence_before?: number;
  confidence_after?: number;
  execution_progress?: number;
  metadata?: Record<string, unknown>;
}

export interface FeedbackContext {
  original_text: string;
  original_intent: IntentType;
  corrected_intent?: IntentType;
  corrected_format?: string;
  rephrased_text?: string;
  locale: SupportedLocale;
  session_id?: string;
  confidence?: number;
  execution_progress?: number;
  metadata?: Record<string, unknown>;
}

interface FeedbackEntry {
  signal: FeedbackSignal;
  expires_at: number;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_FEEDBACK_ENTRIES = 10000;
const BATCH_SIZE = 100;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

const feedbackStore: Map<string, FeedbackEntry> = new Map();
let cleanupTimer: NodeJS.Timeout | null = null;

export function recordFeedback(
  type: FeedbackType,
  context: FeedbackContext,
  ttlMs: number = DEFAULT_TTL_MS
): FeedbackSignal {
  const signal: FeedbackSignal = {
    id: nanoid(16),
    type,
    original_text: context.original_text,
    original_intent: context.original_intent,
    corrected_intent: context.corrected_intent,
    corrected_format: context.corrected_format,
    rephrased_text: context.rephrased_text,
    locale: context.locale,
    timestamp: new Date(),
    session_id: context.session_id,
    confidence_before: context.confidence,
    execution_progress: context.execution_progress,
    metadata: context.metadata
  };

  const entry: FeedbackEntry = {
    signal,
    expires_at: Date.now() + ttlMs
  };

  if (feedbackStore.size >= MAX_FEEDBACK_ENTRIES) {
    pruneExpiredEntries();
    if (feedbackStore.size >= MAX_FEEDBACK_ENTRIES) {
      const oldestKey = feedbackStore.keys().next().value;
      if (oldestKey) feedbackStore.delete(oldestKey);
    }
  }

  feedbackStore.set(signal.id, entry);

  logStructured("info", "Feedback recorded", {
    feedback_id: signal.id,
    type,
    original_intent: signal.original_intent,
    corrected_intent: signal.corrected_intent,
    locale: signal.locale
  });

  return signal;
}

export function getFeedbackById(id: string): FeedbackSignal | null {
  const entry = feedbackStore.get(id);
  if (!entry) return null;
  if (entry.expires_at < Date.now()) {
    feedbackStore.delete(id);
    return null;
  }
  return entry.signal;
}

export function getFeedbackBatch(options?: {
  type?: FeedbackType;
  limit?: number;
  since?: Date;
  locale?: SupportedLocale;
}): FeedbackSignal[] {
  const now = Date.now();
  const limit = options?.limit ?? BATCH_SIZE;
  const result: FeedbackSignal[] = [];

  for (const [id, entry] of feedbackStore.entries()) {
    if (entry.expires_at < now) {
      feedbackStore.delete(id);
      continue;
    }

    const signal = entry.signal;

    if (options?.type && signal.type !== options.type) continue;
    if (options?.locale && signal.locale !== options.locale) continue;
    if (options?.since && signal.timestamp < options.since) continue;

    result.push(signal);
    if (result.length >= limit) break;
  }

  return result;
}

export function getAllFeedback(): FeedbackSignal[] {
  const now = Date.now();
  const result: FeedbackSignal[] = [];

  for (const [id, entry] of feedbackStore.entries()) {
    if (entry.expires_at < now) {
      feedbackStore.delete(id);
      continue;
    }
    result.push(entry.signal);
  }

  return result;
}

export interface ProcessedBatchResult {
  total_processed: number;
  corrections: number;
  rephrases: number;
  format_changes: number;
  early_stops: number;
  clarification_accepted: number;
  clarification_rejected: number;
  hard_negatives_generated: number;
  aliases_proposed: number;
  processing_time_ms: number;
}

export type FeedbackProcessor = (signals: FeedbackSignal[]) => Promise<void>;

const processors: FeedbackProcessor[] = [];

export function registerFeedbackProcessor(processor: FeedbackProcessor): void {
  processors.push(processor);
}

export async function processFeedbackBatch(options?: {
  type?: FeedbackType;
  limit?: number;
  deleteAfterProcess?: boolean;
}): Promise<ProcessedBatchResult> {
  const startTime = Date.now();
  const deleteAfterProcess = options?.deleteAfterProcess ?? true;

  const batch = getFeedbackBatch({
    type: options?.type,
    limit: options?.limit ?? BATCH_SIZE
  });

  const result: ProcessedBatchResult = {
    total_processed: batch.length,
    corrections: 0,
    rephrases: 0,
    format_changes: 0,
    early_stops: 0,
    clarification_accepted: 0,
    clarification_rejected: 0,
    hard_negatives_generated: 0,
    aliases_proposed: 0,
    processing_time_ms: 0
  };

  if (batch.length === 0) {
    return result;
  }

  for (const signal of batch) {
    switch (signal.type) {
      case "correction":
        result.corrections++;
        break;
      case "rephrase":
        result.rephrases++;
        break;
      case "format_change":
        result.format_changes++;
        break;
      case "early_stop":
        result.early_stops++;
        break;
      case "clarification_accepted":
        result.clarification_accepted++;
        break;
      case "clarification_rejected":
        result.clarification_rejected++;
        break;
    }
  }

  for (const processor of processors) {
    try {
      await processor(batch);
    } catch (error) {
      logStructured("error", "Feedback processor failed", {
        error: (error as Error).message
      });
    }
  }

  if (deleteAfterProcess) {
    for (const signal of batch) {
      feedbackStore.delete(signal.id);
    }
  }

  result.processing_time_ms = Date.now() - startTime;

  logStructured("info", "Feedback batch processed", {
    total: result.total_processed,
    corrections: result.corrections,
    rephrases: result.rephrases,
    format_changes: result.format_changes
  });

  return result;
}

function pruneExpiredEntries(): number {
  const now = Date.now();
  let pruned = 0;

  for (const [id, entry] of feedbackStore.entries()) {
    if (entry.expires_at < now) {
      feedbackStore.delete(id);
      pruned++;
    }
  }

  if (pruned > 0) {
    logStructured("info", "Pruned expired feedback entries", { count: pruned });
  }

  return pruned;
}

export function startCleanupTimer(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    pruneExpiredEntries();
  }, CLEANUP_INTERVAL_MS);
}

export function stopCleanupTimer(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

export function getFeedbackStats(): {
  total_entries: number;
  by_type: Record<FeedbackType, number>;
  by_locale: Record<string, number>;
  correction_rate: number;
  early_stop_rate: number;
  clarification_success_rate: number;
} {
  const now = Date.now();
  const byType: Record<FeedbackType, number> = {
    correction: 0,
    rephrase: 0,
    format_change: 0,
    early_stop: 0,
    clarification_accepted: 0,
    clarification_rejected: 0
  };
  const byLocale: Record<string, number> = {};
  let total = 0;

  for (const [id, entry] of feedbackStore.entries()) {
    if (entry.expires_at < now) {
      feedbackStore.delete(id);
      continue;
    }
    
    const signal = entry.signal;
    total++;
    byType[signal.type]++;
    byLocale[signal.locale] = (byLocale[signal.locale] || 0) + 1;
  }

  const clarificationTotal = byType.clarification_accepted + byType.clarification_rejected;

  return {
    total_entries: total,
    by_type: byType,
    by_locale: byLocale,
    correction_rate: total > 0 ? byType.correction / total : 0,
    early_stop_rate: total > 0 ? byType.early_stop / total : 0,
    clarification_success_rate: clarificationTotal > 0
      ? byType.clarification_accepted / clarificationTotal
      : 0
  };
}

export function clearFeedbackStore(): void {
  feedbackStore.clear();
  logStructured("info", "Feedback store cleared", {});
}

export function recordCorrection(
  originalText: string,
  originalIntent: IntentType,
  correctedIntent: IntentType,
  locale: SupportedLocale,
  sessionId?: string
): FeedbackSignal {
  return recordFeedback("correction", {
    original_text: originalText,
    original_intent: originalIntent,
    corrected_intent: correctedIntent,
    locale,
    session_id: sessionId
  });
}

export function recordRephrase(
  originalText: string,
  rephrasedText: string,
  intent: IntentType,
  locale: SupportedLocale,
  sessionId?: string
): FeedbackSignal {
  return recordFeedback("rephrase", {
    original_text: originalText,
    rephrased_text: rephrasedText,
    original_intent: intent,
    locale,
    session_id: sessionId
  });
}

export function recordFormatChange(
  originalText: string,
  intent: IntentType,
  originalFormat: string,
  correctedFormat: string,
  locale: SupportedLocale,
  sessionId?: string
): FeedbackSignal {
  return recordFeedback("format_change", {
    original_text: originalText,
    original_intent: intent,
    corrected_format: correctedFormat,
    locale,
    session_id: sessionId,
    metadata: { original_format: originalFormat }
  });
}

export function recordEarlyStop(
  originalText: string,
  intent: IntentType,
  executionProgress: number,
  locale: SupportedLocale,
  sessionId?: string
): FeedbackSignal {
  return recordFeedback("early_stop", {
    original_text: originalText,
    original_intent: intent,
    execution_progress: executionProgress,
    locale,
    session_id: sessionId
  });
}

export function recordClarificationResult(
  accepted: boolean,
  originalText: string,
  originalIntent: IntentType,
  selectedIntent: IntentType | null,
  locale: SupportedLocale,
  sessionId?: string
): FeedbackSignal {
  return recordFeedback(
    accepted ? "clarification_accepted" : "clarification_rejected",
    {
      original_text: originalText,
      original_intent: originalIntent,
      corrected_intent: selectedIntent || undefined,
      locale,
      session_id: sessionId
    }
  );
}
