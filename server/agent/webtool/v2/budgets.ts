import { z } from "zod";

export const BudgetLimitsSchema = z.object({
  maxPages: z.number().min(1).default(10),
  maxBytes: z.number().min(1).default(5 * 1024 * 1024),
  maxTimeMs: z.number().min(1).default(30000),
});
export type BudgetLimits = z.infer<typeof BudgetLimitsSchema>;

export const ConsumedBudgetSchema = z.object({
  pages: z.number().min(0).default(0),
  bytes: z.number().min(0).default(0),
  timeMs: z.number().min(0).default(0),
});
export type ConsumedBudget = z.infer<typeof ConsumedBudgetSchema>;

export const RemainingBudgetSchema = z.object({
  pages: z.number(),
  bytes: z.number(),
  timeMs: z.number(),
});
export type RemainingBudget = z.infer<typeof RemainingBudgetSchema>;

export const UsagePercentSchema = z.object({
  pages: z.number().min(0).max(100),
  bytes: z.number().min(0).max(100),
  time: z.number().min(0).max(100),
});
export type UsagePercent = z.infer<typeof UsagePercentSchema>;

export const ConsumptionRequestSchema = z.object({
  pages: z.number().min(0).optional(),
  bytes: z.number().min(0).optional(),
  timeMs: z.number().min(0).optional(),
});
export type ConsumptionRequest = z.infer<typeof ConsumptionRequestSchema>;

export const DegradationLevelSchema = z.enum(["none", "light", "moderate", "severe"]);
export type DegradationLevel = z.infer<typeof DegradationLevelSchema>;

export const RequestTypeSchema = z.enum(["page_fetch", "content_extraction", "browser_render", "search"]);
export type RequestType = z.infer<typeof RequestTypeSchema>;

export const DegradationActionSchema = z.enum([
  "proceed",
  "skip_low_priority",
  "limit_content_size",
  "use_fetch_only",
  "abort",
]);
export type DegradationAction = z.infer<typeof DegradationActionSchema>;

export const DegradationResultSchema = z.object({
  level: DegradationLevelSchema,
  action: DegradationActionSchema,
  maxContentBytes: z.number().optional(),
  skipBrowserRendering: z.boolean().default(false),
  priorityThreshold: z.number().min(0).max(1).optional(),
  reason: z.string().optional(),
});
export type DegradationResult = z.infer<typeof DegradationResultSchema>;

export const BudgetTypeSchema = z.enum(["pages", "bytes", "time"]);
export type BudgetType = z.infer<typeof BudgetTypeSchema>;

export const BudgetExceededDetailsSchema = z.object({
  budgetType: BudgetTypeSchema,
  limit: z.number(),
  consumed: z.number(),
  requested: z.number(),
});
export type BudgetExceededDetails = z.infer<typeof BudgetExceededDetailsSchema>;

export class BudgetExceededError extends Error {
  public readonly budgetType: BudgetType;
  public readonly remainingBudget: RemainingBudget;
  public readonly consumedBudget: ConsumedBudget;
  public readonly requestedAmount: ConsumptionRequest;
  public readonly details: BudgetExceededDetails;

  constructor(
    budgetType: BudgetType,
    remainingBudget: RemainingBudget,
    consumedBudget: ConsumedBudget,
    requestedAmount: ConsumptionRequest,
    limits: BudgetLimits
  ) {
    const requested = budgetType === "pages" 
      ? requestedAmount.pages ?? 0
      : budgetType === "bytes"
      ? requestedAmount.bytes ?? 0
      : requestedAmount.timeMs ?? 0;

    const limit = budgetType === "pages"
      ? limits.maxPages
      : budgetType === "bytes"
      ? limits.maxBytes
      : limits.maxTimeMs;

    const consumed = budgetType === "pages"
      ? consumedBudget.pages
      : budgetType === "bytes"
      ? consumedBudget.bytes
      : consumedBudget.timeMs;

    const remaining = budgetType === "pages"
      ? remainingBudget.pages
      : budgetType === "bytes"
      ? remainingBudget.bytes
      : remainingBudget.timeMs;

    super(
      `Budget exceeded for ${budgetType}: requested ${requested}, ` +
      `but only ${remaining} remaining (consumed ${consumed}/${limit})`
    );
    
    this.name = "BudgetExceededError";
    this.budgetType = budgetType;
    this.remainingBudget = remainingBudget;
    this.consumedBudget = consumedBudget;
    this.requestedAmount = requestedAmount;
    this.details = {
      budgetType,
      limit,
      consumed,
      requested,
    };
  }
}

export interface RunBudget {
  runId: string;
  limits: BudgetLimits;
  consumed: ConsumedBudget;
  createdAt: number;
  startTimeMs: number;
}

export const RunBudgetSchema = z.object({
  runId: z.string(),
  limits: BudgetLimitsSchema,
  consumed: ConsumedBudgetSchema,
  createdAt: z.number(),
  startTimeMs: z.number(),
});

export const DEFAULT_BUDGET_LIMITS: BudgetLimits = {
  maxPages: 10,
  maxBytes: 5 * 1024 * 1024,
  maxTimeMs: 30000,
};

const DEGRADATION_THRESHOLD_LIGHT = 0.6;
const DEGRADATION_THRESHOLD_MODERATE = 0.8;
const DEGRADATION_THRESHOLD_SEVERE = 0.95;

const CONTENT_SIZE_LIMIT_MODERATE = 512 * 1024;
const CONTENT_SIZE_LIMIT_SEVERE = 128 * 1024;

export interface BudgetEnforcerOptions {
  defaultLimits: BudgetLimits;
  cleanupIntervalMs: number;
  maxBudgetAgeMs: number;
}

const DEFAULT_ENFORCER_OPTIONS: BudgetEnforcerOptions = {
  defaultLimits: DEFAULT_BUDGET_LIMITS,
  cleanupIntervalMs: 60000,
  maxBudgetAgeMs: 300000,
};

export class BudgetEnforcer {
  private budgets: Map<string, RunBudget> = new Map();
  private options: BudgetEnforcerOptions;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(options: Partial<BudgetEnforcerOptions> = {}) {
    this.options = { ...DEFAULT_ENFORCER_OPTIONS, ...options };
  }

  startCleanup(): void {
    if (this.cleanupInterval) return;
    
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleBudgets();
    }, this.options.cleanupIntervalMs);
    this.cleanupInterval.unref();
  }

  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  private cleanupStaleBudgets(): void {
    const now = Date.now();
    const staleThreshold = now - this.options.maxBudgetAgeMs;
    
    for (const [runId, budget] of this.budgets.entries()) {
      if (budget.createdAt < staleThreshold) {
        this.budgets.delete(runId);
      }
    }
  }

  createBudget(runId: string, limits?: Partial<BudgetLimits>): RunBudget {
    const now = Date.now();
    const fullLimits = BudgetLimitsSchema.parse({
      ...this.options.defaultLimits,
      ...limits,
    });

    const budget: RunBudget = {
      runId,
      limits: fullLimits,
      consumed: { pages: 0, bytes: 0, timeMs: 0 },
      createdAt: now,
      startTimeMs: now,
    };

    this.budgets.set(runId, budget);
    return budget;
  }

  getBudget(runId: string): RunBudget | undefined {
    return this.budgets.get(runId);
  }

  hasBudget(runId: string): boolean {
    return this.budgets.has(runId);
  }

  private getOrCreateBudget(runId: string): RunBudget {
    let budget = this.budgets.get(runId);
    if (!budget) {
      budget = this.createBudget(runId);
    }
    return budget;
  }

  private updateElapsedTime(budget: RunBudget): void {
    const elapsed = Date.now() - budget.startTimeMs;
    budget.consumed.timeMs = elapsed;
  }

  canConsume(runId: string, request: ConsumptionRequest): boolean {
    const budget = this.getOrCreateBudget(runId);
    this.updateElapsedTime(budget);
    
    const { pages = 0, bytes = 0, timeMs = 0 } = request;
    
    const pagesAfter = budget.consumed.pages + pages;
    const bytesAfter = budget.consumed.bytes + bytes;
    const timeAfter = budget.consumed.timeMs + timeMs;
    
    return (
      pagesAfter <= budget.limits.maxPages &&
      bytesAfter <= budget.limits.maxBytes &&
      timeAfter <= budget.limits.maxTimeMs
    );
  }

  consume(runId: string, request: ConsumptionRequest): void {
    const budget = this.getOrCreateBudget(runId);
    this.updateElapsedTime(budget);
    
    const remaining = this.getRemaining(runId);
    const { pages = 0, bytes = 0, timeMs = 0 } = request;

    if (pages > 0 && pages > remaining.pages) {
      throw new BudgetExceededError(
        "pages",
        remaining,
        budget.consumed,
        request,
        budget.limits
      );
    }
    if (bytes > 0 && bytes > remaining.bytes) {
      throw new BudgetExceededError(
        "bytes",
        remaining,
        budget.consumed,
        request,
        budget.limits
      );
    }
    if (timeMs > 0 && timeMs > remaining.timeMs) {
      throw new BudgetExceededError(
        "time",
        remaining,
        budget.consumed,
        request,
        budget.limits
      );
    }

    budget.consumed.pages += pages;
    budget.consumed.bytes += bytes;
  }

  getRemaining(runId: string): RemainingBudget {
    const budget = this.getOrCreateBudget(runId);
    this.updateElapsedTime(budget);
    
    return {
      pages: Math.max(0, budget.limits.maxPages - budget.consumed.pages),
      bytes: Math.max(0, budget.limits.maxBytes - budget.consumed.bytes),
      timeMs: Math.max(0, budget.limits.maxTimeMs - budget.consumed.timeMs),
    };
  }

  getUsagePercent(runId: string): UsagePercent {
    const budget = this.getOrCreateBudget(runId);
    this.updateElapsedTime(budget);
    
    return {
      pages: Math.min(100, (budget.consumed.pages / budget.limits.maxPages) * 100),
      bytes: Math.min(100, (budget.consumed.bytes / budget.limits.maxBytes) * 100),
      time: Math.min(100, (budget.consumed.timeMs / budget.limits.maxTimeMs) * 100),
    };
  }

  isExceeded(runId: string): boolean {
    const budget = this.budgets.get(runId);
    if (!budget) return false;
    
    this.updateElapsedTime(budget);
    
    return (
      budget.consumed.pages > budget.limits.maxPages ||
      budget.consumed.bytes > budget.limits.maxBytes ||
      budget.consumed.timeMs > budget.limits.maxTimeMs
    );
  }

  release(runId: string): void {
    this.budgets.delete(runId);
  }

  getDegradationLevel(runId: string): DegradationLevel {
    const usage = this.getUsagePercent(runId);
    const maxUsage = Math.max(usage.pages, usage.bytes, usage.time) / 100;
    
    if (maxUsage >= DEGRADATION_THRESHOLD_SEVERE) {
      return "severe";
    }
    if (maxUsage >= DEGRADATION_THRESHOLD_MODERATE) {
      return "moderate";
    }
    if (maxUsage >= DEGRADATION_THRESHOLD_LIGHT) {
      return "light";
    }
    return "none";
  }

  applyDegradation(runId: string, requestType: RequestType): DegradationResult {
    const usage = this.getUsagePercent(runId);
    const level = this.getDegradationLevel(runId);
    
    const result: DegradationResult = {
      level,
      action: "proceed",
      skipBrowserRendering: false,
    };

    if (level === "none") {
      return result;
    }

    const pagesUsage = usage.pages / 100;
    const bytesUsage = usage.bytes / 100;
    const timeUsage = usage.time / 100;

    if (level === "severe") {
      if (pagesUsage >= DEGRADATION_THRESHOLD_SEVERE) {
        result.action = "abort";
        result.reason = "Page budget nearly exhausted";
        return result;
      }
      if (bytesUsage >= DEGRADATION_THRESHOLD_SEVERE) {
        result.action = "limit_content_size";
        result.maxContentBytes = CONTENT_SIZE_LIMIT_SEVERE;
        result.reason = "Byte budget nearly exhausted - severely limiting content";
      }
      if (timeUsage >= DEGRADATION_THRESHOLD_SEVERE) {
        result.action = "use_fetch_only";
        result.skipBrowserRendering = true;
        result.reason = "Time budget nearly exhausted - fetch only mode";
      }
      return result;
    }

    if (level === "moderate") {
      if (pagesUsage >= DEGRADATION_THRESHOLD_MODERATE) {
        result.action = "skip_low_priority";
        result.priorityThreshold = 0.5;
        result.reason = "Page budget >80% - skipping low priority URLs";
      }
      if (bytesUsage >= DEGRADATION_THRESHOLD_MODERATE) {
        result.action = "limit_content_size";
        result.maxContentBytes = CONTENT_SIZE_LIMIT_MODERATE;
        result.reason = "Byte budget >80% - limiting content extraction size";
      }
      if (timeUsage >= DEGRADATION_THRESHOLD_MODERATE) {
        result.skipBrowserRendering = true;
        result.action = "use_fetch_only";
        result.reason = "Time budget >80% - skip browser rendering";
      }
      return result;
    }

    if (level === "light") {
      if (requestType === "browser_render" && timeUsage >= DEGRADATION_THRESHOLD_LIGHT) {
        result.skipBrowserRendering = true;
        result.reason = "Time budget >60% - preferring fetch over browser";
      }
      if (requestType === "content_extraction" && bytesUsage >= DEGRADATION_THRESHOLD_LIGHT) {
        result.maxContentBytes = 1024 * 1024;
        result.reason = "Byte budget >60% - moderately limiting content";
      }
    }

    return result;
  }

  getStats(): {
    activeBudgets: number;
    totalBudgetsCreated: number;
  } {
    return {
      activeBudgets: this.budgets.size,
      totalBudgetsCreated: this.budgets.size,
    };
  }

  clear(): void {
    this.budgets.clear();
  }

  destroy(): void {
    this.stopCleanup();
    this.clear();
  }
}

export const budgetEnforcer = new BudgetEnforcer();
