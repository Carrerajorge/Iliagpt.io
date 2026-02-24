/**
 * Prometheus Metrics for Intent Analysis Pipeline
 *
 * Registers counters and histograms for monitoring
 * classification accuracy, latency, and escalation rates.
 *
 * Uses the existing Prometheus setup from server/metrics/prometheus.ts.
 */

import { Logger } from "../../lib/logger";

const logger = new Logger("AnalysisMetrics");

// In-memory metrics store (compatible with the existing metricsCollector pattern)
interface MetricEntry {
  timestamp: number;
  labels: Record<string, string>;
  value: number;
}

const metrics: Record<string, MetricEntry[]> = {};
const MAX_ENTRIES = 1000;

function record(metric: string, value: number, labels: Record<string, string> = {}) {
  if (!metrics[metric]) metrics[metric] = [];
  const entries = metrics[metric];
  entries.push({ timestamp: Date.now(), value, labels });
  // Ring buffer
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
}

// ─── Public API ──────────────────────────────────────────────────────

export const analysisMetrics = {
  /** Record an intent classification event */
  recordClassification(source: "regex" | "llm" | "hybrid", intent: string) {
    record("intent_classification_total", 1, { source, intent });
  },

  /** Record an LLM escalation event */
  recordEscalation(reason: string) {
    record("intent_escalation_total", 1, { reason });
  },

  /** Record brief generation result */
  recordBriefGeneration(status: "success" | "failure" | "timeout") {
    record("brief_generation_total", 1, { status });
  },

  /** Record brief validation result */
  recordBriefValidation(result: "passed" | "failed", score: number) {
    record("brief_validation_total", 1, { result });
    record("brief_validation_score", score, { result });
  },

  /** Record classification duration */
  recordClassificationDuration(source: "regex" | "llm", durationMs: number) {
    record("intent_classification_duration_ms", durationMs, { source });
  },

  /** Record brief generation duration */
  recordBriefDuration(durationMs: number) {
    record("brief_generation_duration_ms", durationMs, {});
  },

  /** Record full pipeline duration */
  recordPipelineDuration(durationMs: number) {
    record("full_analysis_pipeline_duration_ms", durationMs, {});
  },

  /** Get all metrics for the /metrics endpoint or debugging */
  getMetrics(): Record<string, MetricEntry[]> {
    return { ...metrics };
  },

  /** Get summary statistics */
  getSummary(): Record<string, any> {
    const summary: Record<string, any> = {};

    for (const [name, entries] of Object.entries(metrics)) {
      const recent = entries.filter((e) => Date.now() - e.timestamp < 60 * 60 * 1000); // last hour
      if (recent.length === 0) continue;

      if (name.includes("duration")) {
        const values = recent.map((e) => e.value).sort((a, b) => a - b);
        summary[name] = {
          count: values.length,
          p50: values[Math.floor(values.length * 0.5)] ?? 0,
          p95: values[Math.floor(values.length * 0.95)] ?? 0,
          p99: values[Math.floor(values.length * 0.99)] ?? 0,
          avg: values.reduce((s, v) => s + v, 0) / values.length,
        };
      } else {
        // Counters: group by labels
        const groups: Record<string, number> = {};
        for (const entry of recent) {
          const key = Object.entries(entry.labels)
            .map(([k, v]) => `${k}=${v}`)
            .join(",");
          groups[key] = (groups[key] ?? 0) + entry.value;
        }
        summary[name] = groups;
      }
    }

    return summary;
  },
};
