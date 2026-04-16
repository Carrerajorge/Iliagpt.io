import type { IntentType, SupportedLocale } from "../../../shared/schemas/intent";

export type Channel = "web" | "api" | "mobile";
export type DeviceType = "desktop" | "mobile" | "tablet" | "unknown";

export interface OutcomeMetadata {
  locale: SupportedLocale;
  channel: Channel;
  device_type: DeviceType;
  session_id?: string;
  fallback_used?: "none" | "knn" | "llm";
  was_clarification_resolved?: boolean;
  latency_ms?: number;
  route_type?: "rule-only" | "semantic" | "llm";
}

export interface IntentMetricsData {
  total: number;
  successful: number;
  failed: number;
  corrections: number;
  avg_latency_ms: number;
  latencies: number[];
}

export interface LocaleMetrics {
  total: number;
  successful: number;
  failed: number;
  success_rate: number;
  fallback_rate: number;
  unknown_rate: number;
  correction_rate: number;
  avg_latency_ms: number;
}

export interface ChannelMetrics {
  total: number;
  successful: number;
  failed: number;
  success_rate: number;
  fallback_rate: number;
  avg_latency_ms: number;
}

export interface Alert {
  id: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  type: string;
  message: string;
  slice?: string;
  value?: number;
  threshold?: number;
  created_at: Date;
  acknowledged: boolean;
  acknowledged_at?: Date;
  acknowledged_by?: string;
}

export interface ProductMetricsSnapshot {
  window_start: Date;
  window_end: Date;
  total_requests: number;
  by_intent: Record<IntentType, IntentMetricsData>;
  by_locale: Record<string, LocaleMetrics>;
  by_channel: Record<string, ChannelMetrics>;
  by_device: Record<string, ChannelMetrics>;
  overall: {
    success_rate: number;
    clarification_rate: number;
    clarification_helpfulness: number;
    fallback_rate: number;
    unknown_rate: number;
    correction_rate: number;
    p50_latency_ms: number;
    p95_latency_ms: number;
    p99_latency_ms: number;
  };
  top_unknown_phrases: Array<{ phrase: string; count: number }>;
  active_alerts: Alert[];
}

interface MetricsStore {
  window_start: Date;
  total_requests: number;
  successful_requests: number;
  failed_requests: number;
  corrections: number;
  clarification_requests: number;
  clarifications_resolved: number;
  fallback_requests: number;
  unknown_requests: number;
  latencies: number[];
  by_intent: Record<IntentType, {
    total: number;
    successful: number;
    failed: number;
    corrections: number;
    latencies: number[];
  }>;
  by_locale: Record<string, {
    total: number;
    successful: number;
    failed: number;
    fallbacks: number;
    unknowns: number;
    corrections: number;
    latencies: number[];
  }>;
  by_channel: Record<string, {
    total: number;
    successful: number;
    failed: number;
    fallbacks: number;
    latencies: number[];
  }>;
  by_device: Record<string, {
    total: number;
    successful: number;
    failed: number;
    fallbacks: number;
    latencies: number[];
  }>;
  unknown_phrases: Map<string, number>;
  by_route: Record<string, number[]>;
}

const ALL_INTENTS: IntentType[] = [
  "CREATE_PRESENTATION",
  "CREATE_DOCUMENT",
  "CREATE_SPREADSHEET",
  "SUMMARIZE",
  "TRANSLATE",
  "SEARCH_WEB",
  "ANALYZE_DOCUMENT",
  "CHAT_GENERAL",
  "NEED_CLARIFICATION"
];

function createEmptyIntentMetrics(): MetricsStore["by_intent"][IntentType] {
  return { total: 0, successful: 0, failed: 0, corrections: 0, latencies: [] };
}

function createEmptyMetricsStore(): MetricsStore {
  const by_intent: MetricsStore["by_intent"] = {} as MetricsStore["by_intent"];
  for (const intent of ALL_INTENTS) {
    by_intent[intent] = createEmptyIntentMetrics();
  }

  return {
    window_start: new Date(),
    total_requests: 0,
    successful_requests: 0,
    failed_requests: 0,
    corrections: 0,
    clarification_requests: 0,
    clarifications_resolved: 0,
    fallback_requests: 0,
    unknown_requests: 0,
    latencies: [],
    by_intent,
    by_locale: {},
    by_channel: {},
    by_device: {},
    unknown_phrases: new Map(),
    by_route: {
      "rule-only": [],
      "semantic": [],
      "llm": []
    }
  };
}

let metricsStore: MetricsStore = createEmptyMetricsStore();

const MAX_LATENCY_SAMPLES = 10000;
const MAX_UNKNOWN_PHRASES = 1000;

function trimLatencies(arr: number[]): void {
  if (arr.length > MAX_LATENCY_SAMPLES) {
    arr.splice(0, arr.length - MAX_LATENCY_SAMPLES);
  }
}

function computePercentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

function computeAverage(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function recordIntentOutcome(
  intent: IntentType,
  success: boolean,
  metadata: OutcomeMetadata,
  normalizedText?: string
): void {
  metricsStore.total_requests++;
  
  if (success) {
    metricsStore.successful_requests++;
  } else {
    metricsStore.failed_requests++;
  }

  if (!metricsStore.by_intent[intent]) {
    metricsStore.by_intent[intent] = createEmptyIntentMetrics();
  }
  metricsStore.by_intent[intent].total++;
  if (success) {
    metricsStore.by_intent[intent].successful++;
  } else {
    metricsStore.by_intent[intent].failed++;
  }

  if (metadata.latency_ms !== undefined) {
    metricsStore.latencies.push(metadata.latency_ms);
    metricsStore.by_intent[intent].latencies.push(metadata.latency_ms);
    trimLatencies(metricsStore.latencies);
    trimLatencies(metricsStore.by_intent[intent].latencies);
  }

  const locale = metadata.locale;
  if (!metricsStore.by_locale[locale]) {
    metricsStore.by_locale[locale] = {
      total: 0, successful: 0, failed: 0, fallbacks: 0, unknowns: 0, corrections: 0, latencies: []
    };
  }
  metricsStore.by_locale[locale].total++;
  if (success) {
    metricsStore.by_locale[locale].successful++;
  } else {
    metricsStore.by_locale[locale].failed++;
  }
  if (metadata.latency_ms !== undefined) {
    metricsStore.by_locale[locale].latencies.push(metadata.latency_ms);
    trimLatencies(metricsStore.by_locale[locale].latencies);
  }

  const channel = metadata.channel;
  if (!metricsStore.by_channel[channel]) {
    metricsStore.by_channel[channel] = {
      total: 0, successful: 0, failed: 0, fallbacks: 0, latencies: []
    };
  }
  metricsStore.by_channel[channel].total++;
  if (success) {
    metricsStore.by_channel[channel].successful++;
  } else {
    metricsStore.by_channel[channel].failed++;
  }
  if (metadata.latency_ms !== undefined) {
    metricsStore.by_channel[channel].latencies.push(metadata.latency_ms);
    trimLatencies(metricsStore.by_channel[channel].latencies);
  }

  const device = metadata.device_type;
  if (!metricsStore.by_device[device]) {
    metricsStore.by_device[device] = {
      total: 0, successful: 0, failed: 0, fallbacks: 0, latencies: []
    };
  }
  metricsStore.by_device[device].total++;
  if (success) {
    metricsStore.by_device[device].successful++;
  } else {
    metricsStore.by_device[device].failed++;
  }
  if (metadata.latency_ms !== undefined) {
    metricsStore.by_device[device].latencies.push(metadata.latency_ms);
    trimLatencies(metricsStore.by_device[device].latencies);
  }

  if (metadata.fallback_used && metadata.fallback_used !== "none") {
    metricsStore.fallback_requests++;
    metricsStore.by_locale[locale].fallbacks++;
    metricsStore.by_channel[channel].fallbacks++;
    metricsStore.by_device[device].fallbacks++;
  }

  if (intent === "NEED_CLARIFICATION") {
    metricsStore.clarification_requests++;
    if (metadata.was_clarification_resolved) {
      metricsStore.clarifications_resolved++;
    }
  }

  if (intent === "CHAT_GENERAL") {
    metricsStore.unknown_requests++;
    metricsStore.by_locale[locale].unknowns++;
    
    if (normalizedText && metricsStore.unknown_phrases.size < MAX_UNKNOWN_PHRASES) {
      const phrase = normalizedText.substring(0, 100).toLowerCase().trim();
      if (phrase.length > 0) {
        const current = metricsStore.unknown_phrases.get(phrase) || 0;
        metricsStore.unknown_phrases.set(phrase, current + 1);
      }
    }
  }

  if (metadata.route_type) {
    if (!metricsStore.by_route[metadata.route_type]) {
      metricsStore.by_route[metadata.route_type] = [];
    }
    if (metadata.latency_ms !== undefined) {
      metricsStore.by_route[metadata.route_type].push(metadata.latency_ms);
      trimLatencies(metricsStore.by_route[metadata.route_type]);
    }
  }
}

export function recordCorrection(
  intent: IntentType,
  locale: SupportedLocale
): void {
  metricsStore.corrections++;
  
  if (metricsStore.by_intent[intent]) {
    metricsStore.by_intent[intent].corrections++;
  }
  
  if (metricsStore.by_locale[locale]) {
    metricsStore.by_locale[locale].corrections++;
  }
}

export function recordClarificationResolution(resolved: boolean): void {
  if (resolved) {
    metricsStore.clarifications_resolved++;
  }
}

export type SliceType = "intent" | "locale" | "channel" | "device";

export interface SliceMetrics {
  slice_type: SliceType;
  slice_value: string;
  total: number;
  success_rate: number;
  fallback_rate: number;
  unknown_rate: number;
  correction_rate: number;
  avg_latency_ms: number;
  p50_latency_ms: number;
  p95_latency_ms: number;
  p99_latency_ms: number;
}

export function getSliceMetrics(sliceType: SliceType, sliceValue: string): SliceMetrics | null {
  let data: { total: number; successful: number; failed: number; latencies: number[]; fallbacks?: number; unknowns?: number; corrections?: number } | undefined;

  switch (sliceType) {
    case "intent":
      data = metricsStore.by_intent[sliceValue as IntentType];
      break;
    case "locale":
      data = metricsStore.by_locale[sliceValue];
      break;
    case "channel":
      data = metricsStore.by_channel[sliceValue];
      break;
    case "device":
      data = metricsStore.by_device[sliceValue];
      break;
  }

  if (!data || data.total === 0) {
    return null;
  }

  const total = data.total;
  const fallbacks = (data as any).fallbacks || 0;
  const unknowns = (data as any).unknowns || 0;
  const corrections = (data as any).corrections || 0;

  return {
    slice_type: sliceType,
    slice_value: sliceValue,
    total,
    success_rate: data.successful / total,
    fallback_rate: fallbacks / total,
    unknown_rate: unknowns / total,
    correction_rate: corrections / total,
    avg_latency_ms: computeAverage(data.latencies),
    p50_latency_ms: computePercentile(data.latencies, 50),
    p95_latency_ms: computePercentile(data.latencies, 95),
    p99_latency_ms: computePercentile(data.latencies, 99)
  };
}

export function getProductMetrics(activeAlerts: Alert[] = []): ProductMetricsSnapshot {
  const total = metricsStore.total_requests || 1;
  const windowEnd = new Date();

  const by_intent: Record<IntentType, IntentMetricsData> = {} as Record<IntentType, IntentMetricsData>;
  for (const intent of ALL_INTENTS) {
    const data = metricsStore.by_intent[intent];
    by_intent[intent] = {
      total: data.total,
      successful: data.successful,
      failed: data.failed,
      corrections: data.corrections,
      avg_latency_ms: computeAverage(data.latencies),
      latencies: []
    };
  }

  const by_locale: Record<string, LocaleMetrics> = {};
  for (const [locale, data] of Object.entries(metricsStore.by_locale)) {
    const localeTotal = data.total || 1;
    by_locale[locale] = {
      total: data.total,
      successful: data.successful,
      failed: data.failed,
      success_rate: data.successful / localeTotal,
      fallback_rate: data.fallbacks / localeTotal,
      unknown_rate: data.unknowns / localeTotal,
      correction_rate: data.corrections / localeTotal,
      avg_latency_ms: computeAverage(data.latencies)
    };
  }

  const by_channel: Record<string, ChannelMetrics> = {};
  for (const [channel, data] of Object.entries(metricsStore.by_channel)) {
    const channelTotal = data.total || 1;
    by_channel[channel] = {
      total: data.total,
      successful: data.successful,
      failed: data.failed,
      success_rate: data.successful / channelTotal,
      fallback_rate: data.fallbacks / channelTotal,
      avg_latency_ms: computeAverage(data.latencies)
    };
  }

  const by_device: Record<string, ChannelMetrics> = {};
  for (const [device, data] of Object.entries(metricsStore.by_device)) {
    const deviceTotal = data.total || 1;
    by_device[device] = {
      total: data.total,
      successful: data.successful,
      failed: data.failed,
      success_rate: data.successful / deviceTotal,
      fallback_rate: data.fallbacks / deviceTotal,
      avg_latency_ms: computeAverage(data.latencies)
    };
  }

  const topUnknownPhrases = Array.from(metricsStore.unknown_phrases.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([phrase, count]) => ({ phrase, count }));

  const clarificationTotal = metricsStore.clarification_requests || 1;

  return {
    window_start: metricsStore.window_start,
    window_end: windowEnd,
    total_requests: metricsStore.total_requests,
    by_intent,
    by_locale,
    by_channel,
    by_device,
    overall: {
      success_rate: metricsStore.successful_requests / total,
      clarification_rate: metricsStore.clarification_requests / total,
      clarification_helpfulness: metricsStore.clarifications_resolved / clarificationTotal,
      fallback_rate: metricsStore.fallback_requests / total,
      unknown_rate: metricsStore.unknown_requests / total,
      correction_rate: metricsStore.corrections / total,
      p50_latency_ms: computePercentile(metricsStore.latencies, 50),
      p95_latency_ms: computePercentile(metricsStore.latencies, 95),
      p99_latency_ms: computePercentile(metricsStore.latencies, 99)
    },
    top_unknown_phrases: topUnknownPhrases,
    active_alerts: activeAlerts
  };
}

export function getRouteLatencyMetrics(): Record<string, { p50: number; p95: number; p99: number; avg: number; count: number }> {
  const result: Record<string, { p50: number; p95: number; p99: number; avg: number; count: number }> = {};
  
  for (const [route, latencies] of Object.entries(metricsStore.by_route)) {
    result[route] = {
      p50: computePercentile(latencies, 50),
      p95: computePercentile(latencies, 95),
      p99: computePercentile(latencies, 99),
      avg: computeAverage(latencies),
      count: latencies.length
    };
  }
  
  return result;
}

export function resetProductMetrics(): void {
  metricsStore = createEmptyMetricsStore();
}

export function getMetricsWindow(): { start: Date; total_requests: number } {
  return {
    start: metricsStore.window_start,
    total_requests: metricsStore.total_requests
  };
}
