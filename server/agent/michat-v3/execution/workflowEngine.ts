import { MichatError } from "../errors";
import { uid } from "../config";
import { Semaphore } from "../resilience/bulkhead";
import type { 
  WorkflowStep, 
  WorkflowResult, 
  ToolContext, 
  Logger 
} from "../types";
import type { EnterpriseToolRunner } from "./toolRunner";

export class CancellationToken {
  private cancelled = false;
  private reason?: string;

  cancel(reason?: string): void {
    this.cancelled = true;
    this.reason = reason;
  }

  get isCancelled(): boolean {
    return this.cancelled;
  }

  get cancellationReason(): string | undefined {
    return this.reason;
  }
}

export interface WorkflowProgress {
  workflowId: string;
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  pendingSteps: number;
  currentlyRunning: string[];
}

export class WorkflowEngine {
  constructor(
    private toolRunner: EnterpriseToolRunner,
    private concurrency: number,
    private logger: Logger
  ) {}

  async run(
    steps: WorkflowStep[],
    ctx: ToolContext,
    token: CancellationToken = new CancellationToken()
  ): Promise<WorkflowResult> {
    const workflowId = uid("wf");

    ctx.events.emit("workflow.started", {
      workflowId,
      steps: steps.length,
      traceId: ctx.traceId,
      requestId: ctx.requestId,
    });

    this.validateDAG(steps);

    const remaining = new Map(steps.map((s) => [s.id, s]));
    const done = new Set<string>();
    const results: Record<string, unknown> = {};
    const errors: Record<string, string> = {};
    const currentlyRunning = new Set<string>();

    const semaphore = new Semaphore(this.concurrency);
    const canRun = (s: WorkflowStep) => (s.dependsOn ?? []).every((d) => done.has(d));

    const emitProgress = () => {
      const progress: WorkflowProgress = {
        workflowId,
        totalSteps: steps.length,
        completedSteps: done.size,
        failedSteps: Object.keys(errors).length,
        pendingSteps: remaining.size,
        currentlyRunning: Array.from(currentlyRunning),
      };
      ctx.events.emit("workflow.progress", progress);
    };

    try {
      while (remaining.size > 0) {
        if (token.isCancelled) {
          throw new MichatError("E_INTERNAL", `Workflow cancelled: ${token.cancellationReason || "No reason provided"}`);
        }

        const runnable = Array.from(remaining.values()).filter(canRun);

        if (runnable.length === 0 && currentlyRunning.size === 0) {
          throw new MichatError("E_WORKFLOW_DAG", "Invalid DAG: circular dependencies or deadlock detected");
        }

        if (runnable.length === 0) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          continue;
        }

        const executing = runnable.map(async (step) => {
          await semaphore.acquire();

          if (!remaining.has(step.id)) {
            semaphore.release();
            return;
          }

          remaining.delete(step.id);
          currentlyRunning.add(step.id);
          emitProgress();

          const stepRetries = step.retries ?? step.options?.retries ?? 0;

          try {
            const result = await this.toolRunner.run(
              step.tool,
              step.params,
              ctx,
              { ...step.options, retries: stepRetries }
            );
            results[step.id] = result;

            ctx.events.emit("workflow.step.completed", {
              workflowId,
              stepId: step.id,
              tool: step.tool,
              traceId: ctx.traceId,
              requestId: ctx.requestId,
            });
          } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : String(err);
            errors[step.id] = errMsg;

            ctx.events.emit("workflow.step.failed", {
              workflowId,
              stepId: step.id,
              tool: step.tool,
              error: errMsg,
              traceId: ctx.traceId,
              requestId: ctx.requestId,
            });
          } finally {
            done.add(step.id);
            currentlyRunning.delete(step.id);
            semaphore.release();
            emitProgress();
          }
        });

        await Promise.all(executing);
      }

      const status = Object.keys(errors).length ? "failed" : "succeeded";

      ctx.events.emit(`workflow.${status}`, {
        workflowId,
        errorsCount: Object.keys(errors).length,
        resultsCount: Object.keys(results).length,
        traceId: ctx.traceId,
        requestId: ctx.requestId,
      });

      return { workflowId, status, results, errors };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);

      this.logger.warn("workflow.failed", {
        workflowId,
        error: errMsg,
      });

      ctx.events.emit("workflow.failed", {
        workflowId,
        err: errMsg,
        traceId: ctx.traceId,
        requestId: ctx.requestId,
      });

      return {
        workflowId,
        status: "failed",
        results,
        errors: { ...errors, _workflow: errMsg },
      };
    }
  }

  private validateDAG(steps: WorkflowStep[]): void {
    const stepIds = new Set(steps.map((s) => s.id));

    for (const step of steps) {
      for (const dep of step.dependsOn ?? []) {
        if (!stepIds.has(dep)) {
          throw new MichatError("E_WORKFLOW_DAG", `Missing dependency: ${dep} (referenced in step ${step.id})`);
        }
      }
    }

    const visited = new Set<string>();
    const inStack = new Set<string>();

    const hasCycle = (stepId: string): boolean => {
      if (inStack.has(stepId)) return true;
      if (visited.has(stepId)) return false;

      visited.add(stepId);
      inStack.add(stepId);

      const step = steps.find((s) => s.id === stepId);
      if (step) {
        for (const dep of step.dependsOn ?? []) {
          if (hasCycle(dep)) return true;
        }
      }

      inStack.delete(stepId);
      return false;
    };

    for (const step of steps) {
      if (hasCycle(step.id)) {
        throw new MichatError("E_WORKFLOW_DAG", `Circular dependency detected involving step: ${step.id}`);
      }
    }
  }

  getTopologicalOrder(steps: WorkflowStep[]): string[] {
    this.validateDAG(steps);

    const result: string[] = [];
    const visited = new Set<string>();
    const stepMap = new Map(steps.map((s) => [s.id, s]));

    const visit = (stepId: string): void => {
      if (visited.has(stepId)) return;
      visited.add(stepId);

      const step = stepMap.get(stepId);
      if (step) {
        for (const dep of step.dependsOn ?? []) {
          visit(dep);
        }
      }

      result.push(stepId);
    };

    for (const step of steps) {
      visit(step.id);
    }

    return result;
  }
}
