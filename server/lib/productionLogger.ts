/**
 * Production Logger
 * 
 * Enterprise-grade structured logging with:
 * - Log levels (debug, info, warn, error)
 * - Environment-aware behavior
 * - Sensitive data redaction
 * - JSON structured output
 * - Request tracing support
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
    requestId?: string;
    userId?: string;
    component?: string;
    action?: string;
    [key: string]: unknown;
}

interface LogEntry {
    timestamp: string;
    level: LogLevel;
    message: string;
    context?: LogContext;
    error?: {
        name: string;
        message: string;
        stack?: string;
    };
}

// Sensitive fields to redact
const SENSITIVE_FIELDS = [
    'password',
    'token',
    'secret',
    'apiKey',
    'api_key',
    'authorization',
    'credential',
    'ssn',
    'creditCard',
    'credit_card',
];

const LOG_LEVELS: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};

class ProductionLogger {
    private level: LogLevel;
    private isProduction: boolean;
    private component: string;

    constructor(component: string = 'app') {
        this.isProduction = process.env.NODE_ENV === 'production';
        this.level = (process.env.LOG_LEVEL as LogLevel) || (this.isProduction ? 'info' : 'debug');
        this.component = component;
    }

    private shouldLog(level: LogLevel): boolean {
        return LOG_LEVELS[level] >= LOG_LEVELS[this.level];
    }

    private redactSensitive(obj: unknown): unknown {
        if (typeof obj !== 'object' || obj === null) {
            return obj;
        }

        if (Array.isArray(obj)) {
            return obj.map(item => this.redactSensitive(item));
        }

        const redacted: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj)) {
            const lowerKey = key.toLowerCase();
            if (SENSITIVE_FIELDS.some(field => lowerKey.includes(field.toLowerCase()))) {
                redacted[key] = '[REDACTED]';
            } else if (typeof value === 'object' && value !== null) {
                redacted[key] = this.redactSensitive(value);
            } else {
                redacted[key] = value;
            }
        }
        return redacted;
    }

    private formatError(error: Error): LogEntry['error'] {
        return {
            name: error.name,
            message: error.message,
            stack: this.isProduction ? undefined : error.stack,
        };
    }

    private log(level: LogLevel, message: string, context?: LogContext, error?: Error): void {
        if (!this.shouldLog(level)) {
            return;
        }

        const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            level,
            message,
            context: context ? {
                ...this.redactSensitive(context) as LogContext,
                component: this.component,
            } : { component: this.component },
        };

        if (error) {
            entry.error = this.formatError(error);
        }

        if (this.isProduction) {
            // In production, output structured JSON
            console.log(JSON.stringify(entry));
        } else {
            // In development, output human-readable format
            const prefix = `[${entry.timestamp}] [${level.toUpperCase()}] [${this.component}]`;
            const contextStr = context ? ` ${JSON.stringify(this.redactSensitive(context))}` : '';

            switch (level) {
                case 'debug':
                    console.debug(`${prefix} ${message}${contextStr}`);
                    break;
                case 'info':
                    console.info(`${prefix} ${message}${contextStr}`);
                    break;
                case 'warn':
                    console.warn(`${prefix} ${message}${contextStr}`);
                    break;
                case 'error':
                    console.error(`${prefix} ${message}${contextStr}`, error || '');
                    break;
            }
        }
    }

    debug(message: string, context?: LogContext): void {
        this.log('debug', message, context);
    }

    info(message: string, context?: LogContext): void {
        this.log('info', message, context);
    }

    warn(message: string, context?: LogContext): void {
        this.log('warn', message, context);
    }

    error(message: string, error?: Error | unknown, context?: LogContext): void {
        const err = error instanceof Error ? error : new Error(String(error));
        this.log('error', message, context, err);
    }

    child(component: string): ProductionLogger {
        return new ProductionLogger(`${this.component}:${component}`);
    }
}

// Singleton for main logger
export const logger = new ProductionLogger();

// Factory for component-specific loggers
export function createLogger(component: string): ProductionLogger {
    return new ProductionLogger(component);
}

// Export class for testing
export { ProductionLogger };
