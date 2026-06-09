/**
 * sseProtocol — versioned contract for the /api/chat/stream SSE dialect.
 *
 * Single source of truth for every consumer (web client, Electron desktop,
 * Chrome extension, /v1 bridge). The server emits `event: <name>` lines with
 * a JSON payload; every payload is enriched with `conversationId`,
 * `requestId` and (when known) `assistantMessageId` — clients MUST filter by
 * conversationId + requestId (see use-stream-chat.ts).
 *
 * Bump SSE_PROTOCOL_VERSION on any breaking change and document it in
 * docs/sse-protocol.md.
 */

export const SSE_PROTOCOL_VERSION = "2026-06-09" as const;

/** Every event payload carries this correlation envelope (server-injected). */
export interface SseEnvelope {
  conversationId?: string;
  requestId?: string;
  assistantMessageId?: string;
  runId?: string;
  timestamp?: number;
}

// ── Lifecycle ────────────────────────────────────────────────────────────
export interface SseStartEvent extends SseEnvelope {
  latencyMode?: "fast" | "deep" | "auto";
}

export interface SseContextEvent extends SseEnvelope {
  latencyLane?: "fast" | "deep";
  intent?: string;
  intentConfidence?: number;
  deliverableType?: string | null;
  isAgenticMode?: boolean;
}

export interface SseDoneEvent extends SseEnvelope {
  sequenceId?: number;
  totalSequences?: number;
  contentLength?: number;
  completionReason?: string;
  /** Full thinking text for the turn (also persisted server-side). */
  reasoning?: string;
  reasoningDurationMs?: number;
  webSources?: unknown[];
  followUpSuggestions?: string[];
  error?: boolean | string;
}

export interface SseErrorEvent extends SseEnvelope {
  message?: string;
  error?: string | { code?: string; message?: string; retryAfterMs?: number };
}

// ── Content ──────────────────────────────────────────────────────────────
/** Visible answer text. Event name `chunk` (legacy), payload type text_delta. */
export interface SseTextDeltaEvent extends SseEnvelope {
  type: "text_delta";
  content: string;
  sequence?: number;
  isFallback?: boolean;
}

// ── Extended thinking ────────────────────────────────────────────────────
export interface SseReasoningDeltaEvent extends SseEnvelope {
  type: "reasoning_delta";
  content: string;
  sequence?: number;
}

export interface SseReasoningDoneEvent extends SseEnvelope {
  type: "reasoning_done";
  durationMs: number;
}

export interface SseToolCallDeltaEvent extends SseEnvelope {
  type: "tool_call_delta";
  index: number;
  id?: string;
  name?: string;
  argsDelta?: string;
}

// ── Progress / auxiliary ─────────────────────────────────────────────────
export interface SseThinkingStatusEvent extends SseEnvelope {
  step?: string;
  message?: string;
}

export interface SseNoticeEvent extends SseEnvelope {
  type:
    | "provider_fallback"
    | "context_truncated"
    | "retry_empty_response"
    | (string & {});
  [key: string]: unknown;
}

/** event-name → payload map. `chunk` carries text; the rest are typed. */
export interface SseEventMap {
  start: SseStartEvent;
  context: SseContextEvent;
  chunk: SseTextDeltaEvent;
  reasoning_delta: SseReasoningDeltaEvent;
  reasoning_done: SseReasoningDoneEvent;
  tool_call_delta: SseToolCallDeltaEvent;
  thinking: SseThinkingStatusEvent;
  notice: SseNoticeEvent;
  done: SseDoneEvent;
  error: SseErrorEvent;
}

export type SseEventName = keyof SseEventMap;

/** Ordering guarantees the server upholds (see docs/sse-protocol.md):
 *  1. `start` is always first; `done` (or `error`+`done`) is always last.
 *  2. reasoning_delta events arrive BEFORE the first chunk of the answer
 *     they precede; reasoning_done arrives before the first text chunk that
 *     follows the thinking phase (or before `done` when no text follows).
 *  3. tool_call_delta events for one tool call arrive in argsDelta order.
 *  4. chunk `sequence` is monotonically increasing within a request. */
export const SSE_ORDERING_NOTES = true;
