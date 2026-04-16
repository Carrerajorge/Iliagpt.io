/**
 * Typed error classes for IliaGPT's production error handling.
 */

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly context?: Record<string, unknown>;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    statusCode = 500,
    code = 'INTERNAL_ERROR',
    isOperational = true,
    context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    this.context = context;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      statusCode: this.statusCode,
      code: this.code,
      isOperational: this.isOperational,
      ...(this.context && { context: this.context }),
    };
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Invalid input', context?: Record<string, unknown>) {
    super(message, 400, 'VALIDATION_ERROR', true, context);
  }
}

export class AuthError extends AppError {
  constructor(message = 'Authentication required', context?: Record<string, unknown>) {
    super(message, 401, 'AUTH_ERROR', true, context);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Insufficient permissions', context?: Record<string, unknown>) {
    super(message, 403, 'FORBIDDEN', true, context);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', context?: Record<string, unknown>) {
    super(message, 404, 'NOT_FOUND', true, context);
  }
}

export class RateLimitError extends AppError {
  public readonly retryAfterMs?: number;
  constructor(message = 'Rate limit exceeded', retryAfterMs?: number, context?: Record<string, unknown>) {
    super(message, 429, 'RATE_LIMIT', true, context);
    this.retryAfterMs = retryAfterMs;
  }
}

export class LLMError extends AppError {
  public readonly provider?: string;
  public readonly model?: string;
  constructor(message = 'LLM provider failure', provider?: string, model?: string, context?: Record<string, unknown>) {
    super(message, 502, 'LLM_ERROR', true, { ...context, provider, model });
    this.provider = provider;
    this.model = model;
  }
}

export class ToolError extends AppError {
  public readonly toolName?: string;
  constructor(message = 'Tool execution failed', toolName?: string, context?: Record<string, unknown>) {
    super(message, 500, 'TOOL_ERROR', true, { ...context, toolName });
    this.toolName = toolName;
  }
}

export class TimeoutError extends AppError {
  constructor(message = 'Operation timed out', context?: Record<string, unknown>) {
    super(message, 504, 'TIMEOUT', true, context);
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

export function wrapError(err: unknown, fallbackMessage = 'An unexpected error occurred'): AppError {
  if (isAppError(err)) return err;
  const message = err instanceof Error ? err.message : fallbackMessage;
  const wrapped = new AppError(message, 500, 'INTERNAL_ERROR', false);
  if (err instanceof Error && err.stack) wrapped.stack = err.stack;
  return wrapped;
}
