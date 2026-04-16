/**
 * Self-Healing System for ILIAGPT PRO
 * 
 * Autonomous error detection, diagnosis, and remediation system.
 * Learns from failures to improve future execution.
 */

import { EventEmitter } from "events";
import { randomUUID } from "crypto";

// ============================================
// Types and Interfaces
// ============================================

export interface ErrorPattern {
    id: string;
    pattern: RegExp;
    category: ErrorCategory;
    severity: "low" | "medium" | "high" | "critical";
    remediation: RemediationStrategy;
    successRate: number;
    occurrences: number;
    lastSeen: Date;
}

export type ErrorCategory =
    | "network"
    | "api"
    | "validation"
    | "resource"
    | "timeout"
    | "authentication"
    | "rate_limit"
    | "data_format"
    | "dependency"
    | "memory"
    | "unknown";

export interface RemediationStrategy {
    type: "retry" | "fallback" | "parameter_adjust" | "resource_cleanup" | "escalate" | "skip" | "cache_bust";
    maxAttempts: number;
    delayMs: number;
    backoffMultiplier: number;
    action: (context: ExecutionContext, error: Error) => Promise<RemediationResult>;
}

export interface ExecutionContext {
    runId: string;
    stepIndex: number;
    toolName: string;
    parameters: Record<string, any>;
    previousAttempts: number;
    history: ExecutionHistoryItem[];
    metadata: Record<string, any>;
}

export interface ExecutionHistoryItem {
    timestamp: Date;
    action: string;
    success: boolean;
    error?: string;
    duration: number;
}

export interface Diagnosis {
    errorId: string;
    category: ErrorCategory;
    rootCause: string;
    confidence: number;
    suggestedRemediation: RemediationStrategy;
    relatedPatterns: string[];
    context: Record<string, any>;
}

export interface RemediationResult {
    success: boolean;
    action: string;
    modifiedParameters?: Record<string, any>;
    fallbackValue?: any;
    shouldRetry: boolean;
    nextDelay?: number;
    message: string;
}

export interface FailureRecord {
    id: string;
    error: Error;
    context: ExecutionContext;
    diagnosis: Diagnosis;
    remediationAttempts: RemediationAttempt[];
    finalOutcome: "resolved" | "escalated" | "skipped" | "failed";
    timestamp: Date;
}

export interface RemediationAttempt {
    strategy: RemediationStrategy["type"];
    success: boolean;
    duration: number;
    error?: string;
}

// ============================================
// Error Pattern Database
// ============================================

const DEFAULT_ERROR_PATTERNS: Omit<ErrorPattern, "id" | "successRate" | "occurrences" | "lastSeen">[] = [
    // Network errors
    {
        pattern: /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network|fetch failed/i,
        category: "network",
        severity: "medium",
        remediation: {
            type: "retry",
            maxAttempts: 3,
            delayMs: 2000,
            backoffMultiplier: 2,
            action: async (ctx) => ({
                success: true,
                action: "Retrying with exponential backoff",
                shouldRetry: true,
                nextDelay: 2000 * Math.pow(2, ctx.previousAttempts),
                message: `Network error, retry attempt ${ctx.previousAttempts + 1}`
            })
        }
    },

    // Rate limiting
    {
        pattern: /rate limit|429|too many requests|quota exceeded/i,
        category: "rate_limit",
        severity: "medium",
        remediation: {
            type: "retry",
            maxAttempts: 5,
            delayMs: 60000,
            backoffMultiplier: 1.5,
            action: async (ctx) => ({
                success: true,
                action: "Waiting for rate limit reset",
                shouldRetry: true,
                nextDelay: 60000 + (ctx.previousAttempts * 30000),
                message: `Rate limited, waiting ${60 + ctx.previousAttempts * 30}s`
            })
        }
    },

    // API errors
    {
        pattern: /API error|500|502|503|504|internal server error/i,
        category: "api",
        severity: "high",
        remediation: {
            type: "fallback",
            maxAttempts: 2,
            delayMs: 5000,
            backoffMultiplier: 2,
            action: async (ctx) => ({
                success: true,
                action: "Trying fallback provider",
                modifiedParameters: { ...ctx.parameters, useFallback: true },
                shouldRetry: true,
                message: "API error, switching to fallback"
            })
        }
    },

    // Authentication
    {
        pattern: /unauthorized|401|403|forbidden|invalid.*token|expired.*token/i,
        category: "authentication",
        severity: "high",
        remediation: {
            type: "cache_bust",
            maxAttempts: 1,
            delayMs: 0,
            backoffMultiplier: 1,
            action: async (ctx) => ({
                success: false,
                action: "Authentication failed, escalating",
                shouldRetry: false,
                message: "Authentication error - requires manual intervention"
            })
        }
    },

    // Timeout
    {
        pattern: /timeout|timed out|DEADLINE_EXCEEDED/i,
        category: "timeout",
        severity: "medium",
        remediation: {
            type: "parameter_adjust",
            maxAttempts: 2,
            delayMs: 1000,
            backoffMultiplier: 1,
            action: async (ctx) => ({
                success: true,
                action: "Adjusting timeout and retrying",
                modifiedParameters: {
                    ...ctx.parameters,
                    timeout: (ctx.parameters.timeout || 30000) * 2,
                    maxTokens: Math.floor((ctx.parameters.maxTokens || 4096) * 0.7)
                },
                shouldRetry: true,
                message: "Timeout, reducing payload and extending timeout"
            })
        }
    },

    // Validation errors
    {
        pattern: /validation|invalid.*input|missing.*required|schema.*error/i,
        category: "validation",
        severity: "low",
        remediation: {
            type: "parameter_adjust",
            maxAttempts: 2,
            delayMs: 0,
            backoffMultiplier: 1,
            action: async (ctx) => ({
                success: true,
                action: "Sanitizing parameters",
                modifiedParameters: sanitizeParameters(ctx.parameters),
                shouldRetry: true,
                message: "Validation error, attempting to fix parameters"
            })
        }
    },

    // Data format
    {
        pattern: /JSON.*parse|unexpected.*token|invalid.*format|malformed/i,
        category: "data_format",
        severity: "medium",
        remediation: {
            type: "parameter_adjust",
            maxAttempts: 2,
            delayMs: 0,
            backoffMultiplier: 1,
            action: async (ctx) => ({
                success: true,
                action: "Attempting JSON repair",
                modifiedParameters: { ...ctx.parameters, strictParsing: false },
                shouldRetry: true,
                message: "Data format error, attempting repair"
            })
        }
    },

    // Memory/Resource
    {
        pattern: /out of memory|heap|ENOMEM|resource.*exhausted/i,
        category: "memory",
        severity: "critical",
        remediation: {
            type: "resource_cleanup",
            maxAttempts: 1,
            delayMs: 5000,
            backoffMultiplier: 1,
            action: async (ctx) => {
                // Trigger garbage collection if available
                if (global.gc) {
                    global.gc();
                }
                return {
                    success: true,
                    action: "Memory cleanup performed",
                    modifiedParameters: {
                        ...ctx.parameters,
                        batchSize: Math.floor((ctx.parameters.batchSize || 100) / 2)
                    },
                    shouldRetry: true,
                    message: "Memory pressure, reducing batch size"
                };
            }
        }
    },

    // Dependency errors
    {
        pattern: /dependency.*failed|upstream.*error|service.*unavailable/i,
        category: "dependency",
        severity: "high",
        remediation: {
            type: "skip",
            maxAttempts: 1,
            delayMs: 0,
            backoffMultiplier: 1,
            action: async () => ({
                success: true,
                action: "Skipping dependent step",
                shouldRetry: false,
                fallbackValue: null,
                message: "Dependency unavailable, skipping step"
            })
        }
    }
];

// ============================================
// Helper Functions
// ============================================

function sanitizeParameters(params: Record<string, any>): Record<string, any> {
    const sanitized = { ...params };

    // Remove null/undefined values
    for (const key of Object.keys(sanitized)) {
        if (sanitized[key] === null || sanitized[key] === undefined) {
            delete sanitized[key];
        }
        // Truncate overly long strings
        if (typeof sanitized[key] === "string" && sanitized[key].length > 10000) {
            sanitized[key] = sanitized[key].substring(0, 10000) + "...";
        }
    }

    return sanitized;
}

// ============================================
// Self-Healing System Class
// ============================================

export class SelfHealingSystem extends EventEmitter {
    private errorPatterns: Map<string, ErrorPattern>;
    private failureHistory: FailureRecord[];
    private maxHistorySize: number;
    private learningEnabled: boolean;

    constructor(options: { maxHistorySize?: number; learningEnabled?: boolean } = {}) {
        super();
        this.errorPatterns = new Map();
        this.failureHistory = [];
        this.maxHistorySize = options.maxHistorySize || 1000;
        this.learningEnabled = options.learningEnabled ?? true;

        // Initialize with default patterns
        this.initializePatterns();
    }

    private initializePatterns(): void {
        for (const pattern of DEFAULT_ERROR_PATTERNS) {
            const id = randomUUID();
            this.errorPatterns.set(id, {
                ...pattern,
                id,
                successRate: 0.5,
                occurrences: 0,
                lastSeen: new Date()
            });
        }
    }

    /**
     * Diagnose an error and identify root cause
     */
    async diagnose(error: Error, context: ExecutionContext): Promise<Diagnosis> {
        const errorMessage = error.message + (error.stack || "");

        // Find matching patterns
        const matchedPatterns: ErrorPattern[] = [];
        for (const pattern of Array.from(this.errorPatterns.values())) {
            if (pattern.pattern.test(errorMessage)) {
                matchedPatterns.push(pattern);
                pattern.occurrences++;
                pattern.lastSeen = new Date();
            }
        }

        // Sort by severity and success rate
        matchedPatterns.sort((a, b) => {
            const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
            const severityDiff = severityOrder[b.severity] - severityOrder[a.severity];
            if (severityDiff !== 0) return severityDiff;
            return b.successRate - a.successRate;
        });

        const primaryPattern = matchedPatterns[0];

        const diagnosis: Diagnosis = {
            errorId: randomUUID(),
            category: primaryPattern?.category || "unknown",
            rootCause: this.inferRootCause(error, context, primaryPattern),
            confidence: primaryPattern ? Math.min(0.9, primaryPattern.successRate + 0.3) : 0.3,
            suggestedRemediation: primaryPattern?.remediation || this.getDefaultRemediation(),
            relatedPatterns: matchedPatterns.map(p => p.id),
            context: {
                toolName: context.toolName,
                previousAttempts: context.previousAttempts,
                errorType: error.constructor.name
            }
        };

        this.emit("diagnosis", { error, diagnosis, context });

        return diagnosis;
    }

    private inferRootCause(error: Error, context: ExecutionContext, pattern?: ErrorPattern): string {
        if (pattern) {
            const causes: Record<ErrorCategory, string> = {
                network: "Network connectivity issue or service unreachable",
                api: "External API service error or degradation",
                validation: "Invalid input parameters or data format",
                resource: "System resource exhaustion or limit reached",
                timeout: "Operation exceeded time limit, possibly due to large payload",
                authentication: "Authentication credentials invalid or expired",
                rate_limit: "API rate limit exceeded, too many requests",
                data_format: "Response data in unexpected format",
                dependency: "Dependent service or component unavailable",
                memory: "System memory pressure or allocation failure",
                unknown: "Unidentified error pattern"
            };
            return causes[pattern.category];
        }

        return `Unknown error in ${context.toolName}: ${error.message.substring(0, 100)}`;
    }

    private getDefaultRemediation(): RemediationStrategy {
        return {
            type: "retry",
            maxAttempts: 2,
            delayMs: 1000,
            backoffMultiplier: 2,
            action: async () => ({
                success: false,
                action: "Default retry",
                shouldRetry: true,
                message: "Attempting default retry strategy"
            })
        };
    }

    /**
     * Attempt to heal/remediate the error
     */
    async heal(diagnosis: Diagnosis, context: ExecutionContext): Promise<RemediationResult> {
        const strategy = diagnosis.suggestedRemediation;
        const startTime = Date.now();

        this.emit("healing_start", { diagnosis, context });

        if (context.previousAttempts >= strategy.maxAttempts) {
            const result: RemediationResult = {
                success: false,
                action: "escalate",
                shouldRetry: false,
                message: `Max remediation attempts (${strategy.maxAttempts}) reached, escalating`
            };
            this.emit("healing_failed", { diagnosis, result, context });
            return result;
        }

        try {
            // Apply delay if needed
            if (strategy.delayMs > 0 && context.previousAttempts > 0) {
                const delay = strategy.delayMs * Math.pow(strategy.backoffMultiplier, context.previousAttempts - 1);
                await new Promise(resolve => setTimeout(resolve, delay));
            }

            // Execute remediation action
            const result = await strategy.action(context, new Error(diagnosis.rootCause));

            this.emit("healing_complete", { diagnosis, result, context, duration: Date.now() - startTime });

            // Update pattern success rate if learning is enabled
            if (this.learningEnabled) {
                this.updatePatternStats(diagnosis.relatedPatterns, result.success);
            }

            return result;
        } catch (error) {
            const result: RemediationResult = {
                success: false,
                action: strategy.type,
                shouldRetry: false,
                message: `Remediation failed: ${error instanceof Error ? error.message : String(error)}`
            };
            this.emit("healing_error", { diagnosis, error, context });
            return result;
        }
    }

    /**
     * Learn from a failure to improve future remediations
     */
    learnFromFailure(record: FailureRecord): void {
        if (!this.learningEnabled) return;

        // Add to history
        this.failureHistory.push(record);
        if (this.failureHistory.length > this.maxHistorySize) {
            this.failureHistory.shift();
        }

        // Analyze if we should create a new pattern
        const similarFailures = this.failureHistory.filter(f =>
            f.context.toolName === record.context.toolName &&
            f.diagnosis.category === record.diagnosis.category
        );

        // If we see the same failure type multiple times, adjust success rates
        if (similarFailures.length >= 3) {
            const successCount = similarFailures.filter(f => f.finalOutcome === "resolved").length;
            const successRate = successCount / similarFailures.length;

            // Update related patterns
            for (const patternId of record.diagnosis.relatedPatterns) {
                const pattern = this.errorPatterns.get(patternId);
                if (pattern) {
                    // Exponential moving average
                    pattern.successRate = pattern.successRate * 0.7 + successRate * 0.3;
                }
            }
        }

        this.emit("learned", { record, similarCount: similarFailures.length });
    }

    private updatePatternStats(patternIds: string[], success: boolean): void {
        for (const id of patternIds) {
            const pattern = this.errorPatterns.get(id);
            if (pattern) {
                // Update success rate with exponential moving average
                const weight = Math.min(0.1, 1 / (pattern.occurrences + 1));
                pattern.successRate = pattern.successRate * (1 - weight) + (success ? 1 : 0) * weight;
            }
        }
    }

    /**
     * Get healing statistics
     */
    getStats(): {
        totalPatterns: number;
        totalFailures: number;
        resolutionRate: number;
        topCategories: Array<{ category: ErrorCategory; count: number }>;
        recentFailures: number;
    } {
        const resolved = this.failureHistory.filter(f => f.finalOutcome === "resolved").length;

        const categoryCounts = new Map<ErrorCategory, number>();
        for (const failure of this.failureHistory) {
            const count = categoryCounts.get(failure.diagnosis.category) || 0;
            categoryCounts.set(failure.diagnosis.category, count + 1);
        }

        const topCategories = Array.from(categoryCounts.entries())
            .map(([category, count]) => ({ category, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);

        const oneHourAgo = Date.now() - 3600000;
        const recentFailures = this.failureHistory.filter(f =>
            f.timestamp.getTime() > oneHourAgo
        ).length;

        return {
            totalPatterns: this.errorPatterns.size,
            totalFailures: this.failureHistory.length,
            resolutionRate: this.failureHistory.length > 0 ? resolved / this.failureHistory.length : 0,
            topCategories,
            recentFailures
        };
    }

    /**
     * Add a custom error pattern
     */
    addPattern(pattern: Omit<ErrorPattern, "id" | "successRate" | "occurrences" | "lastSeen">): string {
        const id = randomUUID();
        this.errorPatterns.set(id, {
            ...pattern,
            id,
            successRate: 0.5,
            occurrences: 0,
            lastSeen: new Date()
        });
        return id;
    }

    /**
     * Process an error through the full diagnosis-heal cycle
     */
    async processError(
        error: Error,
        context: ExecutionContext
    ): Promise<{ diagnosis: Diagnosis; remediation: RemediationResult }> {
        const diagnosis = await this.diagnose(error, context);
        const remediation = await this.heal(diagnosis, context);

        // Record the failure
        const record: FailureRecord = {
            id: randomUUID(),
            error,
            context,
            diagnosis,
            remediationAttempts: [{
                strategy: diagnosis.suggestedRemediation.type,
                success: remediation.success,
                duration: 0
            }],
            finalOutcome: remediation.success ? "resolved" :
                remediation.shouldRetry ? "failed" : "escalated",
            timestamp: new Date()
        };

        this.learnFromFailure(record);

        return { diagnosis, remediation };
    }
}

// Singleton instance
let selfHealingInstance: SelfHealingSystem | null = null;

export function getSelfHealingSystem(): SelfHealingSystem {
    if (!selfHealingInstance) {
        selfHealingInstance = new SelfHealingSystem();
    }
    return selfHealingInstance;
}

export default SelfHealingSystem;
