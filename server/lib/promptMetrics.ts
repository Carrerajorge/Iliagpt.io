/**
 * Prompt Integrity Metrics
 *
 * Tracks prompt processing events for observability:
 * - Integrity check pass/fail counts
 * - Context truncation events
 * - Token estimation histograms
 * - Compression ratios
 *
 * Uses the existing Prometheus metrics infrastructure from server/metrics/prometheus.ts.
 */

import {
  registerCounter,
  registerHistogram,
  incCounter,
  observeHistogram,
} from "../metrics/prometheus";

// Register metrics on module load
registerCounter({
  name: "prompt_integrity_checks_total",
  help: "Total prompt integrity checks performed",
  labelNames: ["result"], // "pass" | "fail" | "skipped"
});

registerCounter({
  name: "prompt_truncation_total",
  help: "Total context truncation events",
  labelNames: ["reason"], // "context_budget" | "message_drop"
});

registerCounter({
  name: "prompt_dropped_chars_total",
  help: "Total characters dropped from user prompts (invariant: should be 0)",
  labelNames: [],
});

registerHistogram({
  name: "prompt_tokens_estimated",
  help: "Estimated token count of incoming user prompts",
  labelNames: [],
  buckets: [50, 100, 250, 500, 1000, 2000, 4000, 8000, 16000, 32000],
});

registerHistogram({
  name: "prompt_compression_ratio",
  help: "Ratio of final tokens to original tokens after context management",
  labelNames: [],
  buckets: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
});

/** Record an integrity check result. */
export function recordIntegrityCheck(result: "pass" | "fail" | "skipped"): void {
  incCounter("prompt_integrity_checks_total", { result });
}

/** Record a context truncation event. */
export function recordTruncation(originalTokens: number, finalTokens: number, droppedMessages: number): void {
  incCounter("prompt_truncation_total", { reason: "context_budget" });
  if (droppedMessages > 0) {
    incCounter("prompt_truncation_total", { reason: "message_drop" });
  }
  const ratio = originalTokens > 0 ? finalTokens / originalTokens : 1;
  observeHistogram("prompt_compression_ratio", ratio);
}

/** Record the estimated token count of an incoming prompt. */
export function recordPromptTokens(estimatedTokens: number): void {
  observeHistogram("prompt_tokens_estimated", estimatedTokens);
}

/** Record dropped characters (invariant: should always be called with 0). */
export function recordDroppedChars(count: number): void {
  if (count > 0) {
    incCounter("prompt_dropped_chars_total", {}, count);
  }
}

// ── Phase 7: Expanded Metrics ──────────────────────────────

registerHistogram({
  name: "prompt_analysis_duration_seconds",
  help: "Duration of prompt analysis (sync or async) in seconds",
  labelNames: ["mode"], // "sync" | "async"
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10, 30],
});

registerHistogram({
  name: "prompt_preprocess_duration_seconds",
  help: "Duration of prompt pre-processing pipeline in seconds",
  labelNames: [],
  buckets: [0.0001, 0.0005, 0.001, 0.002, 0.005, 0.01, 0.05],
});

registerCounter({
  name: "prompt_context_strategy_used_total",
  help: "Context management strategy usage count",
  labelNames: ["strategy"], // "sliding_window" | "importance_weighted" | "must_keep_spans"
});

registerCounter({
  name: "prompt_must_keep_spans_total",
  help: "Total must-keep spans detected across all prompts",
  labelNames: [],
});

registerCounter({
  name: "prompt_language_detected_total",
  help: "Primary language detected in prompts",
  labelNames: ["language"],
});

registerCounter({
  name: "prompt_duplicate_detected_total",
  help: "Total duplicate prompts detected",
  labelNames: [],
});

registerCounter({
  name: "prompt_nfc_normalization_total",
  help: "Total prompts that required NFC normalization",
  labelNames: [],
});

registerHistogram({
  name: "prompt_token_count_accurate",
  help: "Accurate token count (tiktoken) of incoming prompts",
  labelNames: ["model"],
  buckets: [50, 100, 250, 500, 1000, 2000, 4000, 8000, 16000, 32000, 64000, 128000],
});

/** Record analysis duration. */
export function recordAnalysisDuration(durationMs: number, mode: "sync" | "async"): void {
  observeHistogram("prompt_analysis_duration_seconds", durationMs / 1000, { mode });
}

/** Record pre-processing duration. */
export function recordPreprocessDuration(durationMs: number): void {
  observeHistogram("prompt_preprocess_duration_seconds", durationMs / 1000);
}

/** Record context management strategy used. */
export function recordContextStrategy(strategy: string): void {
  incCounter("prompt_context_strategy_used_total", { strategy });
}

/** Record must-keep spans detected. */
export function recordMustKeepSpans(count: number): void {
  if (count > 0) {
    incCounter("prompt_must_keep_spans_total", {}, count);
  }
}

/** Record detected language. */
export function recordLanguageDetected(language: string): void {
  incCounter("prompt_language_detected_total", { language });
}

/** Record duplicate prompt detection. */
export function recordDuplicateDetected(): void {
  incCounter("prompt_duplicate_detected_total");
}

/** Record NFC normalization event. */
export function recordNfcNormalization(): void {
  incCounter("prompt_nfc_normalization_total");
}

/** Record accurate token count. */
export function recordAccurateTokenCount(tokens: number, model: string): void {
  observeHistogram("prompt_token_count_accurate", tokens, { model });
}
