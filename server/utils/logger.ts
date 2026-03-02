import pino from "pino";
import { getContext } from "../middleware/correlationContext";

export type LogLevel = "debug" | "info" | "warn" | "error";

const SENSITIVE_KEYS = [
  "password",
  "token",
  "secret",
  "key",
  "authorization",
  "cookie",
  "stripe",
  "access_token",
  "refresh_token"
];

const isProduction = process.env.NODE_ENV === "production";

// Configure Pino instance
const pinoLogger = pino({
  level: process.env.LOG_LEVEL || "info",
  redact: {
    paths: SENSITIVE_KEYS.flatMap(key => [key, `*.${key}`, `*.*.${key}`]),
    remove: true,
  },
  // In development, use pino-pretty for readability
  // In production, keep JSON and rotate daily using pino-roll
  transport: !isProduction
    ? {
      target: "pino-pretty",
      options: {
        colorize: true,
        ignore: "pid,hostname",
        translateTime: "HH:MM:ss",
      },
    }
    : {
      target: "pino-roll",
      options: {
        file: "logs/app",
        size: "10m",
        frequency: "daily",
        extension: ".log",
        mkdir: true
      }
    },
  base: {
    env: process.env.NODE_ENV,
  },
});

export interface LoggerContext {
  component?: string;
  userId?: string;
  chatId?: string;
  [key: string]: unknown;
}

export interface Logger {
  debug(message: string, metadata?: Record<string, unknown>): void;
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
  child(context: LoggerContext): Logger;
}

/**
 * Creates a context-aware logger that automatically injects
 * Trace IDs and User IDs from the current AsyncLocalStorage context.
 */
class PinoLoggerWrapper implements Logger {
  private logger: pino.Logger;
  private staticContext: LoggerContext;

  constructor(baseLogger: pino.Logger, context: LoggerContext = {}) {
    this.logger = baseLogger;
    this.staticContext = context;
  }

  private getMergedContext(metadata?: Record<string, unknown>): Record<string, unknown> {
    // Get dynamic context (traceId, userId) from AsyncLocalStorage
    const correlationContext = getContext();

    return {
      ...this.staticContext,
      ...metadata,
      ...correlationContext, // Inject traceId/userId automatically if available
    };
  }

  debug(message: string, metadata?: Record<string, unknown>) {
    this.logger.debug(this.getMergedContext(metadata), message);
  }

  info(message: string, metadata?: Record<string, unknown>) {
    this.logger.info(this.getMergedContext(metadata), message);
  }

  warn(message: string, metadata?: Record<string, unknown>) {
    this.logger.warn(this.getMergedContext(metadata), message);
  }

  error(message: string, metadata?: Record<string, unknown>) {
    this.logger.error(this.getMergedContext(metadata), message);
  }

  child(context: LoggerContext): Logger {
    // Pino's child logger merges bindings efficiently
    return new PinoLoggerWrapper(
      this.logger.child(context),
      { ...this.staticContext, ...context }
    );
  }
}

export function createLogger(component?: string): Logger {
  const context = component ? { component } : {};
  return new PinoLoggerWrapper(pinoLogger, context);
}

// Default singleton logger
export const logger = createLogger();
