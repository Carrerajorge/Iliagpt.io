/**
 * Self-Healing Pipeline Service
 * 
 * Provides resilience patterns for agentic pipelines:
 * - Automatic fallback strategies per tool
 * - Circuit breaker for failing services
 * - Exponential backoff with jitter
 * - Health monitoring and recovery
 */

import { EventEmitter } from "events";

// Circuit breaker states
type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

interface CircuitBreakerConfig {
    failureThreshold: number;     // Failures before opening
    successThreshold: number;     // Successes to close from half-open
    timeout: number;              // Time in OPEN state before HALF_OPEN
    monitorInterval: number;      // Health check interval
}

interface ServiceHealth {
    name: string;
    state: CircuitState;
    failures: number;
    successes: number;
    lastFailure: Date | null;
    lastSuccess: Date | null;
    lastError: string | null;
}

// Fallback chains for different services
export const FALLBACK_CHAINS: Record<string, string[]> = {
    // Academic search fallbacks
    "openalex": ["semantic_scholar", "pubmed", "crossref"],
    "semantic_scholar": ["openalex", "pubmed", "crossref"],
    "scopus": ["openalex", "semantic_scholar", "pubmed"],
    "wos": ["scopus", "openalex", "semantic_scholar"],

    // LLM provider fallbacks
    "grok": ["openai", "anthropic"],
    "openai": ["anthropic", "grok"],
    "anthropic": ["openai", "grok"],

    // Document generation fallbacks
    "docx_generator": ["markdown_to_docx", "html_to_docx"],
    "xlsx_generator": ["csv_generator", "json_to_xlsx"],

    // Web search fallbacks
    "serper": ["serpapi", "duckduckgo"],
    "serpapi": ["serper", "duckduckgo"],
};

const DEFAULT_CIRCUIT_CONFIG: CircuitBreakerConfig = {
    failureThreshold: 5,
    successThreshold: 3,
    timeout: 60000, // 1 minute
    monitorInterval: 30000, // 30 seconds
};

class CircuitBreaker extends EventEmitter {
    private state: CircuitState = "CLOSED";
    private failures = 0;
    private successes = 0;
    private lastFailureTime: Date | null = null;
    private lastError: string | null = null;
    private config: CircuitBreakerConfig;
    private serviceName: string;
    private halfOpenTimer: NodeJS.Timeout | null = null;

    constructor(serviceName: string, config: Partial<CircuitBreakerConfig> = {}) {
        super();
        this.serviceName = serviceName;
        this.config = { ...DEFAULT_CIRCUIT_CONFIG, ...config };
    }

    async execute<T>(action: () => Promise<T>): Promise<T> {
        if (this.state === "OPEN") {
            if (this.shouldAttemptReset()) {
                this.state = "HALF_OPEN";
                this.emit("state_change", { service: this.serviceName, state: "HALF_OPEN" });
            } else {
                throw new Error(`Circuit breaker OPEN for ${this.serviceName}`);
            }
        }

        try {
            const result = await action();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure(error as Error);
            throw error;
        }
    }

    private onSuccess(): void {
        this.failures = 0;

        if (this.state === "HALF_OPEN") {
            this.successes++;
            if (this.successes >= this.config.successThreshold) {
                this.state = "CLOSED";
                this.successes = 0;
                this.emit("state_change", { service: this.serviceName, state: "CLOSED" });
                console.log(`[CircuitBreaker] ${this.serviceName} recovered - CLOSED`);
            }
        }
    }

    private onFailure(error: Error): void {
        this.failures++;
        this.lastFailureTime = new Date();
        this.lastError = error.message;

        if (this.state === "HALF_OPEN") {
            this.state = "OPEN";
            this.scheduleHalfOpen();
            this.emit("state_change", { service: this.serviceName, state: "OPEN" });
        } else if (this.failures >= this.config.failureThreshold) {
            this.state = "OPEN";
            this.scheduleHalfOpen();
            this.emit("state_change", { service: this.serviceName, state: "OPEN" });
            console.warn(`[CircuitBreaker] ${this.serviceName} OPEN after ${this.failures} failures`);
        }
    }

    private shouldAttemptReset(): boolean {
        if (!this.lastFailureTime) return true;
        return Date.now() - this.lastFailureTime.getTime() >= this.config.timeout;
    }

    private scheduleHalfOpen(): void {
        if (this.halfOpenTimer) {
            clearTimeout(this.halfOpenTimer);
        }
        this.halfOpenTimer = setTimeout(() => {
            if (this.state === "OPEN") {
                this.state = "HALF_OPEN";
                this.successes = 0;
                this.emit("state_change", { service: this.serviceName, state: "HALF_OPEN" });
            }
        }, this.config.timeout);
    }

    getHealth(): ServiceHealth {
        return {
            name: this.serviceName,
            state: this.state,
            failures: this.failures,
            successes: this.successes,
            lastFailure: this.lastFailureTime,
            lastSuccess: null,
            lastError: this.lastError,
        };
    }

    reset(): void {
        this.state = "CLOSED";
        this.failures = 0;
        this.successes = 0;
        this.lastFailureTime = null;
        this.lastError = null;
        if (this.halfOpenTimer) {
            clearTimeout(this.halfOpenTimer);
            this.halfOpenTimer = null;
        }
    }
}

// Calculate exponential backoff with jitter
function calculateBackoff(attempt: number, baseDelay = 1000, maxDelay = 30000): number {
    const exponentialDelay = Math.min(maxDelay, baseDelay * Math.pow(2, attempt));
    const jitter = Math.random() * 0.3 * exponentialDelay; // 30% jitter
    return Math.floor(exponentialDelay + jitter);
}

// Sleep utility
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Registry of circuit breakers
const circuitBreakers = new Map<string, CircuitBreaker>();

function getCircuitBreaker(serviceName: string): CircuitBreaker {
    if (!circuitBreakers.has(serviceName)) {
        circuitBreakers.set(serviceName, new CircuitBreaker(serviceName));
    }
    return circuitBreakers.get(serviceName)!;
}

// Main self-healing execution function
export async function executeWithHealing<T>(
    serviceName: string,
    action: () => Promise<T>,
    options: {
        maxRetries?: number;
        fallbacks?: string[];
        fallbackExecutor?: (fallbackService: string) => Promise<T>;
        onRetry?: (attempt: number, error: Error) => void;
        onFallback?: (fallbackService: string) => void;
    } = {}
): Promise<{ result: T; usedFallback: boolean; fallbackService?: string; attempts: number }> {
    const {
        maxRetries = 3,
        fallbacks = FALLBACK_CHAINS[serviceName] || [],
        fallbackExecutor,
        onRetry,
        onFallback,
    } = options;

    const breaker = getCircuitBreaker(serviceName);
    let attempts = 0;
    let lastError: Error | null = null;

    // Try primary service with retries
    while (attempts < maxRetries) {
        try {
            const result = await breaker.execute(action);
            return { result, usedFallback: false, attempts: attempts + 1 };
        } catch (error) {
            lastError = error as Error;
            attempts++;

            if (attempts < maxRetries) {
                const delay = calculateBackoff(attempts);
                console.log(`[SelfHealing] ${serviceName} attempt ${attempts} failed, retrying in ${delay}ms`);
                onRetry?.(attempts, lastError);
                await sleep(delay);
            }
        }
    }

    // Try fallback services
    if (fallbackExecutor && fallbacks.length > 0) {
        for (const fallbackService of fallbacks) {
            const fallbackBreaker = getCircuitBreaker(fallbackService);

            // Skip if fallback circuit is open
            if (fallbackBreaker.getHealth().state === "OPEN") {
                console.log(`[SelfHealing] Skipping ${fallbackService} - circuit OPEN`);
                continue;
            }

            try {
                console.log(`[SelfHealing] Trying fallback: ${fallbackService}`);
                onFallback?.(fallbackService);

                const result = await fallbackBreaker.execute(() => fallbackExecutor(fallbackService));
                return {
                    result,
                    usedFallback: true,
                    fallbackService,
                    attempts: attempts + 1
                };
            } catch (error) {
                console.warn(`[SelfHealing] Fallback ${fallbackService} failed:`, (error as Error).message);
            }
        }
    }

    // All attempts exhausted
    throw new Error(
        `[SelfHealing] ${serviceName} failed after ${attempts} attempts and ${fallbacks.length} fallbacks. ` +
        `Last error: ${lastError?.message}`
    );
}

// Get health status of all services
export function getAllServiceHealth(): ServiceHealth[] {
    return Array.from(circuitBreakers.values()).map(cb => cb.getHealth());
}

// Reset a specific circuit breaker
export function resetCircuitBreaker(serviceName: string): void {
    const breaker = circuitBreakers.get(serviceName);
    if (breaker) {
        breaker.reset();
        console.log(`[SelfHealing] Reset circuit breaker for ${serviceName}`);
    }
}

// Reset all circuit breakers
export function resetAllCircuitBreakers(): void {
    circuitBreakers.forEach((breaker, name) => {
        breaker.reset();
    });
    console.log(`[SelfHealing] Reset all ${circuitBreakers.size} circuit breakers`);
}

// Register event listeners for monitoring
export function onCircuitStateChange(
    callback: (event: { service: string; state: CircuitState }) => void
): void {
    circuitBreakers.forEach(breaker => {
        breaker.on("state_change", callback);
    });
}

export default {
    executeWithHealing,
    getAllServiceHealth,
    resetCircuitBreaker,
    resetAllCircuitBreakers,
    onCircuitStateChange,
    FALLBACK_CHAINS,
    calculateBackoff,
};
