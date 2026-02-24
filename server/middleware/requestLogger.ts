import { Request, Response, NextFunction } from "express";
import { nanoid } from "nanoid";
import { runWithContext, getTraceId as getTraceIdFromContext, CorrelationContext } from "./correlationContext";
import { createLogger } from "../utils/logger";

const logger = createLogger("http");

// SECURITY FIX #19: Sensitive query parameters to redact from logs
const SENSITIVE_QUERY_PARAMS = ['token', 'key', 'secret', 'password', 'apiKey', 'api_key', 'access_token', 'refresh_token', 'code', 'state'];
const FORBIDDEN_QUERY_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const MAX_QUERY_NESTED_DEPTH = 8;
const MAX_QUERY_ARRAY_ITEMS = 25;
const MAX_QUERY_OBJECT_KEYS = 80;

function sanitizeQueryKey(key: string): boolean {
  return !FORBIDDEN_QUERY_KEYS.has(key) && !key.startsWith("__");
}

function sanitizeQueryValue(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
  depth = 0,
): unknown {
  if (depth >= MAX_QUERY_NESTED_DEPTH) {
    return "[truncated]";
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_QUERY_ARRAY_ITEMS)
      .map((item) => sanitizeQueryValue(item, seen, depth + 1));
  }

  if (value && typeof value === "object") {
    if (seen.has(value)) {
      return "[redacted-cyclic]";
    }

    seen.add(value);
    const output: Record<string, unknown> = Object.create(null);
    for (const [rawKey, nested] of Object.entries(value as Record<string, unknown>).slice(0, MAX_QUERY_OBJECT_KEYS)) {
      const key = String(rawKey);
      if (!sanitizeQueryKey(key)) {
        continue;
      }
      output[key] = sanitizeQueryValue(nested, seen, depth + 1);
    }
    return output;
  }

  return value;
}

// SECURITY FIX #20: Sanitize query params for logging
function sanitizeQueryForLogging(query: Record<string, any>): Record<string, any> | undefined {
  if (!query || Object.keys(query).length === 0) return undefined;

  const sanitized: Record<string, unknown> = Object.create(null);
  for (const [key, value] of Object.entries(query)) {
    if (SENSITIVE_QUERY_PARAMS.some(param => key.toLowerCase().includes(param.toLowerCase()))) {
      sanitized[key] = '[REDACTED]';
    } else if (!sanitizeQueryKey(key)) {
      continue;
    } else {
      sanitized[key] = sanitizeQueryValue(value, new WeakSet(), 1);
    }
  }
  return sanitized;
}

export function getTraceId(): string | undefined {
  return getTraceIdFromContext();
}

export function requestLoggerMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const upstreamRequestId = typeof (req as any).requestId === "string"
    ? (req as any).requestId
    : undefined;
  const traceId = upstreamRequestId && upstreamRequestId.trim().length > 0
    ? upstreamRequestId.trim()
    : nanoid(16);
  const startTime = Date.now();

  res.setHeader("X-Trace-Id", traceId);
  res.setHeader("X-Request-Id", traceId);
  res.locals.traceId = traceId;
  if (!res.locals.requestId) {
    res.locals.requestId = traceId;
  }

  const context: CorrelationContext = {
    traceId,
    requestId: traceId,
    startTime,
    userId: (req as any).user?.id,
    workspaceId: (req as any).user?.workspaceId
      ?? (typeof req.headers["x-workspace-id"] === "string" ? req.headers["x-workspace-id"] : undefined),
  };

  runWithContext(context, () => {
    const requestLogger = logger.child({ traceId });

    requestLogger.info("Request started", {
      method: req.method,
      path: req.path,
      // SECURITY FIX #21: Use sanitized query params
      query: sanitizeQueryForLogging(req.query as Record<string, any>),
      userAgent: req.get("user-agent"),
      ip: req.ip || req.socket.remoteAddress,
    });

    res.on("finish", () => {
      const durationMs = Date.now() - startTime;
      // NOTE: Cannot set headers here - response already sent.
      // Only set response headers before headers are sent. (We still log duration here.)

      const isError = res.statusCode >= 400;

      const logMethod = isError ? "warn" : "info";
      requestLogger[logMethod]("Request completed", {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs,
      });
    });

    res.on("error", (error: Error) => {
      const durationMs = Date.now() - startTime;
      requestLogger.error("Request error", {
        method: req.method,
        path: req.path,
        error: error.message,
        stack: error.stack,
        durationMs,
      });
    });

    next();
  });
}
