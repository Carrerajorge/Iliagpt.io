import { EventEmitter } from "events";
import { createLogger } from "./structuredLogger";
import { Registry, Counter, Histogram, Gauge } from "prom-client";

const logger = createLogger("self-healing");

export enum ErrorCategory {
  TRANSIENT = "transient",
  CONFIGURATION = "configuration",
  DEPENDENCY = "dependency",
  CODE_BUG = "code_bug",
  UNKNOWN = "unknown",
}

export enum HealingAction {
  RETRY = "RETRY",
  RESTART_SERVICE = "RESTART_SERVICE",
  CLEAR_CACHE = "CLEAR_CACHE",
  RESET_CONNECTION = "RESET_CONNECTION",
  FALLBACK = "FALLBACK",
  ESCALATE = "ESCALATE",
  THROTTLE = "THROTTLE",
  NONE = "NONE",
}

export interface Diagnosis {
  errorId: string;
  category: ErrorCategory;
  serviceName: string;
  errorMessage: string;
  errorCode?: string;
  suggestedActions: HealingAction[];
  confidence: number;
  context: Record<string, any>;
  timestamp: Date;
  isRecurring: boolean;
  occurrenceCount: number;
}

export interface HealingResult {
  success: boolean;
  action: HealingAction;
  diagnosis: Diagnosis;
  durationMs: number;
  error?: string;
  nextAction?: HealingAction;
  shouldEscalate: boolean;
}

export interface HealingEvent {
  id: string;
  timestamp: Date;
  diagnosis: Diagnosis;
  result: HealingResult;
  attemptNumber: number;
}

export interface ErrorPattern {
  serviceName: string;
  errorType: string;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
  healingAttempts: number;
  lastHealingResult?: HealingResult;
}

export interface SelfHealingEvents {
  error_detected: { diagnosis: Diagnosis };
  healing_started: { diagnosis: Diagnosis; action: HealingAction };
  healing_completed: { result: HealingResult };
  healing_failed: { result: HealingResult };
  pattern_detected: { pattern: ErrorPattern };
  escalation_triggered: { diagnosis: Diagnosis; reason: string };
}

export interface HealingHandler {
  action: HealingAction;
  execute: (diagnosis: Diagnosis) => Promise<boolean>;
  isAvailable: () => boolean;
}

const PATTERN_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const PATTERN_THRESHOLD = 3;
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BACKOFF_BASE_MS = 1000;
const MAX_HISTORY_ENTRIES = 500;
const CLEANUP_INTERVAL_MS = 60000;

const metricsRegistry = new Registry();

const healingAttemptsCounter = new Counter({
  name: "self_healing_attempts_total",
  help: "Total number of healing attempts",
  labelNames: ["action", "service", "category"],
  registers: [metricsRegistry],
});

const healingSuccessCounter = new Counter({
  name: "self_healing_success_total",
  help: "Total number of successful healing attempts",
  labelNames: ["action", "service", "category"],
  registers: [metricsRegistry],
});

const escalationsCounter = new Counter({
  name: "self_healing_escalations_total",
  help: "Total number of escalations to humans",
  labelNames: ["service", "category", "reason"],
  registers: [metricsRegistry],
});

const meanTimeToRecoveryHistogram = new Histogram({
  name: "self_healing_recovery_duration_ms",
  help: "Time to recovery in milliseconds",
  labelNames: ["action", "service"],
  buckets: [100, 500, 1000, 2500, 5000, 10000, 30000, 60000],
  registers: [metricsRegistry],
});

const activeErrorsGauge = new Gauge({
  name: "self_healing_active_errors",
  help: "Number of active errors being tracked",
  labelNames: ["service"],
  registers: [metricsRegistry],
});

const patternsDetectedGauge = new Gauge({
  name: "self_healing_patterns_detected",
  help: "Number of error patterns currently detected",
  registers: [metricsRegistry],
});

class SelfHealingEventEmitter extends EventEmitter {
  emit<K extends keyof SelfHealingEvents>(event: K, payload: SelfHealingEvents[K]): boolean {
    return super.emit(event, payload);
  }

  on<K extends keyof SelfHealingEvents>(event: K, listener: (payload: SelfHealingEvents[K]) => void): this {
    return super.on(event, listener);
  }

  once<K extends keyof SelfHealingEvents>(event: K, listener: (payload: SelfHealingEvents[K]) => void): this {
    return super.once(event, listener);
  }
}

const ERROR_SIGNATURES: Array<{
  pattern: RegExp | string;
  category: ErrorCategory;
  actions: HealingAction[];
}> = [
  { pattern: /ECONNRESET|ECONNREFUSED|ETIMEDOUT|socket hang up/i, category: ErrorCategory.TRANSIENT, actions: [HealingAction.RETRY, HealingAction.RESET_CONNECTION] },
  { pattern: /timeout|timed out/i, category: ErrorCategory.TRANSIENT, actions: [HealingAction.RETRY, HealingAction.RESET_CONNECTION] },
  { pattern: /rate limit|too many requests|429/i, category: ErrorCategory.TRANSIENT, actions: [HealingAction.THROTTLE, HealingAction.RETRY] },
  { pattern: /connection pool|pool exhausted/i, category: ErrorCategory.DEPENDENCY, actions: [HealingAction.RESET_CONNECTION, HealingAction.RESTART_SERVICE] },
  { pattern: /cache.*corrupt|invalid cache/i, category: ErrorCategory.DEPENDENCY, actions: [HealingAction.CLEAR_CACHE, HealingAction.RETRY] },
  { pattern: /ENOMEM|out of memory/i, category: ErrorCategory.DEPENDENCY, actions: [HealingAction.CLEAR_CACHE, HealingAction.RESTART_SERVICE] },
  { pattern: /config.*invalid|missing.*config|env.*not set/i, category: ErrorCategory.CONFIGURATION, actions: [HealingAction.ESCALATE] },
  { pattern: /authentication|unauthorized|403|401/i, category: ErrorCategory.CONFIGURATION, actions: [HealingAction.ESCALATE] },
  { pattern: /syntax.*error|type.*error|reference.*error/i, category: ErrorCategory.CODE_BUG, actions: [HealingAction.ESCALATE] },
  { pattern: /assertion|invariant/i, category: ErrorCategory.CODE_BUG, actions: [HealingAction.ESCALATE] },
  { pattern: /database.*connection|pg.*error|postgres/i, category: ErrorCategory.DEPENDENCY, actions: [HealingAction.RESET_CONNECTION, HealingAction.RETRY] },
  { pattern: /redis.*error|NOAUTH|WRONGPASS/i, category: ErrorCategory.DEPENDENCY, actions: [HealingAction.RESET_CONNECTION, HealingAction.RETRY] },
  { pattern: /service.*unavailable|503|502|504/i, category: ErrorCategory.TRANSIENT, actions: [HealingAction.FALLBACK, HealingAction.RETRY] },
  { pattern: /circuit.*open|breaker.*open/i, category: ErrorCategory.DEPENDENCY, actions: [HealingAction.FALLBACK, HealingAction.RETRY] },
];

function generateErrorId(): string {
  return `err_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function extractErrorInfo(error: any): { message: string; code?: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: error.message,
      code: (error as any).code,
      stack: error.stack,
    };
  }
  if (typeof error === "string") {
    return { message: error };
  }
  return { message: String(error) };
}

function classifyError(errorMessage: string): { category: ErrorCategory; actions: HealingAction[]; confidence: number } {
  for (const sig of ERROR_SIGNATURES) {
    const pattern = sig.pattern instanceof RegExp ? sig.pattern : new RegExp(sig.pattern, "i");
    if (pattern.test(errorMessage)) {
      return {
        category: sig.category,
        actions: sig.actions,
        confidence: 0.8,
      };
    }
  }

  return {
    category: ErrorCategory.UNKNOWN,
    actions: [HealingAction.ESCALATE],
    confidence: 0.3,
  };
}

function calculateBackoffDelay(attempt: number): number {
  const jitter = Math.random() * 0.3 + 0.85;
  return Math.min(RETRY_BACKOFF_BASE_MS * Math.pow(2, attempt) * jitter, 30000);
}

export class SelfHealingManager {
  private events: SelfHealingEventEmitter = new SelfHealingEventEmitter();
  private errorPatterns: Map<string, ErrorPattern> = new Map();
  private healingHistory: HealingEvent[] = [];
  private healingHandlers: Map<HealingAction, HealingHandler> = new Map();
  private cleanupIntervalId: NodeJS.Timeout | null = null;
  private isShuttingDown: boolean = false;
  private activeHealings: Map<string, Diagnosis> = new Map();

  constructor() {
    this.registerDefaultHandlers();
    this.startCleanupInterval();
    logger.info("SelfHealingManager initialized");
  }

  private registerDefaultHandlers(): void {
    this.registerHandler({
      action: HealingAction.RETRY,
      execute: async (diagnosis: Diagnosis) => {
        logger.info(`Executing RETRY for ${diagnosis.serviceName}`, { errorId: diagnosis.errorId });
        await this.sleep(calculateBackoffDelay(diagnosis.occurrenceCount));
        return true;
      },
      isAvailable: () => true,
    });

    this.registerHandler({
      action: HealingAction.CLEAR_CACHE,
      execute: async (diagnosis: Diagnosis) => {
        logger.info(`Executing CLEAR_CACHE for ${diagnosis.serviceName}`, { errorId: diagnosis.errorId });
        return true;
      },
      isAvailable: () => true,
    });

    this.registerHandler({
      action: HealingAction.RESET_CONNECTION,
      execute: async (diagnosis: Diagnosis) => {
        logger.info(`Executing RESET_CONNECTION for ${diagnosis.serviceName}`, { errorId: diagnosis.errorId });
        return true;
      },
      isAvailable: () => true,
    });

    this.registerHandler({
      action: HealingAction.THROTTLE,
      execute: async (diagnosis: Diagnosis) => {
        logger.info(`Executing THROTTLE for ${diagnosis.serviceName}`, { errorId: diagnosis.errorId });
        const delay = 5000 + Math.random() * 5000;
        await this.sleep(delay);
        return true;
      },
      isAvailable: () => true,
    });

    this.registerHandler({
      action: HealingAction.FALLBACK,
      execute: async (diagnosis: Diagnosis) => {
        logger.info(`Executing FALLBACK for ${diagnosis.serviceName}`, { errorId: diagnosis.errorId });
        return true;
      },
      isAvailable: () => true,
    });

    this.registerHandler({
      action: HealingAction.RESTART_SERVICE,
      execute: async (diagnosis: Diagnosis) => {
        logger.warn(`RESTART_SERVICE requested for ${diagnosis.serviceName} - escalating`, { errorId: diagnosis.errorId });
        return false;
      },
      isAvailable: () => false,
    });

    this.registerHandler({
      action: HealingAction.ESCALATE,
      execute: async (diagnosis: Diagnosis) => {
        logger.warn(`ESCALATE triggered for ${diagnosis.serviceName}`, {
          errorId: diagnosis.errorId,
          category: diagnosis.category,
          message: diagnosis.errorMessage,
        });
        escalationsCounter.inc({
          service: diagnosis.serviceName,
          category: diagnosis.category,
          reason: "manual_escalation",
        });
        return true;
      },
      isAvailable: () => true,
    });
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private startCleanupInterval(): void {
    this.cleanupIntervalId = setInterval(() => {
      this.cleanupOldPatterns();
      this.cleanupHistory();
    }, CLEANUP_INTERVAL_MS);
    this.cleanupIntervalId.unref();
  }

  private cleanupOldPatterns(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, pattern] of this.errorPatterns) {
      if (now - pattern.lastSeen.getTime() > PATTERN_WINDOW_MS * 2) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.errorPatterns.delete(key);
    }

    patternsDetectedGauge.set(this.errorPatterns.size);
  }

  private cleanupHistory(): void {
    if (this.healingHistory.length > MAX_HISTORY_ENTRIES) {
      this.healingHistory = this.healingHistory.slice(-MAX_HISTORY_ENTRIES);
    }
  }

  registerHandler(handler: HealingHandler): void {
    this.healingHandlers.set(handler.action, handler);
    logger.debug(`Registered healing handler for ${handler.action}`);
  }

  registerCustomHandler(action: HealingAction, execute: (diagnosis: Diagnosis) => Promise<boolean>): void {
    this.registerHandler({
      action,
      execute,
      isAvailable: () => true,
    });
  }

  diagnose(error: any, serviceName: string = "unknown", context: Record<string, any> = {}): Diagnosis {
    const errorInfo = extractErrorInfo(error);
    const classification = classifyError(errorInfo.message);
    const patternKey = `${serviceName}:${classification.category}:${errorInfo.code || "no_code"}`;
    
    const existingPattern = this.errorPatterns.get(patternKey);
    const now = new Date();
    
    let occurrenceCount = 1;
    let isRecurring = false;

    if (existingPattern) {
      const timeSinceFirst = now.getTime() - existingPattern.firstSeen.getTime();
      if (timeSinceFirst <= PATTERN_WINDOW_MS) {
        occurrenceCount = existingPattern.count + 1;
        isRecurring = occurrenceCount >= PATTERN_THRESHOLD;
      }
    }

    const diagnosis: Diagnosis = {
      errorId: generateErrorId(),
      category: classification.category,
      serviceName,
      errorMessage: errorInfo.message,
      errorCode: errorInfo.code,
      suggestedActions: classification.actions,
      confidence: classification.confidence,
      context: {
        ...context,
        stack: errorInfo.stack,
      },
      timestamp: now,
      isRecurring,
      occurrenceCount,
    };

    this.updatePattern(patternKey, diagnosis);
    this.events.emit("error_detected", { diagnosis });
    activeErrorsGauge.inc({ service: serviceName });

    logger.info(`Error diagnosed`, {
      errorId: diagnosis.errorId,
      category: diagnosis.category,
      service: serviceName,
      isRecurring,
      occurrenceCount,
      suggestedActions: diagnosis.suggestedActions,
    });

    return diagnosis;
  }

  private updatePattern(patternKey: string, diagnosis: Diagnosis): void {
    const existing = this.errorPatterns.get(patternKey);
    const now = new Date();

    if (existing) {
      const timeSinceFirst = now.getTime() - existing.firstSeen.getTime();
      
      if (timeSinceFirst > PATTERN_WINDOW_MS) {
        this.errorPatterns.set(patternKey, {
          serviceName: diagnosis.serviceName,
          errorType: diagnosis.category,
          count: 1,
          firstSeen: now,
          lastSeen: now,
          healingAttempts: 0,
        });
      } else {
        existing.count++;
        existing.lastSeen = now;
        
        if (existing.count === PATTERN_THRESHOLD) {
          this.events.emit("pattern_detected", { pattern: existing });
          logger.warn(`Error pattern detected`, {
            service: diagnosis.serviceName,
            category: diagnosis.category,
            count: existing.count,
          });
        }
      }
    } else {
      this.errorPatterns.set(patternKey, {
        serviceName: diagnosis.serviceName,
        errorType: diagnosis.category,
        count: 1,
        firstSeen: now,
        lastSeen: now,
        healingAttempts: 0,
      });
    }

    patternsDetectedGauge.set(this.errorPatterns.size);
  }

  async heal(diagnosis: Diagnosis): Promise<HealingResult> {
    const startTime = Date.now();
    
    if (this.activeHealings.has(diagnosis.errorId)) {
      logger.debug(`Healing already in progress for ${diagnosis.errorId}`);
      return {
        success: false,
        action: HealingAction.NONE,
        diagnosis,
        durationMs: 0,
        error: "Healing already in progress",
        shouldEscalate: false,
      };
    }

    this.activeHealings.set(diagnosis.errorId, diagnosis);

    try {
      for (const action of diagnosis.suggestedActions) {
        const handler = this.healingHandlers.get(action);
        
        if (!handler || !handler.isAvailable()) {
          continue;
        }

        healingAttemptsCounter.inc({
          action,
          service: diagnosis.serviceName,
          category: diagnosis.category,
        });

        this.events.emit("healing_started", { diagnosis, action });
        logger.info(`Starting healing action ${action}`, { errorId: diagnosis.errorId });

        try {
          const success = await handler.execute(diagnosis);
          const durationMs = Date.now() - startTime;

          const result: HealingResult = {
            success,
            action,
            diagnosis,
            durationMs,
            shouldEscalate: !success && action === HealingAction.ESCALATE,
          };

          if (success) {
            healingSuccessCounter.inc({
              action,
              service: diagnosis.serviceName,
              category: diagnosis.category,
            });
            meanTimeToRecoveryHistogram.observe(
              { action, service: diagnosis.serviceName },
              durationMs
            );
            activeErrorsGauge.dec({ service: diagnosis.serviceName });

            this.events.emit("healing_completed", { result });
            this.addToHistory(diagnosis, result);

            logger.info(`Healing successful`, {
              errorId: diagnosis.errorId,
              action,
              durationMs,
            });

            return result;
          }
        } catch (healingError: any) {
          logger.error(`Healing action ${action} failed`, {
            errorId: diagnosis.errorId,
            error: healingError.message,
          });
        }
      }

      const durationMs = Date.now() - startTime;
      const result: HealingResult = {
        success: false,
        action: HealingAction.ESCALATE,
        diagnosis,
        durationMs,
        error: "All healing actions exhausted",
        shouldEscalate: true,
      };

      escalationsCounter.inc({
        service: diagnosis.serviceName,
        category: diagnosis.category,
        reason: "healing_exhausted",
      });

      this.events.emit("healing_failed", { result });
      this.events.emit("escalation_triggered", {
        diagnosis,
        reason: "All healing actions exhausted",
      });
      this.addToHistory(diagnosis, result);

      logger.warn(`All healing actions exhausted, escalating`, {
        errorId: diagnosis.errorId,
        service: diagnosis.serviceName,
      });

      return result;

    } finally {
      this.activeHealings.delete(diagnosis.errorId);
    }
  }

  private addToHistory(diagnosis: Diagnosis, result: HealingResult): void {
    const patternKey = `${diagnosis.serviceName}:${diagnosis.category}:${diagnosis.errorCode || "no_code"}`;
    const pattern = this.errorPatterns.get(patternKey);
    
    if (pattern) {
      pattern.healingAttempts++;
      pattern.lastHealingResult = result;
    }

    this.healingHistory.push({
      id: `heal_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      timestamp: new Date(),
      diagnosis,
      result,
      attemptNumber: pattern?.healingAttempts || 1,
    });
  }

  async tryAutoHeal(error: any, serviceName: string = "unknown", context: Record<string, any> = {}): Promise<boolean> {
    const diagnosis = this.diagnose(error, serviceName, context);

    if (diagnosis.category === ErrorCategory.CODE_BUG) {
      logger.info(`Skipping auto-heal for code bug, escalating`, { errorId: diagnosis.errorId });
      escalationsCounter.inc({
        service: serviceName,
        category: diagnosis.category,
        reason: "code_bug_detected",
      });
      return false;
    }

    if (diagnosis.category === ErrorCategory.CONFIGURATION) {
      logger.info(`Skipping auto-heal for configuration error, escalating`, { errorId: diagnosis.errorId });
      escalationsCounter.inc({
        service: serviceName,
        category: diagnosis.category,
        reason: "config_error_detected",
      });
      return false;
    }

    if (diagnosis.occurrenceCount > MAX_RETRY_ATTEMPTS && diagnosis.isRecurring) {
      logger.warn(`Max retry attempts reached, escalating`, {
        errorId: diagnosis.errorId,
        occurrenceCount: diagnosis.occurrenceCount,
      });
      escalationsCounter.inc({
        service: serviceName,
        category: diagnosis.category,
        reason: "max_retries_exceeded",
      });
      return false;
    }

    const result = await this.heal(diagnosis);
    return result.success;
  }

  getHealingHistory(): HealingEvent[] {
    return [...this.healingHistory];
  }

  getActivePatterns(): ErrorPattern[] {
    return Array.from(this.errorPatterns.values());
  }

  getStatistics(): {
    totalHealingAttempts: number;
    successfulHealings: number;
    activePatterns: number;
    activeHealings: number;
    historySize: number;
  } {
    const successful = this.healingHistory.filter((h) => h.result.success).length;
    
    return {
      totalHealingAttempts: this.healingHistory.length,
      successfulHealings: successful,
      activePatterns: this.errorPatterns.size,
      activeHealings: this.activeHealings.size,
      historySize: this.healingHistory.length,
    };
  }

  on<K extends keyof SelfHealingEvents>(event: K, listener: (payload: SelfHealingEvents[K]) => void): this {
    this.events.on(event, listener);
    return this;
  }

  once<K extends keyof SelfHealingEvents>(event: K, listener: (payload: SelfHealingEvents[K]) => void): this {
    this.events.once(event, listener);
    return this;
  }

  off<K extends keyof SelfHealingEvents>(event: K, listener: (payload: SelfHealingEvents[K]) => void): this {
    this.events.off(event, listener);
    return this;
  }

  clearPattern(serviceName: string): void {
    const keysToDelete: string[] = [];
    
    for (const key of this.errorPatterns.keys()) {
      if (key.startsWith(`${serviceName}:`)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.errorPatterns.delete(key);
    }

    patternsDetectedGauge.set(this.errorPatterns.size);
    logger.info(`Cleared patterns for service: ${serviceName}`, { count: keysToDelete.length });
  }

  clearAllPatterns(): void {
    this.errorPatterns.clear();
    patternsDetectedGauge.set(0);
    logger.info("Cleared all error patterns");
  }

  shutdown(): void {
    this.isShuttingDown = true;
    
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }

    this.events.removeAllListeners();
    logger.info("SelfHealingManager shut down");
  }
}

const selfHealingManager = new SelfHealingManager();

export function diagnoseError(error: any, serviceName?: string, context?: Record<string, any>): Diagnosis {
  return selfHealingManager.diagnose(error, serviceName, context);
}

export async function tryAutoHeal(error: any, serviceName?: string, context?: Record<string, any>): Promise<boolean> {
  return selfHealingManager.tryAutoHeal(error, serviceName, context);
}

export function getSelfHealingManager(): SelfHealingManager {
  return selfHealingManager;
}

export function getSelfHealingMetrics(): Registry {
  return metricsRegistry;
}

export async function getSelfHealingMetricsText(): Promise<string> {
  return metricsRegistry.metrics();
}

export { SelfHealingManager };
