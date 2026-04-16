import { randomUUID } from "crypto";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  requestId: string;
  conversationId?: string;
  userId?: string;
  [key: string]: unknown;
}

export interface RequestLogData {
  method: string;
  path: string;
  attachmentsCount: number;
  clientIp?: string;
  userAgent?: string;
}

export interface ParsingLogData {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  parserUsed: string;
  durationMs: number;
  tokensExtracted: number;
  chunksGenerated: number;
  success: boolean;
  error?: string;
}

export interface ResponseLogData {
  statusCode: number;
  durationMs: number;
  chunksReturned: number;
  totalTokens: number;
  filesProcessed: number;
  filesFailed: number;
}

export interface ErrorLogData {
  error: Error | string;
  phase: "request" | "parsing" | "response" | "unknown";
  filename?: string;
  stack?: string;
}

export interface AuditLogData {
  action: string;
  resource: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  outcome: "success" | "failure";
}

const PII_PATTERNS = {
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/gi,
  phone: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  ipLastOctet: /(\d{1,3}\.\d{1,3}\.\d{1,3}\.)\d{1,3}/g,
  userPath: /(?:\/home\/|\/Users\/|C:\\Users\\)[^\s\/\\]+/gi,
};

function redactPII(value: unknown): unknown {
  if (typeof value !== "string") {
    if (Array.isArray(value)) {
      return value.map(redactPII);
    }
    if (value !== null && typeof value === "object") {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        result[k] = redactPII(v);
      }
      return result;
    }
    return value;
  }

  let redacted = value;
  redacted = redacted.replace(PII_PATTERNS.email, "[EMAIL_REDACTED]");
  redacted = redacted.replace(PII_PATTERNS.phone, "[PHONE_REDACTED]");
  redacted = redacted.replace(PII_PATTERNS.ipLastOctet, "$1***");
  redacted = redacted.replace(PII_PATTERNS.userPath, "[USER_PATH_REDACTED]");
  
  return redacted;
}

function safeStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj, (_, value) => {
      if (value instanceof Error) {
        return {
          name: value.name,
          message: value.message,
          stack: value.stack,
        };
      }
      return value;
    });
  } catch {
    return String(obj);
  }
}

export interface PareLogger {
  requestId: string;
  setContext(ctx: Partial<LogContext>): void;
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  logRequest(data: RequestLogData): void;
  logParsing(data: ParsingLogData): void;
  logResponse(data: ResponseLogData): void;
  logError(data: ErrorLogData): void;
  logAudit(data: AuditLogData): void;
}

class PareLoggerImpl implements PareLogger {
  public readonly requestId: string;
  private context: LogContext;
  private startTime: number;

  constructor(requestId?: string) {
    this.requestId = requestId || randomUUID();
    this.context = { requestId: this.requestId };
    this.startTime = Date.now();
  }

  setContext(ctx: Partial<LogContext>): void {
    this.context = { ...this.context, ...ctx };
  }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    const timestamp = new Date().toISOString();
    const elapsedMs = Date.now() - this.startTime;
    
    const logEntry = {
      timestamp,
      level,
      message,
      ...this.context,
      elapsedMs,
      ...(data ? redactPII(data) : {}),
    };

    const output = safeStringify(logEntry);
    
    switch (level) {
      case "debug":
        if (process.env.LOG_LEVEL === "debug") {
          console.log(output);
        }
        break;
      case "info":
        console.log(output);
        break;
      case "warn":
        console.warn(output);
        break;
      case "error":
        console.error(output);
        break;
    }
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log("debug", message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log("info", message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log("warn", message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.log("error", message, data);
  }

  logRequest(data: RequestLogData): void {
    this.info("PARE_REQUEST_START", {
      event: "request_start",
      method: data.method,
      path: data.path,
      attachmentsCount: data.attachmentsCount,
      clientIp: data.clientIp,
      userAgent: data.userAgent,
    });
  }

  logParsing(data: ParsingLogData): void {
    const level = data.success ? "info" : "warn";
    this.log(level, "PARE_PARSING_COMPLETE", {
      event: "parsing_complete",
      filename: data.filename,
      mimeType: data.mimeType,
      sizeBytes: data.sizeBytes,
      parserUsed: data.parserUsed,
      durationMs: data.durationMs,
      tokensExtracted: data.tokensExtracted,
      chunksGenerated: data.chunksGenerated,
      success: data.success,
      error: data.error,
    });
  }

  logResponse(data: ResponseLogData): void {
    this.info("PARE_RESPONSE_SENT", {
      event: "response_sent",
      statusCode: data.statusCode,
      durationMs: data.durationMs,
      chunksReturned: data.chunksReturned,
      totalTokens: data.totalTokens,
      filesProcessed: data.filesProcessed,
      filesFailed: data.filesFailed,
    });
  }

  logError(data: ErrorLogData): void {
    const errorMessage = data.error instanceof Error ? data.error.message : String(data.error);
    const stack = data.error instanceof Error ? data.error.stack : data.stack;
    
    this.error("PARE_ERROR", {
      event: "error",
      phase: data.phase,
      errorMessage,
      stack,
      filename: data.filename,
    });
  }

  logAudit(data: AuditLogData): void {
    this.info("PARE_AUDIT", {
      event: "audit",
      action: data.action,
      resource: data.resource,
      resourceId: data.resourceId,
      details: data.details,
      outcome: data.outcome,
    });
  }
}

export function createPareLogger(requestId?: string): PareLogger {
  return new PareLoggerImpl(requestId);
}

export { redactPII };
