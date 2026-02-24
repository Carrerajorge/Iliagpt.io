/**
 * Centralized Error Handling (#28)
 * RFC 7807 Problem Details for HTTP APIs
 */

import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { audit } from './auditLog';

// Error types
export class AppError extends Error {
    public readonly statusCode: number;
    public readonly code: string;
    public readonly details?: Record<string, any>;
    public readonly isOperational: boolean;

    constructor(
        message: string,
        statusCode: number = 500,
        code: string = 'INTERNAL_ERROR',
        details?: Record<string, any>
    ) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
        this.isOperational = true;

        Error.captureStackTrace(this, this.constructor);
    }
}

// Common error classes
export class BadRequestError extends AppError {
    constructor(message: string, details?: Record<string, any>) {
        super(message, 400, 'BAD_REQUEST', details);
    }
}

export class UnauthorizedError extends AppError {
    constructor(message: string = 'No autorizado') {
        super(message, 401, 'UNAUTHORIZED');
    }
}

export class ForbiddenError extends AppError {
    constructor(message: string = 'Acceso denegado') {
        super(message, 403, 'FORBIDDEN');
    }
}

export class NotFoundError extends AppError {
    constructor(resource: string = 'Recurso') {
        super(`${resource} no encontrado`, 404, 'NOT_FOUND');
    }
}

export class ConflictError extends AppError {
    constructor(message: string) {
        super(message, 409, 'CONFLICT');
    }
}

export class ValidationError extends AppError {
    constructor(errors: Record<string, string[]>) {
        super('Error de validación', 422, 'VALIDATION_ERROR', { errors });
    }
}

export class RateLimitError extends AppError {
    constructor(retryAfter: number) {
        super('Límite de solicitudes excedido', 429, 'RATE_LIMITED', { retryAfter });
    }
}

export class ExternalServiceError extends AppError {
    constructor(service: string, originalError?: Error) {
        super(`Error en servicio externo: ${service}`, 502, 'EXTERNAL_SERVICE_ERROR', {
            service,
            originalMessage: originalError?.message,
        });
    }
}

// RFC 7807 Problem Details format
interface ProblemDetails {
    type: string;
    title: string;
    status: number;
    detail: string;
    instance: string;
    code: string;
    timestamp: string;
    requestId?: string;
    errors?: Record<string, string[]>;
    [key: string]: any;
}

/**
 * Format error to RFC 7807 Problem Details
 */
function formatProblemDetails(
    error: AppError | Error,
    req: Request
): ProblemDetails {
    const isAppError = error instanceof AppError;
    const statusCode = isAppError ? error.statusCode : 500;
    const code = isAppError ? error.code : 'INTERNAL_ERROR';

    const problem: ProblemDetails = {
        type: `https://api.iliagpt.ai/errors/${code.toLowerCase()}`,
        title: getErrorTitle(statusCode),
        status: statusCode,
        detail: isAppError ? error.message : 'Ha ocurrido un error interno',
        instance: req.originalUrl,
        code,
        timestamp: new Date().toISOString(),
        requestId: (req as any).requestId,
    };

    // Add validation errors if present
    if (isAppError && error.details?.errors) {
        problem.errors = error.details.errors;
    }

    // Add other details in non-production
    if (process.env.NODE_ENV !== 'production' && isAppError && error.details) {
        Object.assign(problem, error.details);
    }

    return problem;
}

/**
 * Get human-readable title for status code
 */
function getErrorTitle(statusCode: number): string {
    const titles: Record<number, string> = {
        400: 'Bad Request',
        401: 'Unauthorized',
        403: 'Forbidden',
        404: 'Not Found',
        409: 'Conflict',
        422: 'Validation Error',
        429: 'Too Many Requests',
        500: 'Internal Server Error',
        502: 'Bad Gateway',
        503: 'Service Unavailable',
    };
    return titles[statusCode] || 'Error';
}

/**
 * Convert Zod error to validation error
 */
function handleZodError(error: ZodError): ValidationError {
    const errors: Record<string, string[]> = {};

    for (const issue of error.issues) {
        const path = issue.path.join('.') || '_root';
        if (!errors[path]) {
            errors[path] = [];
        }
        errors[path].push(issue.message);
    }

    return new ValidationError(errors);
}

/**
 * Global error handler middleware
 */
export function errorHandler(
    error: Error,
    req: Request,
    res: Response,
    next: NextFunction
): void {
    // Already sent response
    if (res.headersSent) {
        return next(error);
    }

    // Convert known error types
    let appError: AppError;

    if (error instanceof AppError) {
        appError = error;
    } else if (error instanceof ZodError) {
        appError = handleZodError(error);
    } else if (error.name === 'JsonWebTokenError') {
        appError = new UnauthorizedError('Token inválido');
    } else if (error.name === 'TokenExpiredError') {
        appError = new UnauthorizedError('Token expirado');
    } else {
        // Unknown error - log full details
        console.error('Unhandled error:', error);
        appError = new AppError(
            process.env.NODE_ENV === 'production'
                ? 'Ha ocurrido un error interno'
                : error.message,
            500,
            'INTERNAL_ERROR'
        );
    }

    // Log error
    const logLevel = appError.statusCode >= 500 ? 'error' : 'warn';
    console[logLevel](`[${appError.code}] ${appError.message}`, {
        statusCode: appError.statusCode,
        path: req.path,
        method: req.method,
        requestId: (req as any).requestId,
        userId: (req as any).user?.id,
    });

    // Audit high-severity errors
    if (appError.statusCode >= 500) {
        audit.adminAction(
            (req as any).user?.id || 0,
            'server_error',
            {
                code: appError.code,
                path: req.path,
                message: appError.message,
            },
            req
        );
    }

    // Format and send response
    const problem = formatProblemDetails(appError, req);

    res
        .status(appError.statusCode)
        .type('application/problem+json')
        .json(problem);
}

/**
 * Not found handler for unmatched routes
 */
export function notFoundHandler(req: Request, res: Response, next: NextFunction): void {
    next(new NotFoundError('Endpoint'));
}

/**
 * Async handler wrapper to catch promise rejections
 */
export function asyncHandler(
    fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
    return (req: Request, res: Response, next: NextFunction) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

/**
 * Apply error handling to Express app
 */
export function applyErrorHandling(app: any): void {
    // 404 handler for unmatched routes
    app.use(notFoundHandler);

    // Global error handler
    app.use(errorHandler);

    console.log('✅ Centralized error handling configured (RFC 7807)');
}
