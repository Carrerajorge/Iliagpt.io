/**
 * Express error handling middleware for IliaGPT.
 */

import type { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import * as crypto from 'crypto';
import { ZodError } from 'zod';
import { AppError, ValidationError, wrapError } from '../lib/errors';

const isDev = process.env.NODE_ENV !== 'production';

declare global {
  namespace Express {
    interface Request {
      correlationId?: string;
    }
  }
}

/** Attach or generate a correlation ID for every request. */
export function correlationId(req: Request, res: Response, next: NextFunction) {
  const id = (req.headers['x-request-id'] as string) || crypto.randomUUID();
  req.correlationId = id;
  res.setHeader('X-Request-Id', id);
  next();
}

/** 404 handler for unmatched routes. */
export const notFoundHandler = (req: Request, res: Response): void => {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `Cannot ${req.method} ${req.path}` },
  });
};

/** Central error handler — must be registered after all routes. */
export const errorHandler: ErrorRequestHandler = (
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  // Handle Zod validation errors
  if (err instanceof ZodError) {
    const issues = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    const appErr = new ValidationError('Validation failed', { issues });
    sendError(appErr, req, res);
    return;
  }

  // Handle Drizzle / pg errors (constraint violations, connection errors)
  if (isPgError(err)) {
    const pgCode = (err as Record<string, unknown>).code as string;
    const status = pgCode === '23505' ? 409 : pgCode?.startsWith('08') ? 503 : 500;
    const code = pgCode === '23505' ? 'CONFLICT' : pgCode?.startsWith('08') ? 'DB_UNAVAILABLE' : 'DB_ERROR';
    const message = pgCode === '23505' ? 'Duplicate record' : 'Database error';
    const appErr = new AppError(message, status, code, true);
    sendError(appErr, req, res);
    return;
  }

  const appErr = wrapError(err);
  sendError(appErr, req, res);
};

function sendError(appErr: AppError, req: Request, res: Response) {
  const userId = (req as any).user?.id;

  console.error(
    JSON.stringify({
      level: 'error',
      code: appErr.code,
      message: appErr.message,
      statusCode: appErr.statusCode,
      method: req.method,
      path: req.path,
      correlationId: req.correlationId,
      userId,
      ...(appErr.context && { context: appErr.context }),
      ...(isDev && { stack: appErr.stack }),
    }),
  );

  const body: Record<string, unknown> = {
    error: {
      code: appErr.code,
      message: appErr.isOperational ? appErr.message : 'Internal server error',
      ...(appErr.context && isDev && { context: appErr.context }),
      ...(isDev && { stack: appErr.stack }),
    },
  };

  if (!res.headersSent) {
    res.status(appErr.statusCode).json(body);
  }
}

function isPgError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as Record<string, unknown>;
  return typeof e.code === 'string' && typeof e.severity === 'string';
}

/** Wrap async route handlers so rejected promises forward to errorHandler. */
export const asyncHandler = <T>(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<T>,
) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
