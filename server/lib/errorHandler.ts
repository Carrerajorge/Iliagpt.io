/**
 * Centralized Error Handler
 * 
 * RFC 7807 compliant error responses with:
 * - Consistent error format
 * - Error classification
 * - Logging integration
 * - Stack trace handling
 */

import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { createLogger } from './productionLogger';

const logger = createLogger('ErrorHandler');

// RFC 7807 Problem Details
interface ProblemDetails {
    type: string;
    title: string;
    status: number;
    detail: string;
    instance?: string;
    errors?: Array<{
        field: string;
        message: string;
    }>;
    traceId?: string;
}

// Custom error classes
export class AppError extends Error {
    constructor(
        public statusCode: number,
        public message: string,
        public code: string = 'APP_ERROR',
        public isOperational: boolean = true
    ) {
        super(message);
        this.name = 'AppError';
        Error.captureStackTrace(this, this.constructor);
    }
}

export class ValidationError extends AppError {
    constructor(message: string, public errors?: Array<{ field: string; message: string }>) {
        super(400, message, 'VALIDATION_ERROR');
        this.name = 'ValidationError';
    }
}

export class NotFoundError extends AppError {
    constructor(resource: string = 'Resource') {
        super(404, `${resource} not found`, 'NOT_FOUND');
        this.name = 'NotFoundError';
    }
}

export class UnauthorizedError extends AppError {
    constructor(message: string = 'Authentication required') {
        super(401, message, 'UNAUTHORIZED');
        this.name = 'UnauthorizedError';
    }
}

export class ForbiddenError extends AppError {
    constructor(message: string = 'Access denied') {
        super(403, message, 'FORBIDDEN');
        this.name = 'ForbiddenError';
    }
}

export class ConflictError extends AppError {
    constructor(message: string = 'Resource conflict') {
        super(409, message, 'CONFLICT');
        this.name = 'ConflictError';
    }
}

export class RateLimitError extends AppError {
    constructor(retryAfter?: number) {
        super(429, 'Too many requests', 'RATE_LIMIT_EXCEEDED');
        this.name = 'RateLimitError';
    }
}

export class InternalError extends AppError {
    constructor(message: string = 'Internal server error') {
        super(500, message, 'INTERNAL_ERROR', false);
        this.name = 'InternalError';
    }
}

export class ServiceUnavailableError extends AppError {
    constructor(service: string = 'Service') {
        super(503, `${service} is temporarily unavailable`, 'SERVICE_UNAVAILABLE');
        this.name = 'ServiceUnavailableError';
    }
}

// Convert Zod errors to our format
function formatZodError(error: ZodError): ValidationError {
    const errors = error.issues.map(issue => ({
        field: issue.path.join('.'),
        message: issue.message,
    }));
    return new ValidationError('Validation failed', errors);
}

// Create RFC 7807 response
function createProblemDetails(
    error: AppError | Error,
    req: Request,
    traceId?: string
): ProblemDetails {
    const isAppError = error instanceof AppError;
    const statusCode = isAppError ? error.statusCode : 500;

    const problem: ProblemDetails = {
        type: `https://api.example.com/errors/${isAppError ? (error as AppError).code : 'INTERNAL_ERROR'}`,
        title: error.name || 'Error',
        status: statusCode,
        detail: error.message,
        instance: req.originalUrl,
    };

    if (traceId) {
        problem.traceId = traceId;
    }

    if (error instanceof ValidationError && error.errors) {
        problem.errors = error.errors;
    }

    return problem;
}

// Main error handler middleware
export function errorHandler(
    err: Error,
    req: Request,
    res: Response,
    next: NextFunction
): void {
    // Generate trace ID
    const traceId = req.headers['x-request-id'] as string ||
        `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Convert Zod errors
    let error = err;
    if (err instanceof ZodError) {
        error = formatZodError(err);
    }

    // Determine if operational error
    const isAppError = error instanceof AppError;
    const isOperational = isAppError && (error as AppError).isOperational;
    const statusCode = isAppError ? (error as AppError).statusCode : 500;

    // Log error
    const logContext = {
        traceId,
        requestId: req.headers['x-request-id'] as string,
        userId: (req as any).user?.id,
        method: req.method,
        url: req.originalUrl,
        statusCode,
        isOperational,
    };

    if (statusCode >= 500) {
        logger.error('Server error', error, logContext);
    } else if (statusCode >= 400) {
        logger.warn(`Client error: ${error.message}`, logContext);
    }

    // Create response
    const problem = createProblemDetails(error, req, traceId);

    // Don't expose internal error details in production
    if (statusCode >= 500 && process.env.NODE_ENV === 'production') {
        problem.detail = 'An unexpected error occurred. Please try again later.';
    }

    res.status(statusCode).json(problem);
}

// Async handler wrapper to catch promise rejections
export function asyncHandler(
    fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
    return (req: Request, res: Response, next: NextFunction) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

// Not found handler
export function notFoundHandler(req: Request, res: Response, next: NextFunction): void {
    next(new NotFoundError('Endpoint'));
}
