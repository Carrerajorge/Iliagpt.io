import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { context, Span, SpanStatusCode, trace } from "@opentelemetry/api";

import { agentEventBus } from "../agent/eventBus";
import { TraceEventType } from "@shared/schema";
import { RunLockManager } from "./runLockManager";
import { recordRunDuration, recordRunLockTimeout, recordRunStatus, recordSlowRun } from "./metrics";
import { WorkflowStore } from "./store";
import {
  StepExecutor,
  StepExecutorContext,
  StepExecutorRegistry,
  WorkflowDefinition,
  WorkflowEventSeverity,
  WorkflowRunStatus,
  WorkflowStepDefinition,
  WorkflowStepResult,
  WorkflowStepStatus,
  WorkflowSubmission,
} from "./types";

const DEFAULT_CONCURRENCY = 1;
const DEFAULT_BACKOFF_MS = 500;
const DEFAULT_LOCK_TIMEOUT_MS = Number(process.env.WORKFLOW_RUN_LOCK_TIMEOUT_MS || 5000);
const SLOW_RUN_THRESHOLD_MS = Number(process.env.WORKFLOW_SLOW_RUN_THRESHOLD_MS || 30_000);
const NOOP_EXECUTOR_KEY = "noop";
const tracer = trace.getTracer("workflow.runner");

export class InMemoryStepExecutorRegistry implements StepExecutorRegistry {
  private executors = new Map<string, StepExecutor>();

  getExecutor(key: string): StepExecutor | undefined {
    return this.executors.get(key);
  }

  registerExecutor(key: string, executor: StepExecutor): void {
    this.executors.set(key, executor);
  }
}

interface StepState {
  definition: WorkflowStepDefinition;
  stepId: string;
  stepIndex: number;
  status: WorkflowStepStatus;
  attempt: number;
  dependencies: Set<string>;
  lastError?: WorkflowStepResult["error"];
}

interface RunContextOptions {
  userId?: string | null;
  userPlan?: "free" | "pro" | "admin";
  variables?: Record<string, any>;
}

export class WorkflowRunInstance extends EventEmitter {
  private runningSteps = new Map<string, Promise<void>>();
  private completedSteps = 0;
  private cancelRequested = false;
  private readonly stepStates: Record<string, StepState> = {};
  private readonly concurrency: number;
  private runSpan: Span | null = null;
  private runStartedAt = 0;
  private eventSeqCursor = 0;

  constructor(
    private readonly store: WorkflowStore,
    private readonly definition: WorkflowDefinition,
    private readonly runId: string,
    private readonly chatId: string,
    private readonly traceId: string,
    private readonly executorRegistry: StepExecutorRegistry,
    stepMap: Array<{ stepIndex: number; stepId: string }>,
    private readonly runContext: RunContextOptions = {},
  ) {
    super();
    this.concurrency = definition.concurrency ?? DEFAULT_CONCURRENCY;

    for (const [index, step] of definition.steps.entries()) {
      const persisted = stepMap.find((entry) => entry.stepIndex === index);
      this.stepStates[step.id] = {
        definition: step,
        stepId: persisted?.stepId || randomUUID(),
        stepIndex: index,
        status: "queued",
        attempt: 0,
        dependencies: new Set(step.dependencies || []),
      };
    }
  }

  async start(): Promise<void> {
    this.runStartedAt = Date.now();
    this.eventSeqCursor = await this.store.getLastEventSeq(this.runId);

    this.runSpan = tracer.startSpan("workflow.run", {
      attributes: {
        run_id: this.runId,
        chat_id: this.chatId,
        trace_id: this.traceId,
        objective: this.definition.objective,
        total_steps: this.definition.steps.length,
      },
    });

    const runCtx = trace.setSpan(context.active(), this.runSpan);

    return context.with(runCtx, async () => {
      await this.emitTrace("run_created", {
        status: "pending",
        summary: this.definition.objective,
        metadata: {
          totalSteps: this.definition.steps.length,
          concurrency: this.concurrency,
        },
      });

      await this.store.updateRunStatus(this.runId, {
        status: "running",
        startedAt: new Date(),
      });

      try {
        await this.executeSteps();

        if (this.cancelRequested) {
          await this.cancelRemainingSteps();
          await this.finalizeRun("cancelled", "Cancelado por el usuario");
        } else if (this.hasFailedStep()) {
          await this.finalizeRun("failed", this.describeFailure());
        } else if (this.completedSteps === this.definition.steps.length) {
          await this.finalizeRun("completed");
        } else {
          await this.finalizeRun("failed", "El flujo no pudo completar todos los pasos");
        }
      } catch (error: any) {
        await this.finalizeRun("failed", error?.message || "Error inesperado");
        throw error;
      } finally {
        this.runSpan?.end();
        this.runSpan = null;
      }
    });
  }

  requestCancel(): void {
    this.cancelRequested = true;
  }

  private async executeSteps(): Promise<void> {
    while (!this.cancelRequested && this.hasPendingOrRunning()) {
      const ready = this.getReadySteps();

      for (const step of ready) {
        if (this.runningSteps.size >= this.concurrency) {
          break;
        }
        this.startStep(step);
      }

      if (this.runningSteps.size === 0 && ready.length === 0) {
        // No steps are eligible to run and none are running: dead-end due to failed deps.
        break;
      }

      if (this.runningSteps.size > 0) {
        await Promise.race(this.runningSteps.values());
      }
    }

    await Promise.all(this.runningSteps.values());
  }

  private getReadySteps(): StepState[] {
    return Object.values(this.stepStates).filter((state) => {
      if (state.status !== "queued" && state.status !== "retrying") {
        return false;
      }

      for (const dependency of state.dependencies) {
        const dependencyStep = this.stepStates[dependency];
        if (!dependencyStep || dependencyStep.status !== "succeeded") {
          return false;
        }
      }

      return true;
    });
  }

  private hasPendingOrRunning(): boolean {
    return (
      Object.values(this.stepStates).some((state) => ["queued", "running", "retrying"].includes(state.status)) ||
      this.runningSteps.size > 0
    );
  }

  private hasFailedStep(): boolean {
    return Object.values(this.stepStates).some((state) => state.status === "failed");
  }

  private describeFailure(): string {
    const failed = Object.values(this.stepStates).find((state) => state.status === "failed");
    if (!failed) {
      return "Run failed";
    }

    return failed.lastError?.message || `Paso ${failed.definition.name} falló`;
  }

  private startStep(stepState: StepState): void {
    stepState.status = "running";
    stepState.attempt += 1;
    this.runningSteps.set(stepState.definition.id, this.executeStep(stepState));
  }

  private async executeStep(stepState: StepState): Promise<void> {
    const executor =
      this.executorRegistry.getExecutor(stepState.definition.executorKey || "") ??
      this.executorRegistry.getExecutor(NOOP_EXECUTOR_KEY);

    if (!executor) {
      throw new Error(`Executor ${stepState.definition.executorKey || NOOP_EXECUTOR_KEY} no registrado`);
    }

    const stepSpan = tracer.startSpan("workflow.step", {
      attributes: {
        run_id: this.runId,
        step_id: stepState.stepId,
        step_index: stepState.stepIndex,
        step_name: stepState.definition.name,
        tool_name: stepState.definition.toolName,
        attempt: stepState.attempt,
      },
    });

    const stepCtx = trace.setSpan(context.active(), stepSpan);

    try {
      await context.with(stepCtx, async () => {
        await this.emitTrace(
          "step_started",
          {
            status: "running",
            stepId: stepState.stepId,
            stepIndex: stepState.stepIndex,
            tool_name: stepState.definition.toolName,
            metadata: {
              description: stepState.definition.description,
              attempt: stepState.attempt,
            },
          },
          { step: stepState, span: stepSpan },
        );

        await this.store.updateStepStatus(stepState.stepId, {
          status: "running",
          startedAt: new Date(),
        });

        const contextPayload: StepExecutorContext = {
          runId: this.runId,
          chatId: this.chatId,
          userId: this.runContext.userId || null,
          userPlan: this.runContext.userPlan,
          step: stepState.definition,
          stepId: stepState.stepId,
          stepIndex: stepState.stepIndex,
          attempt: stepState.attempt,
          variables: this.runContext.variables || {},
          traceId: this.traceId,
        };

        const result = await this.executeWithTimeout(executor(contextPayload), stepState.definition.timeoutMs);
        await this.handleStepResult(stepState, result, stepSpan);
      });
    } catch (error: any) {
      await this.handleStepFailure(stepState, error, stepSpan);
    } finally {
      stepSpan.end();
      this.runningSteps.delete(stepState.definition.id);
    }
  }

  private async handleStepResult(stepState: StepState, result: WorkflowStepResult, stepSpan: Span): Promise<void> {
    if (!result.success) {
      const errorPayload = result.error || { message: `Paso ${stepState.definition.name} falló`, retryable: false };
      await this.handleStepFailure(stepState, errorPayload, stepSpan);
      return;
    }

    stepState.status = "succeeded";
    this.completedSteps += 1;

    await this.store.updateStepStatus(stepState.stepId, {
      status: "succeeded",
      toolOutput: result.output ? result.output : null,
      error: null,
      retryCount: stepState.attempt - 1,
      completedAt: new Date(),
    });

    await this.store.updateRunStatus(this.runId, {
      completedSteps: this.completedSteps,
      currentStepIndex: stepState.stepIndex + 1,
    });

    if (result.artifacts?.length) {
      await this.store.appendArtifactsIdempotent(
        result.artifacts.map((artifact) => ({
          runId: this.runId,
          stepId: stepState.stepId,
          stepIndex: stepState.stepIndex,
          artifact,
        })),
      );
    }

    await this.emitTrace(
      "step_completed",
      {
        status: "completed",
        stepId: stepState.stepId,
        stepIndex: stepState.stepIndex,
        summary: `${stepState.definition.name} completado`,
        metadata: {
          attempt: stepState.attempt,
          artifacts: result.artifacts || [],
        },
      },
      { step: stepState, span: stepSpan },
    );

    if (result.logs?.length) {
      for (const log of result.logs) {
        await this.emitTrace(
          "step_log",
          {
            stepId: stepState.stepId,
            stepIndex: stepState.stepIndex,
            metadata: {
              level: log.level,
              message: log.message,
              timestamp: log.timestamp,
              ...log.metadata,
            },
          },
          {
            step: stepState,
            span: stepSpan,
            severity: log.level === "error" ? "error" : log.level === "warn" ? "warning" : "info",
          },
        );
      }
    }
  }

  private async handleStepFailure(stepState: StepState, error: any, stepSpan: Span): Promise<void> {
    const retryPolicy = stepState.definition.retryPolicy;
    const canRetry = !!retryPolicy && stepState.attempt < retryPolicy.attempts;

    stepState.status = canRetry ? "retrying" : "failed";
    stepState.lastError = {
      code: error?.code,
      message: error?.message || String(error ?? "Error inesperado"),
      retryable: canRetry,
    };

    const updatePayload: Record<string, any> = {
      status: stepState.status,
      error: stepState.lastError.message,
      retryCount: stepState.attempt,
    };
    if (!canRetry) {
      updatePayload.completedAt = new Date();
    }

    await this.store.updateStepStatus(stepState.stepId, updatePayload);

    await this.emitTrace(
      canRetry ? "step_retried" : "step_failed",
      {
        status: stepState.status,
        stepId: stepState.stepId,
        stepIndex: stepState.stepIndex,
        error: stepState.lastError,
        summary: stepState.lastError.message,
        metadata: {
          attempt: stepState.attempt,
          retryable: canRetry,
        },
      },
      { step: stepState, span: stepSpan, severity: canRetry ? "warning" : "error" },
    );

    stepSpan.setStatus({ code: SpanStatusCode.ERROR, message: stepState.lastError.message });

    if (canRetry && !this.cancelRequested) {
      const backoff = Math.min(
        (retryPolicy!.backoffMs || DEFAULT_BACKOFF_MS) * stepState.attempt,
        retryPolicy!.maxBackoffMs || Number.MAX_SAFE_INTEGER,
      );
      await this.delay(backoff);
      stepState.status = "queued";
      return;
    }
  }

  private async executeWithTimeout<T>(promise: Promise<T>, timeoutMs?: number): Promise<T> {
    const effectiveTimeout = (timeoutMs && timeoutMs > 0)
      ? timeoutMs
      : (Number(process.env.WORKFLOW_DEFAULT_STEP_TIMEOUT_MS) || 300000);

    return Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        setTimeout(() => reject(new Error(`Timeout ejecutando paso (${effectiveTimeout}ms)`)), effectiveTimeout);
      }),
    ]);
  }

  private async cancelRemainingSteps(): Promise<void> {
    const pending = Object.values(this.stepStates).filter((step) => step.status === "queued" || step.status === "retrying");

    await Promise.all(
      pending.map(async (step) => {
        step.status = "cancelled";
        await this.store.updateStepStatus(step.stepId, {
          status: "cancelled",
          completedAt: new Date(),
        });
      }),
    );
  }

  private async finalizeRun(status: WorkflowRunStatus, message?: string): Promise<void> {
    await this.store.updateRunStatus(this.runId, {
      status,
      completedAt: new Date(),
      error: status === "failed" ? message || "Error" : null,
    });

    let eventType: TraceEventType;
    if (status === "completed") {
      eventType = "run_completed";
    } else if (status === "cancelled") {
      eventType = "run_cancelled";
    } else {
      eventType = "run_failed";
    }

    await this.emitTrace(
      eventType,
      {
        status,
        summary: message,
        metadata: {
          completedSteps: this.completedSteps,
          totalSteps: this.definition.steps.length,
        },
      },
      { severity: status === "failed" ? "error" : status === "cancelled" ? "warning" : "info" },
    );

    const runDurationMs = Date.now() - this.runStartedAt;
    if (status === "completed" || status === "failed" || status === "cancelled") {
      recordRunStatus(status);
      recordRunDuration(status, runDurationMs);
      recordSlowRun(this.runId, runDurationMs, SLOW_RUN_THRESHOLD_MS);
    }

    this.emit("finished", status);
  }

  private async emitTrace(
    eventType: TraceEventType,
    payload: Record<string, any>,
    options: { step?: StepState; span?: Span; severity?: WorkflowEventSeverity } = {},
  ): Promise<void> {
    this.eventSeqCursor += 1;
    const eventSeq = this.eventSeqCursor;

    const activeSpan = options.span || this.runSpan;
    const spanContext = activeSpan?.spanContext();
    const traceId = spanContext?.traceId || this.traceId;
    const spanId = spanContext?.spanId;

    const eventSeverity = options.severity || this.mapEventSeverity(eventType);
    const correlationId = `${this.runId}:${eventSeq}:${eventType}`;

    const metadata = {
      ...(payload.metadata || {}),
      event_seq: eventSeq,
      correlation_id: correlationId,
      trace_id: traceId,
      span_id: spanId,
      severity: eventSeverity,
    };

    const storeResult = await this.store.appendEventIdempotent({
      runId: this.runId,
      eventSeq,
      correlationId,
      eventType,
      stepId: options.step?.stepId ?? payload.stepId ?? null,
      stepIndex: options.step?.stepIndex ?? payload.stepIndex ?? null,
      traceId,
      spanId: spanId ?? null,
      severity: eventSeverity,
      payload,
      metadata,
      timestamp: new Date(),
    });

    if (!storeResult.inserted) {
      return;
    }

    await agentEventBus.emit(
      this.runId,
      eventType,
      {
        ...payload,
        stepId: options.step?.stepId ?? payload.stepId,
        stepIndex: options.step?.stepIndex ?? payload.stepIndex,
        event_seq: eventSeq,
        correlation_id: correlationId,
        trace_id: traceId,
        span_id: spanId,
        severity: eventSeverity,
        metadata,
      },
      { persist: false },
    );
  }

  private mapEventSeverity(eventType: TraceEventType): WorkflowEventSeverity {
    if (["run_failed", "step_failed", "error", "tool_call_failed"].includes(eventType)) {
      return "error";
    }
    if (["step_retried", "run_cancelled", "cancelled"].includes(eventType)) {
      return "warning";
    }
    return "info";
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export class WorkflowRunner {
  private readonly executions = new Map<string, WorkflowRunInstance>();
  private readonly lockManager = new RunLockManager();

  constructor(
    private readonly store: WorkflowStore,
    private readonly executors: StepExecutorRegistry,
  ) {
    if (!executors.getExecutor(NOOP_EXECUTOR_KEY)) {
      executors.registerExecutor(NOOP_EXECUTOR_KEY, async () => ({ success: true }));
    }
  }

  async startWorkflow(submission: WorkflowSubmission): Promise<{ runId: string }> {
    if (submission.idempotencyKey) {
      const existing = await this.store.getRunByIdempotencyKey(submission.chatId, submission.idempotencyKey);
      if (existing) {
        return { runId: existing.id };
      }
    }

    const runId = randomUUID();
    const startLockKey = submission.idempotencyKey ? `${submission.chatId}:${submission.idempotencyKey}` : runId;

    let run;
    try {
      run = await this.lockManager.withLock(startLockKey, DEFAULT_LOCK_TIMEOUT_MS, async () => {
        return this.store.createRun({
          runId,
          chatId: submission.chatId,
          userId: submission.userId || null,
          plan: submission.plan,
          idempotencyKey: submission.idempotencyKey || null,
        });
      });
    } catch (error: any) {
      if (error?.message?.includes("Timeout waiting for lock")) {
        recordRunLockTimeout("start", startLockKey);
      }
      throw error;
    }

    // If createRun returned an existing idempotent run, do not start a duplicate execution.
    if (run.id !== runId) {
      return { runId: run.id };
    }

    recordRunStatus("created");

    const stepMap = await this.store.createSteps(runId, submission.plan.steps);
    const runInstance = new WorkflowRunInstance(
      this.store,
      submission.plan,
      runId,
      submission.chatId,
      submission.traceId || runId,
      this.executors,
      stepMap,
      {
        userId: submission.userId,
        userPlan: submission.userPlan,
        variables: submission.variables,
      },
    );

    this.executions.set(runId, runInstance);

    runInstance
      .start()
      .catch((error) => {
        console.error(`[WorkflowRunner] Run ${runId} failed:`, error);
      })
      .finally(() => {
        this.executions.delete(runId);
      });

    return { runId };
  }

  async cancelRun(runId: string): Promise<{ cancelled: boolean }> {
    try {
      return await this.lockManager.withLock(runId, DEFAULT_LOCK_TIMEOUT_MS, async () => {
        const run = this.executions.get(runId);
        if (run) {
          run.requestCancel();
          return { cancelled: true };
        }

        const persisted = await this.store.loadRun(runId);
        if (!persisted) {
          return { cancelled: false };
        }

        if (["completed", "failed", "cancelled"].includes(persisted.status)) {
          return { cancelled: false };
        }

        await this.store.updateRunStatus(runId, {
          status: "cancelled",
          completedAt: new Date(),
          error: "Cancelado por el usuario",
        });
        await this.store.cancelPendingSteps(runId);

        const lastSeq = await this.store.getLastEventSeq(runId);
        await this.store.appendEventIdempotent({
          runId,
          eventSeq: lastSeq + 1,
          correlationId: `${runId}:${lastSeq + 1}:run_cancelled`,
          eventType: "run_cancelled",
          traceId: runId,
          severity: "warning",
          payload: {
            status: "cancelled",
            summary: "Cancelado por el usuario",
          },
          metadata: {
            event_seq: lastSeq + 1,
          },
          timestamp: new Date(),
        });

        await agentEventBus.emit(
          runId,
          "run_cancelled",
          {
            status: "cancelled",
            summary: "Cancelado por el usuario",
            event_seq: lastSeq + 1,
            severity: "warning",
          },
          { persist: false },
        );

        return { cancelled: true };
      });
    } catch (error: any) {
      if (error?.message?.includes("Timeout waiting for lock")) {
        recordRunLockTimeout("cancel", runId);
      }
      throw error;
    }
  }
}
