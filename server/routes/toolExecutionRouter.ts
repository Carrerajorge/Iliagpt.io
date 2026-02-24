import { Router, Request, Response } from "express";
import {
  toolExecutionEngine,
  initializeToolExecutionEngine,
  type ExecutionOptions,
  type ExecutionProgress,
  type ToolType,
  type ExecutionResult,
} from "../services/toolExecutionEngine";
import { createLogger } from "../lib/structuredLogger";

const logger = createLogger("tool-execution-router");

const TOOL_EXECUTION_NAME_RE = /^[a-zA-Z0-9._-]{1,80}$/;
const TOOL_EXECUTION_RESPONSE_LIMIT_BYTES = 12_000;
const TOOL_HISTORY_MAX_LIMIT = 1000;
const TOOL_HISTORY_MIN_LIMIT = 1;
const TOOL_EXECUTION_IDEMPOTENCY_KEY_RE = /^[a-zA-Z0-9._-]{6,140}$/;
const TOOL_EXECUTION_KEY_SANITIZE_RE = /^[a-zA-Z0-9._-]{1,80}$/;
const TOOL_EXECUTION_OPTION_TIMEOUT_MIN = 250;
const TOOL_EXECUTION_OPTION_TIMEOUT_MAX = 120_000;
const TOOL_EXECUTION_OPTION_MAX_RETRIES = 4;
const TOOL_EXECUTION_OPTION_MAX_KEYS = 24;
const TOOL_EXECUTION_CANCEL_ID_RE = /^[a-zA-Z0-9-_.]{6,64}$/;

const TOOL_EXECUTION_INPUT_MAX_BYTES = 196_000;
const TOOL_EXECUTION_INPUT_MAX_KEYS = 120;
const TOOL_EXECUTION_INPUT_MAX_DEPTH = 8;
const TOOL_EXECUTION_INPUT_MAX_ARRAY_LENGTH = 500;
const TOOL_EXECUTION_INPUT_MAX_STRING_LENGTH = 2_000;
const TOOL_EXECUTION_INPUT_KEY_MAX_LENGTH = 120;

const TOOL_EXECUTION_CONTROL_CHARS_RE = /[\u0000-\u001f\u007f-\u009f]/g;
const PROHIBITED_TOOL_INPUT_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const TOOL_EXECUTION_HEADER_ID_RE = /^[a-zA-Z0-9._-]{6,140}$/;
const TOOL_EXECUTION_RESPONSE_TIMEOUT_CODE = 504;
const TOOL_EXECUTION_OVERLOAD_CODE = 429;

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value ?? "");
  }
}

function normalizeToolPayload(value: unknown, maxBytes = TOOL_EXECUTION_RESPONSE_LIMIT_BYTES): unknown {
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length <= maxBytes) {
      return value;
    }
    if (typeof value === "string") {
      return serialized.slice(0, maxBytes);
    }
    if (value && typeof value === "object") {
      return serialized.slice(0, maxBytes);
    }
    return String(value).slice(0, maxBytes);
  } catch {
    return "[unserializable payload]";
  }
}

function sanitizeToolLogSnippet(value: unknown, maxChars = 900): string {
  if (value == null) return "";
  const payload = typeof value === "string" ? value : safeStringify(value);
  return payload.length <= maxChars ? payload : payload.slice(0, maxChars);
}

function sanitizeToolErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error ?? "Unknown error");
}

function resolveHeaderValue(rawValue: unknown): string | null {
  if (typeof rawValue === "string") {
    const normalized = rawValue.trim();
    if (!normalized || !TOOL_EXECUTION_HEADER_ID_RE.test(normalized)) {
      return null;
    }
    return normalized;
  }

  if (Array.isArray(rawValue)) {
    if (rawValue.length === 0) {
      return null;
    }
    return resolveHeaderValue(rawValue[0]);
  }

  return null;
}

function resolveExecutionStatus(result: ExecutionResult): number {
  if (result.errorCode === "IDEMPOTENCY_CONFLICT") return 409;
  if (result.errorCode === "TOOL_NOT_FOUND") return 404;
  if (result.errorCode === "INVALID_INPUT") return 400;
  if (result.errorCode === "TOOL_CIRCUIT_OPEN") return 503;
  if (result.errorCode === "TOOL_TIMEOUT") return TOOL_EXECUTION_RESPONSE_TIMEOUT_CODE;
  if (result.errorCode === "TOOL_OVERLOADED") return TOOL_EXECUTION_OVERLOAD_CODE;
  if (!result.success) return 502;
  return 200;
}

function sanitizeText(value: unknown): string {
  return String(value == null ? "" : value)
    .normalize("NFKC")
    .replace(TOOL_EXECUTION_CONTROL_CHARS_RE, "")
    .trim();
}

function resolveToolName(rawName: unknown): string | null {
  if (typeof rawName !== "string") return null;
  const trimmed = rawName.trim();
  return TOOL_EXECUTION_NAME_RE.test(trimmed) ? trimmed : null;
}

function resolveExecutionId(rawExecutionId: unknown): string | null {
  if (typeof rawExecutionId !== "string") return null;
  const normalized = rawExecutionId.trim();
  return TOOL_EXECUTION_CANCEL_ID_RE.test(normalized) ? normalized : null;
}

function resolveLimit(rawLimit: unknown): number | undefined {
  const value = Array.isArray(rawLimit) ? rawLimit[0] : rawLimit;
  if (typeof value === "undefined") return undefined;
  const parsed = typeof value === "number" ? Math.trunc(value) : Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return undefined;
  return Math.min(Math.max(parsed, TOOL_HISTORY_MIN_LIMIT), TOOL_HISTORY_MAX_LIMIT);
}

function resolveQueryValue(rawValue: unknown): string | undefined {
  const resolved = Array.isArray(rawValue) ? rawValue[0] : rawValue;
  if (typeof resolved !== "string") return undefined;
  const normalized = resolved.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function resolveToolType(rawType: unknown): ToolType | undefined {
  if (resolveQueryValue(rawType) === "python") return "python";
  if (resolveQueryValue(rawType) === "typescript") return "typescript";
  return undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sanitizeInputValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (depth >= TOOL_EXECUTION_INPUT_MAX_DEPTH) {
    throw new Error("Tool input depth limit exceeded");
  }

  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    const normalized = sanitizeText(value);
    return normalized.length > TOOL_EXECUTION_INPUT_MAX_STRING_LENGTH
      ? normalized.slice(0, TOOL_EXECUTION_INPUT_MAX_STRING_LENGTH)
      : normalized;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Tool input contains invalid numeric value");
    }
    return value;
  }

  if (typeof value === "boolean" || typeof value === "bigint") {
    return typeof value === "bigint" ? value.toString() : value;
  }

  if (typeof value === "function" || typeof value === "symbol") {
    throw new Error("Tool input contains unsupported value type");
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new Error("Tool input has circular reference");
    }
    seen.add(value);
    const output: unknown[] = [];
    const limit = Math.min(value.length, TOOL_EXECUTION_INPUT_MAX_ARRAY_LENGTH);
    for (let i = 0; i < limit; i += 1) {
      output.push(sanitizeInputValue(value[i], depth + 1, seen));
    }
    seen.delete(value);
    return output;
  }

  if (isPlainObject(value)) {
    if (seen.has(value)) {
      throw new Error("Tool input has circular reference");
    }
    seen.add(value);
    const output: Record<string, unknown> = {};
    let keys = 0;

    for (const [rawKey, item] of Object.entries(value)) {
      if (keys >= TOOL_EXECUTION_INPUT_MAX_KEYS) {
        break;
      }

      const key = sanitizeText(rawKey);
      if (
        !TOOL_EXECUTION_KEY_SANITIZE_RE.test(key)
        || key.length > TOOL_EXECUTION_INPUT_KEY_MAX_LENGTH
        || PROHIBITED_TOOL_INPUT_KEYS.has(key)
      ) {
        continue;
      }

      output[key] = sanitizeInputValue(item, depth + 1, seen);
      keys += 1;
    }

    seen.delete(value);
    return output;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Map || value instanceof Set) {
    throw new Error("Tool input must not contain Map or Set");
  }

  return String(value);
}

function resolveToolInput(rawInput: unknown): Record<string, unknown> {
  const normalized = sanitizeInputValue(rawInput, 0, new WeakSet<object>()) as unknown;
  if (!isPlainObject(normalized)) {
    throw new Error("Tool input must be a plain object");
  }
  const serialized = safeStringify(normalized);
  if (serialized.length > TOOL_EXECUTION_INPUT_MAX_BYTES) {
    throw new Error("Tool input exceeds maximum payload size");
  }
  return normalized;
}

function resolveOptionalIdempotencyKey(rawValue: unknown): string | null {
  if (typeof rawValue !== "string") return null;
  const normalized = rawValue.trim();
  return TOOL_EXECUTION_IDEMPOTENCY_KEY_RE.test(normalized) ? normalized : null;
}

function resolveExecutionOptions(rawOptions: unknown): ExecutionOptions {
  if (!isPlainObject(rawOptions)) {
    return {};
  }

  const output: ExecutionOptions = {};
  const timeoutCandidate = rawOptions.timeout;
  if (typeof timeoutCandidate === "number" && Number.isFinite(timeoutCandidate)) {
    const timeout = Math.trunc(timeoutCandidate);
    if (timeout >= TOOL_EXECUTION_OPTION_TIMEOUT_MIN && timeout <= TOOL_EXECUTION_OPTION_TIMEOUT_MAX) {
      output.timeout = timeout;
    }
  }

  const maxRetriesCandidate = rawOptions.maxRetries;
  if (typeof maxRetriesCandidate === "number" && Number.isFinite(maxRetriesCandidate)) {
    const maxRetries = Math.trunc(maxRetriesCandidate);
    if (maxRetries >= 0 && maxRetries <= TOOL_EXECUTION_OPTION_MAX_RETRIES) {
      output.maxRetries = maxRetries;
    }
  }

  if (rawOptions.skipCache === true || rawOptions.skipCache === false) {
    output.skipCache = rawOptions.skipCache;
  }

  const userIdCandidate = rawOptions.userId;
  if (typeof userIdCandidate === "string") {
    const normalizedUserId = sanitizeText(userIdCandidate);
    if (normalizedUserId && TOOL_EXECUTION_KEY_SANITIZE_RE.test(normalizedUserId)) {
      output.userId = normalizedUserId;
    }
  }

  const conversationIdCandidate = (rawOptions as any).conversationId;
  if (typeof conversationIdCandidate === "string") {
    const normalizedConversationId = sanitizeText(conversationIdCandidate);
    if (normalizedConversationId && TOOL_EXECUTION_KEY_SANITIZE_RE.test(normalizedConversationId)) {
      output.conversationId = normalizedConversationId;
    }
  }

  const runIdCandidate = (rawOptions as any).runId;
  if (typeof runIdCandidate === "string") {
    const normalizedRunId = sanitizeText(runIdCandidate);
    if (normalizedRunId && TOOL_EXECUTION_KEY_SANITIZE_RE.test(normalizedRunId)) {
      output.runId = normalizedRunId;
    }
  }

  const traceIdCandidate = (rawOptions as any).traceId;
  if (typeof traceIdCandidate === "string") {
    const normalizedTraceId = sanitizeText(traceIdCandidate);
    if (normalizedTraceId && TOOL_EXECUTION_HEADER_ID_RE.test(normalizedTraceId)) {
      output.traceId = normalizedTraceId;
    }
  }

  const requestIdCandidate = (rawOptions as any).requestId;
  if (typeof requestIdCandidate === "string") {
    const normalizedRequestId = sanitizeText(requestIdCandidate);
    if (normalizedRequestId && TOOL_EXECUTION_HEADER_ID_RE.test(normalizedRequestId)) {
      output.requestId = normalizedRequestId;
    }
  }

  const idempotencyKey = resolveOptionalIdempotencyKey((rawOptions as any).idempotencyKey);
  if (idempotencyKey) {
    output.idempotencyKey = idempotencyKey;
  }

  return output;
}

export function createToolExecutionRouter(): Router {
  const router = Router();

  initializeToolExecutionEngine().catch((error) => {
    logger.error("Failed to initialize tool execution engine", { error });
  });

  router.get("/tools", async (req: Request, res: Response) => {
    try {
      const type = resolveToolType(req.query.type);
      const category = resolveQueryValue(req.query.category);
      const tools = await toolExecutionEngine.listTools({
        type,
        category,
        refresh: req.query.refresh === "true",
      });
      res.json({
        success: true,
        count: tools.length,
        tools,
      });
    } catch (error: any) {
      logger.error("Failed to list tools", { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.get("/tools/:name", async (req: Request, res: Response) => {
    try {
      const name = resolveToolName(req.params.name);
      if (!name) {
        return res.status(400).json({
          success: false,
          error: `Invalid tool name '${req.params.name}'`,
        });
      }

      const tool = await toolExecutionEngine.getTool(name);
      if (!tool) {
        return res.status(404).json({
          success: false,
          error: `Tool '${name}' not found`,
        });
      }

      res.json({
        success: true,
        tool,
      });
    } catch (error: any) {
      logger.error(`Failed to get tool '${req.params.name}'`, { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.post("/tools/:name/execute", async (req: Request, res: Response) => {
    const requestTraceId = resolveHeaderValue(req.headers["x-trace-id"])
      || resolveHeaderValue(req.headers["x-request-id"])
      || (typeof res.locals?.traceId === "string" ? res.locals.traceId : undefined)
      || (typeof req.headers.traceid === "string" ? req.headers.traceid : undefined)
      || "";
    const requestLogger = requestTraceId
      ? logger.withRequest(requestTraceId, (req as any).user?.id)
      : logger;

    try {
      const name = resolveToolName(req.params.name);
      if (!name) {
        return res.status(400).json({
          success: false,
          error: `Invalid tool name '${req.params.name}'`,
        });
      }

      let input: Record<string, unknown>;
      try {
        input = resolveToolInput(req.body?.input);
      } catch (error: any) {
        return res.status(400).json({
          success: false,
          error: sanitizeToolErrorMessage(error),
        });
      }

      const executionOptions = resolveExecutionOptions(req.body?.options);
      executionOptions.userId = executionOptions.userId || (req as any).userId;
      executionOptions.traceId = resolveHeaderValue(req.headers["x-trace-id"]) || requestTraceId || undefined;
      executionOptions.conversationId = resolveHeaderValue(req.headers["x-conversation-id"]) || undefined;
      executionOptions.runId = resolveHeaderValue(req.headers["x-run-id"]) || undefined;
      executionOptions.requestId = resolveHeaderValue(req.headers["x-request-id"]) || requestTraceId || undefined;

      if (typeof req.body?.options === "object" && req.body.options !== null) {
        if (!isPlainObject(req.body.options)) {
          return res.status(400).json({
            success: false,
            error: "Invalid execution options",
          });
        }
        const optionKeys = Object.keys(req.body.options).length;
        if (optionKeys > TOOL_EXECUTION_OPTION_MAX_KEYS) {
          return res.status(413).json({
            success: false,
            error: `Too many execution options (max ${TOOL_EXECUTION_OPTION_MAX_KEYS})`,
          });
        }
      }

      const requestIdempotencyKey = resolveOptionalIdempotencyKey(
        req.headers["x-idempotency-key"] || req.headers["idempotency-key"],
      );
      if (requestIdempotencyKey) {
        executionOptions.idempotencyKey = requestIdempotencyKey;
      }

      requestLogger.info(`Executing tool '${name}'`, {
        toolName: name,
        inputKeys: Object.keys(input),
        timeout: executionOptions.timeout,
        maxRetries: executionOptions.maxRetries,
        userId: executionOptions.userId,
        hasIdempotencyKey: Boolean(executionOptions.idempotencyKey),
        traceId: executionOptions.traceId,
        conversationId: executionOptions.conversationId,
        runId: executionOptions.runId,
        requestId: executionOptions.requestId,
      });

      const result = await toolExecutionEngine.execute(name, input, executionOptions);
      const safeData = normalizeToolPayload(result.data);
      const safeError = sanitizeToolLogSnippet(result.error, 800);
      const statusCode = resolveExecutionStatus(result);
      const hasPartialOutput = !result.success && result.data !== undefined;

      res.status(statusCode).json({
        success: result.success,
        executionId: result.executionId,
        data: safeData,
        error: safeError,
        errorCode: result.errorCode,
        complete: result.success || hasPartialOutput,
        fallback: hasPartialOutput,
        metadata: result.metadata,
        metrics: result.metrics,
      });
    } catch (error: any) {
      requestLogger.error(`Failed to execute tool '${req.params.name}'`, { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.get("/executions/active", async (_req: Request, res: Response) => {
    try {
      const executions = toolExecutionEngine.getActiveExecutions();
      res.json({
        success: true,
        count: executions.length,
        executions,
      });
    } catch (error: any) {
      logger.error("Failed to get active executions", { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.post("/executions/:executionId/cancel", async (req: Request, res: Response) => {
    try {
      const executionId = resolveExecutionId(req.params.executionId);
      if (!executionId) {
        return res.status(400).json({
          success: false,
          error: `Invalid executionId '${req.params.executionId}'`,
        });
      }
      const cancelled = await toolExecutionEngine.cancelExecution(executionId);
      res.json({
        success: cancelled,
        message: cancelled ? "Execution cancelled" : "Execution not found or already completed",
      });
    } catch (error: any) {
      logger.error(`Failed to cancel execution '${req.params.executionId}'`, { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.get("/history", async (req: Request, res: Response) => {
    try {
      const { limit, successOnly } = req.query;
      const resolvedLimit = resolveLimit(limit);
      const toolName = resolveToolName(req.query.toolName);
      const userId = resolveQueryValue(req.query.userId);

      const history = toolExecutionEngine.getExecutionHistory({
        toolName: toolName || undefined,
        userId,
        limit: resolvedLimit,
        successOnly: successOnly === "true",
      });

      res.json({
        success: true,
        count: history.length,
        history,
      });
    } catch (error: any) {
      logger.error("Failed to get execution history", { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.get("/analytics", async (_req: Request, res: Response) => {
    try {
      const analytics = toolExecutionEngine.getEngineAnalytics();
      res.json({
        success: true,
        analytics: {
          ...analytics,
          toolAnalytics: Object.fromEntries(analytics.toolAnalytics),
        },
      });
    } catch (error: any) {
      logger.error("Failed to get analytics", { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.get("/analytics/:toolName", async (req: Request, res: Response) => {
    try {
      const toolName = resolveToolName(req.params.toolName);
      if (!toolName) {
        return res.status(400).json({
          success: false,
          error: `Invalid tool name '${req.params.toolName}'`,
        });
      }

      const analytics = toolExecutionEngine.getToolAnalytics(toolName);
      if (!analytics) {
        return res.status(404).json({
          success: false,
          error: `No analytics found for tool '${toolName}'`,
        });
      }

      res.json({
        success: true,
        analytics,
      });
    } catch (error: any) {
      logger.error(`Failed to get analytics for '${req.params.toolName}'`, { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.get("/circuit-breaker/:toolName", async (req: Request, res: Response) => {
    try {
      const toolName = resolveToolName(req.params.toolName);
      if (!toolName) {
        return res.status(400).json({
          success: false,
          error: `Invalid tool name '${req.params.toolName}'`,
        });
      }

      const status = toolExecutionEngine.getCircuitBreakerStatus(toolName);
      if (!status) {
        return res.status(404).json({
          success: false,
          error: `No circuit breaker found for tool '${toolName}'`,
        });
      }

      res.json({
        success: true,
        toolName,
        ...status,
      });
    } catch (error: any) {
      logger.error(`Failed to get circuit breaker status for '${req.params.toolName}'`, { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.post("/circuit-breaker/:toolName/reset", async (req: Request, res: Response) => {
    try {
      const toolName = resolveToolName(req.params.toolName);
      if (!toolName) {
        return res.status(400).json({
          success: false,
          error: `Invalid tool name '${req.params.toolName}'`,
        });
      }

      toolExecutionEngine.resetCircuitBreaker(toolName);
      res.json({
        success: true,
        message: `Circuit breaker reset for tool '${toolName}'`,
      });
    } catch (error: any) {
      logger.error(`Failed to reset circuit breaker for '${req.params.toolName}'`, { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.post("/cache/clear", async (_req: Request, res: Response) => {
    try {
      toolExecutionEngine.clearCache();
      res.json({
        success: true,
        message: "Tool cache cleared",
      });
    } catch (error: any) {
      logger.error("Failed to clear cache", { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.post("/tools/refresh", async (_req: Request, res: Response) => {
    try {
      const tools = await toolExecutionEngine.refreshTools();
      res.json({
        success: true,
        count: tools.length,
        tools,
      });
    } catch (error: any) {
      logger.error("Failed to refresh tools", { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  return router;
}

export function setupToolExecutionWebSocket(
  wss: any,
  path: string = "/tool-execution",
): void {
  const clients = new Set<any>();

  const unsubscribeProgress = toolExecutionEngine.subscribeToProgress((progress: ExecutionProgress) => {
    const message = JSON.stringify({
      type: "progress",
      data: progress,
    });
    clients.forEach((client) => {
      if (client.readyState === 1) {
        client.send(message);
      }
    });
  });

  const unsubscribeCircuit = toolExecutionEngine.subscribeToCircuitChanges((event) => {
    const message = JSON.stringify({
      type: "circuit_state_change",
      data: event,
    });
    clients.forEach((client) => {
      if (client.readyState === 1) {
        client.send(message);
      }
    });
  });

  wss.on("connection", (ws: any, req: any) => {
    if (!req.url?.startsWith(path)) return;

    const safeSend = (payload: Record<string, unknown>) => {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify(payload));
      }
    };

    clients.add(ws);
    logger.info("Tool execution WebSocket client connected", { clientCount: clients.size });

    safeSend({
      type: "connected",
      message: "Connected to tool execution engine",
    });

    ws.on("close", () => {
      clients.delete(ws);
      logger.info("Tool execution WebSocket client disconnected", { clientCount: clients.size });
    });

    ws.on("message", async (data: any) => {
      try {
        const messageRaw = typeof data === "string" ? data : data?.toString();
        if (!messageRaw) {
          safeSend({ type: "error", error: "Invalid websocket payload" });
          return;
        }

        const message = JSON.parse(messageRaw);
        if (message.type === "execute") {
          const toolName = resolveToolName(message.toolName);
          if (!toolName) {
            safeSend({ type: "error", error: "Invalid tool name in websocket request" });
            return;
          }

          let input = {} as Record<string, unknown>;
          try {
            input = resolveToolInput(message.input);
          } catch (error) {
            safeSend({ type: "error", error: sanitizeToolErrorMessage(error) });
            return;
          }

          if (typeof message.options === "object" && message.options !== null && !isPlainObject(message.options)) {
            safeSend({ type: "error", error: "Invalid execution options" });
            return;
          }

          if (typeof message.options === "object" && message.options !== null) {
            const optionKeys = Object.keys(message.options).length;
            if (optionKeys > TOOL_EXECUTION_OPTION_MAX_KEYS) {
              safeSend({
                type: "error",
                error: `Too many execution options (max ${TOOL_EXECUTION_OPTION_MAX_KEYS})`,
              });
              return;
            }
          }

          const executionOptions = resolveExecutionOptions(message.options);
          const traceId = resolveHeaderValue(message.traceId);
          const conversationId = resolveHeaderValue(message.conversationId);
          const runId = resolveHeaderValue(message.runId);
          const requestId = resolveHeaderValue(message.requestId);
          if (traceId) {
            executionOptions.traceId = traceId;
          }
          if (conversationId) {
            executionOptions.conversationId = conversationId;
          }
          if (runId) {
            executionOptions.runId = runId;
          }
          if (requestId) {
            executionOptions.requestId = requestId;
          }
          const idempotencyKey = resolveOptionalIdempotencyKey(message.idempotencyKey);
          if (idempotencyKey) {
            executionOptions.idempotencyKey = idempotencyKey;
          }

          executionOptions.onProgress = (progress) => {
            safeSend({
              type: "progress",
              data: progress,
            });
          };

          const result = await toolExecutionEngine.execute(toolName, input, executionOptions);
          const safeResultData = normalizeToolPayload(result.data);
          const resultHasPartialOutput = !result.success && result.data !== undefined;
          safeSend({
            type: "result",
            data: {
              ...result,
              data: safeResultData,
              complete: result.success || resultHasPartialOutput,
              fallback: resultHasPartialOutput,
            },
          });
          return;
        }

        if (message.type === "cancel") {
          const executionId = resolveExecutionId(message.executionId);
          if (!executionId) {
            safeSend({ type: "error", error: "Invalid executionId in cancel request" });
            return;
          }
          const cancelled = await toolExecutionEngine.cancelExecution(executionId);
          safeSend({ type: "cancelled", data: { executionId, cancelled } });
          return;
        }

        safeSend({ type: "error", error: "Unsupported websocket message type" });
      } catch (error: any) {
        logger.error("tool execution websocket error", { error: error.message });
        safeSend({
          type: "error",
          error: sanitizeToolErrorMessage(error),
        });
      }
    });
  });
}

export default createToolExecutionRouter;
