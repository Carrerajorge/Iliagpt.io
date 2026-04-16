import { Router, Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { gmail_v1 } from 'googleapis';
import { z } from 'zod';
import { storage } from '../storage';
import {
  GMAIL_SCOPES,
  getGmailClient,
  gmailSearch,
  gmailFetchThread,
  gmailSend,
  gmailMarkRead,
  gmailLabels,
} from '../integrations/gmailApi';
import type { GmailOAuthToken } from '@shared/schema';
import { getUserId } from '../types/express';
import { aiLimiter } from '../middleware/rateLimiter';
import { sanitizeSearchQuery, sanitizePlainText } from '../lib/textSanitizers';
import { createLogger } from '../utils/logger';
import { sanitizeText } from '../lib/pythonToolsClient';
import { withRetry } from '../utils/retry';
import { isTransientError } from '../utils/errors';
import {
  incCounter,
  observeHistogram,
  registerCounter,
  registerGauge,
  registerHistogram,
  setGauge,
} from '../metrics/prometheus';
import {
  addAttribute,
  withSpan,
  recordError as recordTracingError,
  SPAN_NAMES,
  SPAN_ATTRIBUTES,
} from '../lib/tracing';

interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
  outputSchema?: {
    type: string;
    properties?: Record<string, unknown>;
  };
}

interface McpRequest {
  jsonrpc: string;
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface McpResponse {
  jsonrpc: string;
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: Record<string, unknown>;
  };
}

type GmailToolName = 'gmail_search' | 'gmail_fetch' | 'gmail_send' | 'gmail_mark_read' | 'gmail_labels';

type GmailToolStage = 'parse' | 'auth' | 'execution' | 'serialize' | 'response';

type GmailToolProtocol = 'rest' | 'jsonrpc';

type GmailToolErrorCode =
  | 'validation'
  | 'scope'
  | 'backpressure'
  | 'circuit_open'
  | 'timeout'
  | 'unauthorized'
  | 'not_connected'
  | 'unsupported_method'
  | 'idempotency_conflict'
  | 'idempotency_in_progress'
  | 'internal';

type GmailToolError = Error & {
  code: GmailToolErrorCode;
  retryAfterSeconds?: number;
  fallbackPayload?: Record<string, unknown>;
};

type GmailToolCircuitState = {
  status: 'closed' | 'open' | 'half-open';
  failures: number;
  openedUntil: number;
  backoffLevel: number;
  halfOpenAttempts: number;
};

type GmailToolIdempotencyRecord = {
  state: 'proposed' | 'running' | 'done';
  fingerprint: string;
  expiresAtMs: number;
  promise: Promise<unknown>;
  result?: unknown;
  startedAtMs: number;
};

type GmailToolConcurrencyState = {
  activeGlobal: number;
  activeByUser: Map<string, number>;
};

const logger = createLogger("gmail-mcp");
const FALLBACK_TOOL_NAME = "gmail_unknown";

const mcpRequestSchema = z.object({
  jsonrpc: z.literal("2.0").or(z.string().transform(() => "2.0" as const)),
  id: z.union([z.string().min(1), z.number().int(), z.null()]).optional(),
  method: z.string().trim().min(1).max(64),
  params: z.record(z.unknown()).optional(),
}).strict();

const toolCallSchema = z.object({
  tool: z.string().trim().min(1).max(48).optional(),
  name: z.string().trim().min(1).max(48).optional(),
  arguments: z.record(z.unknown()).optional().default({}),
}).strict().refine((value) => Boolean(value.tool || value.name), {
  message: "tool or name is required",
}).transform((value) => ({
  tool: value.tool || value.name!,
  arguments: value.arguments || {},
}));

const gmailSearchSchema = z.object({
  query: z.string().trim().min(1).max(500),
  maxResults: z.coerce.number().int().min(1).max(100).optional(),
}).strict();

const gmailFetchSchema = z.object({
  threadId: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
}).strict();

const gmailSendSchema = z.object({
  to: z.string().trim().min(1).max(500),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(30_000),
  threadId: z.string().trim().max(128).optional(),
}).strict();

const gmailMarkReadSchema = z.object({
  messageId: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
}).strict();

const gmailLabelsSchema = z.object({}).strict();

const gmailToolSchemas: Record<GmailToolName, z.ZodTypeAny> = {
  gmail_search: gmailSearchSchema,
  gmail_fetch: gmailFetchSchema,
  gmail_send: gmailSendSchema,
  gmail_mark_read: gmailMarkReadSchema,
  gmail_labels: gmailLabelsSchema,
};

const GMAIL_TOOL_SCOPE_REQUIRED_MAP: Record<GmailToolName, readonly string[]> = {
  gmail_search: [GMAIL_SCOPES[0]],
  gmail_fetch: [GMAIL_SCOPES[0]],
  gmail_send: [GMAIL_SCOPES[1]],
  gmail_mark_read: [GMAIL_SCOPES[2]],
  gmail_labels: [GMAIL_SCOPES[0], GMAIL_SCOPES[3]],
};

const GMAIL_TOOL_IDEMPOTENT_TOOLS = new Set<GmailToolName>(['gmail_send', 'gmail_mark_read']);
const EMAIL_SAFE_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GMAIL_TOOL_DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const GMAIL_TOOL_CALL_TIMEOUT_MS = 8_000;
const GMAIL_TOOL_CIRCUIT_FAILURE_THRESHOLD = 5;
const GMAIL_TOOL_CIRCUIT_RESET_MS = 25_000;
const GMAIL_TOOL_CIRCUIT_MAX_RESET_MS = 120_000;
const GMAIL_TOOL_CIRCUIT_HALF_OPEN_ATTEMPTS = 1;
const GMAIL_TOOL_MAX_PAYLOAD_BYTES = 16 * 1024;
const GMAIL_TOOL_MAX_RETRIES = 2;
const GMAIL_TOOL_MAX_CONCURRENT_GLOBAL = 16;
const GMAIL_TOOL_MAX_CONCURRENT_PER_USER = 4;
const GMAIL_TOOL_MAX_CONCURRENT_WAIT_MS = 1_200;
const GMAIL_TOOL_MAX_PAYLOAD_OBJECT_KEYS = 60;
const GMAIL_TOOL_MAX_PAYLOAD_DEPTH = 4;
const GMAIL_TOOL_MAX_PAYLOAD_ARRAY_LENGTH = 40;
const GMAIL_TOOL_MAX_PAYLOAD_STRING_LEN = 30_000;
const GMAIL_TOOL_MAX_RESULT_BYTES = 128_000;
const GMAIL_TOOL_MAX_ERROR_MESSAGE_LEN = 1_024;
const GMAIL_TOOL_MAX_RECIPIENTS = 50;
const GMAIL_TOOL_IDEMPOTENCY_MAX_ACTIVE_KEYS = 1_000;
const GMAIL_TOOL_IDEMPOTENCY_STATE_RANK: Record<GmailToolIdempotencyRecord['state'], number> = {
  done: 0,
  proposed: 1,
  running: 2,
};
const GMAIL_TOOL_IDEMPOTENCY_TTL_MS = 5 * 60 * 1000;
const GMAIL_TOOL_IDEMPOTENCY_KEY_MIN_LEN = 8;
const GMAIL_TOOL_IDEMPOTENCY_KEY_MAX_LEN = 128;
const GMAIL_TOOL_ALLOWED_KEY_REGEX = /^[A-Za-z0-9._-]{1,64}$/;
const GMAIL_TOOL_IDEMPOTENCY_REGEX = /^[A-Za-z0-9._-]{8,128}$/;
const GMAIL_TOOL_OPENAI_FALLBACK_LABEL = 'degraded';
const GMAIL_TOOL_STAGE_TIMEOUT_MS: Record<GmailToolStage, number> = {
  parse: 250,
  auth: 1_000,
  execution: GMAIL_TOOL_CALL_TIMEOUT_MS,
  serialize: 300,
  response: 200,
};
const GMAIL_TOOL_METRIC_NAMES = {
  TOOL_CALLS_TOTAL: "gmail_mcp_tool_calls_total",
  TOOL_STAGE_DURATION_MS: "gmail_mcp_tool_stage_duration_ms",
  TOOL_STAGE_ERRORS_TOTAL: "gmail_mcp_tool_stage_errors_total",
  CONCURRENCY_WAIT_MS: "gmail_mcp_tool_concurrency_wait_ms",
  CONCURRENCY_WAIT_ATTEMPTS: "gmail_mcp_tool_concurrency_wait_attempts",
  IDEMPOTENCY_EVENTS_TOTAL: "gmail_mcp_tool_idempotency_events_total",
  ACTIVE_EXECUTIONS: "gmail_mcp_tool_active_executions",
  FALLBACK_TOTAL: "gmail_mcp_tool_fallbacks_total",
  TOOL_RETRIES: "gmail_mcp_tool_retries_total",
} as const;
let gmailMcpMetricsInitialized = false;

const gmailToolCircuitStore = new Map<string, GmailToolCircuitState>();
const gmailToolIdempotencyStore = new Map<string, GmailToolIdempotencyRecord>();
const gmailToolConcurrency: GmailToolConcurrencyState = {
  activeGlobal: 0,
  activeByUser: new Map<string, number>(),
};

function initializeGmailMcpMetrics(): void {
  if (gmailMcpMetricsInitialized) {
    return;
  }

  registerCounter({
    name: GMAIL_TOOL_METRIC_NAMES.TOOL_CALLS_TOTAL,
    help: "Total Gmail MCP tool calls",
    labelNames: ["tool", "status", "protocol", "stage"],
  });
  registerCounter({
    name: GMAIL_TOOL_METRIC_NAMES.TOOL_STAGE_ERRORS_TOTAL,
    help: "Total Gmail MCP tool stage errors",
    labelNames: ["tool", "stage", "protocol", "code"],
  });
  registerCounter({
    name: GMAIL_TOOL_METRIC_NAMES.FALLBACK_TOTAL,
    help: "Total Gmail MCP tool fallback outcomes",
    labelNames: ["tool", "code", "protocol", "stage"],
  });
  registerCounter({
    name: GMAIL_TOOL_METRIC_NAMES.TOOL_RETRIES,
    help: "Total Gmail MCP tool retry attempts",
    labelNames: ["tool", "stage"],
  });
  registerCounter({
    name: GMAIL_TOOL_METRIC_NAMES.CONCURRENCY_WAIT_ATTEMPTS,
    help: "Total Gmail MCP tool execution slot wait attempts",
    labelNames: ["tool", "protocol", "outcome"],
  });
  registerCounter({
    name: GMAIL_TOOL_METRIC_NAMES.IDEMPOTENCY_EVENTS_TOTAL,
    help: "Total Gmail MCP tool idempotency events",
    labelNames: ["tool", "protocol", "state"],
  });
  registerGauge({
    name: GMAIL_TOOL_METRIC_NAMES.ACTIVE_EXECUTIONS,
    help: "Active Gmail MCP tool executions",
    labelNames: ["protocol", "tool"],
  });
  registerHistogram({
    name: GMAIL_TOOL_METRIC_NAMES.TOOL_STAGE_DURATION_MS,
    help: "Gmail MCP tool stage duration in milliseconds",
    labelNames: ["tool", "stage", "status", "protocol"],
    buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 15000],
  });
  registerHistogram({
    name: GMAIL_TOOL_METRIC_NAMES.CONCURRENCY_WAIT_MS,
    help: "Time spent waiting for execution slot",
    labelNames: ["tool", "protocol", "status"],
    buckets: [1, 2, 5, 10, 25, 50, 100, 150, 250, 500, 1000],
  });

  gmailMcpMetricsInitialized = true;
}

function getGmailToolCircuitState(toolName: string): GmailToolCircuitState {
  let state = gmailToolCircuitStore.get(toolName);
  if (!state) {
    state = {
      status: 'closed',
      failures: 0,
      openedUntil: 0,
      backoffLevel: 0,
      halfOpenAttempts: 0,
    };
    gmailToolCircuitStore.set(toolName, state);
  }
  return state;
}

function getGmailToolCircuitResetMs(level: number): number {
  const normalizedLevel = Math.min(Math.max(level, 1), 6);
  return Math.min(
    GMAIL_TOOL_CIRCUIT_MAX_RESET_MS,
    GMAIL_TOOL_CIRCUIT_RESET_MS * Math.pow(2, normalizedLevel - 1)
  );
}

function enterGmailToolHalfOpen(toolName: string): void {
  const state = getGmailToolCircuitState(toolName);
  if (state.status === 'half-open' || state.status === 'closed') {
    return;
  }
  state.status = 'half-open';
  state.halfOpenAttempts = GMAIL_TOOL_CIRCUIT_HALF_OPEN_ATTEMPTS;
  state.openedUntil = 0;
  state.failures = 0;
}

function reserveHalfOpenCircuitAttempt(toolName: string): boolean {
  const state = getGmailToolCircuitState(toolName);
  if (state.status !== 'half-open') {
    return true;
  }
  if (state.halfOpenAttempts <= 0) {
    return false;
  }
  state.halfOpenAttempts -= 1;
  return true;
}

function parseToolErrorCode(error: unknown): GmailToolErrorCode {
  const message = extractToolErrorMessage(error, "Tool call failed");
  return resolveToolErrorCode(error, message);
}

function setGmailToolActiveGauge(toolName: GmailToolName, protocol: GmailToolProtocol): void {
  const userSafeTool = sanitizeText(toolName);
  setGauge(
    GMAIL_TOOL_METRIC_NAMES.ACTIVE_EXECUTIONS,
    gmailToolConcurrency.activeGlobal,
    {
      protocol,
      tool: userSafeTool,
    }
  );
}

function observeToolStage(
  toolName: GmailToolName,
  protocol: GmailToolProtocol,
  stage: GmailToolStage,
  status: 'ok' | 'error',
  durationMs: number
): void {
  observeHistogram(
    GMAIL_TOOL_METRIC_NAMES.TOOL_STAGE_DURATION_MS,
    durationMs,
    {
      tool: toolName,
      stage,
      status,
      protocol,
    }
  );
}

function observeSlotWait(
  toolName: GmailToolName,
  protocol: GmailToolProtocol,
  status: "ok" | "timeout",
  durationMs: number
): void {
  const safeTool = sanitizeText(toolName);
  observeHistogram(
    GMAIL_TOOL_METRIC_NAMES.CONCURRENCY_WAIT_MS,
    durationMs,
    {
      tool: safeTool,
      protocol,
      status,
    }
  );
}

function countSlotWaitAttempt(
  toolName: GmailToolName,
  protocol: GmailToolProtocol,
  outcome: "granted" | "waiting" | "timeout"
): void {
  const safeTool = sanitizeText(toolName);
  incCounter(
    GMAIL_TOOL_METRIC_NAMES.CONCURRENCY_WAIT_ATTEMPTS,
    {
      tool: safeTool,
      protocol,
      outcome,
    }
  );
}

function countIdempotencyEvent(
  toolName: GmailToolName,
  protocol: GmailToolProtocol,
  state: "start" | "proposed" | "replay" | "conflict" | "in_progress" | "success" | "failure"
): void {
  const safeTool = sanitizeText(toolName);
  incCounter(
    GMAIL_TOOL_METRIC_NAMES.IDEMPOTENCY_EVENTS_TOTAL,
    {
      tool: safeTool,
      protocol,
      state,
    }
  );
}

function getSlotWaitDelayMs(attempt: number): number {
  const exponential = Math.min(120, 10 + attempt ** 2);
  const jitter = Math.floor(Math.random() * 10);
  return exponential + jitter;
}

function countToolStageError(
  toolName: GmailToolName,
  protocol: GmailToolProtocol,
  stage: GmailToolStage,
  error: unknown
): void {
  const code = parseToolErrorCode(error);
  incCounter(
    GMAIL_TOOL_METRIC_NAMES.TOOL_STAGE_ERRORS_TOTAL,
    {
      tool: toolName,
      stage,
      protocol,
      code,
    }
  );
}

function markGmailToolFailure(toolName: string): void {
  const state = getGmailToolCircuitState(toolName);
  if (state.status === 'half-open') {
    state.status = 'open';
    state.backoffLevel += 1;
    state.openedUntil = Date.now() + getGmailToolCircuitResetMs(state.backoffLevel);
    state.halfOpenAttempts = 0;
    state.failures = 0;
    return;
  }

  state.failures += 1;
  if (state.failures >= GMAIL_TOOL_CIRCUIT_FAILURE_THRESHOLD) {
    state.backoffLevel = Math.min(state.backoffLevel + 1, 6);
    state.status = 'open';
    state.openedUntil = Date.now() + getGmailToolCircuitResetMs(state.backoffLevel);
    state.failures = 0;
  }
}

function markGmailToolSuccess(toolName: string): void {
  const state = getGmailToolCircuitState(toolName);
  state.failures = 0;
  state.status = 'closed';
  state.backoffLevel = 0;
  state.halfOpenAttempts = 0;
  state.openedUntil = 0;
}

function isGmailToolCircuitOpen(toolName: string): boolean {
  const state = getGmailToolCircuitState(toolName);
  if (state.status === 'closed') {
    return false;
  }
  if (state.status === 'half-open') {
    return !reserveHalfOpenCircuitAttempt(toolName);
  }
  if (state.status !== 'open') {
    return false;
  }
  if (Date.now() >= state.openedUntil) {
    enterGmailToolHalfOpen(toolName);
    return false;
  }
  return true;
}

function createToolError(
  code: GmailToolErrorCode,
  message: string,
  options: { retryAfterSeconds?: number } = {}
): GmailToolError {
  const error = new Error(
    sanitizeText(message).slice(0, GMAIL_TOOL_MAX_ERROR_MESSAGE_LEN)
  ) as GmailToolError;
  error.code = code;
  if (typeof options.retryAfterSeconds === "number") {
    error.retryAfterSeconds = options.retryAfterSeconds;
  }
  return error;
}

function isKnownGmailToolName(value: string): value is GmailToolName {
  return Object.prototype.hasOwnProperty.call(gmailToolSchemas, value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return false;
  }

  if (Object.prototype.toString.call(value) !== '[object Object]') {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isGmailToolError(error: unknown): error is GmailToolError {
  return error instanceof Error && typeof (error as GmailToolError).code === "string";
}

function normalizeTokenScopes(rawScopes: GmailOAuthToken['scopes'] | undefined): string[] {
  if (!Array.isArray(rawScopes)) {
    return [];
  }
  return rawScopes
    .filter((scope): scope is string => typeof scope === "string" && scope.trim().length > 0)
    .map((scope) => sanitizeText(scope.trim()));
}

function hasRequiredScopes(rawScopes: GmailOAuthToken['scopes'] | undefined, toolName: string): boolean {
  const normalizedScopes = new Set(normalizeTokenScopes(rawScopes));
  const requiredScopes = isKnownGmailToolName(toolName) ? GMAIL_TOOL_SCOPE_REQUIRED_MAP[toolName] : undefined;
  if (!requiredScopes) {
    return false;
  }
  return requiredScopes.every((requiredScope) => normalizedScopes.has(requiredScope));
}

function acquireToolExecutionSlot(userId: string): (() => void) | null {
  if (gmailToolConcurrency.activeGlobal >= GMAIL_TOOL_MAX_CONCURRENT_GLOBAL) {
    return null;
  }

  const userActive = gmailToolConcurrency.activeByUser.get(userId) ?? 0;
  if (userActive >= GMAIL_TOOL_MAX_CONCURRENT_PER_USER) {
    return null;
  }

  gmailToolConcurrency.activeGlobal += 1;
  gmailToolConcurrency.activeByUser.set(userId, userActive + 1);

  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;

    const nextGlobal = Math.max(0, gmailToolConcurrency.activeGlobal - 1);
    gmailToolConcurrency.activeGlobal = nextGlobal;

    const nextUser = Math.max(0, (gmailToolConcurrency.activeByUser.get(userId) ?? 1) - 1);
    if (nextUser <= 0) {
      gmailToolConcurrency.activeByUser.delete(userId);
    } else {
      gmailToolConcurrency.activeByUser.set(userId, nextUser);
    }
  };
}

async function acquireToolExecutionSlotWithTimeout(
  userId: string,
  protocol: GmailToolProtocol,
  toolName: GmailToolName
): Promise<() => void> {
  const start = Date.now();
  let attempt = 0;

  while (true) {
    const releaseSlot = acquireToolExecutionSlot(userId);
    if (releaseSlot) {
      const waitMs = Date.now() - start;
      observeSlotWait(toolName, protocol, "ok", waitMs);
      countSlotWaitAttempt(toolName, protocol, "granted");
      return releaseSlot;
    }

    attempt += 1;
    countSlotWaitAttempt(toolName, protocol, "waiting");
    const waitMs = getSlotWaitDelayMs(attempt);

    if (Date.now() - start + waitMs >= GMAIL_TOOL_MAX_CONCURRENT_WAIT_MS) {
      observeSlotWait(toolName, protocol, "timeout", Date.now() - start);
      countSlotWaitAttempt(toolName, protocol, "timeout");
      throw createToolError("backpressure", "Too many concurrent Gmail tool executions", { retryAfterSeconds: 2 });
    }

    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

function readCorrelationId(req: Request): string {
  const raw = (req.headers["x-request-id"] as string) || (req.headers["x-correlation-id"] as string) || "";
  return sanitizeText(raw).slice(0, 64);
}

function resolveGmailTool(rawTool: unknown): GmailToolName | undefined {
  if (typeof rawTool !== "string") {
    return undefined;
  }

  const normalized = sanitizeText(rawTool).trim().toLowerCase();
  if (!isKnownGmailToolName(normalized)) {
    return undefined;
  }

  return normalized;
}

function extractToolIdentityFromPayload(payload: unknown): { toolLabel: string; canonicalTool?: GmailToolName } {
  if (!isPlainObject(payload)) {
    return { toolLabel: FALLBACK_TOOL_NAME };
  }

  const candidate = (payload as { tool?: unknown }).tool ?? (payload as { name?: unknown }).name;
  if (typeof candidate !== "string") {
    return { toolLabel: FALLBACK_TOOL_NAME };
  }

  const sanitizedCandidate = sanitizeText(candidate).trim().toLowerCase().slice(0, 64);
  if (!sanitizedCandidate) {
    return { toolLabel: FALLBACK_TOOL_NAME };
  }

  const canonicalTool = resolveGmailTool(sanitizedCandidate);
  return {
    toolLabel: canonicalTool ?? sanitizedCandidate,
    canonicalTool,
  };
}

function stampCorrelationResponseHeaders(res: Response, correlationId: string): void {
  const safeId = sanitizeText(correlationId).slice(0, 64);
  if (safeId) {
    res.setHeader("x-request-id", safeId);
    res.setHeader("x-correlation-id", safeId);
  }
}

function isSafeRequestPayload(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function getIdempotencyHeader(req: Request): string | undefined {
  return (
    req.get("idempotency-key") ||
    req.get("Idempotency-Key") ||
    req.header("X-Idempotency-Key") ||
    undefined
  );
}

function isJsonRequest(req: Request): boolean {
  const contentType = sanitizeText(req.get("content-type") || "").toLowerCase();
  if (!contentType) {
    return true;
  }
  return contentType.includes("application/json");
}

function normalizeErrorMessage(message: string): string {
  return sanitizeText(message).slice(0, GMAIL_TOOL_MAX_ERROR_MESSAGE_LEN);
}

function isToolCallPayloadTooLarge(req: Request): boolean {
  const contentLengthHeader = req.get("content-length");
  if (contentLengthHeader) {
    const contentLength = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(contentLength) && contentLength > GMAIL_TOOL_MAX_PAYLOAD_BYTES) {
      return true;
    }
  }
  try {
    const requestByteLength = Buffer.byteLength(
      typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {})
    );
    return requestByteLength > GMAIL_TOOL_MAX_PAYLOAD_BYTES;
  } catch {
    return false;
  }
}

function sanitizeToolValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    return sanitizeMcpText(value, GMAIL_TOOL_MAX_PAYLOAD_STRING_LEN);
  }

  if (typeof value === "number") {
    if (Number.isFinite(value)) {
      return value;
    }
    throw createToolError("validation", "Tool payload contains invalid number");
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    if (depth >= GMAIL_TOOL_MAX_PAYLOAD_DEPTH) {
      throw createToolError("validation", "Tool payload nesting is too deep");
    }
    if (value.length > GMAIL_TOOL_MAX_PAYLOAD_ARRAY_LENGTH) {
      throw createToolError("validation", "Tool payload array is too large");
    }
    return value.map((entry) => sanitizeToolValue(entry, depth + 1));
  }

  if (typeof value !== 'object' || !isPlainObject(value)) {
    throw createToolError("validation", "Tool payload contains unsupported value type");
  }

  if (depth >= GMAIL_TOOL_MAX_PAYLOAD_DEPTH) {
    throw createToolError("validation", "Tool payload nesting is too deep");
  }

  const source = value as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  const keys = Object.keys(source);
  if (keys.length > GMAIL_TOOL_MAX_PAYLOAD_OBJECT_KEYS) {
    throw createToolError("validation", "Tool payload has too many fields");
  }

  const usedKeys = new Set<string>();
  for (const rawKey of keys.slice(0, GMAIL_TOOL_MAX_PAYLOAD_OBJECT_KEYS)) {
    if (rawKey.length > 64) {
      throw createToolError("validation", "Tool argument key is too long");
    }

    const sanitizedKey = sanitizeText(rawKey);
    if (!sanitizedKey || !GMAIL_TOOL_ALLOWED_KEY_REGEX.test(sanitizedKey)) {
      throw createToolError("validation", "Tool argument key is invalid");
    }

    if (usedKeys.has(sanitizedKey)) {
      throw createToolError("validation", "Tool payload contains duplicate fields");
    }
    usedKeys.add(sanitizedKey);

    if (GMAIL_TOOL_DANGEROUS_KEYS.has(sanitizedKey) || GMAIL_TOOL_DANGEROUS_KEYS.has(sanitizedKey.toLowerCase())) {
      continue;
    }
    safe[sanitizedKey] = sanitizeToolValue(source[rawKey], depth + 1);
  }

  return safe;
}

function sanitizeIdempotencyKey(raw: string | undefined): string | null {
  if (!raw) {
    return null;
  }

  const normalized = sanitizeText(raw).trim();
  if (normalized.length === 0) {
    return null;
  }

  if (
    normalized.length < GMAIL_TOOL_IDEMPOTENCY_KEY_MIN_LEN ||
    normalized.length > GMAIL_TOOL_IDEMPOTENCY_KEY_MAX_LEN
  ) {
    throw createToolError("validation", "Idempotency key must be between 8 and 128 characters");
  }

  if (!GMAIL_TOOL_IDEMPOTENCY_REGEX.test(normalized)) {
    throw createToolError("validation", "Idempotency key contains invalid characters");
  }

  return normalized;
}

function getToolIdempotencyCacheKey(
  userId: string,
  toolName: GmailToolName,
  idempotencyKey: string,
): string {
  return `${userId}:${toolName}:${idempotencyKey}`;
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (typeof value !== "object") {
    return JSON.stringify(value);
  }

  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    normalized[key] = (value as Record<string, unknown>)[key];
  }
  return JSON.stringify(normalized);
}

function buildToolFingerprint(toolName: GmailToolName, args: Record<string, unknown>): string {
  return createHash('sha256').update(`${toolName}|${stableStringify(args)}`).digest('hex');
}

function pruneExpiredIdempotencyEntries(): void {
  const now = Date.now();
  for (const [cacheKey, record] of gmailToolIdempotencyStore) {
    if (record.expiresAtMs <= now) {
      gmailToolIdempotencyStore.delete(cacheKey);
    }
  }

  if (gmailToolIdempotencyStore.size <= GMAIL_TOOL_IDEMPOTENCY_MAX_ACTIVE_KEYS) {
    return;
  }

  const evictionOrder = [...gmailToolIdempotencyStore.entries()].sort((left, right) => {
    const leftRank = GMAIL_TOOL_IDEMPOTENCY_STATE_RANK[left[1].state];
    const rightRank = GMAIL_TOOL_IDEMPOTENCY_STATE_RANK[right[1].state];
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    return left[1].startedAtMs - right[1].startedAtMs;
  });

  for (const [cacheKey] of evictionOrder) {
    gmailToolIdempotencyStore.delete(cacheKey);
    if (gmailToolIdempotencyStore.size <= GMAIL_TOOL_IDEMPOTENCY_MAX_ACTIVE_KEYS) {
      break;
    }
  }
}

async function withToolIdempotency<T>(
  userId: string,
  toolName: GmailToolName,
  idempotencyKey: string | null,
  args: Record<string, unknown>,
  protocol: GmailToolProtocol,
  operation: () => Promise<T>
): Promise<T> {
  if (!idempotencyKey || !GMAIL_TOOL_IDEMPOTENT_TOOLS.has(toolName)) {
    return operation();
  }

  const cacheKey = getToolIdempotencyCacheKey(userId, toolName, idempotencyKey);
  const now = Date.now();
  const fingerprint = buildToolFingerprint(toolName, args);
  const existing = gmailToolIdempotencyStore.get(cacheKey);

  if (existing) {
    if (existing.expiresAtMs <= now) {
      gmailToolIdempotencyStore.delete(cacheKey);
    } else if (existing.fingerprint !== fingerprint) {
      countIdempotencyEvent(toolName, protocol, 'conflict');
      throw createToolError("idempotency_conflict", "Idempotency key is reused with a different payload");
    } else if (existing.state === 'done') {
      countIdempotencyEvent(toolName, protocol, 'replay');
      logger.info('[MCP Gmail] Idempotency replay', {
        userId: sanitizeText(String(userId)),
        tool: toolName,
      });
      return existing.result as T;
    } else {
      countIdempotencyEvent(toolName, protocol, 'in_progress');
      throw createToolError("idempotency_in_progress", "Idempotent request already in progress");
    }
  }

  const startedAtMs = now;
  const record: GmailToolIdempotencyRecord = {
    state: 'proposed',
    fingerprint,
    expiresAtMs: now + GMAIL_TOOL_IDEMPOTENCY_TTL_MS,
    promise: Promise.resolve(undefined),
    startedAtMs,
  };

  record.promise = (async () => {
    const executionResult = await operation();
    return executionResult;
  })();
  countIdempotencyEvent(toolName, protocol, 'proposed');
  gmailToolIdempotencyStore.set(cacheKey, record);
  pruneExpiredIdempotencyEntries();

  record.state = 'running';
  const promise = record.promise.then(
    (result) => {
      record.state = 'done';
      record.result = result;
      countIdempotencyEvent(toolName, protocol, 'success');
      return result;
    },
    (error: unknown) => {
      countIdempotencyEvent(toolName, protocol, 'failure');
      gmailToolIdempotencyStore.delete(cacheKey);
      throw error;
    }
  );
  countIdempotencyEvent(toolName, protocol, 'start');
  record.promise = promise;

  return promise as Promise<T>;
}

function isBackpressureError(message: string): boolean {
  return message.toLowerCase().includes("too many concurrent gmail tool executions");
}

function isGmailToolTimeout(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("tool call timed out") ||
    normalized.includes("stage timed out") ||
    normalized.includes("timed out")
  );
}

function inferToolStageFromError(message: string): GmailToolStage {
  const normalized = message.toLowerCase();
  if (normalized.includes('parse stage')) {
    return 'parse';
  }
  if (normalized.includes('auth stage')) {
    return 'auth';
  }
  if (normalized.includes('response stage')) {
    return 'response';
  }
  if (normalized.includes('serialize')) {
    return 'serialize';
  }
  if (normalized.includes('execution stage')) {
    return 'execution';
  }
  return 'execution';
}

function isGmailCircuitError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("temporarily unavailable") || normalized.includes("tool call temporarily unavailable");
}

function isValidationFailure(message: string): boolean {
  const normalized = message.toLowerCase().trim();
  return (
    normalized === "tool or name is required" ||
    normalized === "unknown tool" ||
    normalized === "invalid params" ||
    normalized.includes("validation failed") ||
    normalized.includes("invalid input") ||
    normalized.includes("malformed request") ||
    normalized.includes("recipient list is empty") ||
    normalized.includes("tool payload")
  );
}

function isTransientGmailToolError(error: unknown): boolean {
  const message = extractToolErrorMessage(error, "Tool call failed").toLowerCase();
  if (isGmailToolError(error) && (error.code === "validation" || error.code === "scope")) {
    return false;
  }
  if (isGmailCircuitError(message)) {
    return false;
  }
  return isTransientError(error);
}

function getToolRetrySeconds(message: string, toolName?: GmailToolName): number | null {
  if (isBackpressureError(message)) {
    return 2;
  }
  if (message.toLowerCase().includes("too many requests")) {
    return 3;
  }
  if (isGmailToolTimeout(message)) {
    return 1;
  }
  if (isGmailCircuitError(message)) {
    if (toolName) {
      const retryAfter = getGmailToolCircuitRetryAfterSeconds(toolName);
      if (retryAfter !== null) {
        return retryAfter;
      }
    }
    return Math.ceil(GMAIL_TOOL_CIRCUIT_RESET_MS / 1000);
  }
  return null;
}

function getGmailToolCircuitRetryAfterSeconds(toolName: string): number | null {
  const state = getGmailToolCircuitState(toolName);
  if (state.openedUntil <= 0) {
    return null;
  }
  const remainingMs = Math.max(0, state.openedUntil - Date.now());
  return Math.max(1, Math.ceil(remainingMs / 1000));
}

async function withGmailToolCircuit<T>(toolName: string, operation: () => Promise<T>): Promise<T> {
  if (isGmailToolCircuitOpen(toolName)) {
    const retryAfterSeconds = getGmailToolCircuitRetryAfterSeconds(toolName) ?? Math.ceil(GMAIL_TOOL_CIRCUIT_RESET_MS / 1000);
    throw createToolError("circuit_open", "Tool call temporarily unavailable", {
      retryAfterSeconds,
    });
  }

  try {
    const result = await operation();
    markGmailToolSuccess(toolName);
    return result;
  } catch (error) {
    const message = extractToolErrorMessage(error, "Tool call failed");
    if (!isValidationFailure(message) && !message.includes("Gmail not connected")) {
      markGmailToolFailure(toolName);
    }
    throw error;
  }
}

async function withToolStageTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  stage: GmailToolStage
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      reject(createToolError("timeout", `${stage} stage timed out`));
    }, timeoutMs);

    try {
      Promise.resolve(operation())
        .then((result) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeout);
          resolve(result);
        })
        .catch((error) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeout);
          reject(error);
        });
    } catch (error) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      reject(error as Error);
    }
  });
}

async function withToolStage<T>(
  protocol: GmailToolProtocol,
  toolName: GmailToolName,
  stage: GmailToolStage,
  operation: () => Promise<T>
): Promise<T> {
  const timeoutMs = GMAIL_TOOL_STAGE_TIMEOUT_MS[stage];
  const start = Date.now();
  try {
    const result = await withToolStageTimeout(operation, timeoutMs, stage);
    observeToolStage(toolName, protocol, stage, 'ok', Date.now() - start);
    return result;
  } catch (error: unknown) {
    const durationMs = Date.now() - start;
    observeToolStage(toolName, protocol, stage, 'error', durationMs);
    countToolStageError(toolName, protocol, stage, error);
    throw error;
  }
}

async function withToolCallRetry<T>(toolName: GmailToolName, operation: () => Promise<T>): Promise<T> {
  return withRetry(
    () => withGmailToolCircuit(toolName, operation),
    {
      maxRetries: GMAIL_TOOL_MAX_RETRIES,
      baseDelay: 250,
      maxDelay: 1_000,
      exponentialBackoff: true,
      shouldRetry: (error: Error) => isTransientGmailToolError(error),
      onRetry: (error: Error, attempt: number, delay: number) => {
        logger.warn("[MCP Gmail] Retrying tool call", {
          tool: toolName,
          attempt,
          delay,
          reason: extractToolErrorMessage(error, "Tool call failed"),
        });

        addAttribute('mcp.retry.attempt', attempt);
        addAttribute('mcp.retry.delay_ms', delay);
        incCounter(
          GMAIL_TOOL_METRIC_NAMES.TOOL_RETRIES,
          {
            tool: toolName,
            stage: "execution",
          }
        );
      },
    }
  );
}

function sanitizeMcpText(value: string, maxLen: number): string {
  return sanitizePlainText(value, { maxLen, collapseWs: true }).slice(0, maxLen);
}

function normalizeQuery(raw: string): string {
  return sanitizeSearchQuery(raw, 500);
}

function validateEmail(raw: string): string {
  const sanitized = sanitizeMcpText(raw, 254);
  if (!EMAIL_SAFE_REGEX.test(sanitized)) {
    throw createToolError("validation", "Invalid email address");
  }
  return sanitized;
}

function parseEmailList(raw: string): string[] {
  const addresses = raw
    .split(/[;,]/)
    .map((value) => sanitizeMcpText(value, 254))
    .map((value) => value.trim())
    .filter(Boolean);

  if (addresses.length === 0) {
    throw createToolError("validation", "Recipient list is empty");
  }

  for (const address of addresses) {
    validateEmail(address);
  }
  if (addresses.length > GMAIL_TOOL_MAX_RECIPIENTS) {
    throw createToolError("validation", "Recipient list is too large");
  }

  const unique = new Set<string>();
  const deduped: string[] = [];
  for (const address of addresses) {
    if (unique.has(address)) {
      continue;
    }
    unique.add(address);
    deduped.push(address);
  }

  return deduped;
}

function sanitizeToolResult(result: unknown): unknown {
  if (result === undefined) {
    return null;
  }

  try {
    const serialized = JSON.stringify(result);
    if (serialized.length <= GMAIL_TOOL_MAX_RESULT_BYTES) {
      return result;
    }
    return {
      truncated: true,
      byteLength: serialized.length,
      preview: serialized.slice(0, 2048),
    };
  } catch {
    return {
      truncated: true,
      byteLength: 0,
      preview: null,
    };
  }
}

function buildToolFallbackPayload(
  toolName: GmailToolName | string,
  code: GmailToolErrorCode,
  message: string,
  protocol: GmailToolProtocol,
  stage: GmailToolStage = 'response'
): Record<string, unknown> {
  const safeTool = sanitizeText(toolName).slice(0, 64);
  incCounter(
    GMAIL_TOOL_METRIC_NAMES.FALLBACK_TOTAL,
    {
      tool: safeTool,
      code,
      protocol,
      stage,
    }
  );

  return {
    degraded: true,
    fallback: GMAIL_TOOL_OPENAI_FALLBACK_LABEL,
    tool: safeTool,
    reason: code,
    protocol,
    stage,
    safeMessage: normalizeErrorMessage(message),
    timestamp: new Date().toISOString(),
  };
}

function sanitizeToolArgs(args: Record<string, unknown>): Record<string, unknown> {
  if (!isPlainObject(args)) {
    throw createToolError("validation", "Tool arguments must be an object");
  }

  const safeKeys = Object.keys(args);
  if (safeKeys.length > GMAIL_TOOL_MAX_PAYLOAD_OBJECT_KEYS) {
    throw createToolError("validation", "Tool arguments has too many fields");
  }

  const sanitized: Record<string, unknown> = {};
  const usedKeys = new Set<string>();
  for (const key of safeKeys) {
    if (key.length > 64) {
      throw createToolError("validation", "Tool argument key is too long");
    }

    const sanitizedKey = sanitizeText(key);
    if (!sanitizedKey || !GMAIL_TOOL_ALLOWED_KEY_REGEX.test(sanitizedKey)) {
      throw createToolError("validation", "Tool argument key is invalid");
    }

    if (usedKeys.has(sanitizedKey)) {
      throw createToolError("validation", "Tool arguments contain duplicate fields");
    }
    usedKeys.add(sanitizedKey);

    if (GMAIL_TOOL_DANGEROUS_KEYS.has(sanitizedKey) || GMAIL_TOOL_DANGEROUS_KEYS.has(sanitizedKey.toLowerCase())) {
      continue;
    }
    sanitized[sanitizedKey] = sanitizeToolValue(args[key], 1);
  }
  return sanitized;
}

function getMcpToolByName(toolName: string): McpTool | undefined {
  return MCP_TOOL_BY_NAME.get(toolName);
}

function validateToolResultAgainstSchema(toolName: GmailToolName, result: unknown): unknown {
  const tool = getMcpToolByName(toolName);
  if (!tool || !tool.outputSchema || typeof result === 'undefined') {
    return result;
  }

  const expectedType = tool.outputSchema.type;
  if (!expectedType) {
    return result;
  }

  const normalized = expectedType.toLowerCase();
  const isArray = normalized === 'array';
  const isObject = normalized === 'object';

  const isTypeMatch =
    (isArray && Array.isArray(result)) ||
    (isObject && isPlainObject(result)) ||
    (normalized === 'string' && typeof result === 'string') ||
    (normalized === 'number' && typeof result === 'number') ||
    (normalized === 'boolean' && typeof result === 'boolean') ||
    (normalized === 'null' && result === null);

  if (isTypeMatch) {
    return result;
  }

  return {
    degraded: true,
    fallback: GMAIL_TOOL_OPENAI_FALLBACK_LABEL,
    tool: toolName,
    expectedType,
    actualType: result === null ? 'null' : typeof result,
    partial: true,
    note: 'Tool output normalized due schema mismatch',
    source: sanitizeToolResult(result),
  };
}

function validateToolPayload(toolName: GmailToolName, args: Record<string, unknown>): Record<string, unknown> {
  if (!toolName || toolName.length > 48) {
    throw createToolError("validation", "Invalid tool name");
  }
  if (Object.keys(args).length > GMAIL_TOOL_MAX_PAYLOAD_OBJECT_KEYS) {
    throw createToolError("validation", "Tool payload has too many fields");
  }

  const sanitized = sanitizeToolArgs(args);
  const serialized = JSON.stringify(sanitized);
  if (serialized.length > GMAIL_TOOL_MAX_PAYLOAD_BYTES) {
    throw createToolError("validation", "Tool payload is too large");
  }

  return sanitized;
}

function validateToolArgs(toolName: GmailToolName, args: Record<string, unknown>): unknown {
  return gmailToolSchemas[toolName].parse(args);
}

function extractToolErrorMessage(error: unknown, fallback: string): string {
  const rawMessage = typeof error?.message === "string" ? error.message : fallback;
  const sanitized = sanitizeText(rawMessage);
  return sanitized.length > 0 ? sanitized : sanitizeText(fallback);
}

function resolveToolErrorCode(error: unknown, message: string): GmailToolErrorCode {
  if (isGmailToolError(error)) {
    return error.code;
  }
  if (isValidationFailure(message)) {
    return "validation";
  }
  const normalized = message.toLowerCase();
  if (normalized === "insufficient gmail scopes") {
    return "scope";
  }
  if (isBackpressureError(normalized)) {
    return "backpressure";
  }
  if (isGmailCircuitError(normalized)) {
    return "circuit_open";
  }
  if (isGmailToolTimeout(normalized)) {
    return "timeout";
  }
  if (normalized === "gmail not connected" || normalized === "unauthorized") {
    return "unauthorized";
  }
  if (normalized === "idempotency key is reused with a different payload") {
    return "idempotency_conflict";
  }
  if (normalized === "idempotent request already in progress") {
    return "idempotency_in_progress";
  }
  if (normalized.startsWith("unknown method:")) {
    return "unsupported_method";
  }
  return "internal";
}

function classifyToolError(
  error: unknown,
  toolName?: GmailToolName
): { status: number; body: { code: GmailToolErrorCode; error: string; retryAfter?: number } } {
  const message = extractToolErrorMessage(error, "Tool call failed");
  const code = resolveToolErrorCode(error, message);

  if (code === "validation" || code === "scope") {
    const safeMessage = normalizeErrorMessage(message);
    return {
      status: 400,
      body: { code, error: safeMessage },
    };
  }

  if (code === "idempotency_conflict" || code === "idempotency_in_progress") {
    const safeMessage = normalizeErrorMessage(message);
    return {
      status: 409,
      body: { code, error: safeMessage },
    };
  }

  if (code === "backpressure") {
    const retryAfterSeconds = isGmailToolError(error)
      ? error.retryAfterSeconds
      : getToolRetrySeconds(message, toolName);
    return {
      status: 429,
      body: {
        code,
        error: "Too many concurrent Gmail tool executions",
        retryAfter: retryAfterSeconds ?? 2,
      },
    };
  }

  if (code === "circuit_open") {
    const retryAfterSeconds = isGmailToolError(error)
      ? error.retryAfterSeconds
      : getToolRetrySeconds(message, toolName);
    return {
      status: 503,
      body: {
        code,
        error: "Tool call temporarily unavailable",
        retryAfter: retryAfterSeconds ?? Math.ceil(GMAIL_TOOL_CIRCUIT_RESET_MS / 1000),
      },
    };
  }

  if (code === "timeout") {
    return {
      status: 504,
      body: { code, error: "Tool call timed out" },
    };
  }

  if (code === "unauthorized" || code === "not_connected") {
    const safeMessage = normalizeErrorMessage(message);
    return {
      status: 403,
      body: { code, error: safeMessage },
    };
  }

  return {
    status: 500,
    body: { code, error: "Tool call failed" },
  };
}

function mapToolErrorToJsonRpcCode(code: GmailToolErrorCode): number {
  if (code === "validation") {
    return -32602;
  }
  if (code === "scope") {
    return -32602;
  }
  if (code === "unsupported_method") {
    return -32601;
  }
  if (code === "unauthorized" || code === "not_connected") {
    return -32000;
  }
  if (code === "idempotency_conflict" || code === "idempotency_in_progress") {
    return -32000;
  }
  if (code === "backpressure" || code === "circuit_open" || code === "timeout") {
    return -32000;
  }
  return -32603;
}

async function handleToolCall(
  toolName: GmailToolName,
  args: Record<string, unknown>,
  gmail: gmail_v1.Gmail
): Promise<unknown> {
  const sanitizedArgs = validateToolArgs(toolName, args);
  switch (toolName) {
    case 'gmail_search': {
      const { query, maxResults } = sanitizedArgs as z.infer<typeof gmailSearchSchema>;
      const safeQuery = normalizeQuery(query);
      return gmailSearch(gmail, { query: safeQuery, maxResults });
    }

    case 'gmail_fetch': {
      const { threadId } = sanitizedArgs as z.infer<typeof gmailFetchSchema>;
      return gmailFetchThread(gmail, { threadId });
    }

    case 'gmail_send': {
      const {
        to,
        subject,
        body,
        threadId,
      } = sanitizedArgs as z.infer<typeof gmailSendSchema>;

      const safeThreadId = threadId && sanitizeMcpText(threadId, 128);
      const recipients = parseEmailList(to).join(", ");
      const safeSubject = sanitizeMcpText(subject, 200);
      const safeBody = sanitizeMcpText(body, 30_000);
      return gmailSend(gmail, { to: recipients, subject: safeSubject, body: safeBody, threadId: safeThreadId });
    }

    case 'gmail_mark_read': {
      const { messageId } = sanitizedArgs as z.infer<typeof gmailMarkReadSchema>;
      return gmailMarkRead(gmail, { messageId });
    }

    case 'gmail_labels': {
      return gmailLabels(gmail);
    }

    default:
      throw createToolError("validation", "Unknown tool");
  }
}

async function executeToolCall(
  req: Request,
  userId: string,
  toolName: string,
  args: Record<string, unknown>,
  token: GmailOAuthToken,
  protocol: GmailToolProtocol
): Promise<unknown> {
  if (!isKnownGmailToolName(toolName)) {
    throw createToolError("validation", "Unknown tool");
  }
  initializeGmailMcpMetrics();

  const normalizedToolName = toolName;
  const correlationId = readCorrelationId(req);
  const start = Date.now();
  const sanitizedTool = sanitizeText(toolName);
  const idempotencyKey = sanitizeIdempotencyKey(
    getIdempotencyHeader(req)
  );
  const sanitizedArgs = await withToolStage(
    protocol,
    normalizedToolName,
    'parse',
    async () => {
      const parsedArgs = validateToolPayload(normalizedToolName, args);
      if (GMAIL_TOOL_IDEMPOTENT_TOOLS.has(normalizedToolName) && !idempotencyKey) {
        throw createToolError("validation", "Idempotency-Key header is required for this operation");
      }
      return parsedArgs;
    }
  );

  try {
    const result = await withToolIdempotency(
      userId,
      normalizedToolName,
      idempotencyKey,
      sanitizedArgs,
      protocol,
      async () =>
        withSpan(
          SPAN_NAMES.TOOL_EXECUTION,
          async () => {
            addAttribute(SPAN_ATTRIBUTES.AGENT_TOOL_NAME, normalizedToolName);
            addAttribute('mcp.stage', 'execution');
            addAttribute('mcp.idempotent', idempotencyKey !== null);

            try {
              const releaseSlot = await acquireToolExecutionSlotWithTimeout(
                userId,
                protocol,
                normalizedToolName
              );
              setGmailToolActiveGauge(normalizedToolName, protocol);
              try {
                const gmail = await withToolStage(protocol, normalizedToolName, 'auth', async () => {
                  if (!hasRequiredScopes(token.scopes, normalizedToolName)) {
                    throw createToolError("scope", "Insufficient Gmail scopes");
                  }
                  return getGmailClient(token);
                });

                return await withToolStage(protocol, normalizedToolName, 'execution', async () => {
                  const toolResult = await withToolCallRetry(normalizedToolName, () =>
                    withToolStageTimeout(
                      () => handleToolCall(normalizedToolName, sanitizedArgs, gmail),
                      GMAIL_TOOL_STAGE_TIMEOUT_MS.execution,
                      'execution'
                    )
                  );
                  return validateToolResultAgainstSchema(normalizedToolName, toolResult);
                });
              } finally {
                setGmailToolActiveGauge(normalizedToolName, protocol);
                releaseSlot();
              }
            } finally {
              setGmailToolActiveGauge(normalizedToolName, protocol);
            }
          },
          {
            userId,
            requestId: correlationId,
          }
        )
    );

    logger.info("[MCP Gmail] Tool call completed", {
      correlationId,
      userId: sanitizeText(String(userId)),
      tool: sanitizedTool,
      durationMs: Date.now() - start,
      status: "ok",
      idempotent: idempotencyKey !== null,
    });

    const response = await withToolStage(protocol, normalizedToolName, 'response', async () => sanitizeToolResult(result));
    incCounter(
      GMAIL_TOOL_METRIC_NAMES.TOOL_CALLS_TOTAL,
      {
        tool: normalizedToolName,
        status: "success",
        protocol,
        stage: "response",
      }
    );
    return response;
  } catch (error: unknown) {
    const message = extractToolErrorMessage(error, "Tool call failed");
    const code = resolveToolErrorCode(error, message);
    addAttribute("mcp.tool.code", code);
    addAttribute("mcp.tool.duration_ms", Date.now() - start);

    recordTracingError(error instanceof Error ? error : new Error(message));
    incCounter(
      GMAIL_TOOL_METRIC_NAMES.TOOL_CALLS_TOTAL,
      {
        tool: normalizedToolName,
        status: "error",
        protocol,
        stage: "response",
      }
    );
    countToolStageError(normalizedToolName, protocol, "response", error);

    logger.warn("[MCP Gmail] Tool call execution failed", {
      correlationId,
      userId: sanitizeText(String(userId)),
      tool: sanitizedTool,
      durationMs: Date.now() - start,
      code,
      error: message,
    });

  const shouldFallback = ["timeout", "circuit_open", "internal", "backpressure"].includes(code);
  if (shouldFallback) {
    const fallbackPayload = buildToolFallbackPayload(
      normalizedToolName,
      code,
      message,
      protocol,
      'response'
    );
    if (error && typeof error === "object") {
      const fallbackAwareError = error as GmailToolError & { fallbackPayload?: Record<string, unknown> };
      fallbackAwareError.fallbackPayload = fallbackPayload;
    }
  }

    throw error;
  }
}

const MCP_TOOLS: McpTool[] = [
  {
    name: 'gmail_search',
    description: 'Search emails in Gmail inbox with a query',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Gmail search query (e.g., "is:unread", "from:example@gmail.com")' },
        maxResults: { type: 'number', description: 'Maximum number of results (default: 20)' }
      },
      required: ['query']
    },
    outputSchema: {
      type: 'object',
      properties: {
        messages: { type: 'array' },
      },
    }
  },
  {
    name: 'gmail_fetch',
    description: 'Fetch a specific email thread by ID',
    inputSchema: {
      type: 'object',
      properties: {
        threadId: { type: 'string', description: 'The Gmail thread ID to fetch' }
      },
      required: ['threadId']
    },
    outputSchema: {
      type: 'object',
      properties: {
        thread: { type: 'object' },
      },
    }
  },
  {
    name: 'gmail_send',
    description: 'Send an email',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Email subject' },
        body: { type: 'string', description: 'Email body (plain text)' },
        threadId: { type: 'string', description: 'Optional thread ID for replies' }
      },
      required: ['to', 'subject', 'body']
    },
    outputSchema: {
      type: 'object',
      properties: {
        messageId: { type: 'string' },
      },
    }
  },
  {
    name: 'gmail_mark_read',
    description: 'Mark an email as read',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: { type: 'string', description: 'The message ID to mark as read' }
      },
      required: ['messageId']
    },
    outputSchema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
      },
    }
  },
  {
    name: 'gmail_labels',
    description: 'Get all Gmail labels',
    inputSchema: {
      type: 'object',
      properties: {}
    },
    outputSchema: {
      type: 'object',
      properties: {
        labels: { type: 'array' },
      },
    }
  }
];

const MCP_TOOL_BY_NAME = new Map<string, McpTool>(MCP_TOOLS.map((tool) => [tool.name, tool]));

export function createGmailMcpRouter(): Router {
  initializeGmailMcpMetrics();
  const router = Router();

  const resolveAuthenticatedUserId = (req: Request): string | null => {
    const userId = getUserId(req);
    if (!userId) return null;
    const normalized = String(userId);
    if (normalized.startsWith("anon_")) return null;
    return normalized;
  };

  router.get('/sse', async (req: Request, res: Response) => {
    const userId = resolveAuthenticatedUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const token = await storage.getGmailOAuthToken(userId);
    if (!token) {
      res.status(403).json({ error: 'Gmail not connected' });
      return;
    }

    logger.info('MCP Gmail SSE session started', {
      userId: sanitizeText(String(userId)),
      correlationId: sanitizeText((req.headers['x-request-id'] as string) || (req.headers['x-correlation-id'] as string) || ''),
    });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendEvent = (event: string, data: unknown) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    sendEvent('capabilities', {
      tools: MCP_TOOLS.map(t => ({ name: t.name, description: t.description }))
    });

    const heartbeat = setInterval(() => {
      sendEvent('heartbeat', { timestamp: Date.now() });
    }, 30000);

    req.on('close', () => {
      clearInterval(heartbeat);
    });
  });

  router.post('/tools/call', aiLimiter, async (req: Request, res: Response) => {
    const correlationId = readCorrelationId(req);
    const userId = resolveAuthenticatedUserId(req);

    return withSpan(
      'gmail.mcp.tools.call',
      async () => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        stampCorrelationResponseHeaders(res, correlationId);

        if (!isSafeRequestPayload(req.body)) {
          res.status(400).json({ error: 'Invalid request payload', code: 'validation' });
          return;
        }

        if (!isJsonRequest(req)) {
          res.status(415).json({ error: 'Unsupported Media Type', code: 'validation' });
          return;
        }

        if (isToolCallPayloadTooLarge(req)) {
          res.setHeader("Retry-After", String(Math.ceil(GMAIL_TOOL_MAX_PAYLOAD_BYTES / 1024)));
          res.status(413).json({ error: 'Request payload too large' });
          return;
        }

        if (!userId) {
          res.status(401).json({ error: 'Unauthorized' });
          return;
        }

        const token = await storage.getGmailOAuthToken(userId);
        if (!token) {
          res.status(403).json({ error: 'Gmail not connected' });
          return;
        }

        try {
          const parsed = toolCallSchema.parse(req.body);
          const safeTool = resolveGmailTool(parsed.tool);
          if (!safeTool) {
            throw createToolError("validation", "Unknown tool");
          }
          const result = await executeToolCall(
            req,
            userId,
            safeTool,
            parsed.arguments || {},
            token,
            'rest'
          );
          logger.info('[MCP Gmail] Tool call', {
            userId: sanitizeText(String(userId)),
            tool: safeTool,
            correlationId,
          });
          res.json({ success: true, result });
        } catch (error: unknown) {
          const { toolLabel: safeToolLabel, canonicalTool: safeTool } = extractToolIdentityFromPayload(req.body);
          const fallbackCarrier = error as { fallbackPayload?: Record<string, unknown> };
          const classification = classifyToolError(error, safeTool);
          if (classification.body.retryAfter) {
            res.setHeader("Retry-After", String(classification.body.retryAfter));
          }

          const level = classification.status >= 500 ? "error" : "warn";
          logger[level]('[MCP Gmail] Tool call error', {
            userId: sanitizeText(String(userId)),
            tool: safeTool ?? safeToolLabel,
            error: classification.body.error,
            code: classification.body.code,
            correlationId,
          });

          const fallbackCode = classification.body.code;
          const responsePayload: Record<string, unknown> = {
            error: classification.body.error,
            code: fallbackCode,
            correlationId,
          };
          if (classification.body.retryAfter) {
            responsePayload.retryAfter = classification.body.retryAfter;
          }

          if (fallbackCode === 'timeout' || fallbackCode === 'circuit_open' || fallbackCode === 'internal' || fallbackCode === 'backpressure') {
            responsePayload.fallback = fallbackCarrier.fallbackPayload ??
              buildToolFallbackPayload(
                safeTool ?? safeToolLabel,
                fallbackCode,
                classification.body.error,
                'rest',
                inferToolStageFromError(classification.body.error)
              );
          }

          res.status(classification.status).json(responsePayload);
        }
      },
      {
        userId: userId ? sanitizeText(String(userId)) : undefined,
        requestId: correlationId,
      }
    );
  });

  router.get('/tools', aiLimiter, (req: Request, res: Response) => {
    const userId = resolveAuthenticatedUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    res.json({ tools: MCP_TOOLS });
  });

  router.post('/jsonrpc', aiLimiter, async (req: Request, res: Response) => {
    const correlationId = readCorrelationId(req);
    const userId = resolveAuthenticatedUserId(req);

    return withSpan(
      'gmail.mcp.jsonrpc',
      async () => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        stampCorrelationResponseHeaders(res, correlationId);

        if (!isSafeRequestPayload(req.body)) {
          res.status(200).json({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32600, message: "Invalid JSON-RPC request" },
          });
          return;
        }

        if (!isJsonRequest(req)) {
          res.status(200).json({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32600, message: "Unsupported Media Type" },
          });
          return;
        }

        if (isToolCallPayloadTooLarge(req)) {
          res.status(200).json({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32600, message: "Request payload too large" },
          });
          return;
        }

        const parsed = mcpRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(200).json({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32600, message: "Invalid JSON-RPC request" },
          });
          return;
        }

        const request = parsed.data as McpRequest;
        const response: McpResponse = {
          jsonrpc: '2.0',
          id: request.id ?? null,
        };

        try {
          if (!userId) {
            throw createToolError("unauthorized", "Unauthorized");
          }

          const token = await storage.getGmailOAuthToken(userId);
          if (!token) {
            throw createToolError("not_connected", "Gmail not connected");
          }

          switch (request.method) {
            case 'tools/list':
              response.result = { tools: MCP_TOOLS };
              break;

            case 'tools/call': {
              const params = toolCallSchema.parse(request.params || {});
              const safeTool = resolveGmailTool(params.tool);
              if (!safeTool) {
                throw createToolError("validation", "Unknown tool");
              }
              response.result = await executeToolCall(
                req,
                userId,
                safeTool,
                params.arguments || {},
                token,
                'jsonrpc'
              );
              break;
            }

            default:
              throw createToolError("unsupported_method", `Unknown method: ${request.method}`);
          }
        } catch (error: unknown) {
          const { toolLabel: safeToolLabel, canonicalTool: safeParsedTool } = extractToolIdentityFromPayload(request.params);
          const safeTool = request.method === 'tools/call' ? safeParsedTool : undefined;
          const message = extractToolErrorMessage(error, "Internal error");
          const code = resolveToolErrorCode(error, message);
          const safeMessage = normalizeErrorMessage(message);
          response.error = {
            code: mapToolErrorToJsonRpcCode(code),
            message: safeMessage || "Internal error",
          };

          const retryAfter = isGmailToolError(error)
            ? error.retryAfterSeconds
            : getToolRetrySeconds(message, safeTool);
          const normalizedRetryAfter = normalizeRetryAfterSeconds(retryAfter);

          if (code === "backpressure" || code === "circuit_open" || code === "timeout") {
            response.error.data = {
              retryAfter: normalizedRetryAfter,
              code,
            };
          }

          const fallbackCarrier = error as { fallbackPayload?: Record<string, unknown> };
          if (code === "internal" || code === "circuit_open" || code === "timeout" || code === "backpressure") {
            response.error.data = {
              ...(response.error.data || {}),
              fallback: fallbackCarrier.fallbackPayload ??
                buildToolFallbackPayload(
                  safeTool ?? safeToolLabel,
                  code,
                  message,
                  'jsonrpc',
                  inferToolStageFromError(message)
                ),
            };
          }

          const logContext = {
            userId: sanitizeText(String(userId ?? "")),
            tool: safeTool ?? safeToolLabel,
            method: request.method,
            error: message,
            code,
            correlationId,
          };
          if (code === "validation" || code === "scope" || code === "unsupported_method") {
            logger.warn('[MCP Gmail] JSON-RPC error', logContext);
          } else {
            logger.error('[MCP Gmail] JSON-RPC error', logContext);
          }
        }

        res.status(200).json(response);
      },
      {
        userId: userId ? sanitizeText(String(userId)) : undefined,
        requestId: correlationId,
      }
    );
  });

  return router;
}

export const GMAIL_SCOPES_EXPORT = GMAIL_SCOPES;
