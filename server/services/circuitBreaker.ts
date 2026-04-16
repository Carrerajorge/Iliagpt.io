/**
 * Circuit Breaker for LLM Calls (#32)
 * Prevent cascade failures with automatic failover
 */

import CircuitBreaker from 'opossum';
import { FALLBACK_CHAINS } from '../lib/modelRegistry';

interface CircuitBreakerOptions {
    timeout?: number;          // Time in ms to wait for action to complete
    errorThresholdPercentage?: number; // Error percentage to trip circuit
    resetTimeout?: number;     // Time in ms to try again after failure
    volumeThreshold?: number;  // Minimum requests before calculating error %
}

interface LLMCallOptions {
    model: string;
    messages: Array<{ role: string; content: string }>;
    temperature?: number;
    maxTokens?: number;
    stream?: boolean;
}

// Default circuit breaker settings for LLM calls
const DEFAULT_OPTIONS: CircuitBreakerOptions = {
    timeout: 60000,              // 60 second timeout
    errorThresholdPercentage: 50, // Trip if 50% of requests fail
    resetTimeout: 30000,         // Try again after 30 seconds
    volumeThreshold: 5,          // Need at least 5 requests
};

// Breaker registry
const breakers = new Map<string, CircuitBreaker>();

// Fallback models – sourced from the central model registry
const FALLBACK_CHAIN: Record<string, string[]> = Object.fromEntries(
    Object.entries(FALLBACK_CHAINS).map(([k, v]) => [k, [...v]]),
);

/**
 * Get or create circuit breaker for a model
 */
function getBreaker(model: string, callFunction: (options: LLMCallOptions) => Promise<any>): CircuitBreaker {
    if (breakers.has(model)) {
        return breakers.get(model)!;
    }

    const breaker = new CircuitBreaker(callFunction, {
        ...DEFAULT_OPTIONS,
        name: `llm-${model}`,
    });

    // Event handlers
    breaker.on('open', () => {
        console.warn(`⚠️ Circuit OPEN for model: ${model}`);
    });

    breaker.on('halfOpen', () => {
        console.log(`🔄 Circuit HALF-OPEN for model: ${model}`);
    });

    breaker.on('close', () => {
        console.log(`✅ Circuit CLOSED for model: ${model}`);
    });

    breaker.on('timeout', () => {
        console.warn(`⏱️ Timeout for model: ${model}`);
    });

    breaker.on('reject', () => {
        console.warn(`🚫 Request rejected (circuit open) for model: ${model}`);
    });

    breakers.set(model, breaker);
    return breaker;
}

/**
 * Try calling LLM with automatic fallback
 */
export async function callWithFallback(
    options: LLMCallOptions,
    callFunction: (options: LLMCallOptions) => Promise<any>
): Promise<{ result: any; usedModel: string; wasFallback: boolean }> {
    const primaryModel = options.model;
    const fallbackModels = FALLBACK_CHAIN[primaryModel] || [];
    const allModels = [primaryModel, ...fallbackModels];

    let lastError: Error | null = null;

    for (let i = 0; i < allModels.length; i++) {
        const model = allModels[i];
        const breaker = getBreaker(model, callFunction);

        try {
            const result = await breaker.fire({ ...options, model });
            return {
                result,
                usedModel: model,
                wasFallback: i > 0,
            };
        } catch (error: any) {
            lastError = error;
            console.warn(`Failed with model ${model}: ${error.message}`);

            // If circuit is open, immediately try next
            if (error.code === 'EOPENBREAKER') {
                continue;
            }

            // For other errors, still try fallback
            if (i < allModels.length - 1) {
                console.log(`Attempting fallback to: ${allModels[i + 1]}`);
            }
        }
    }

    throw lastError || new Error('All models failed');
}

/**
 * Get circuit breaker status for all models
 */
export function getBreakerStatus(): Record<string, {
    state: string;
    stats: {
        failures: number;
        successes: number;
        rejects: number;
        timeouts: number;
    };
}> {
    const status: Record<string, any> = {};

    for (const [model, breaker] of breakers.entries()) {
        const stats = breaker.stats;
        status[model] = {
            state: breaker.opened ? 'OPEN' : breaker.halfOpen ? 'HALF_OPEN' : 'CLOSED',
            stats: {
                failures: stats.failures,
                successes: stats.successes,
                rejects: stats.rejects,
                timeouts: stats.timeouts,
            },
        };
    }

    return status;
}

/**
 * Reset a specific circuit breaker
 */
export function resetBreaker(model: string): boolean {
    const breaker = breakers.get(model);
    if (breaker) {
        breaker.close();
        return true;
    }
    return false;
}

/**
 * Reset all circuit breakers
 */
export function resetAllBreakers(): void {
    for (const breaker of breakers.values()) {
        breaker.close();
    }
}

/**
 * Simple retry wrapper with exponential backoff
 */
export async function withRetry<T>(
    fn: () => Promise<T>,
    options: {
        maxRetries?: number;
        baseDelay?: number;
        maxDelay?: number;
        onRetry?: (error: Error, attempt: number) => void;
    } = {}
): Promise<T> {
    const { maxRetries = 3, baseDelay = 1000, maxDelay = 10000, onRetry } = options;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error: any) {
            lastError = error;

            if (attempt < maxRetries) {
                const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
                const jitter = Math.random() * 200; // Add some jitter

                onRetry?.(error, attempt + 1);
                await new Promise(resolve => setTimeout(resolve, delay + jitter));
            }
        }
    }

    throw lastError;
}

/**
 * Timeout wrapper for any async function
 */
export async function withTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number,
    timeoutMessage: string = 'Operation timed out'
): Promise<T> {
    return Promise.race([
        fn(),
        new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
        ),
    ]);
}
