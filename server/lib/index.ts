/**
 * Server Library Index
 * 
 * Centralized exports for all server utilities.
 */

// Logging
export { logger, createLogger, ProductionLogger } from './productionLogger';

// Environment
export { validateEnv, getEnv, hasFeature, type EnvConfig } from './envValidator';

// Error Handling
export {
    errorHandler,
    asyncHandler,
    notFoundHandler,
    AppError,
    ValidationError,
    NotFoundError,
    UnauthorizedError,
    ForbiddenError,
    ConflictError,
    RateLimitError,
    InternalError,
    ServiceUnavailableError,
} from './errorHandler';

// Rate Limiting
export {
    createRateLimiter,
    authRateLimiter,
    apiRateLimiter,
    chatRateLimiter,
    uploadRateLimiter,
    adminRateLimiter,
    searchRateLimiter,
} from './rateLimiter';

// Retry Logic
export {
    withRetry,
    retryable,
    fetchWithRetry,
    withCircuitBreaker,
} from './retryUtility';

// Request Validation
export {
    validate,
    validateBody,
    validateQuery,
    validateParams,
    commonSchemas,
    sanitizeString,
    sanitizedString,
} from './requestValidator';
