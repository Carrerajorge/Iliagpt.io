import { nanoid } from "nanoid";
import { logger as baseLogger, LogLevel, Logger as BaseLogger } from "../utils/logger";
import { sanitizeSensitiveData } from "./securityUtils";
import crypto from "node:crypto";

export type { LogLevel };

export interface LogEntry {
  id: string;
  level: LogLevel;
  message: string;
  requestId?: string;
  userId?: string;
  component: string;
  timestamp: Date;
  metadata?: Record<string, any>;
  duration?: number;
}

export interface LogFilters {
  level?: LogLevel;
  component?: string;
  since?: Date;
  requestId?: string;
  userId?: string;
  limit?: number;
}

export interface LogStats {
  total: number;
  byLevel: Record<LogLevel, number>;
  byComponent: Record<string, number>;
  oldestEntry?: Date;
  newestEntry?: Date;
}

// Extend BaseLogger to include chainable methods used by existing code
export interface StructuredLogger extends BaseLogger {
  withRequest: (requestId: string, userId?: string) => StructuredLogger;
  withDuration: (duration: number) => StructuredLogger;
}

const MAX_LOG_ENTRIES = 5000;
const logs: LogEntry[] = [];
const MAX_METADATA_BYTES = 4096;
const MAX_METADATA_DEPTH = 8;

function safeSerialize(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value !== "object") {
    return value;
  }

  if (seen.has(value as object)) {
    return "[circular]";
  }
  seen.add(value as object);

  if (depth >= MAX_METADATA_DEPTH) {
    return "[max-depth]";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => safeSerialize(item, depth + 1, seen));
  }

  const record = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  const keys = Object.keys(record);
  for (const key of keys) {
    if (key.startsWith("__proto__") || key === "prototype" || key === "constructor") {
      output[key] = "[redacted]";
      continue;
    }

    output[key] = safeSerialize(record[key], depth + 1, seen);
  }

  return output;
}

function normalizeMetadata(metadata?: Record<string, any>): Record<string, unknown> | undefined {
  if (!metadata || typeof metadata !== "object") {
    return metadata ? { value: sanitizeSensitiveData({ value: metadata } as Record<string, unknown>) } : undefined;
  }

  let normalized: Record<string, unknown> = safeSerialize(
    sanitizeSensitiveData(metadata as Record<string, unknown>)
  ) as Record<string, unknown>;

  const serialized = JSON.stringify(normalized);
  if (serialized.length <= MAX_METADATA_BYTES) {
    return normalized;
  }

  const truncatedHash = crypto.createHash("sha256").update(serialized).digest("hex");

  normalized = {
    _truncated: true,
    _originalBytes: serialized.length,
    _sha256: truncatedHash,
    _timestamp: new Date().toISOString(),
  };

  return normalized;
}

/**
 * Adds a log entry to the in-memory buffer (for UI/Dashboard)
 * AND emits it via the standardized Pino logger (for infrastructure)
 */
function addLog(entry: Omit<LogEntry, "id" | "timestamp">): void {
  const logEntry: LogEntry = {
    ...entry,
    id: nanoid(12),
    timestamp: new Date(),
  };

  logs.push(logEntry);

  // Rotation: delete old entries if max exceeded
  if (logs.length > MAX_LOG_ENTRIES) {
    logs.splice(0, logs.length - MAX_LOG_ENTRIES);
  }

  // Use standardized Pino logger for output
  // We recreate the context object expected by Pino
  const context = {
    component: logEntry.component,
    requestId: logEntry.requestId,
    userId: logEntry.userId,
    duration: logEntry.duration,
    ...(logEntry.metadata || {}),
  };

  // Delegate to Pino
  switch (logEntry.level) {
    case "debug":
      baseLogger.debug(logEntry.message, context);
      break;
    case "info":
      baseLogger.info(logEntry.message, context);
      break;
    case "warn":
      baseLogger.warn(logEntry.message, context);
      break;
    case "error":
      baseLogger.error(logEntry.message, context);
      break;
  }
}

export function createLogger(component: string): StructuredLogger {
  let contextRequestId: string | undefined;
  let contextUserId: string | undefined;
  let contextDuration: number | undefined;

  const createLogMethod = (level: LogLevel) => {
    return (message: string, metadata?: Record<string, any>) => {
      const normalizedMetadata = normalizeMetadata(metadata);

      addLog({
        level,
        message,
        component,
        requestId: contextRequestId,
        userId: contextUserId,
        duration: contextDuration,
        metadata: normalizedMetadata,
      });
    };
  };

  // Implement the chainable interface
  const logger = {
    // Standard methods
    debug: createLogMethod("debug"),
    info: createLogMethod("info"),
    warn: createLogMethod("warn"),
    error: createLogMethod("error"),

    // Pino-compatible child (maps to createLogger)
    child(context: any): BaseLogger {
      return baseLogger.child({ ...context, component });
    },

    // Chainable context methods (specific to this implementation)
    withRequest(requestId: string, userId?: string): StructuredLogger {
      const child = createLogger(component);
      (child as any)._setContext(requestId, userId, contextDuration);
      return child;
    },

    withDuration(duration: number): StructuredLogger {
      const child = createLogger(component);
      (child as any)._setContext(contextRequestId, contextUserId, duration);
      return child;
    },
  };

  // Hidden context setter
  (logger as any)._setContext = (reqId?: string, userId?: string, duration?: number) => {
    contextRequestId = reqId;
    contextUserId = userId;
    contextDuration = duration;
  };

  return logger as StructuredLogger;
}

export function getLogs(filters?: LogFilters): LogEntry[] {
  let result = [...logs];

  if (filters) {
    if (filters.level) {
      result = result.filter(log => log.level === filters.level);
    }
    if (filters.component) {
      result = result.filter(log => log.component === filters.component);
    }
    if (filters.since) {
      const sinceDate = new Date(filters.since);
      result = result.filter(log => log.timestamp >= sinceDate);
    }
    if (filters.requestId) {
      result = result.filter(log => log.requestId === filters.requestId);
    }
    if (filters.userId) {
      result = result.filter(log => log.userId === filters.userId);
    }
    if (filters.limit && filters.limit > 0) {
      result = result.slice(-filters.limit);
    }
  }

  return result;
}

export function getLogStats(): LogStats {
  const byLevel: Record<LogLevel, number> = {
    debug: 0,
    info: 0,
    warn: 0,
    error: 0,
  };

  const byComponent: Record<string, number> = {};

  for (const log of logs) {
    byLevel[log.level]++;
    byComponent[log.component] = (byComponent[log.component] || 0) + 1;
  }

  return {
    total: logs.length,
    byLevel,
    byComponent,
    oldestEntry: logs.length > 0 ? logs[0].timestamp : undefined,
    newestEntry: logs.length > 0 ? logs[logs.length - 1].timestamp : undefined,
  };
}

export function clearLogs(): void {
  logs.length = 0;
}

// Default system logger
export const systemLogger = createLogger("system");
