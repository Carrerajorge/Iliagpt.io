import { z } from "zod";
import { randomUUID } from "crypto";
import {
  PlanStep,
  Artifact,
  ArtifactSchema,
  ToolOutput,
  ToolOutputSchema,
} from "../contracts";
import { toolRegistry, ToolContext, ToolResult } from "../toolRegistry";
import {
  executionEngine,
  CancellationToken,
  CancellationError,
  RetryableError,
  ExecutionOptions,
} from "../executionEngine";
import { eventLogger, logStepEvent, logToolEvent } from "../eventLogger";

export const CitationSchema = z.object({
  id: z.string().uuid(),
  sourceUrl: z.string().optional(),
  sourceTitle: z.string().optional(),
  excerpt: z.string(),
  confidence: z.number().min(0).max(1).default(1),
  stepIndex: z.number().int().nonnegative(),
  createdAt: z.date(),
});
export type Citation = z.infer<typeof CitationSchema>;

export const StepResultSchema = z.object({
  stepIndex: z.number().int().nonnegative(),
  toolName: z.string(),
  success: z.boolean(),
  output: z.any().optional(),
  artifacts: z.array(ArtifactSchema).default([]),
  citations: z.array(CitationSchema).default([]),
  durationMs: z.number().int().nonnegative(),
  retryCount: z.number().int().nonnegative().default(0),
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
  }).optional(),
});
export type StepResult = z.infer<typeof StepResultSchema>;

export const ExecutionContextSchema = z.object({
  userId: z.string(),
  userPlan: z.enum(["free", "pro", "admin"]),
  chatId: z.string(),
  runId: z.string(),
  correlationId: z.string(),
  cancellationToken: z.custom<CancellationToken>().optional(),
  previousResults: z.map(z.number(), z.custom<StepResult>()).optional(),
  retryConfig: z.object({
    maxRetries: z.number().int().nonnegative().default(3),
    baseDelayMs: z.number().int().positive().default(1000),
    maxDelayMs: z.number().int().positive().default(30000),
    jitterFactor: z.number().min(0).max(1).default(0.1),
  }).optional(),
});
export type ExecutionContext = z.infer<typeof ExecutionContextSchema>;

export const ExecutorConfigSchema = z.object({
  defaultTimeoutMs: z.number().int().positive().default(60000),
  collectCitations: z.boolean().default(true),
  validateArtifacts: z.boolean().default(true),
  emitDetailedEvents: z.boolean().default(true),
});
export type ExecutorConfig = z.infer<typeof ExecutorConfigSchema>;

const DEFAULT_RETRY_CONFIG: Required<NonNullable<ExecutionContext["retryConfig"]>> = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitterFactor: 0.1,
};

export class ExecutorAgent {
  private config: ExecutorConfig;

  constructor(config: Partial<ExecutorConfig> = {}) {
    this.config = ExecutorConfigSchema.parse(config);
  }

  async executeStep(
    step: PlanStep,
    context: ExecutionContext
  ): Promise<StepResult> {
    const startTime = Date.now();
    const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...context.retryConfig };
    let retryCount = 0;

    context.cancellationToken?.setCorrelationId(context.correlationId);

    await this.emitStepEvent(context, step.index, "step_started", {
      toolName: step.toolName,
      description: step.description,
    });

    while (retryCount <= retryConfig.maxRetries) {
      try {
        context.cancellationToken?.throwIfCancelled();

        const result = await this.executeSingleAttempt(step, context, retryCount);

        await this.emitStepEvent(context, step.index, "step_completed", {
          toolName: step.toolName,
          success: result.success,
          artifactCount: result.artifacts.length,
          citationCount: result.citations.length,
          durationMs: result.durationMs,
        });

        return result;
      } catch (error: any) {
        if (error instanceof CancellationError) {
          return this.buildCancelledResult(step, startTime, retryCount);
        }

        const isRetryable = this.isRetryableError(error);
        if (!isRetryable || retryCount >= retryConfig.maxRetries) {
          await this.emitStepEvent(context, step.index, "step_failed", {
            toolName: step.toolName,
            error: error.message,
            retryCount,
            retryable: isRetryable,
          });

          return this.buildErrorResult(step, error, startTime, retryCount);
        }

        const delay = this.calculateBackoffDelay(retryCount, retryConfig);
        await this.emitStepEvent(context, step.index, "step_retried", {
          toolName: step.toolName,
          retryCount: retryCount + 1,
          delayMs: delay,
          error: error.message,
        });

        await this.sleep(delay);
        retryCount++;
      }
    }

    return this.buildErrorResult(
      step,
      new Error("Max retries exceeded"),
      startTime,
      retryCount
    );
  }

  private async executeSingleAttempt(
    step: PlanStep,
    context: ExecutionContext,
    retryCount: number
  ): Promise<StepResult> {
    const startTime = Date.now();

    const resolvedInput = this.resolveInputReferences(step.input, context.previousResults);

    const toolContext: ToolContext = {
      userId: context.userId,
      chatId: context.chatId,
      runId: context.runId,
      correlationId: context.correlationId,
      stepIndex: step.index,
      userPlan: context.userPlan,
      isConfirmed: (context as any).isConfirmed === true,
    };

    await logToolEvent(
      context.runId,
      context.correlationId,
      step.index,
      step.toolName,
      "tool_called",
      { input: resolvedInput }
    );

    const executionOptions: ExecutionOptions = {
      maxRetries: 0,
      baseDelayMs: 1000,
      maxDelayMs: 30000,
      timeoutMs: step.timeoutMs || this.config.defaultTimeoutMs,
      cancellationToken: context.cancellationToken,
    };

    const executeResult = await executionEngine.execute(
      step.toolName,
      async () => toolRegistry.execute(step.toolName, resolvedInput, toolContext),
      executionOptions
    );

    const durationMs = Date.now() - startTime;

    if (!executeResult.success || !executeResult.data) {
      const errorMsg = executeResult.error?.message || "Tool execution failed";
      await logToolEvent(
        context.runId,
        context.correlationId,
        step.index,
        step.toolName,
        "tool_failed",
        { error: errorMsg, durationMs }
      );

      throw new RetryableError(
        errorMsg,
        executeResult.error?.code !== "INVALID_INPUT"
      );
    }

    const toolResult = executeResult.data as ToolResult;

    await logToolEvent(
      context.runId,
      context.correlationId,
      step.index,
      step.toolName,
      "tool_completed",
      {
        success: toolResult.success,
        artifactCount: toolResult.artifacts?.length || 0,
        durationMs,
      }
    );

    if (!toolResult.success) {
      throw new RetryableError(
        toolResult.error?.message || "Tool returned failure",
        toolResult.error?.retryable ?? true
      );
    }

    const artifacts = this.processArtifacts(toolResult.artifacts || [], step.index);
    const citations = this.config.collectCitations
      ? this.extractCitations(toolResult, step.index)
      : [];

    return {
      stepIndex: step.index,
      toolName: step.toolName,
      success: true,
      output: toolResult.output,
      artifacts,
      citations,
      durationMs,
      retryCount,
    };
  }

  private resolveInputReferences(
    input: Record<string, any>,
    previousResults?: Map<number, StepResult>
  ): Record<string, any> {
    if (!previousResults || previousResults.size === 0) {
      return input;
    }

    const resolved: Record<string, any> = {};

    for (const [key, value] of Object.entries(input)) {
      if (typeof value === "string" && value.startsWith("$step[")) {
        const match = value.match(/\$step\[(\d+)\]\.(.+)/);
        if (match) {
          const stepIndex = parseInt(match[1], 10);
          const path = match[2];
          const stepResult = previousResults.get(stepIndex);
          if (stepResult) {
            resolved[key] = this.getNestedValue(stepResult, path);
            continue;
          }
        }
      }
      resolved[key] = value;
    }

    return resolved;
  }

  private getNestedValue(obj: any, path: string): any {
    const parts = path.split(".");
    let current = obj;
    for (const part of parts) {
      if (current == null) return undefined;
      current = current[part];
    }
    return current;
  }

  private processArtifacts(artifacts: any[], stepIndex: number): Artifact[] {
    const processed: Artifact[] = [];

    for (const artifact of artifacts) {
      try {
        const validated = ArtifactSchema.parse({
          ...artifact,
          id: artifact.id || randomUUID(),
          createdAt: artifact.createdAt || new Date(),
        });
        processed.push(validated);
      } catch (error) {
        console.warn(`[ExecutorAgent] Invalid artifact at step ${stepIndex}:`, error);
      }
    }

    return processed;
  }

  private extractCitations(result: ToolResult, stepIndex: number): Citation[] {
    const citations: Citation[] = [];

    if (result.output?.sources) {
      for (const source of result.output.sources) {
        citations.push({
          id: randomUUID(),
          sourceUrl: source.url,
          sourceTitle: source.title,
          excerpt: source.excerpt || source.content?.slice(0, 500) || "",
          confidence: source.confidence || 1,
          stepIndex,
          createdAt: new Date(),
        });
      }
    }

    if (result.output?.citations) {
      for (const citation of result.output.citations) {
        citations.push({
          id: randomUUID(),
          sourceUrl: citation.url,
          sourceTitle: citation.title,
          excerpt: citation.text || citation.excerpt || "",
          confidence: citation.confidence || 1,
          stepIndex,
          createdAt: new Date(),
        });
      }
    }

    return citations;
  }

  private isRetryableError(error: any): boolean {
    if (error instanceof RetryableError) {
      return error.isRetryable;
    }

    if (error instanceof CancellationError) {
      return false;
    }

    const message = error.message?.toLowerCase() || "";
    const nonRetryablePatterns = [
      "invalid input",
      "access denied",
      "not found",
      "unauthorized",
      "forbidden",
      "validation failed",
    ];

    return !nonRetryablePatterns.some((pattern) => message.includes(pattern));
  }

  private calculateBackoffDelay(
    retryCount: number,
    config: typeof DEFAULT_RETRY_CONFIG
  ): number {
    const exponentialDelay = config.baseDelayMs * Math.pow(2, retryCount);
    const clampedDelay = Math.min(exponentialDelay, config.maxDelayMs);
    const jitter = clampedDelay * config.jitterFactor * Math.random();
    return Math.floor(clampedDelay + jitter);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async emitStepEvent(
    context: ExecutionContext,
    stepIndex: number,
    eventType: "step_started" | "step_completed" | "step_failed" | "step_retried",
    payload: Record<string, any>
  ): Promise<void> {
    if (!this.config.emitDetailedEvents) return;

    await logStepEvent(
      context.runId,
      context.correlationId,
      stepIndex,
      eventType,
      payload,
      { timestamp: Date.now() }
    );
  }

  private buildCancelledResult(
    step: PlanStep,
    startTime: number,
    retryCount: number
  ): StepResult {
    return {
      stepIndex: step.index,
      toolName: step.toolName,
      success: false,
      artifacts: [],
      citations: [],
      durationMs: Date.now() - startTime,
      retryCount,
      error: {
        code: "CANCELLED",
        message: "Step execution was cancelled",
        retryable: false,
      },
    };
  }

  private buildErrorResult(
    step: PlanStep,
    error: any,
    startTime: number,
    retryCount: number
  ): StepResult {
    return {
      stepIndex: step.index,
      toolName: step.toolName,
      success: false,
      artifacts: [],
      citations: [],
      durationMs: Date.now() - startTime,
      retryCount,
      error: {
        code: error.code || "EXECUTION_ERROR",
        message: error.message || "Unknown error",
        retryable: this.isRetryableError(error),
      },
    };
  }
}

export const executorAgent = new ExecutorAgent();
