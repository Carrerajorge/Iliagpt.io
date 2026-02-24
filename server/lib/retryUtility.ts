/**
 * Retry Utility with Exponential Backoff
 * 
 * Provides consistent retry logic for:
 * - API calls
 * - Database operations
 * - External services
 */

import { createLogger } from './productionLogger';

const logger = createLogger('Retry');

interface RetryOptions {
    maxAttempts?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    backoffMultiplier?: number;
    jitter?: boolean;
    retryCondition?: (error: Error) => boolean;
    onRetry?: (error: Error, attempt: number, delayMs: number) => void;
}

const defaultOptions: Required<Omit<RetryOptions, 'onRetry' | 'retryCondition'>> = {
    maxAttempts: 2,
    initialDelayMs: 250,
    maxDelayMs: 5000,
    backoffMultiplier: 1.5,
    jitter: true,
};

/**
 * Calculate delay with exponential backoff and optional jitter
 */
function calculateDelay(
    attempt: number,
    options: Required<Omit<RetryOptions, 'onRetry' | 'retryCondition'>>
): number {
    let delay = options.initialDelayMs * Math.pow(options.backoffMultiplier, attempt - 1);
    delay = Math.min(delay, options.maxDelayMs);

    if (options.jitter) {
        // Add random jitter between 0% and 25%
        const jitterFactor = 1 + Math.random() * 0.25;
        delay = Math.floor(delay * jitterFactor);
    }

    return delay;
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Default retry condition - retry on network errors and 5xx
 */
function defaultRetryCondition(error: Error): boolean {
    // Retry on network errors
    if (error.message.includes('ECONNREFUSED') ||
        error.message.includes('ETIMEDOUT') ||
        error.message.includes('ECONNRESET') ||
        error.message.includes('fetch failed')) {
        return true;
    }

    // Retry on rate limits
    if (error.message.includes('429') || error.message.includes('rate limit')) {
        return true;
    }

    // Retry on server errors
    if (error.message.includes('500') ||
        error.message.includes('502') ||
        error.message.includes('503') ||
        error.message.includes('504')) {
        return true;
    }

    return false;
}

/**
 * Execute a function with retry logic
 */
export async function withRetry<T>(
    fn: () => Promise<T>,
    options: RetryOptions = {}
): Promise<T> {
    const opts = {
        ...defaultOptions,
        ...options,
        retryCondition: options.retryCondition || defaultRetryCondition,
    };

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));

            // Check if we should retry
            if (attempt === opts.maxAttempts || !opts.retryCondition(lastError)) {
                throw lastError;
            }

            const delayMs = calculateDelay(attempt, opts);

            logger.warn(`Attempt ${attempt} failed, retrying in ${delayMs}ms`, {
                error: lastError.message,
                attempt,
                maxAttempts: opts.maxAttempts,
                delay: delayMs,
            });

            if (opts.onRetry) {
                opts.onRetry(lastError, attempt, delayMs);
            }

            await sleep(delayMs);
        }
    }

    // This should never be reached, but TypeScript needs it
    throw lastError || new Error('Retry failed');
}

/**
 * Create a retryable version of an async function
 */
export function retryable<T extends (...args: any[]) => Promise<any>>(
    fn: T,
    options: RetryOptions = {}
): T {
    return ((...args: Parameters<T>) => withRetry(() => fn(...args), options)) as T;
}

/**
 * Retry wrapper for fetch calls
 */
export async function fetchWithRetry(
    url: string,
    init?: RequestInit,
    options: RetryOptions = {}
): Promise<Response> {
    return withRetry(async () => {
        const response = await fetch(url, init);

        // Throw on server errors to trigger retry
        if (response.status >= 500 || response.status === 429) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return response;
    }, {
        maxAttempts: 2,
        initialDelayMs: 250,
        ...options,
    });
}

/**
 * Circuit breaker integration (uses opossum if available)
 */
export interface CircuitBreakerOptions {
    timeout?: number;
    errorThreshold?: number;
    resetTimeout?: number;
}

let opossum: any = null;

/**
 * Create a circuit breaker wrapped function
 */
export async function withCircuitBreaker<T>(
    fn: () => Promise<T>,
    name: string,
    options: CircuitBreakerOptions = {}
): Promise<T> {
    // Lazy load opossum
    if (opossum === null) {
        try {
            opossum = await import('opossum');
        } catch {
            // Fallback if opossum not installed
            logger.warn('Opossum not available, circuit breaker disabled');
            return fn();
        }
    }

    const breaker = new opossum.default(fn, {
        timeout: options.timeout || 8000,
        errorThresholdPercentage: options.errorThreshold || 50,
        resetTimeout: options.resetTimeout || 15000,
    });

    breaker.on('open', () => {
        logger.warn(`Circuit breaker OPEN: ${name}`);
    });

    breaker.on('halfOpen', () => {
        logger.info(`Circuit breaker HALF-OPEN: ${name}`);
    });

    breaker.on('close', () => {
        logger.info(`Circuit breaker CLOSED: ${name}`);
    });

    return breaker.fire();
}
