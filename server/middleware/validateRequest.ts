import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { fromZodError } from 'zod-validation-error';
import { ValidationError } from '../utils/errors';

type ValidatedRequest = Request & {
  validatedBody?: unknown;
  validatedQuery?: unknown;
  validatedParams?: unknown;
};

export function validateBody<T>(schema: ZodSchema<T>): RequestHandler {
  return (req: ValidatedRequest, res: Response, next: NextFunction): void => {
    try {
      const result = schema.parse(req.body);
      req.body = result;
      req.validatedBody = result;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error, {
          prefix: 'Validation failed',
          prefixSeparator: ': ',
          issueSeparator: '; ',
          unionSeparator: ' or ',
        });
        next(new ValidationError(validationError.message, {
          issues: error.errors.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
            code: issue.code,
          })),
        }));
        return;
      }
      next(error);
    }
  };
}

export function validateQuery<T>(schema: ZodSchema<T>): RequestHandler {
  return (req: ValidatedRequest, res: Response, next: NextFunction): void => {
    try {
      const result = schema.parse(req.query);
      req.query = result as any;
      req.validatedQuery = result;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error, {
          prefix: 'Query validation failed',
          prefixSeparator: ': ',
          issueSeparator: '; ',
          unionSeparator: ' or ',
        });
        next(new ValidationError(validationError.message, {
          issues: error.errors.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
            code: issue.code,
          })),
        }));
        return;
      }
      next(error);
    }
  };
}

export function validateParams<T>(schema: ZodSchema<T>): RequestHandler {
  return (req: ValidatedRequest, res: Response, next: NextFunction): void => {
    try {
      const result = schema.parse(req.params);
      req.params = result as any;
      req.validatedParams = result;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error, {
          prefix: 'Path parameter validation failed',
          prefixSeparator: ': ',
          issueSeparator: '; ',
          unionSeparator: ' or ',
        });
        next(new ValidationError(validationError.message, {
          issues: error.errors.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
            code: issue.code,
          })),
        }));
        return;
      }
      next(error);
    }
  };
}

export function validate<
  TBody = unknown,
  TQuery = unknown,
  TParams = unknown
>(options: {
  body?: ZodSchema<TBody>;
  query?: ZodSchema<TQuery>;
  params?: ZodSchema<TParams>;
}): RequestHandler[] {
  const middlewares: RequestHandler[] = [];
  
  if (options.params) {
    middlewares.push(validateParams(options.params));
  }
  if (options.query) {
    middlewares.push(validateQuery(options.query));
  }
  if (options.body) {
    middlewares.push(validateBody(options.body));
  }
  
  return middlewares;
}
