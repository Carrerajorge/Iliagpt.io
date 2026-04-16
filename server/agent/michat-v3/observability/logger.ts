import type { Logger } from "../types";
import { nowISO } from "../config";

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export interface StructuredLogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  traceId?: string;
  requestId?: string;
}

export class ConsoleLogger implements Logger {
  private minLevel: number;
  private traceId?: string;
  private requestId?: string;

  constructor(
    level: LogLevel = "info",
    traceId?: string,
    requestId?: string
  ) {
    this.minLevel = LOG_LEVELS[level];
    this.traceId = traceId;
    this.requestId = requestId;
  }

  private log(level: LogLevel, msg: string, ctx?: Record<string, unknown>): void {
    if (LOG_LEVELS[level] < this.minLevel) return;

    const entry: StructuredLogEntry = {
      timestamp: nowISO(),
      level,
      message: msg,
      context: ctx,
      traceId: this.traceId,
      requestId: this.requestId,
    };

    const formatted = JSON.stringify(entry);
    
    switch (level) {
      case "debug":
        console.debug(formatted);
        break;
      case "info":
        console.info(formatted);
        break;
      case "warn":
        console.warn(formatted);
        break;
      case "error":
        console.error(formatted);
        break;
    }
  }

  debug(msg: string, ctx?: Record<string, unknown>): void {
    this.log("debug", msg, ctx);
  }

  info(msg: string, ctx?: Record<string, unknown>): void {
    this.log("info", msg, ctx);
  }

  warn(msg: string, ctx?: Record<string, unknown>): void {
    this.log("warn", msg, ctx);
  }

  error(msg: string, ctx?: Record<string, unknown>): void {
    this.log("error", msg, ctx);
  }

  child(bindings: { traceId?: string; requestId?: string }): ConsoleLogger {
    return new ConsoleLogger(
      Object.keys(LOG_LEVELS).find(
        (k) => LOG_LEVELS[k as LogLevel] === this.minLevel
      ) as LogLevel,
      bindings.traceId ?? this.traceId,
      bindings.requestId ?? this.requestId
    );
  }
}

export const globalLogger = new ConsoleLogger(
  (process.env.MICHAT_LOG_LEVEL as LogLevel) || "info"
);
