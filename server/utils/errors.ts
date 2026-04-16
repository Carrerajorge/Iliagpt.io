export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    statusCode: number = 500,
    code: string = 'INTERNAL_ERROR',
    isOperational: boolean = true,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 400, 'VALIDATION_ERROR', true, details);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string = 'Resource', id?: string) {
    const message = id ? `${resource} with id '${id}' not found` : `${resource} not found`;
    super(message, 404, 'NOT_FOUND', true, { resource, id });
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication required') {
    super(message, 401, 'AUTHENTICATION_ERROR', true);
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string = 'Access denied') {
    super(message, 403, 'AUTHORIZATION_ERROR', true);
  }
}

export class RateLimitError extends AppError {
  public readonly retryAfter?: number;

  constructor(message: string = 'Too many requests', retryAfter?: number) {
    super(message, 429, 'RATE_LIMIT_ERROR', true, { retryAfter });
    this.retryAfter = retryAfter;
  }
}

export class ExternalServiceError extends AppError {
  public readonly serviceName: string;
  public readonly originalError?: Error;

  constructor(
    serviceName: string,
    message: string = 'External service error',
    originalError?: Error,
    statusCode: number = 502
  ) {
    super(message, statusCode, 'EXTERNAL_SERVICE_ERROR', true, { serviceName });
    this.serviceName = serviceName;
    this.originalError = originalError;
  }
}

export class ConflictError extends AppError {
  constructor(message: string = 'Resource conflict') {
    super(message, 409, 'CONFLICT_ERROR', true);
  }
}

export class BadRequestError extends AppError {
  constructor(message: string = 'Bad request', details?: Record<string, unknown>) {
    super(message, 400, 'BAD_REQUEST', true, details);
  }
}

export const createValidationError = (field: string, reason: string): ValidationError => {
  return new ValidationError(`Validation failed for '${field}': ${reason}`, { field, reason });
};

export const createNotFoundError = (resource: string, id?: string): NotFoundError => {
  return new NotFoundError(resource, id);
};

export const createAuthError = (message?: string): AuthenticationError => {
  return new AuthenticationError(message);
};

export const createForbiddenError = (message?: string): AuthorizationError => {
  return new AuthorizationError(message);
};

export const createRateLimitError = (retryAfter?: number): RateLimitError => {
  return new RateLimitError('Rate limit exceeded. Please try again later.', retryAfter);
};

export const createExternalServiceError = (
  serviceName: string,
  originalError?: Error
): ExternalServiceError => {
  const message = originalError?.message || `Failed to communicate with ${serviceName}`;
  return new ExternalServiceError(serviceName, message, originalError);
};

export const isOperationalError = (error: Error): boolean => {
  if (error instanceof AppError) {
    return error.isOperational;
  }
  return false;
};

export const isTransientError = (error: Error | unknown): boolean => {
  if (error instanceof ExternalServiceError) return true;
  if (error instanceof RateLimitError) return true;
  
  if (error instanceof AppError) {
    return error.statusCode >= 500 || error.statusCode === 429;
  }
  
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes('timeout') ||
      message.includes('econnreset') ||
      message.includes('econnrefused') ||
      message.includes('network') ||
      message.includes('socket hang up') ||
      message.includes('etimedout')
    );
  }
  
  return false;
};
