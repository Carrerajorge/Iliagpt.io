
import { Request, Response, NextFunction } from 'express';
import { z, ZodError } from 'zod';
import { log } from '../index';

type ValidationSource = 'body' | 'query' | 'params';

export const validate = (schema: z.ZodSchema<any>, source: ValidationSource = 'body') => {
    return (req: Request, res: Response, next: NextFunction) => {
        try {
            const dataToValidate = req[source];
            const validatedData = schema.parse(dataToValidate);

            // Replace raw data with validated/transformed data
            req[source] = validatedData;

            next();
        } catch (error) {
            if (error instanceof ZodError) {
                log(`[Validation Error] ${req.method} ${req.path}: ${JSON.stringify(error.errors)}`, 'security');

                return res.status(400).json({
                    status: 'error',
                    code: 'VALIDATION_ERROR',
                    message: 'Invalid request data',
                    details: error.errors.map(err => ({
                        path: err.path.join('.'),
                        message: err.message
                    }))
                });
            }
            next(error);
        }
    };
};

// Generic schemas for common patterns
export const commonSchemas = {
    id: z.object({
        id: z.string().uuid().or(z.string().min(1))
    }),
    pagination: z.object({
        page: z.coerce.number().min(1).default(1),
        limit: z.coerce.number().min(1).max(100).default(20)
    })
};
