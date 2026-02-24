/**
 * Standardized API Error Response Handler
 * Provides consistent error formatting across all API endpoints
 */

import { Response } from 'express';
import { createLogger } from './productionLogger';

const logger = createLogger('ApiError');

// Standard error codes
export enum ErrorCode {
  // Client errors (4xx)
  BAD_REQUEST = 'BAD_REQUEST',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  RATE_LIMITED = 'RATE_LIMITED',
  PAYLOAD_TOO_LARGE = 'PAYLOAD_TOO_LARGE',

  // Server errors (5xx)
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  EXTERNAL_SERVICE_ERROR = 'EXTERNAL_SERVICE_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
  TIMEOUT = 'TIMEOUT',
}

// Map error codes to HTTP status codes
const errorStatusMap: Record<ErrorCode, number> = {
  [ErrorCode.BAD_REQUEST]: 400,
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.CONFLICT]: 409,
  [ErrorCode.VALIDATION_ERROR]: 422,
  [ErrorCode.RATE_LIMITED]: 429,
  [ErrorCode.PAYLOAD_TOO_LARGE]: 413,
  [ErrorCode.INTERNAL_ERROR]: 500,
  [ErrorCode.SERVICE_UNAVAILABLE]: 503,
  [ErrorCode.EXTERNAL_SERVICE_ERROR]: 502,
  [ErrorCode.DATABASE_ERROR]: 500,
  [ErrorCode.TIMEOUT]: 504,
};

// Standard API error response interface
export interface ApiErrorResponse {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
    requestId?: string;
  };
  timestamp: string;
}

// Standard API success response interface
export interface ApiSuccessResponse<T = unknown> {
  success: true;
  data: T;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    hasMore?: boolean;
  };
  timestamp: string;
}

/**
 * Custom API Error class
 */
export class ApiError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;
  public readonly isOperational: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    details?: Record<string, unknown>,
    isOperational = true
  ) {
    super(message);
    this.code = code;
    this.statusCode = errorStatusMap[code] || 500;
    this.details = details;
    this.isOperational = isOperational;

    // Capture stack trace
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message: string, details?: Record<string, unknown>) {
    return new ApiError(ErrorCode.BAD_REQUEST, message, details);
  }

  static unauthorized(message = 'Authentication required') {
    return new ApiError(ErrorCode.UNAUTHORIZED, message);
  }

  static forbidden(message = 'Access denied') {
    return new ApiError(ErrorCode.FORBIDDEN, message);
  }

  static notFound(resource = 'Resource') {
    return new ApiError(ErrorCode.NOT_FOUND, `${resource} not found`);
  }

  static validationError(message: string, details?: Record<string, unknown>) {
    return new ApiError(ErrorCode.VALIDATION_ERROR, message, details);
  }

  static rateLimited(message = 'Too many requests') {
    return new ApiError(ErrorCode.RATE_LIMITED, message);
  }

  static internal(message = 'Internal server error') {
    return new ApiError(ErrorCode.INTERNAL_ERROR, message, undefined, false);
  }

  static serviceUnavailable(service: string) {
    return new ApiError(ErrorCode.SERVICE_UNAVAILABLE, `${service} is temporarily unavailable`);
  }

  static externalServiceError(service: string, originalError?: Error) {
    return new ApiError(
      ErrorCode.EXTERNAL_SERVICE_ERROR,
      `Error communicating with ${service}`,
      originalError ? { originalMessage: originalError.message } : undefined
    );
  }

  static databaseError(message = 'Database operation failed') {
    return new ApiError(ErrorCode.DATABASE_ERROR, message);
  }

  static timeout(operation: string) {
    return new ApiError(ErrorCode.TIMEOUT, `${operation} timed out`);
  }
}

/**
 * Send standardized error response
 */
export function sendErrorResponse(
  res: Response,
  error: ApiError | Error,
  requestId?: string
): void {
  const isProduction = process.env.NODE_ENV === 'production';

  if (error instanceof ApiError) {
    const response: ApiErrorResponse = {
      success: false,
      error: {
        code: error.code,
        message: error.message,
        requestId,
        // Only include details in non-production or for operational errors
        ...((!isProduction || error.isOperational) && error.details && { details: error.details }),
      },
      timestamp: new Date().toISOString(),
    };

    // Log non-operational errors
    if (!error.isOperational) {
      logger.error('Non-operational error', { error: error.message, stack: error.stack, requestId });
    }

    res.status(error.statusCode).json(response);
  } else {
    // Generic error - don't expose details in production
    const response: ApiErrorResponse = {
      success: false,
      error: {
        code: ErrorCode.INTERNAL_ERROR,
        message: isProduction ? 'An unexpected error occurred' : error.message,
        requestId,
      },
      timestamp: new Date().toISOString(),
    };

    logger.error('Unhandled error', { error: error.message, stack: error.stack, requestId });

    res.status(500).json(response);
  }
}

/**
 * Send standardized success response
 */
export function sendSuccessResponse<T>(
  res: Response,
  data: T,
  statusCode = 200,
  meta?: ApiSuccessResponse<T>['meta']
): void {
  const response: ApiSuccessResponse<T> = {
    success: true,
    data,
    timestamp: new Date().toISOString(),
    ...(meta && { meta }),
  };

  res.status(statusCode).json(response);
}

/**
 * Wrap async route handler with error handling
 */
export function asyncHandler(
  fn: (req: any, res: Response, next: any) => Promise<any>
) {
  return (req: any, res: Response, next: any) => {
    Promise.resolve(fn(req, res, next)).catch((error) => {
      sendErrorResponse(res, error, req.requestId);
    });
  };
}

export default {
  ApiError,
  ErrorCode,
  sendErrorResponse,
  sendSuccessResponse,
  asyncHandler,
};
