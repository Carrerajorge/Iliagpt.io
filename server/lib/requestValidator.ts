/**
 * Request Validation Middleware
 * 
 * Zod-based request validation for:
 * - Body
 * - Query parameters
 * - Path parameters
 * - Headers
 */

import type { Request, Response, NextFunction } from 'express';
import { z, ZodSchema, ZodError } from 'zod';
import { ValidationError } from './errorHandler';

interface ValidationSchemas {
    body?: ZodSchema;
    query?: ZodSchema;
    params?: ZodSchema;
    headers?: ZodSchema;
}

/**
 * Create validation middleware from Zod schemas
 */
export function validate(schemas: ValidationSchemas) {
    return async (req: Request, res: Response, next: NextFunction) => {
        const errors: Array<{ field: string; message: string }> = [];

        try {
            if (schemas.body) {
                req.body = schemas.body.parse(req.body);
            }
        } catch (error) {
            if (error instanceof ZodError) {
                errors.push(...error.issues.map(issue => ({
                    field: `body.${issue.path.join('.')}`,
                    message: issue.message,
                })));
            }
        }

        try {
            if (schemas.query) {
                req.query = schemas.query.parse(req.query) as any;
            }
        } catch (error) {
            if (error instanceof ZodError) {
                errors.push(...error.issues.map(issue => ({
                    field: `query.${issue.path.join('.')}`,
                    message: issue.message,
                })));
            }
        }

        try {
            if (schemas.params) {
                req.params = schemas.params.parse(req.params);
            }
        } catch (error) {
            if (error instanceof ZodError) {
                errors.push(...error.issues.map(issue => ({
                    field: `params.${issue.path.join('.')}`,
                    message: issue.message,
                })));
            }
        }

        try {
            if (schemas.headers) {
                schemas.headers.parse(req.headers);
            }
        } catch (error) {
            if (error instanceof ZodError) {
                errors.push(...error.issues.map(issue => ({
                    field: `headers.${issue.path.join('.')}`,
                    message: issue.message,
                })));
            }
        }

        if (errors.length > 0) {
            next(new ValidationError('Request validation failed', errors));
            return;
        }

        next();
    };
}

/**
 * Common validation schemas
 */
export const commonSchemas = {
    // UUID
    uuid: z.string().uuid(),

    // Pagination
    pagination: z.object({
        page: z.string().transform(Number).pipe(z.number().min(1)).optional().default('1'),
        limit: z.string().transform(Number).pipe(z.number().min(1).max(100)).optional().default('20'),
        sort: z.string().optional(),
        order: z.enum(['asc', 'desc']).optional().default('desc'),
    }),

    // Search
    search: z.object({
        q: z.string().min(1).max(500).optional(),
        filters: z.record(z.string()).optional(),
    }),

    // Date range
    dateRange: z.object({
        from: z.string().datetime().optional(),
        to: z.string().datetime().optional(),
    }),

    // ID parameter
    idParam: z.object({
        id: z.string().uuid(),
    }),

    // Chat message
    chatMessage: z.object({
        content: z.string().min(1).max(100000),
        attachments: z.array(z.object({
            id: z.string(),
            type: z.string(),
            name: z.string(),
            size: z.number().optional(),
            mimeType: z.string().optional(),
        })).optional(),
        model: z.string().optional(),
        temperature: z.number().min(0).max(2).optional(),
    }),

    // User update
    userUpdate: z.object({
        displayName: z.string().min(1).max(100).optional(),
        avatar: z.string().url().optional(),
        settings: z.record(z.unknown()).optional(),
    }),

    // File upload metadata
    fileUpload: z.object({
        filename: z.string().min(1).max(255),
        mimeType: z.string(),
        size: z.number().max(100 * 1024 * 1024), // 100MB max
        chatId: z.string().uuid().optional(),
    }),
};

/**
 * Shorthand validators
 */
export const validateBody = <T extends ZodSchema>(schema: T) => validate({ body: schema });
export const validateQuery = <T extends ZodSchema>(schema: T) => validate({ query: schema });
export const validateParams = <T extends ZodSchema>(schema: T) => validate({ params: schema });

/**
 * Sanitize string input (basic XSS prevention)
 */
export function sanitizeString(input: string): string {
    const normalized = input.normalize("NFC");
    const withoutNulls = normalized.replace(/\u0000/g, "");
    const withoutControl = withoutNulls.replace(/[\u0001-\u0008\u000B-\u001F\u007F]/g, "");
    const escaped = withoutControl
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#x27;")
        .replace(/\//g, "&#x2F;");

    return escaped.slice(0, 10000);
}

/**
 * Schema for sanitized strings
 */
export const sanitizedString = z.string().transform(sanitizeString);
