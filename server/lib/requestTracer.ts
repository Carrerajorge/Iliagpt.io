import { Request, Response, NextFunction } from "express";
import { nanoid } from "nanoid";
import { createLogger } from "./structuredLogger";

const logger = createLogger("request-tracer");

const SENSITIVE_QUERY_PARAMS = ["token", "key", "secret", "password", "apiKey", "api_key", "access_token", "refresh_token", "code", "state"];
const MAX_USER_AGENT_BYTES = 256;
const MAX_QUERY_ITEM_LENGTH = 120;

interface RequestInfo {
  requestId: string;
  method: string;
  path: string;
  startTime: number;
  userId?: string;
}

interface RequestStats {
  totalRequests: number;
  activeRequests: number;
  avgDurationMs: number;
  maxDurationMs: number;
  minDurationMs: number;
  requestsPerMinute: number;
  byMethod: Record<string, number>;
  byPath: Record<string, number>;
  recentErrors: number;
}

const activeRequests: Map<string, RequestInfo> = new Map();
const requestHistory: { duration: number; timestamp: number; error: boolean }[] = [];
const REQUEST_HISTORY_MAX = 1000;
const STATS_WINDOW_MS = 60000; // 1 minuto
const MAX_QUERY_NESTED_DEPTH = 6;
const MAX_QUERY_ARRAY_ITEMS = 25;
const MAX_QUERY_OBJECT_KEYS = 80;

let totalRequests = 0;
let totalDuration = 0;
let maxDuration = 0;
let minDuration = Infinity;
const methodCounts: Record<string, number> = {};
const pathCounts: Record<string, number> = {};
const FORBIDDEN_RECORD_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function isSafeRecordKey(key: string): boolean {
  return !FORBIDDEN_RECORD_KEYS.has(key) && !key.startsWith("__");
}

const DEV_SKIP_LOG_PREFIXES = ['/src/', '/node_modules/', '/@', '/@vite/', '/@replit/', '/__vite'];
const isDevMode = process.env.NODE_ENV !== 'production';

function shouldSkipTracerLog(path: string): boolean {
  if (!isDevMode) return false;
  return DEV_SKIP_LOG_PREFIXES.some(prefix => path.startsWith(prefix));
}

export function requestTracerMiddleware(req: Request, res: Response, next: NextFunction): void {
  const upstreamFromLocals =
    typeof (res.locals as any)?.requestId === "string" ? String((res.locals as any).requestId).trim() : "";
  const upstreamFromCorrelation =
    typeof (req as any)?.correlationId === "string" ? String((req as any).correlationId).trim() : "";
  const upstreamFromReq =
    typeof (req as any)?.requestId === "string" ? String((req as any).requestId).trim() : "";
  const upstream = upstreamFromLocals || upstreamFromCorrelation || upstreamFromReq;

  const requestId = upstream || nanoid(16);
  const startTime = Date.now();
  
  if (!res.locals.requestId) {
    res.locals.requestId = requestId;
  }
  
  const userId = (req as any).user?.id;
  const skipLog = shouldSkipTracerLog(req.path);
  
  const requestInfo: RequestInfo = {
    requestId,
    method: req.method,
    path: req.path,
    startTime,
    userId,
  };
  
  activeRequests.set(requestId, requestInfo);
  totalRequests++;

  try {
    if (!res.getHeader("X-Request-Id")) {
      res.setHeader("X-Request-Id", requestId);
    }
  } catch {
  }
  
  const method = isSafeRecordKey(req.method) ? req.method : "INVALID";
  methodCounts[method] = (methodCounts[method] || 0) + 1;
  const normalizedPath = normalizePath(req.path);
  const safePath = isSafeRecordKey(normalizedPath) ? normalizedPath : "INVALID";
  pathCounts[safePath] = (pathCounts[safePath] || 0) + 1;
  
  if (!skipLog) {
    logger.withRequest(requestId, userId).info(`→ ${req.method} ${req.path}`, {
      query: sanitizeQueryForLogging(req.query as Record<string, unknown>),
      userAgent: sanitizeUserAgent(req.get("user-agent")),
    });
  }
  
  res.on("finish", () => {
    const duration = Date.now() - startTime;
    activeRequests.delete(requestId);
    
    totalDuration += duration;
    maxDuration = Math.max(maxDuration, duration);
    minDuration = Math.min(minDuration, duration);
    
    const isError = res.statusCode >= 400;
    
    requestHistory.push({
      duration,
      timestamp: Date.now(),
      error: isError,
    });
    
    if (requestHistory.length > REQUEST_HISTORY_MAX) {
      requestHistory.splice(0, requestHistory.length - REQUEST_HISTORY_MAX);
    }
    
    if (!skipLog) {
      const logMethod = isError ? "warn" : "info";
      logger.withRequest(requestId, userId).withDuration(duration)[logMethod](
        `← ${req.method} ${req.path} ${res.statusCode}`,
        { statusCode: res.statusCode }
      );
    }
  });
  
  res.on("error", (error) => {
    const duration = Date.now() - startTime;
    activeRequests.delete(requestId);
    
    logger.withRequest(requestId, userId).error(`✗ ${req.method} ${req.path} ERROR`, {
      error: error.message,
      duration,
    });
  });
  
  next();
}

function normalizePath(path: string): string {
  // Normalizar paths con IDs dinámicos
  return path
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "/:id")
    .replace(/\/\d+/g, "/:id")
    .replace(/\/[a-zA-Z0-9_-]{16,}/g, "/:id");
}

function sanitizeQueryValue(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
  depth = 0,
): unknown {
  if (depth > MAX_QUERY_NESTED_DEPTH) {
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
      if (!isSafeRecordKey(key)) {
        continue;
      }
      output[key] = sanitizeQueryValue(nested, seen, depth + 1);
    }
    return output;
  }

  return value;
}

function sanitizeQueryForLogging(query: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!query || Object.keys(query).length === 0) {
    return undefined;
  }

  const sanitized: Record<string, unknown> = Object.create(null);
  for (const [key, value] of Object.entries(query)) {
    if (!isSafeRecordKey(key)) {
      continue;
    }

    if (SENSITIVE_QUERY_PARAMS.some((fragment) => key.toLowerCase().includes(fragment.toLowerCase()))) {
      sanitized[key] = "[REDACTED]";
      continue;
    }

    if (typeof value === "string") {
      sanitized[key] = truncateSafe(value, MAX_QUERY_ITEM_LENGTH);
      continue;
    }

    if (value == null) {
      sanitized[key] = value;
      continue;
    }

    if (Array.isArray(value)) {
      const items = sanitizeQueryValue(value, new WeakSet(), 1);
      if (Array.isArray(items)) {
        sanitized[key] = items.map((item) => (typeof item === "string" ? truncateSafe(item, MAX_QUERY_ITEM_LENGTH) : item));
      } else {
        sanitized[key] = items;
      }
      continue;
    }

    sanitized[key] = sanitizeQueryValue(value, new WeakSet(), 1);
  }

  return sanitized;
}

function truncateSafe(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(maxLength - 1, 0))}…`;
}

function sanitizeUserAgent(userAgent: string | undefined): string | undefined {
  if (!userAgent) return undefined;

  const normalized = userAgent.normalize("NFKC").replace(/\x00/g, "");
  if (normalized.length <= MAX_USER_AGENT_BYTES) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_USER_AGENT_BYTES)}...`;
}

export function getActiveRequests(): RequestInfo[] {
  return Array.from(activeRequests.values());
}

export function getActiveRequestsCount(): number {
  return activeRequests.size;
}

export function getRequestStats(): RequestStats {
  const now = Date.now();
  const recentWindow = now - STATS_WINDOW_MS;
  
  const recentRequests = requestHistory.filter(r => r.timestamp >= recentWindow);
  const recentErrors = recentRequests.filter(r => r.error).length;
  const requestsPerMinute = recentRequests.length;
  
  return {
    totalRequests,
    activeRequests: activeRequests.size,
    avgDurationMs: totalRequests > 0 ? Math.round(totalDuration / totalRequests) : 0,
    maxDurationMs: maxDuration === 0 ? 0 : maxDuration,
    minDurationMs: minDuration === Infinity ? 0 : minDuration,
    requestsPerMinute,
    byMethod: { ...methodCounts },
    byPath: { ...pathCounts },
    recentErrors,
  };
}

export function getRequestById(requestId: string): RequestInfo | undefined {
  return activeRequests.get(requestId);
}
