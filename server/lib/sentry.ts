/**
 * Sentry Error Aggregation Service
 * 
 * Features:
 * - Automatic error capture with context
 * - Performance monitoring
 * - User feedback collection
 * - Release tracking
 */

import { Request, Response, NextFunction } from "express";

// Sentry configuration
export interface SentryConfig {
    dsn: string;
    environment: string;
    release?: string;
    sampleRate: number;
    tracesSampleRate: number;
    profilesSampleRate: number;
    debug: boolean;
    enabled: boolean;
}

const DEFAULT_CONFIG: SentryConfig = {
    dsn: process.env.SENTRY_DSN || "",
    environment: process.env.NODE_ENV || "development",
    release: process.env.APP_VERSION || "1.0.0",
    sampleRate: 1.0,
    tracesSampleRate: 0.2,
    profilesSampleRate: 0.1,
    debug: process.env.NODE_ENV === "development",
    enabled: !!process.env.SENTRY_DSN,
};

// Sentry SDK placeholder (would use @sentry/node in production)
let sentryClient: any = null;
let config = { ...DEFAULT_CONFIG };

// Error severity levels
export type SeverityLevel = "fatal" | "error" | "warning" | "info" | "debug";

// Captured error interface
export interface CapturedError {
    id: string;
    message: string;
    stack?: string;
    level: SeverityLevel;
    timestamp: Date;
    context: Record<string, any>;
    user?: { id?: string; email?: string; username?: string };
    tags: Record<string, string>;
    extra: Record<string, any>;
}

// Error buffer for when Sentry is unavailable
const errorBuffer: CapturedError[] = [];
const MAX_BUFFER_SIZE = 100;

// Initialize Sentry
export async function initSentry(customConfig: Partial<SentryConfig> = {}): Promise<boolean> {
    config = { ...DEFAULT_CONFIG, ...customConfig };

    if (!config.enabled || !config.dsn) {
        console.log("[Sentry] Disabled - no DSN configured");
        return false;
    }

    try {
        // Dynamic import to avoid issues if Sentry not installed
        const Sentry = await import("@sentry/node");

        Sentry.init({
            dsn: config.dsn,
            environment: config.environment,
            release: config.release,
            sampleRate: config.sampleRate,
            tracesSampleRate: config.tracesSampleRate,
            profilesSampleRate: config.profilesSampleRate,
            debug: config.debug,
            integrations: [
                // Add default integrations
            ],
            beforeSend(event) {
                // Scrub sensitive data
                if (event.request?.headers) {
                    delete event.request.headers.authorization;
                    delete event.request.headers.cookie;
                }
                return event;
            },
        });

        sentryClient = Sentry;
        console.log(`[Sentry] Initialized for ${config.environment}`);

        // Flush buffered errors
        flushErrorBuffer();

        return true;
    } catch (error) {
        console.warn("[Sentry] SDK not available, using fallback error logging");
        return false;
    }
}

// Capture an error
export function captureError(
    error: Error | string,
    options: {
        level?: SeverityLevel;
        user?: { id?: string; email?: string; username?: string };
        tags?: Record<string, string>;
        extra?: Record<string, any>;
        context?: Record<string, any>;
    } = {}
): string {
    const errorId = generateErrorId();
    const message = error instanceof Error ? error.message : error;
    const stack = error instanceof Error ? error.stack : undefined;

    const captured: CapturedError = {
        id: errorId,
        message,
        stack,
        level: options.level || "error",
        timestamp: new Date(),
        context: options.context || {},
        user: options.user,
        tags: options.tags || {},
        extra: options.extra || {},
    };

    if (sentryClient) {
        // Send to Sentry
        sentryClient.withScope((scope: any) => {
            if (options.user) {
                scope.setUser(options.user);
            }

            if (options.tags) {
                for (const [key, value] of Object.entries(options.tags)) {
                    scope.setTag(key, value);
                }
            }

            if (options.extra) {
                for (const [key, value] of Object.entries(options.extra)) {
                    scope.setExtra(key, value);
                }
            }

            if (options.context) {
                scope.setContext("custom", options.context);
            }

            scope.setLevel(options.level || "error");

            if (error instanceof Error) {
                sentryClient.captureException(error);
            } else {
                sentryClient.captureMessage(message);
            }
        });
    } else {
        // Buffer for later or log locally
        bufferError(captured);
    }

    // Always log to console in development
    if (config.debug) {
        console.error(`[Sentry:${captured.level}] ${message}`, {
            id: errorId,
            tags: options.tags,
            extra: options.extra,
        });
    }

    return errorId;
}

// Capture a message (not necessarily an error)
export function captureMessage(
    message: string,
    level: SeverityLevel = "info",
    context?: Record<string, any>
): string {
    return captureError(message, { level, context });
}

// Set user context for subsequent errors
export function setUser(user: { id?: string; email?: string; username?: string } | null): void {
    if (sentryClient) {
        sentryClient.setUser(user);
    }
}

// Add breadcrumb (trail of events leading to error)
export function addBreadcrumb(breadcrumb: {
    category: string;
    message: string;
    level?: SeverityLevel;
    data?: Record<string, any>;
}): void {
    if (sentryClient) {
        sentryClient.addBreadcrumb({
            category: breadcrumb.category,
            message: breadcrumb.message,
            level: breadcrumb.level || "info",
            data: breadcrumb.data,
            timestamp: Date.now() / 1000,
        });
    }
}

// Express error handler middleware
export function sentryErrorHandler() {
    return (err: Error, req: Request, res: Response, next: NextFunction) => {
        const errorId = captureError(err, {
            context: {
                url: req.url,
                method: req.method,
                headers: sanitizeHeaders(req.headers),
                query: req.query,
                body: sanitizeBody(req.body),
            },
            user: (req as any).user ? {
                id: (req as any).user.id,
                email: (req as any).user.email,
            } : undefined,
            tags: {
                path: req.path,
                method: req.method,
            },
        });

        // Pass to next error handler
        (res as any).sentryErrorId = errorId;
        next(err);
    };
}

// Express request handler (for performance monitoring)
export function sentryRequestHandler() {
    return (req: Request, res: Response, next: NextFunction) => {
        addBreadcrumb({
            category: "http",
            message: `${req.method} ${req.path}`,
            data: {
                url: req.url,
                method: req.method,
            },
        });

        next();
    };
}

// Generate unique error ID
function generateErrorId(): string {
    return `err_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// Buffer error when Sentry unavailable
function bufferError(error: CapturedError): void {
    if (errorBuffer.length >= MAX_BUFFER_SIZE) {
        errorBuffer.shift();
    }
    errorBuffer.push(error);

    // Log locally
    console.error(`[ErrorBuffer] ${error.level}: ${error.message}`);
}

// Flush buffered errors to Sentry
function flushErrorBuffer(): void {
    if (!sentryClient || errorBuffer.length === 0) return;

    console.log(`[Sentry] Flushing ${errorBuffer.length} buffered errors`);

    for (const error of errorBuffer) {
        sentryClient.captureMessage(error.message, {
            level: error.level,
            tags: error.tags,
            extra: {
                ...error.extra,
                bufferedAt: error.timestamp,
            },
        });
    }

    errorBuffer.length = 0;
}

// Sanitize headers for logging
function sanitizeHeaders(headers: Record<string, any>): Record<string, any> {
    const sanitized = { ...headers };
    const sensitiveHeaders = ["authorization", "cookie", "x-api-key"];

    for (const header of sensitiveHeaders) {
        if (sanitized[header]) {
            sanitized[header] = "[REDACTED]";
        }
    }

    return sanitized;
}

// Sanitize request body
function sanitizeBody(body: any): any {
    if (!body || typeof body !== "object") return body;

    const sanitized = { ...body };
    const sensitiveFields = ["password", "token", "secret", "apiKey", "api_key"];

    for (const field of sensitiveFields) {
        if (sanitized[field]) {
            sanitized[field] = "[REDACTED]";
        }
    }

    return sanitized;
}

// Get buffered errors (for debugging)
export function getBufferedErrors(): CapturedError[] {
    return [...errorBuffer];
}

// Flush events (call before shutdown)
export async function flushSentry(): Promise<void> {
    if (sentryClient) {
        await sentryClient.flush(5000);
        console.log("[Sentry] Flushed pending events");
    }
}

// Create a monitored async function wrapper
export function withErrorMonitoring<T extends (...args: any[]) => Promise<any>>(
    fn: T,
    options: { name?: string; tags?: Record<string, string> } = {}
): T {
    return (async (...args: Parameters<T>): Promise<ReturnType<T>> => {
        try {
            return await fn(...args);
        } catch (error) {
            captureError(error as Error, {
                tags: { function: options.name || fn.name, ...options.tags },
                extra: { args: args.map(a => typeof a === "object" ? "[object]" : a) },
            });
            throw error;
        }
    }) as T;
}

export default {
    initSentry,
    captureError,
    captureMessage,
    setUser,
    addBreadcrumb,
    sentryErrorHandler,
    sentryRequestHandler,
    getBufferedErrors,
    flushSentry,
    withErrorMonitoring,
};
