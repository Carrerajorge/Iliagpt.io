/**
 * Smart Retry System - ILIAGPT PRO 3.0
 * 
 * Intelligent retry with exponential backoff and model fallback.
 */

// ============== Types ==============

export interface RetryConfig {
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    backoffMultiplier?: number;
    fallbackModels?: string[];
    retryableErrors?: string[];
    onRetry?: (attempt: number, error: Error, nextModel?: string) => void;
}

export interface RetryResult<T> {
    success: boolean;
    data?: T;
    attempts: number;
    totalDurationMs: number;
    usedModel?: string;
    errors: Error[];
}

// ============== Default Config ==============

const DEFAULT_CONFIG: Required<Omit<RetryConfig, 'onRetry' | 'fallbackModels'>> = {
    maxRetries: 2,
    baseDelayMs: 300,
    maxDelayMs: 3000,
    backoffMultiplier: 1.5,
    retryableErrors: [
        "ECONNRESET",
        "ETIMEDOUT",
        "ENOTFOUND",
        "rate_limit",
        "overloaded",
        "timeout",
        "503",
        "502",
        "429",
    ],
};

// ============== Retry Logic ==============

/**
 * Check if error is retryable
 */
function isRetryableError(error: Error, retryableErrors: string[]): boolean {
    const errorString = error.message.toLowerCase();
    return retryableErrors.some(re =>
        errorString.includes(re.toLowerCase())
    );
}

/**
 * Calculate delay with jitter
 */
function calculateDelay(
    attempt: number,
    baseDelay: number,
    maxDelay: number,
    multiplier: number
): number {
    const exponentialDelay = baseDelay * Math.pow(multiplier, attempt);
    const jitter = Math.random() * 0.15 * exponentialDelay; // 0-15% jitter
    return Math.min(exponentialDelay + jitter, maxDelay);
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute with smart retry
 */
export async function smartRetry<T>(
    fn: (modelId?: string) => Promise<T>,
    config: RetryConfig = {}
): Promise<RetryResult<T>> {
    const {
        maxRetries = DEFAULT_CONFIG.maxRetries,
        baseDelayMs = DEFAULT_CONFIG.baseDelayMs,
        maxDelayMs = DEFAULT_CONFIG.maxDelayMs,
        backoffMultiplier = DEFAULT_CONFIG.backoffMultiplier,
        retryableErrors = DEFAULT_CONFIG.retryableErrors,
        fallbackModels = [],
        onRetry,
    } = config;

    const errors: Error[] = [];
    const startTime = Date.now();
    let currentModelIndex = -1; // -1 means primary model
    let usedModel: string | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const modelToUse = currentModelIndex >= 0
                ? fallbackModels[currentModelIndex]
                : undefined;

            usedModel = modelToUse;
            const result = await fn(modelToUse);

            return {
                success: true,
                data: result,
                attempts: attempt + 1,
                totalDurationMs: Date.now() - startTime,
                usedModel,
                errors,
            };
        } catch (error) {
            const err = error as Error;
            errors.push(err);

            // Check if we should retry
            if (attempt >= maxRetries) {
                break;
            }

            if (!isRetryableError(err, retryableErrors)) {
                // Non-retryable error, try fallback model if available
                if (currentModelIndex < fallbackModels.length - 1) {
                    currentModelIndex++;
                    onRetry?.(attempt + 1, err, fallbackModels[currentModelIndex]);
                    continue; // No delay for model switch
                }
                break;
            }

            // Calculate delay
            const delay = calculateDelay(
                attempt,
                baseDelayMs,
                maxDelayMs,
                backoffMultiplier
            );

            onRetry?.(attempt + 1, err);
            await sleep(delay);

            // After 2 retries on same model, try fallback
            if (attempt >= 1 && currentModelIndex < fallbackModels.length - 1) {
                currentModelIndex++;
                onRetry?.(attempt + 1, err, fallbackModels[currentModelIndex]);
            }
        }
    }

    return {
        success: false,
        attempts: errors.length,
        totalDurationMs: Date.now() - startTime,
        usedModel,
        errors,
    };
}

/**
 * Create retry wrapper for a function
 */
export function withRetry<T extends (...args: any[]) => Promise<any>>(
    fn: T,
    config: RetryConfig = {}
): (...args: Parameters<T>) => Promise<RetryResult<Awaited<ReturnType<T>>>> {
    return async (...args: Parameters<T>) => {
        return smartRetry(() => fn(...args), config);
    };
}

/**
 * React hook for retry state
 */
export interface UseRetryState {
    isRetrying: boolean;
    attempt: number;
    lastError: Error | null;
    usedFallback: boolean;
}

export function createRetryState(): UseRetryState {
    return {
        isRetrying: false,
        attempt: 0,
        lastError: null,
        usedFallback: false,
    };
}

export default smartRetry;
