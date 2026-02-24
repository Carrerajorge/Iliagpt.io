import crypto from "crypto";
import { toolRegistry } from "./registry";
import { storage } from "../../storage";
import {
  ExecutionPlan,
  PlanStep,
  StepResult,
  ExecutionContext,
  ToolResult,
  Artifact,
  ProgressUpdate,
  PipelineConfig,
  DEFAULT_PIPELINE_CONFIG
} from "./types";

export type StepCallback = (update: ProgressUpdate) => void;

export class PipelineExecutor {
  private config: PipelineConfig;
  private cancelledRuns: Set<string> = new Set();

  constructor(config: Partial<PipelineConfig> = {}) {
    this.config = { ...DEFAULT_PIPELINE_CONFIG, ...config };
  }

  async execute(
    plan: ExecutionPlan,
    onProgress?: StepCallback,
    contextOverrides?: { userId?: string; conversationId?: string }
  ): Promise<{ results: StepResult[]; artifacts: Artifact[] }> {
    const results: StepResult[] = [];
    const artifacts: Map<string, Artifact> = new Map();
    const variables: Map<string, any> = new Map();
    const completedSteps: Set<string> = new Set();

    for (let i = 0; i < plan.steps.length; i++) {
      if (this.cancelledRuns.has(plan.runId)) {
        break;
      }

      const step = plan.steps[i];

      if (step.dependsOn) {
        const unmetDeps = step.dependsOn.filter(depId => !completedSteps.has(depId));
        if (unmetDeps.length > 0) {
          const failedDeps = unmetDeps.filter(depId =>
            results.find(r => r.stepId === depId && r.status === "failed")
          );

          if (failedDeps.length > 0 && !step.optional) {
            results.push({
              stepId: step.id,
              toolId: step.toolId,
              status: "skipped",
              input: step.params,
              retryCount: 0,
              validated: false,
              validationErrors: [`Skipped due to failed dependencies: ${failedDeps.join(", ")}`]
            });
            continue;
          }
        }
      }

      if (step.condition) {
        try {
          const conditionMet = this.evaluateCondition(step.condition, variables);
          if (!conditionMet) {
            results.push({
              stepId: step.id,
              toolId: step.toolId,
              status: "skipped",
              input: step.params,
              retryCount: 0,
              validated: false,
              validationErrors: ["Condition not met"]
            });
            continue;
          }
        } catch (e) {
          console.warn(`Condition evaluation failed for step ${step.id}:`, e);
        }
      }

      const context: ExecutionContext = {
        runId: plan.runId,
        planId: plan.id,
        stepIndex: i,
        userId: contextOverrides?.userId,
        conversationId: contextOverrides?.conversationId,
        previousResults: results,
        artifacts,
        variables,
        onProgress: (update) => onProgress?.(update),
        isCancelled: () => this.cancelledRuns.has(plan.runId)
      };

      const result = await this.executeStep(step, context, onProgress);
      results.push(result);

      if (result.status === "completed") {
        completedSteps.add(step.id);

        if (result.output?.data !== undefined) {
          variables.set(`${step.id}_output`, result.output.data);
          variables.set(`step_${i}_output`, result.output.data);
        }

        if (result.output?.artifacts) {
          for (const artifact of result.output.artifacts) {
            artifacts.set(artifact.id, artifact);
          }
        }
      }

      if (result.status === "failed" && !step.optional) {
        const hasRecovery = plan.steps.slice(i + 1).some(s =>
          !s.dependsOn?.includes(step.id)
        );
        if (!hasRecovery) {
          break;
        }
      }
    }

    // Clean up cancelled run tracking to prevent memory leak
    this.cancelledRuns.delete(plan.runId);

    return { results, artifacts: Array.from(artifacts.values()) };
  }

  private async executeStep(
    step: PlanStep,
    context: ExecutionContext,
    onProgress?: StepCallback
  ): Promise<StepResult> {
    const startedAt = new Date();
    let retryCount = 0;
    const maxRetries = step.retryPolicy?.maxRetries || 2;

    onProgress?.({
      runId: context.runId,
      stepId: step.id,
      status: "started",
      message: step.description
    });

    const tool = toolRegistry.get(step.toolId);
    if (!tool) {
      return {
        stepId: step.id,
        toolId: step.toolId,
        status: "failed",
        startedAt,
        completedAt: new Date(),
        input: step.params,
        output: { success: false, error: `Tool '${step.toolId}' not found` },
        retryCount: 0,
        validated: false,
        validationErrors: [`Unknown tool: ${step.toolId}`]
      };
    }

    const resolvedParams = this.resolveParams(step.params, context);

    const validation = toolRegistry.validateToolParams(step.toolId, resolvedParams);
    if (!validation.valid) {
      return {
        stepId: step.id,
        toolId: step.toolId,
        status: "failed",
        startedAt,
        completedAt: new Date(),
        input: resolvedParams,
        output: { success: false, error: `Invalid parameters: ${validation.errors?.join(", ")}` },
        retryCount: 0,
        validated: false,
        validationErrors: validation.errors
      };
    }

    let lastError: string | undefined;

    while (retryCount <= maxRetries) {
      if (context.isCancelled()) {
        return {
          stepId: step.id,
          toolId: step.toolId,
          status: "failed",
          startedAt,
          completedAt: new Date(),
          input: resolvedParams,
          output: { success: false, error: "Cancelled by user" },
          retryCount,
          validated: false
        };
      }

      try {
        const timeout = step.timeout || tool.timeout || this.config.defaultTimeout;

        let timeoutTimer: ReturnType<typeof setTimeout>;
        const result = await Promise.race([
          tool.execute(context, resolvedParams),
          new Promise<ToolResult>((_, reject) => {
            timeoutTimer = setTimeout(() => reject(new Error("Step timeout")), timeout);
          })
        ]);
        clearTimeout(timeoutTimer!);

        const completedAt = new Date();

        onProgress?.({
          runId: context.runId,
          stepId: step.id,
          status: result.success ? "completed" : "failed",
          message: result.success ? `Completed: ${step.description}` : result.error,
          detail: result.metadata
        });

        return {
          stepId: step.id,
          toolId: step.toolId,
          status: result.success ? "completed" : "failed",
          startedAt,
          completedAt,
          input: resolvedParams,
          output: result,
          retryCount,
          duration: completedAt.getTime() - startedAt.getTime(),
          validated: result.success,
          validationErrors: result.success ? undefined : [result.error || "Unknown error"]
        };
      } catch (error: any) {
        lastError = error.message;
        retryCount++;

        if (retryCount <= maxRetries) {
          const delay = (step.retryPolicy?.delayMs || 1000) *
            Math.pow(step.retryPolicy?.backoffMultiplier || 2, retryCount - 1);
          await new Promise(resolve => setTimeout(resolve, delay));

          onProgress?.({
            runId: context.runId,
            stepId: step.id,
            status: "progress",
            message: `Retry ${retryCount}/${maxRetries}: ${error.message}`
          });
        }
      }
    }

    const completedAt = new Date();

    onProgress?.({
      runId: context.runId,
      stepId: step.id,
      status: "failed",
      message: `Failed after ${retryCount} retries: ${lastError}`
    });

    return {
      stepId: step.id,
      toolId: step.toolId,
      status: "failed",
      startedAt,
      completedAt,
      input: resolvedParams,
      output: { success: false, error: lastError },
      retryCount,
      duration: completedAt.getTime() - startedAt.getTime(),
      validated: false,
      validationErrors: [lastError || "Max retries exceeded"]
    };
  }

  private resolveParams(
    params: Record<string, any>,
    context: ExecutionContext
  ): Record<string, any> {
    const resolved: Record<string, any> = {};

    for (const [key, value] of Object.entries(params)) {
      if (typeof value === "string") {
        if (value.startsWith("dynamic_from_")) {
          resolved[key] = this.resolveDynamicParam(value, context);
        } else {
          resolved[key] = this.interpolateString(value, context);
        }
      } else if (Array.isArray(value)) {
        resolved[key] = value.map(v => {
          if (typeof v === "string") {
            if (v.startsWith("dynamic_from_")) {
              return this.resolveDynamicParam(v, context);
            }
            return this.interpolateString(v, context);
          }
          return v;
        });
      } else if (typeof value === "object" && value !== null) {
        resolved[key] = this.resolveParams(value, context);
      } else {
        resolved[key] = value;
      }
    }

    return resolved;
  }

  private resolveDynamicParam(placeholder: string, context: ExecutionContext): string {
    if (placeholder === "dynamic_from_search_results" || placeholder === "dynamic_from_search") {
      const searchResult = context.previousResults
        .filter(r => r.toolId === "search_web" && r.status === "completed")
        .pop();

      if (searchResult?.output?.data?.results?.[0]?.url) {
        return searchResult.output.data.results[0].url;
      }
      if (searchResult?.output?.data?.results?.[0]?.link) {
        return searchResult.output.data.results[0].link;
      }
    }

    if (placeholder === "dynamic_from_response" || placeholder === "dynamic_from_text") {
      const lastResult = context.previousResults
        .filter(r => r.status === "completed")
        .pop();

      if (lastResult?.output?.data?.response) {
        return lastResult.output.data.response;
      }
      if (lastResult?.output?.data?.textContent) {
        return lastResult.output.data.textContent;
      }
      if (lastResult?.output?.data?.content) {
        return lastResult.output.data.content;
      }
    }

    if (placeholder === "dynamic_from_url" || placeholder === "dynamic_from_navigate") {
      const navResult = context.previousResults
        .filter(r => r.toolId === "web_navigate" && r.status === "completed")
        .pop();

      if (navResult?.output?.data?.url) {
        return navResult.output.data.url;
      }
    }

    if (placeholder === "dynamic_from_content" || placeholder === "dynamic_from_page") {
      const navResult = context.previousResults
        .filter(r => r.toolId === "web_navigate" && r.status === "completed")
        .pop();

      if (navResult?.output?.data?.textContent) {
        return navResult.output.data.textContent;
      }
    }

    if (placeholder.startsWith("dynamic_from_step_")) {
      const stepMatch = placeholder.match(/dynamic_from_step_(\d+)_(.+)/);
      if (stepMatch) {
        const stepIndex = parseInt(stepMatch[1], 10);
        const field = stepMatch[2];
        const result = context.previousResults[stepIndex];
        if (result?.status === "completed" && result?.output?.data) {
          const value = this.getNestedValue(result.output.data, field);
          if (value !== undefined) {
            return typeof value === "string" ? value : JSON.stringify(value);
          }
        }
      }
    }

    // Fallback: return empty string instead of raw placeholder to avoid showing internal placeholders to users
    console.warn(`[PipelineExecutor] Unhandled dynamic placeholder: ${placeholder}`);
    return "";
  }

  private getNestedValue(obj: any, path: string): any {
    const parts = path.split(".");
    let current = obj;
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      const arrayMatch = part.match(/^(.+)\[(\d+)\]$/);
      if (arrayMatch) {
        current = current[arrayMatch[1]]?.[parseInt(arrayMatch[2], 10)];
      } else {
        current = current[part];
      }
    }
    return current;
  }

  private interpolateString(str: string, context: ExecutionContext): string {
    return str.replace(/\$\{([^}]+)\}/g, (_, expr) => {
      const value = context.variables.get(expr);
      return value !== undefined ? String(value) : `\${${expr}}`;
    });
  }

  private evaluateCondition(condition: string, variables: Map<string, any>): boolean {
    try {
      // Safe condition evaluation without code injection via new Function()
      // Only supports simple comparisons: "var == value", "var != value", "var > value", etc.
      const trimmed = condition.trim();

      // Boolean variable check: "varName" or "!varName"
      if (/^!?\w+$/.test(trimmed)) {
        const negate = trimmed.startsWith("!");
        const varName = negate ? trimmed.slice(1) : trimmed;
        const val = variables.get(varName);
        return negate ? !val : Boolean(val);
      }

      // Comparison: "varName op value"
      const match = trimmed.match(/^(\w+)\s*(===|!==|==|!=|>=|<=|>|<)\s*(.+)$/);
      if (match) {
        const [, varName, op, rawValue] = match;
        const left = variables.get(varName);
        let right: any = rawValue.trim();
        // Parse right-hand side
        if (right === "true") right = true;
        else if (right === "false") right = false;
        else if (right === "null") right = null;
        else if (right === "undefined") right = undefined;
        else if (/^-?\d+(\.\d+)?$/.test(right)) right = Number(right);
        else if (/^["'].*["']$/.test(right)) right = right.slice(1, -1);

        switch (op) {
          case "===": return left === right;
          case "!==": return left !== right;
          case "==": return left == right;
          case "!=": return left != right;
          case ">": return left > right;
          case "<": return left < right;
          case ">=": return left >= right;
          case "<=": return left <= right;
        }
      }

      // Unsupported condition format — default to true to not block execution
      console.warn(`[PipelineExecutor] Unsupported condition format: "${condition}"`);
      return true;
    } catch {
      return true;
    }
  }

  cancel(runId: string): void {
    this.cancelledRuns.add(runId);
  }

  isRunning(runId: string): boolean {
    return !this.cancelledRuns.has(runId);
  }
}

export const pipelineExecutor = new PipelineExecutor();
