/**
 * Typed, versioned DashboardEvent schema — single source of truth
 * for all telemetry emitted across the application.
 *
 * Every event carries mandatory correlation IDs so the Dashboard
 * can join traces end-to-end (request → LLM call → tool → response).
 */

import { z } from "zod/v4";
import crypto from "crypto";

// ---------------------------------------------------------------------------
// Correlation IDs
// ---------------------------------------------------------------------------

export const CorrelationIdsSchema = z.object({
  traceId: z.string().min(1),
  requestId: z.string().optional(),
  userId: z.string().optional(),
  workspaceId: z.string().optional(),
  conversationId: z.string().optional(),
  runId: z.string().optional(),
});

export type CorrelationIds = z.infer<typeof CorrelationIdsSchema>;

// ---------------------------------------------------------------------------
// Event Categories
// ---------------------------------------------------------------------------

export const EVENT_CATEGORIES = [
  "http_request",
  "llm_call",
  "chat_run",
  "tool_execution",
  "db_operation",
  "queue_event",
  "upload_event",
  "error_event",
  "health_check",
  "deployment_event",
  "ui_event",
  "slo_breach",
  "pipeline_health",
] as const;

export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export const SCHEMA_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Base Event
// ---------------------------------------------------------------------------

const BaseEventSchema = z.object({
  eventId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  timestamp: z.number(),
  schemaVersion: z.literal(SCHEMA_VERSION),
  correlationIds: CorrelationIdsSchema,
});

// ---------------------------------------------------------------------------
// Event Variants
// ---------------------------------------------------------------------------

export const HttpRequestEventSchema = BaseEventSchema.extend({
  category: z.literal("http_request"),
  method: z.string(),
  path: z.string(),
  statusCode: z.number(),
  durationMs: z.number(),
  contentLength: z.number().optional(),
  userAgent: z.string().optional(),
});

export const LlmCallEventSchema = BaseEventSchema.extend({
  category: z.literal("llm_call"),
  provider: z.string(),
  model: z.string(),
  latencyMs: z.number(),
  tokensIn: z.number().optional(),
  tokensOut: z.number().optional(),
  cached: z.boolean().optional(),
  fromFallback: z.boolean().optional(),
  circuitState: z.enum(["closed", "half_open", "open"]).optional(),
  success: z.boolean(),
  errorCode: z.string().optional(),
});

export const ChatRunEventSchema = BaseEventSchema.extend({
  category: z.literal("chat_run"),
  intent: z.string().optional(),
  latencyLane: z.enum(["fast", "deep", "auto"]).optional(),
  webSearchUsed: z.boolean().optional(),
  modelUsed: z.string().optional(),
  providerUsed: z.string().optional(),
  totalLatencyMs: z.number(),
  streamingDurationMs: z.number().optional(),
  tokensTotal: z.number().optional(),
  success: z.boolean(),
  errorCode: z.string().optional(),
});

export const ToolExecutionEventSchema = BaseEventSchema.extend({
  category: z.literal("tool_execution"),
  toolName: z.string(),
  latencyMs: z.number(),
  success: z.boolean(),
  errorCode: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const DbOperationEventSchema = BaseEventSchema.extend({
  category: z.literal("db_operation"),
  operation: z.enum(["select", "insert", "update", "delete", "transaction"]),
  table: z.string().optional(),
  durationMs: z.number(),
  rowsAffected: z.number().optional(),
  success: z.boolean(),
  errorCode: z.string().optional(),
});

export const QueueEventSchema = BaseEventSchema.extend({
  category: z.literal("queue_event"),
  queueName: z.string(),
  action: z.enum(["submitted", "accepted", "completed", "failed", "dead_lettered", "retried", "backpressured"]),
  channel: z.string().optional(),
  latencyMs: z.number().optional(),
  attempts: z.number().optional(),
  errorMessage: z.string().optional(),
});

export const UploadEventSchema = BaseEventSchema.extend({
  category: z.literal("upload_event"),
  fileType: z.string(),
  fileSizeBytes: z.number(),
  durationMs: z.number(),
  success: z.boolean(),
  errorCode: z.string().optional(),
});

export const ErrorEventSchema = BaseEventSchema.extend({
  category: z.literal("error_event"),
  errorCode: z.string(),
  errorMessage: z.string(),
  endpoint: z.string().optional(),
  statusCode: z.number().optional(),
  stack: z.string().optional(),
});

export const HealthCheckEventSchema = BaseEventSchema.extend({
  category: z.literal("health_check"),
  overallStatus: z.enum(["ok", "degraded", "down"]),
  components: z.record(z.string(), z.object({
    status: z.enum(["ok", "degraded", "down", "unknown"]),
    latencyMs: z.number().optional(),
  })),
});

export const DeploymentEventSchema = BaseEventSchema.extend({
  category: z.literal("deployment_event"),
  action: z.enum(["started", "completed", "rolled_back", "failed"]),
  slot: z.string().optional(),
  imageTag: z.string().optional(),
  durationMs: z.number().optional(),
});

export const UiEventSchema = BaseEventSchema.extend({
  category: z.literal("ui_event"),
  action: z.string(),
  component: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const SloBreachEventSchema = BaseEventSchema.extend({
  category: z.literal("slo_breach"),
  sloName: z.string(),
  targetValue: z.number(),
  currentValue: z.number(),
  severity: z.enum(["warning", "critical"]),
  windowSeconds: z.number().optional(),
});

export const PipelineHealthEventSchema = BaseEventSchema.extend({
  category: z.literal("pipeline_health"),
  bufferSize: z.number(),
  flushRatePerSec: z.number(),
  dropRatePerSec: z.number(),
  queueDepth: z.number(),
  sinkCircuitState: z.enum(["closed", "half_open", "open"]),
  degraded: z.boolean(),
});

// ---------------------------------------------------------------------------
// Union
// ---------------------------------------------------------------------------

export const DashboardEventSchema = z.discriminatedUnion("category", [
  HttpRequestEventSchema,
  LlmCallEventSchema,
  ChatRunEventSchema,
  ToolExecutionEventSchema,
  DbOperationEventSchema,
  QueueEventSchema,
  UploadEventSchema,
  ErrorEventSchema,
  HealthCheckEventSchema,
  DeploymentEventSchema,
  UiEventSchema,
  SloBreachEventSchema,
  PipelineHealthEventSchema,
]);

export type DashboardEvent = z.infer<typeof DashboardEventSchema>;

// Variant types for convenience
export type HttpRequestEvent = z.infer<typeof HttpRequestEventSchema>;
export type LlmCallEvent = z.infer<typeof LlmCallEventSchema>;
export type ChatRunEvent = z.infer<typeof ChatRunEventSchema>;
export type ToolExecutionEvent = z.infer<typeof ToolExecutionEventSchema>;
export type DbOperationEvent = z.infer<typeof DbOperationEventSchema>;
export type QueueEvent = z.infer<typeof QueueEventSchema>;
export type UploadEvent = z.infer<typeof UploadEventSchema>;
export type ErrorEvent = z.infer<typeof ErrorEventSchema>;
export type HealthCheckEvent = z.infer<typeof HealthCheckEventSchema>;
export type DeploymentEvent = z.infer<typeof DeploymentEventSchema>;
export type UiEvent = z.infer<typeof UiEventSchema>;
export type SloBreachEvent = z.infer<typeof SloBreachEventSchema>;
export type PipelineHealthEvent = z.infer<typeof PipelineHealthEventSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let nanoidCounter = 0;

/** Generate a short unique event ID. */
export function generateEventId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  const seq = (nanoidCounter++ & 0xffff).toString(36);
  return `${ts}-${rand}-${seq}`;
}

/**
 * Build a deterministic idempotency key from category + correlation + dedup fields.
 * Same inputs always produce the same key → enables at-least-once dedup.
 */
export function buildIdempotencyKey(
  category: EventCategory,
  correlationIds: CorrelationIds,
  dedupFields: Record<string, string | number | boolean | undefined>,
): string {
  const parts = [
    category,
    correlationIds.traceId,
    correlationIds.requestId ?? "",
    correlationIds.runId ?? "",
    ...Object.entries(dedupFields)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v ?? ""}`),
  ];
  return crypto
    .createHash("sha256")
    .update(parts.join("|"))
    .digest("hex")
    .slice(0, 64);
}

/**
 * Validate an event against the schema.
 * Returns `{ ok: true, event }` or `{ ok: false, error }`.
 */
export function validateEvent(
  raw: unknown,
): { ok: true; event: DashboardEvent } | { ok: false; error: string } {
  const result = DashboardEventSchema.safeParse(raw);
  if (result.success) {
    return { ok: true, event: result.data };
  }
  return { ok: false, error: result.error.message };
}

/**
 * Create a complete event with auto-generated eventId, timestamp, and idempotencyKey.
 * `dedupFields` are category-specific fields used for deterministic dedup.
 */
export function createEvent<T extends Omit<DashboardEvent, "eventId" | "idempotencyKey" | "timestamp" | "schemaVersion">>(
  partial: T,
  dedupFields?: Record<string, string | number | boolean | undefined>,
): T & { eventId: string; idempotencyKey: string; timestamp: number; schemaVersion: typeof SCHEMA_VERSION } {
  const eventId = generateEventId();
  const timestamp = Date.now();
  const idempotencyKey = buildIdempotencyKey(
    partial.category,
    partial.correlationIds,
    dedupFields ?? {},
  );
  return {
    ...partial,
    eventId,
    idempotencyKey,
    timestamp,
    schemaVersion: SCHEMA_VERSION,
  };
}
