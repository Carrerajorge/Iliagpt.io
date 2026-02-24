/**
 * Telemetry module — single entry point for event emission, schema,
 * pipeline metrics, and SLO evaluation.
 */

export {
  // Schema & types
  type DashboardEvent,
  type CorrelationIds,
  type EventCategory,
  type HttpRequestEvent,
  type LlmCallEvent,
  type ChatRunEvent,
  type ToolExecutionEvent,
  type DbOperationEvent,
  type QueueEvent,
  type UploadEvent,
  type ErrorEvent,
  type HealthCheckEvent,
  type DeploymentEvent,
  type UiEvent,
  type SloBreachEvent,
  type PipelineHealthEvent,
  DashboardEventSchema,
  CorrelationIdsSchema,
  EVENT_CATEGORIES,
  SCHEMA_VERSION,
  // Helpers
  generateEventId,
  buildIdempotencyKey,
  validateEvent,
  createEvent,
} from "./eventSchema";

// Emitter (lazy singleton — import from ./emitter directly)
export { telemetryEmitter } from "./emitter";

// Pipeline metrics
export { pipelineMetrics } from "./pipelineMetrics";
