import { z } from "zod";
import crypto from "crypto";
import { executeRealHandler, hasRealHandler, RealToolResult } from "./realToolHandlers";
import {
  CircuitBreaker,
  CircuitBreakerConfig,
  CircuitState,
  globalHealthManager,
  getOrCreateCircuitBreaker,
  getAllResilienceMetrics,
} from "./resilience";

export interface StrictE2EResult {
  toolName: string;
  input: unknown;
  output: unknown;
  schemaValidation: "pass" | "fail";
  requestId: string;
  durationMs: number;
  retryCount: number;
  replanEvents: string[];
  validationPassed: boolean;
  artifacts?: string[];
  errorStack?: string;
}

export const ToolErrorCodeSchema = z.enum([
  "VALIDATION_ERROR",
  "TIMEOUT_ERROR",
  "RATE_LIMIT_ERROR",
  "EXECUTION_ERROR",
  "NOT_FOUND_ERROR",
  "PERMISSION_ERROR",
  "DEPENDENCY_ERROR",
  "NETWORK_ERROR",
  "INTERNAL_ERROR",
]);

export type ToolErrorCode = z.infer<typeof ToolErrorCodeSchema>;

export interface ToolError {
  code: ToolErrorCode;
  message: string;
  details?: Record<string, unknown>;
  retryable: boolean;
}

export const ToolConfigSchema = z.object({
  timeout: z.number().min(100).max(300000).default(30000),
  maxRetries: z.number().min(0).max(10).default(3),
  retryDelay: z.number().min(100).max(60000).default(1000),
  rateLimitPerMinute: z.number().min(1).max(1000).default(60),
  rateLimitPerHour: z.number().min(1).max(10000).default(1000),
});

export type ToolConfig = z.infer<typeof ToolConfigSchema>;

export const ToolImplementationStatus = {
  IMPLEMENTED: "implemented",
  STUB: "stub", 
  DISABLED: "disabled",
} as const;

export type ToolImplementationStatusType = typeof ToolImplementationStatus[keyof typeof ToolImplementationStatus];

export const ToolMetadataSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().min(10).max(1000),
  category: z.string(),
  version: z.string().default("1.0.0"),
  author: z.string().default("system"),
  tags: z.array(z.string()).default([]),
  deprecated: z.boolean().default(false),
  experimental: z.boolean().default(false),
  implementationStatus: z.enum(["implemented", "stub", "disabled"]).default("implemented"),
  requiresCredentials: z.array(z.string()).default([]),
});

export type ToolMetadata = z.infer<typeof ToolMetadataSchema>;

export interface ToolCallTrace {
  requestId: string;
  toolName: string;
  category: string;
  args: Record<string, unknown>;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  status: "pending" | "success" | "error" | "timeout" | "rate_limited";
  error?: ToolError;
  output?: unknown;
  retryCount: number;
  metadata?: Record<string, unknown>;
}

export interface RegisteredTool<TInput = unknown, TOutput = unknown> {
  metadata: ToolMetadata;
  config: ToolConfig;
  inputSchema: z.ZodSchema<TInput>;
  outputSchema: z.ZodSchema<TOutput>;
  execute: (input: TInput, trace: ToolCallTrace) => Promise<TOutput>;
  validate?: (input: TInput) => Promise<boolean>;
  healthCheck?: () => Promise<boolean>;
}

export interface ToolExecutionResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: ToolError;
  trace: ToolCallTrace;
}

export interface ToolCallPersistenceContext {
  userId?: string;
  chatId?: string;
  runId?: string;
  providerId?: string;
  accountId?: string;
}

export const TOOL_CATEGORIES = [
  "Web",
  "Generation",
  "Processing",
  "Data",
  "Document",
  "Development",
  "Diagram",
  "API",
  "Productivity",
  "Security",
  "Automation",
  "Database",
  "Monitoring",
  "Utility",
  "Memory",
  "Reasoning",
  "Orchestration",
  "Communication",
  "AdvancedSystem",
] as const;

export type ToolCategory = typeof TOOL_CATEGORIES[number];

function redactForLog(value: any): any {
  const seen = new WeakSet();
  const sensitiveKeys = ["password", "token", "secret", "key", "auth", "credential", "apiKey"];

  const walk = (v: any): any => {
    if (v === null || v === undefined) return v;
    if (typeof v === "string") {
      if (v.length > 2000) return v.slice(0, 2000) + "...[truncated]";
      return v;
    }
    if (typeof v !== "object") return v;
    if (seen.has(v)) return "[Circular]";
    seen.add(v);

    if (Array.isArray(v)) {
      return v.slice(0, 50).map(walk);
    }

    const out: Record<string, any> = {};
    for (const [k, child] of Object.entries(v)) {
      if (sensitiveKeys.some(s => k.toLowerCase().includes(s.toLowerCase()))) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = walk(child);
      }
    }
    return out;
  };

  return walk(value);
}

class RateLimiter {
  private minuteCounts: Map<string, { count: number; resetAt: number }> = new Map();
  private hourCounts: Map<string, { count: number; resetAt: number }> = new Map();

  check(toolName: string, limitPerMinute: number, limitPerHour: number): boolean {
    const now = Date.now();
    
    const minuteKey = `${toolName}_minute`;
    const minuteData = this.minuteCounts.get(minuteKey);
    if (minuteData) {
      if (now > minuteData.resetAt) {
        this.minuteCounts.set(minuteKey, { count: 1, resetAt: now + 60000 });
      } else if (minuteData.count >= limitPerMinute) {
        return false;
      } else {
        minuteData.count++;
      }
    } else {
      this.minuteCounts.set(minuteKey, { count: 1, resetAt: now + 60000 });
    }

    const hourKey = `${toolName}_hour`;
    const hourData = this.hourCounts.get(hourKey);
    if (hourData) {
      if (now > hourData.resetAt) {
        this.hourCounts.set(hourKey, { count: 1, resetAt: now + 3600000 });
      } else if (hourData.count >= limitPerHour) {
        return false;
      } else {
        hourData.count++;
      }
    } else {
      this.hourCounts.set(hourKey, { count: 1, resetAt: now + 3600000 });
    }

    return true;
  }

  getStats(toolName: string): { minuteCount: number; hourCount: number } {
    const minuteData = this.minuteCounts.get(`${toolName}_minute`);
    const hourData = this.hourCounts.get(`${toolName}_hour`);
    return {
      minuteCount: minuteData?.count || 0,
      hourCount: hourData?.count || 0,
    };
  }
}

class ToolRegistry {
  private tools: Map<string, RegisteredTool<any, any>> = new Map();
  private traces: ToolCallTrace[] = [];
  private rateLimiter = new RateLimiter();
  private maxTraces = 10000;
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();

  register<TInput, TOutput>(tool: RegisteredTool<TInput, TOutput>): void {
    const { name } = tool.metadata;
    
    if (this.tools.has(name)) {
      console.warn(`[ToolRegistry] Tool "${name}" already registered, overwriting`);
    }

    const validatedMetadata = ToolMetadataSchema.parse(tool.metadata);
    const validatedConfig = ToolConfigSchema.parse(tool.config);

    this.tools.set(name, {
      ...tool,
      metadata: validatedMetadata,
      config: validatedConfig,
    });

    const category = validatedMetadata.category;
    if (!this.circuitBreakers.has(category)) {
      this.circuitBreakers.set(category, getOrCreateCircuitBreaker(`tool_category_${category}`, {
        failureThreshold: 5,
        successThreshold: 3,
        resetTimeoutMs: 30000,
      }));
    }

    globalHealthManager.registerHealthCheck(`tool_${name}`, async () => {
      if (tool.healthCheck) {
        return await tool.healthCheck();
      }
      return true;
    });

    console.log(`[ToolRegistry] Registered tool: ${name} (${tool.metadata.category})`);
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  getAll(): RegisteredTool[] {
    return Array.from(this.tools.values());
  }

  getByCategory(category: ToolCategory): RegisteredTool[] {
    return this.getAll().filter(t => t.metadata.category === category);
  }

  getCategories(): Map<ToolCategory, number> {
    const categories = new Map<ToolCategory, number>();
    for (const tool of this.tools.values()) {
      const cat = tool.metadata.category as ToolCategory;
      categories.set(cat, (categories.get(cat) || 0) + 1);
    }
    return categories;
  }

  async execute<TInput, TOutput>(
    name: string,
    input: TInput,
    options?: { skipValidation?: boolean; skipRateLimit?: boolean; context?: ToolCallPersistenceContext }
  ): Promise<ToolExecutionResult<TOutput>> {
    const requestId = crypto.randomUUID();
    const startTime = Date.now();
    const ctx = options?.context;
    const shouldPersist = !!(ctx?.userId || ctx?.chatId || ctx?.runId || ctx?.accountId);
    
    const trace: ToolCallTrace = {
      requestId,
      toolName: name,
      category: "",
      args: input as Record<string, unknown>,
      startTime,
      status: "pending",
      retryCount: 0,
    };

    const persistTrace = (finalTrace: ToolCallTrace) => {
      if (!shouldPersist || !ctx) return;
      void (async () => {
        try {
          const safeUserId =
            ctx.userId && ctx.userId !== "anonymous" && !String(ctx.userId).startsWith("anon_")
              ? String(ctx.userId)
              : undefined;
          const { storage } = await import("../../storage");
          await storage.createToolCallLog({
            userId: safeUserId,
            chatId: ctx.chatId,
            runId: ctx.runId,
            toolId: finalTrace.toolName,
            providerId: ctx.providerId || "agentic_engine",
            accountId: ctx.accountId,
            inputRedacted: redactForLog(finalTrace.args),
            outputRedacted: redactForLog(finalTrace.output),
            status: finalTrace.status,
            errorCode: finalTrace.error?.code,
            errorMessage: finalTrace.error?.message,
            latencyMs: Math.max(0, Math.round(finalTrace.durationMs ?? (Date.now() - finalTrace.startTime))),
            idempotencyKey: finalTrace.requestId,
          });
        } catch (err: any) {
          console.warn("[RegistryToolRegistry] Failed to persist tool_call_logs:", err?.message || err);
        }
      })();
    };

    try {
      const tool = this.tools.get(name);
      if (!tool) {
        const error: ToolError = {
          code: "NOT_FOUND_ERROR",
          message: `Tool "${name}" not found in registry`,
          retryable: false,
        };
        trace.status = "error";
        trace.error = error;
        trace.endTime = Date.now();
        trace.durationMs = trace.endTime - trace.startTime;
        this.addTrace(trace);
        persistTrace(trace);
        return { success: false, error, trace };
      }

      trace.category = tool.metadata.category;

      const circuitBreaker = this.circuitBreakers.get(tool.metadata.category);
      if (circuitBreaker && !circuitBreaker.canExecute()) {
        const error: ToolError = {
          code: "DEPENDENCY_ERROR",
          message: `Circuit breaker open for category "${tool.metadata.category}"`,
          retryable: true,
        };
        trace.status = "error";
        trace.error = error;
        trace.endTime = Date.now();
        trace.durationMs = trace.endTime - trace.startTime;
        this.addTrace(trace);
        persistTrace(trace);
        return { success: false, error, trace };
      }

      if (!options?.skipRateLimit) {
        const allowed = this.rateLimiter.check(
          name,
          tool.config.rateLimitPerMinute,
          tool.config.rateLimitPerHour
        );
        if (!allowed) {
          const error: ToolError = {
            code: "RATE_LIMIT_ERROR",
            message: `Rate limit exceeded for tool "${name}"`,
            retryable: true,
          };
          trace.status = "rate_limited";
          trace.error = error;
          trace.endTime = Date.now();
          trace.durationMs = trace.endTime - trace.startTime;
          this.addTrace(trace);
          persistTrace(trace);
          return { success: false, error, trace };
        }
      }

      if (!options?.skipValidation) {
        const parseResult = tool.inputSchema.safeParse(input);
        if (!parseResult.success) {
          const error: ToolError = {
            code: "VALIDATION_ERROR",
            message: `Input validation failed: ${parseResult.error.message}`,
            details: { zodErrors: parseResult.error.errors },
            retryable: false,
          };
          trace.status = "error";
          trace.error = error;
          trace.endTime = Date.now();
          trace.durationMs = trace.endTime - trace.startTime;
          this.addTrace(trace);
          persistTrace(trace);
          return { success: false, error, trace };
        }
      }

      let lastError: ToolError | undefined;
      const maxRetries = tool.config.maxRetries;
      
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        trace.retryCount = attempt;
        
        try {
          const result = await this.executeWithTimeout(
            () => tool.execute(input as any, trace),
            tool.config.timeout
          );

          const outputValidation = tool.outputSchema.safeParse(result);
          if (!outputValidation.success) {
            console.warn(`[ToolRegistry] Output validation warning for ${name}: ${outputValidation.error.message}`);
          }

          trace.status = "success";
          trace.output = result;
          trace.endTime = Date.now();
          trace.durationMs = trace.endTime - trace.startTime;
          this.addTrace(trace);
          persistTrace(trace);
          
          circuitBreaker?.recordSuccess();
          return { success: true, data: result as TOutput, trace };
        } catch (err: any) {
          const isTimeout = err.message?.includes("timed out");
          lastError = {
            code: isTimeout ? "TIMEOUT_ERROR" : "EXECUTION_ERROR",
            message: err.message || "Unknown execution error",
            details: { stack: err.stack },
            retryable: isTimeout || attempt < maxRetries,
          };

          if (attempt < maxRetries) {
            await this.delay(tool.config.retryDelay * Math.pow(2, attempt));
          }
        }
      }

      trace.status = lastError?.code === "TIMEOUT_ERROR" ? "timeout" : "error";
      trace.error = lastError;
      trace.endTime = Date.now();
      trace.durationMs = trace.endTime - trace.startTime;
      this.addTrace(trace);
      persistTrace(trace);
      
      circuitBreaker?.recordFailure();
      return { success: false, error: lastError, trace };
    } catch (err: any) {
      const error: ToolError = {
        code: "INTERNAL_ERROR",
        message: err.message || "Internal registry error",
        retryable: false,
      };
      trace.status = "error";
      trace.error = error;
      trace.endTime = Date.now();
      trace.durationMs = trace.endTime - trace.startTime;
      this.addTrace(trace);
      persistTrace(trace);
      return { success: false, error, trace };
    }
  }

  private async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    return Promise.race([
      fn(),
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private addTrace(trace: ToolCallTrace): void {
    this.traces.push(trace);
    if (this.traces.length > this.maxTraces) {
      this.traces = this.traces.slice(-this.maxTraces / 2);
    }
  }

  getTraces(filter?: {
    toolName?: string;
    category?: string;
    status?: ToolCallTrace["status"];
    since?: number;
    limit?: number;
  }): ToolCallTrace[] {
    let result = this.traces;

    if (filter?.toolName) {
      result = result.filter(t => t.toolName === filter.toolName);
    }
    if (filter?.category) {
      result = result.filter(t => t.category === filter.category);
    }
    if (filter?.status) {
      result = result.filter(t => t.status === filter.status);
    }
    if (filter?.since) {
      result = result.filter(t => t.startTime >= filter.since!);
    }
    if (filter?.limit) {
      result = result.slice(-filter.limit);
    }

    return result;
  }

  getStats(): {
    totalTools: number;
    byCategory: Record<string, number>;
    traces: {
      total: number;
      byStatus: Record<string, number>;
      avgDurationMs: number;
    };
  } {
    const byCategory: Record<string, number> = {};
    for (const tool of this.tools.values()) {
      byCategory[tool.metadata.category] = (byCategory[tool.metadata.category] || 0) + 1;
    }

    const byStatus: Record<string, number> = {};
    let totalDuration = 0;
    let countWithDuration = 0;
    
    for (const trace of this.traces) {
      byStatus[trace.status] = (byStatus[trace.status] || 0) + 1;
      if (trace.durationMs) {
        totalDuration += trace.durationMs;
        countWithDuration++;
      }
    }

    return {
      totalTools: this.tools.size,
      byCategory,
      traces: {
        total: this.traces.length,
        byStatus,
        avgDurationMs: countWithDuration > 0 ? Math.round(totalDuration / countWithDuration) : 0,
      },
    };
  }

  async runHealthChecks(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    
    for (const [name, tool] of this.tools.entries()) {
      try {
        if (tool.healthCheck) {
          results.set(name, await tool.healthCheck());
        } else {
          results.set(name, true);
        }
      } catch {
        results.set(name, false);
      }
    }
    
    return results;
  }

  getResilienceMetrics(): {
    global: ReturnType<typeof getAllResilienceMetrics>;
    byCategory: Record<string, { state: CircuitState; failureCount: number; successCount: number }>;
    toolHealth: ReturnType<typeof globalHealthManager.getOverallHealth>;
  } {
    const byCategory: Record<string, { state: CircuitState; failureCount: number; successCount: number }> = {};
    
    for (const [category, breaker] of this.circuitBreakers) {
      const metrics = breaker.getMetrics();
      byCategory[category] = {
        state: metrics.state,
        failureCount: metrics.failureCount,
        successCount: metrics.successCount,
      };
    }

    return {
      global: getAllResilienceMetrics(),
      byCategory,
      toolHealth: globalHealthManager.getOverallHealth(),
    };
  }

  getToolResilienceMetrics(name: string): {
    circuitBreaker: { state: CircuitState; failureCount: number; successCount: number } | null;
    healthStatus: ReturnType<typeof globalHealthManager.getHealthStatus> | undefined;
    recentTraces: ToolCallTrace[];
  } | null {
    const tool = this.tools.get(name);
    if (!tool) return null;

    const category = tool.metadata.category;
    const breaker = this.circuitBreakers.get(category);
    
    let circuitBreakerInfo = null;
    if (breaker) {
      const metrics = breaker.getMetrics();
      circuitBreakerInfo = {
        state: metrics.state,
        failureCount: metrics.failureCount,
        successCount: metrics.successCount,
      };
    }

    return {
      circuitBreaker: circuitBreakerInfo,
      healthStatus: globalHealthManager.getHealthStatus(`tool_${name}`),
      recentTraces: this.getTraces({ toolName: name, limit: 10 }),
    };
  }

  getCircuitBreakerState(category: string): CircuitState | null {
    const breaker = this.circuitBreakers.get(category);
    return breaker ? breaker.getState() : null;
  }

  resetCircuitBreaker(category: string): boolean {
    const breaker = this.circuitBreakers.get(category);
    if (breaker) {
      breaker.reset();
      return true;
    }
    return false;
  }

  async executeStrictE2E<TInput>(
    name: string,
    input: TInput,
    options?: { forceReal?: boolean }
  ): Promise<StrictE2EResult> {
    const requestId = crypto.randomUUID();
    const startTime = Date.now();
    const replanEvents: string[] = [];
    
    const result: StrictE2EResult = {
      toolName: name,
      input,
      output: null,
      schemaValidation: "fail",
      requestId,
      durationMs: 0,
      retryCount: 0,
      replanEvents,
      validationPassed: false,
    };

    try {
      const tool = this.tools.get(name);
      if (!tool) {
        result.errorStack = `Tool "${name}" not found`;
        result.durationMs = Date.now() - startTime;
        return result;
      }

      const parseResult = tool.inputSchema.safeParse(input);
      if (!parseResult.success) {
        result.errorStack = `Input validation failed: ${parseResult.error.message}`;
        result.durationMs = Date.now() - startTime;
        return result;
      }

      if (hasRealHandler(name)) {
        const realResult = await executeRealHandler(name, input);
        if (realResult) {
          result.output = realResult.data;
          result.artifacts = realResult.artifacts;
          result.validationPassed = realResult.validationPassed;
          result.schemaValidation = realResult.success ? "pass" : "fail";
          result.durationMs = Date.now() - startTime;
          
          if (!realResult.validationPassed) {
            result.errorStack = `Real execution failed validation: ${realResult.message}`;
          }
          return result;
        }
      }

      const execResult = await this.execute(name, input);
      result.output = execResult.data;
      result.retryCount = execResult.trace.retryCount;
      result.durationMs = Date.now() - startTime;
      
      if (execResult.success) {
        result.schemaValidation = "pass";
        
        const output = execResult.data as any;
        const hasRealData = output && (
          (output.data && Object.keys(output.data).length > 0 && !output.data.stub) ||
          (output.results && Array.isArray(output.results) && output.results.length > 0) ||
          (output.filePath && typeof output.filePath === "string") ||
          (output.hash && typeof output.hash === "string")
        );
        
        result.validationPassed = hasRealData;
        if (!hasRealData) {
          result.errorStack = "Output appears to be mock/empty data";
        }
      } else {
        result.errorStack = execResult.error?.message || "Execution failed";
      }

      return result;
    } catch (err: any) {
      result.errorStack = err.stack || err.message || "Unknown error";
      result.durationMs = Date.now() - startTime;
      return result;
    }
  }

  toJSON(): object {
    return {
      tools: Array.from(this.tools.entries()).map(([name, tool]) => ({
        name,
        metadata: tool.metadata,
        config: tool.config,
        inputSchema: this.schemaToJSON(tool.inputSchema),
        outputSchema: this.schemaToJSON(tool.outputSchema),
      })),
      stats: this.getStats(),
    };
  }

  private schemaToJSON(schema: z.ZodSchema): object {
    try {
      const shape = (schema as any)._def;
      return {
        type: shape?.typeName || "unknown",
        description: shape?.description,
      };
    } catch {
      return { type: "unknown" };
    }
  }
}

export const toolRegistry = new ToolRegistry();
export { ToolRegistry };
