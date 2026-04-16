import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { z } from "zod";
import {
  Run,
  RunSchema,
  CreateRunRequest,
  CreateRunRequestSchema,
  RunResponse,
  RunResponseSchema,
  RunResultPackage,
  RunResultPackageSchema,
  Step,
  Artifact,
  AgentPlan,
  RoleTransition,
  AgentRole,
} from "./contracts";
import { RunStateMachine, StepStateMachine, RunStatus } from "./stateMachine";
import { eventLogger, logRunEvent, EventType } from "./eventLogger";
import { CancellationToken, CancellationError, executionEngine, resourceCleanup } from "./executionEngine";
import { plannerAgent, PlanningContext } from "./roles/plannerAgent";
import { executorAgent, ExecutionContext, StepResult, Citation } from "./roles/executorAgent";
import { verifierAgent, RunResultPackage as VerifierPackage } from "./roles/verifierAgent";
import { storage } from "../storage";
import { db } from "../db";
import { agentRuns, agentSteps, agentAssets, agentModeEvents, agentModeRuns, agentModeSteps } from "@shared/schema";
import { eq } from "drizzle-orm";

export const RunControllerConfigSchema = z.object({
  maxConcurrentRuns: z.number().int().positive().default(5),
  defaultTimeoutMs: z.number().int().positive().default(300000),
  maxRetries: z.number().int().nonnegative().default(3),
  enableVerification: z.boolean().default(true),
});
export type RunControllerConfig = z.infer<typeof RunControllerConfigSchema>;

interface QueuedRun {
  runId: string;
  userId: string;
  resolve: () => void;
  reject: (error: Error) => void;
}

interface ActiveRunContext {
  run: Run;
  stateMachine: RunStateMachine;
  cancellationToken: CancellationToken;
  stepResults: Map<number, StepResult>;
  artifacts: Artifact[];
  citations: Citation[];
  roleTransitions: RoleTransition[];
  startTime: number;
  planningDurationMs?: number;
  executionDurationMs?: number;
  verificationDurationMs?: number;
}

export class RunController extends EventEmitter {
  private config: RunControllerConfig;
  private activeRuns: Map<string, ActiveRunContext> = new Map();
  private cancellationTokens: Map<string, CancellationToken> = new Map();
  private runQueue: QueuedRun[] = [];
  private currentConcurrency: number = 0;
  private pausedRuns: Set<string> = new Set();

  constructor(config: Partial<RunControllerConfig> = {}) {
    super();
    this.config = RunControllerConfigSchema.parse(config);
  }

  async createRun(request: CreateRunRequest, userId: string): Promise<Run> {
    const validatedRequest = CreateRunRequestSchema.parse(request);
    const runId = randomUUID();
    const correlationId = randomUUID();
    const now = new Date();

    const run: Run = {
      id: runId,
      chatId: validatedRequest.chatId,
      messageId: validatedRequest.messageId,
      userId,
      status: "queued",
      steps: [],
      artifacts: [],
      correlationId,
      idempotencyKey: validatedRequest.idempotencyKey,
      currentStepIndex: 0,
      totalSteps: 0,
      completedSteps: 0,
      createdAt: now,
      updatedAt: now,
      metadata: {
        originalMessage: validatedRequest.message,
        attachments: validatedRequest.attachments,
      },
    };

    await db.insert(agentModeRuns).values({
      id: runId,
      chatId: validatedRequest.chatId,
      messageId: validatedRequest.messageId,
      userId,
      status: "queued",
      idempotencyKey: validatedRequest.idempotencyKey,
    });

    await logRunEvent(runId, correlationId, "run_created", {
      chatId: validatedRequest.chatId,
      userId,
      message: validatedRequest.message,
    });

    this.emit("runCreated", run);
    console.log(`[RunController] Created run ${runId} for user ${userId}`);

    return run;
  }

  async startRun(runId: string): Promise<void> {
    const existingContext = this.activeRuns.get(runId);
    if (existingContext) {
      throw new Error(`Run ${runId} is already active`);
    }

    const run = await this.loadRun(runId);
    if (!run) {
      throw new Error(`Run ${runId} not found`);
    }

    if (run.status !== "queued" && run.status !== "paused") {
      throw new Error(`Cannot start run ${runId} in status ${run.status}`);
    }

    if (this.currentConcurrency >= this.config.maxConcurrentRuns) {
      await this.enqueueRun(runId, run.userId);
      return;
    }

    this.currentConcurrency++;
    setImmediate(() => {
      this.executeRunAsync(run).catch((error) => {
        console.error(`[RunController] Run ${runId} failed:`, error);
      });
    });
  }

  async pauseRun(runId: string, reason?: string): Promise<boolean> {
    const context = this.activeRuns.get(runId);
    if (!context) {
      console.warn(`[RunController] Cannot pause run ${runId}: not active`);
      return false;
    }

    if (!context.stateMachine.canTransitionTo("paused")) {
      console.warn(`[RunController] Cannot pause run ${runId} in status ${context.stateMachine.getStatus()}`);
      return false;
    }

    this.pausedRuns.add(runId);

    const token = this.cancellationTokens.get(runId);
    if (token) {
      await token.cancel(reason || "Run paused by user");
    }

    context.stateMachine.transition("paused", reason);
    context.run.status = "paused";
    context.run.updatedAt = new Date();

    await logRunEvent(runId, context.run.correlationId, "run_paused", {
      reason,
      currentStepIndex: context.run.currentStepIndex,
    });

    this.emit("runPaused", { runId, reason });
    console.log(`[RunController] Paused run ${runId}: ${reason || "no reason"}`);

    return true;
  }

  async resumeRun(runId: string): Promise<boolean> {
    if (!this.pausedRuns.has(runId)) {
      console.warn(`[RunController] Run ${runId} is not paused`);
      return false;
    }

    const context = this.activeRuns.get(runId);
    if (context && !context.stateMachine.canTransitionTo("running")) {
      console.warn(`[RunController] Cannot resume run ${runId} from status ${context.stateMachine.getStatus()}`);
      return false;
    }

    this.pausedRuns.delete(runId);

    const newToken = new CancellationToken();
    this.cancellationTokens.set(runId, newToken);

    if (context) {
      context.cancellationToken = newToken;
      context.stateMachine.transition("running", "Resumed by user");
      context.run.status = "running";
      context.run.updatedAt = new Date();
    }

    await logRunEvent(
      runId,
      context?.run.correlationId || runId,
      "run_resumed",
      { resumedAt: new Date().toISOString() }
    );

    this.emit("runResumed", { runId });
    console.log(`[RunController] Resumed run ${runId}`);

    if (context) {
      setImmediate(() => {
        this.continueExecution(context).catch((error) => {
          console.error(`[RunController] Resume failed for run ${runId}:`, error);
        });
      });
    }

    return true;
  }

  async cancelRun(runId: string, reason?: string): Promise<boolean> {
    const context = this.activeRuns.get(runId);

    const queueIndex = this.runQueue.findIndex((q) => q.runId === runId);
    if (queueIndex !== -1) {
      const queued = this.runQueue.splice(queueIndex, 1)[0];
      queued.reject(new Error(reason || "Cancelled while queued"));
      console.log(`[RunController] Cancelled queued run ${runId}`);
      return true;
    }

    if (!context) {
      console.warn(`[RunController] Cannot cancel run ${runId}: not active`);
      return false;
    }

    const token = this.cancellationTokens.get(runId);
    if (token) {
      await token.cancel(reason || "Cancelled by user");
    }

    if (context.stateMachine.canTransitionTo("cancelled")) {
      context.stateMachine.transition("cancelled", reason);
      context.run.status = "cancelled";
      context.run.error = reason;
      context.run.updatedAt = new Date();
      context.run.completedAt = new Date();
    }

    await logRunEvent(runId, context.run.correlationId, "run_cancelled", {
      reason,
      cancelledAt: new Date().toISOString(),
      completedSteps: context.run.completedSteps,
    });

    this.cleanupRun(runId);
    this.emit("runCancelled", { runId, reason });
    console.log(`[RunController] Cancelled run ${runId}: ${reason || "no reason"}`);

    return true;
  }

  async retryRun(runId: string): Promise<Run> {
    const originalRun = await this.loadRun(runId);
    if (!originalRun) {
      throw new Error(`Run ${runId} not found`);
    }

    if (originalRun.status !== "failed" && originalRun.status !== "cancelled") {
      throw new Error(`Cannot retry run ${runId} in status ${originalRun.status}`);
    }

    const retryCount = (originalRun.metadata?.retryCount || 0) + 1;
    if (retryCount > this.config.maxRetries) {
      throw new Error(`Maximum retry count (${this.config.maxRetries}) exceeded for run ${runId}`);
    }

    const newRun = await this.createRun(
      {
        chatId: originalRun.chatId,
        messageId: originalRun.messageId,
        message: originalRun.metadata?.originalMessage || originalRun.plan?.objective || "",
        idempotencyKey: `${originalRun.idempotencyKey || runId}-retry-${retryCount}`,
      },
      originalRun.userId
    );

    newRun.metadata = {
      ...newRun.metadata,
      originalRunId: runId,
      retryCount,
      originalError: originalRun.error,
    };

    await logRunEvent(newRun.id, newRun.correlationId, "run_created", {
      isRetry: true,
      originalRunId: runId,
      retryCount,
    });

    console.log(`[RunController] Created retry run ${newRun.id} from ${runId} (attempt ${retryCount})`);

    return newRun;
  }

  async getRunStatus(runId: string): Promise<RunResponse> {
    const context = this.activeRuns.get(runId);

    if (context) {
      return this.buildRunResponse(context.run);
    }

    const run = await this.loadRun(runId);
    if (!run) {
      throw new Error(`Run ${runId} not found`);
    }

    return this.buildRunResponse(run);
  }

  async getRunResult(runId: string): Promise<RunResultPackage> {
    const run = await this.loadRun(runId);
    if (!run) {
      throw new Error(`Run ${runId} not found`);
    }

    if (run.status !== "completed" && run.status !== "failed") {
      throw new Error(`Run ${runId} is not finished (status: ${run.status})`);
    }

    const context = this.activeRuns.get(runId);
    const events = await eventLogger.getEventsForRun(runId);

    const allArtifacts = context?.artifacts || run.artifacts || [];

    let allCitations = context?.citations || [];
    if (allCitations.length === 0) {
      const citationEvents = await db.select().from(agentModeEvents)
        .where(eq(agentModeEvents.runId, runId));
      const citationRows = citationEvents.filter((e) => e.eventType === "citation_extracted");
      allCitations = citationRows.map((e) => {
        const payload = e.payload as { sourceUrl?: string; sourceTitle?: string; excerpt?: string; confidence?: number };
        return {
          id: e.id,
          stepIndex: e.stepIndex || 0,
          sourceUrl: payload.sourceUrl || "",
          sourceTitle: payload.sourceTitle || "",
          excerpt: payload.excerpt || "",
          confidence: payload.confidence || 0,
          createdAt: e.timestamp,
        };
      });
    }

    const now = Date.now();
    const planningMs = context?.planningDurationMs || 0;
    const executionMs = context?.executionDurationMs || 0;
    const verificationMs = context?.verificationDurationMs || 0;
    const totalDurationMs = run.completedAt && run.startedAt
      ? new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()
      : now - (context?.startTime || now);

    const citationCoverage = allCitations.length > 0 ? 1 : 0;

    const result: RunResultPackage = {
      finalAnswer: run.summary || "",
      artifacts: allArtifacts,
      citations: allCitations.map((c) => ({
        id: c.id,
        sourceUrl: c.sourceUrl || "",
        sourceTitle: c.sourceTitle || "",
        quote: (c.excerpt || "").slice(0, 500),
        locator: `step:${c.stepIndex}`,
        confidence: c.confidence,
        retrievedAt: c.createdAt,
      })),
      runLog: events.map((e) => ({
        id: e.id,
        runId: e.runId,
        stepIndex: e.stepIndex,
        correlationId: e.correlationId,
        eventType: e.eventType,
        payload: e.payload,
        timestamp: e.timestamp,
        metadata: e.metadata,
      })),
      metrics: {
        totalDurationMs,
        planningMs,
        executionMs,
        verificationMs,
        toolCalls: run.completedSteps,
        citationCoverage,
      },
      status: run.status,
      error: run.error,
    };

    return result;
  }

  private async executeRunAsync(run: Run): Promise<void> {
    const stateMachine = new RunStateMachine(run.id, run.status as RunStatus);
    const cancellationToken = new CancellationToken();
    cancellationToken.setCorrelationId(run.correlationId);

    this.cancellationTokens.set(run.id, cancellationToken);

    const context: ActiveRunContext = {
      run,
      stateMachine,
      cancellationToken,
      stepResults: new Map(),
      artifacts: [],
      citations: [],
      roleTransitions: [],
      startTime: Date.now(),
    };

    this.activeRuns.set(run.id, context);

    try {
      run.startedAt = new Date();
      run.updatedAt = new Date();
      run.status = "planning";
      stateMachine.transition("planning", "Starting execution");

      await db.update(agentModeRuns)
        .set({ startedAt: run.startedAt, status: "planning" })
        .where(eq(agentModeRuns.id, run.id));

      await logRunEvent(run.id, run.correlationId, "run_started", {
        startedAt: run.startedAt.toISOString(),
      });

      this.emitRoleTransition(context, "planner", "executor", "Starting planning phase");
      await this.planningPhase(context);

      if (cancellationToken.isCancelled || this.pausedRuns.has(run.id)) {
        return;
      }

      stateMachine.transition("running", "Plan generated, executing steps");
      run.status = "running";
      run.updatedAt = new Date();

      await db.update(agentModeRuns)
        .set({ status: "running", plan: run.plan as any, totalSteps: run.totalSteps })
        .where(eq(agentModeRuns.id, run.id));

      this.emitRoleTransition(context, "executor", "executor", "Starting execution phase");
      await this.executionPhase(context);

      if (cancellationToken.isCancelled || this.pausedRuns.has(run.id)) {
        return;
      }

      if (this.config.enableVerification) {
        stateMachine.transition("verifying", "All steps completed, verifying results");
        run.status = "verifying";
        run.updatedAt = new Date();

        this.emitRoleTransition(context, "executor", "verifier", "Starting verification phase");
        await this.verificationPhase(context);
      }

      stateMachine.transition("completed", "Run completed successfully");
      run.status = "completed";
      run.completedAt = new Date();
      run.updatedAt = new Date();

      await logRunEvent(run.id, run.correlationId, "run_completed", {
        completedAt: run.completedAt.toISOString(),
        totalSteps: run.totalSteps,
        completedSteps: run.completedSteps,
        artifactCount: context.artifacts.length,
      });

      const result = await this.getRunResult(run.id);
      await this.persistRunResult(run.id, context, result);

      this.emit("runCompleted", { runId: run.id, result });
    } catch (error: any) {
      await this.handleRunError(context, error);
    } finally {
      this.cleanupRun(run.id);
      this.processQueue();
    }
  }

  private async planningPhase(context: ActiveRunContext): Promise<void> {
    const { run, cancellationToken } = context;
    const planningStart = Date.now();

    try {
      cancellationToken.throwIfCancelled();

      const planningContext: PlanningContext = {
        userId: run.userId,
        userPlan: "pro",
        chatId: run.chatId,
        runId: run.id,
        correlationId: run.correlationId,
        maxSteps: 10,
        requireCitations: true,
      };

      const objective = run.metadata?.originalMessage || "";
      const plan = await plannerAgent.generatePlan(objective, planningContext);

      run.plan = plan;
      run.totalSteps = plan.steps.length;
      run.steps = plan.steps.map((step, index) => ({
        id: randomUUID(),
        runId: run.id,
        stepIndex: index,
        toolName: step.toolName,
        description: step.description,
        status: "pending",
        input: step.input,
        retryCount: 0,
      }));
      run.updatedAt = new Date();

      context.planningDurationMs = Date.now() - planningStart;

      await db.update(agentModeRuns)
        .set({ plan: run.plan as any, totalSteps: run.totalSteps })
        .where(eq(agentModeRuns.id, run.id));

      for (const step of run.steps) {
        await db.insert(agentModeSteps).values({
          id: step.id,
          runId: run.id,
          stepIndex: step.stepIndex,
          toolName: step.toolName,
          toolInput: step.input || {},
          status: step.status,
          retryCount: 0,
        }).onConflictDoNothing();
      }

      console.log(`[RunController] Planning completed for run ${run.id}: ${plan.steps.length} steps`);
    } catch (error: any) {
      context.planningDurationMs = Date.now() - planningStart;
      throw error;
    }
  }

  private async executionPhase(context: ActiveRunContext): Promise<void> {
    const { run, cancellationToken, stepResults } = context;
    const executionStart = Date.now();

    try {
      if (!run.plan) {
        throw new Error("No plan available for execution");
      }

      const executionContext: ExecutionContext = {
        userId: run.userId,
        userPlan: "pro",
        chatId: run.chatId,
        runId: run.id,
        correlationId: run.correlationId,
        cancellationToken,
        previousResults: stepResults,
      };

      for (const step of run.plan.steps) {
        cancellationToken.throwIfCancelled();

        if (this.pausedRuns.has(run.id)) {
          console.log(`[RunController] Run ${run.id} paused at step ${step.index}`);
          return;
        }

        run.currentStepIndex = step.index;
        run.updatedAt = new Date();

        const deps = step.dependencies || [];
        for (const depIndex of deps) {
          const depResult = stepResults.get(depIndex);
          if (!depResult?.success && !run.plan.steps[depIndex].optional) {
            const runStep = run.steps[step.index];
            if (runStep) {
              runStep.status = "skipped";
            }

            await logRunEvent(run.id, run.correlationId, "step_skipped", {
              stepIndex: step.index,
              reason: `Dependency step ${depIndex} failed`,
            });

            continue;
          }
        }

        const runStep = run.steps[step.index];
        if (runStep) {
          runStep.status = "running";
          runStep.startedAt = new Date();
        }

        try {
          const result = await executorAgent.executeStep(step, executionContext);
          stepResults.set(step.index, result);

          if (runStep) {
            runStep.status = result.success ? "succeeded" : "failed";
            runStep.output = result.output;
            runStep.completedAt = new Date();
            runStep.durationMs = result.durationMs;
            runStep.retryCount = result.retryCount;
            runStep.error = result.error?.message;
          }

          if (result.success) {
            run.completedSteps++;
            context.artifacts.push(...result.artifacts);
            const citationsWithIds = result.citations.map((c) => ({
              ...c,
              id: c.id || randomUUID(),
            }));
            context.citations.push(...citationsWithIds);
          } else if (!step.optional) {
            console.warn(`[RunController] Required step ${step.index} failed: ${result.error?.message}`);
          }

          await db.update(agentModeRuns)
            .set({ completedSteps: run.completedSteps, currentStepIndex: run.currentStepIndex })
            .where(eq(agentModeRuns.id, run.id));

          if (runStep) {
            await db.update(agentModeSteps)
              .set({
                toolOutput: runStep.output,
                status: runStep.status,
                error: runStep.error,
                startedAt: runStep.startedAt,
                completedAt: runStep.completedAt,
                retryCount: runStep.retryCount,
              })
              .where(eq(agentModeSteps.id, runStep.id));
          }
        } catch (error: any) {
          if (error instanceof CancellationError) {
            throw error;
          }

          if (runStep) {
            runStep.status = "failed";
            runStep.completedAt = new Date();
            runStep.error = error.message;
          }

          if (!step.optional) {
            throw error;
          }
        }

        run.updatedAt = new Date();
      }

      context.executionDurationMs = Date.now() - executionStart;

      console.log(`[RunController] Execution completed for run ${run.id}: ${run.completedSteps}/${run.totalSteps} steps`);
    } catch (error: any) {
      context.executionDurationMs = Date.now() - executionStart;
      throw error;
    }
  }

  private async verificationPhase(context: ActiveRunContext): Promise<void> {
    const { run, stepResults, artifacts, citations } = context;
    const verificationStart = Date.now();

    try {
      const verifierPackage: VerifierPackage = {
        runId: run.id,
        correlationId: run.correlationId,
        objective: run.plan?.objective || run.metadata?.originalMessage || "",
        stepResults: Array.from(stepResults.values()),
        artifacts,
        citations,
        summary: run.summary,
      };

      const verificationResult = await verifierAgent.verify(verifierPackage);

      context.verificationDurationMs = Date.now() - verificationStart;

      run.metadata = {
        ...run.metadata,
        verification: {
          passed: verificationResult.passed,
          score: verificationResult.score,
          citationCoverage: verificationResult.citationCoverage,
          artifactIntegrity: verificationResult.artifactIntegrity,
          issueCount: verificationResult.issues.length,
          gapCount: verificationResult.gapsRequiringResearch.length,
        },
      };

      if (!verificationResult.passed) {
        console.warn(`[RunController] Verification failed for run ${run.id}: score ${verificationResult.score}`);
      }

      console.log(`[RunController] Verification completed for run ${run.id}: passed=${verificationResult.passed}`);
    } catch (error: any) {
      context.verificationDurationMs = Date.now() - verificationStart;
      console.error(`[RunController] Verification error for run ${run.id}:`, error);
    }
  }

  private async continueExecution(context: ActiveRunContext): Promise<void> {
    const { run, stateMachine } = context;

    try {
      if (stateMachine.getStatus() === "running") {
        await this.executionPhase(context);
      }

      if (!context.cancellationToken.isCancelled && !this.pausedRuns.has(run.id)) {
        if (this.config.enableVerification && stateMachine.canTransitionTo("verifying")) {
          stateMachine.transition("verifying", "Resuming verification");
          run.status = "verifying";
          await this.verificationPhase(context);
        }

        stateMachine.transition("completed", "Run completed after resume");
        run.status = "completed";
        run.completedAt = new Date();
        run.updatedAt = new Date();

        await logRunEvent(run.id, run.correlationId, "run_completed", {
          completedAt: run.completedAt.toISOString(),
          wasResumed: true,
        });

        const result = await this.getRunResult(run.id);
        await this.persistRunResult(run.id, context, result);

        this.emit("runCompleted", { runId: run.id, result });
      }
    } catch (error: any) {
      await this.handleRunError(context, error);
    } finally {
      this.cleanupRun(run.id);
      this.processQueue();
    }
  }

  private async handleRunError(context: ActiveRunContext, error: any): Promise<void> {
    const { run, stateMachine } = context;

    if (error instanceof CancellationError) {
      console.log(`[RunController] Run ${run.id} was cancelled: ${error.message}`);
      return;
    }

    console.error(`[RunController] Run ${run.id} failed:`, error);

    if (stateMachine.canTransitionTo("failed")) {
      stateMachine.transition("failed", error.message);
      run.status = "failed";
      run.error = error.message;
      run.completedAt = new Date();
      run.updatedAt = new Date();
    }

    await logRunEvent(run.id, run.correlationId, "run_failed", {
      error: error.message,
      stack: error.stack,
      completedSteps: run.completedSteps,
      totalSteps: run.totalSteps,
    });

    try {
      await db.update(agentModeRuns)
        .set({
          status: "failed",
          completedAt: run.completedAt,
          error: run.error,
          plan: run.plan as any,
          artifacts: context.artifacts as any,
          totalSteps: run.totalSteps,
          completedSteps: run.completedSteps,
          currentStepIndex: run.currentStepIndex,
        })
        .where(eq(agentModeRuns.id, run.id));

      for (const step of run.steps) {
        await db.update(agentModeSteps)
          .set({
            toolOutput: step.output,
            status: step.status,
            error: step.error,
            completedAt: step.completedAt,
            retryCount: step.retryCount,
          })
          .where(eq(agentModeSteps.id, step.id));
      }

      for (const citation of context.citations) {
        await db.insert(agentModeEvents).values({
          id: citation.id || randomUUID(),
          runId: run.id,
          stepIndex: citation.stepIndex,
          correlationId: run.correlationId,
          eventType: "citation_extracted",
          payload: {
            sourceUrl: citation.sourceUrl,
            sourceTitle: citation.sourceTitle,
            excerpt: citation.excerpt,
            confidence: citation.confidence,
          },
          timestamp: citation.createdAt,
        }).onConflictDoNothing();
      }
    } catch (persistError) {
      console.error(`[RunController] Failed to persist failed run ${run.id}:`, persistError);
    }

    this.emit("runFailed", { runId: run.id, error: error.message });
  }

  private emitRoleTransition(
    context: ActiveRunContext,
    fromRole: AgentRole,
    toRole: AgentRole,
    reason: string
  ): void {
    const transition: RoleTransition = {
      fromRole,
      toRole,
      timestamp: new Date(),
      reason,
    };

    context.roleTransitions.push(transition);
    this.emit("roleTransition", { runId: context.run.id, transition });
  }

  private cleanupRun(runId: string): void {
    const context = this.activeRuns.get(runId);
    if (context) {
      resourceCleanup.cleanup(context.run.correlationId).catch((err) => {
        console.error(`[RunController] Cleanup failed for run ${runId}:`, err);
      });
    }

    this.activeRuns.delete(runId);
    this.cancellationTokens.delete(runId);
    this.pausedRuns.delete(runId);
    this.currentConcurrency = Math.max(0, this.currentConcurrency - 1);

    console.log(`[RunController] Cleaned up run ${runId}, concurrency: ${this.currentConcurrency}`);
  }

  private async enqueueRun(runId: string, userId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.runQueue.push({ runId, userId, resolve, reject });
      console.log(`[RunController] Run ${runId} queued (position: ${this.runQueue.length})`);
    });
  }

  private processQueue(): void {
    while (
      this.runQueue.length > 0 &&
      this.currentConcurrency < this.config.maxConcurrentRuns
    ) {
      const queued = this.runQueue.shift();
      if (queued) {
        queued.resolve();
        this.startRun(queued.runId).catch((error) => {
          console.error(`[RunController] Failed to start queued run ${queued.runId}:`, error);
        });
      }
    }
  }

  private async loadRun(runId: string): Promise<Run | null> {
    const context = this.activeRuns.get(runId);
    if (context) {
      return context.run;
    }

    try {
      const [dbRun] = await db.select().from(agentModeRuns).where(eq(agentModeRuns.id, runId));
      if (!dbRun) {
        const legacyRun = await storage.getAgentRun(runId);
        if (!legacyRun) return null;
        return {
          id: legacyRun.id,
          chatId: legacyRun.conversationId || "",
          userId: "",
          status: this.mapDbStatus(legacyRun.status),
          steps: [],
          artifacts: [],
          correlationId: randomUUID(),
          currentStepIndex: 0,
          totalSteps: 0,
          completedSteps: 0,
          startedAt: legacyRun.startedAt,
          completedAt: legacyRun.completedAt || undefined,
          createdAt: legacyRun.startedAt,
          updatedAt: legacyRun.startedAt,
          error: legacyRun.error || undefined,
          metadata: { objective: legacyRun.objective },
        };
      }

      const dbSteps = await db.select().from(agentModeSteps).where(eq(agentModeSteps.runId, runId));

      const plan = dbRun.plan as AgentPlan | null;
      const planSteps = plan?.steps || [];

      const steps = dbSteps.map((s) => {
        const planStep = planSteps.find((ps) => ps.index === s.stepIndex);
        return {
          id: s.id,
          runId: s.runId,
          stepIndex: s.stepIndex,
          toolName: s.toolName,
          description: planStep?.description || "",
          status: s.status as "pending" | "running" | "succeeded" | "failed" | "skipped",
          input: s.toolInput,
          output: s.toolOutput,
          error: s.error || undefined,
          startedAt: s.startedAt || undefined,
          completedAt: s.completedAt || undefined,
          retryCount: s.retryCount || 0,
        };
      });

      const artifacts = (dbRun.artifacts as Artifact[]) || [];

      const run: Run = {
        id: dbRun.id,
        chatId: dbRun.chatId || "",
        messageId: dbRun.messageId || undefined,
        userId: dbRun.userId || "",
        status: this.mapDbStatus(dbRun.status),
        plan: plan || undefined,
        steps,
        artifacts,
        correlationId: randomUUID(),
        currentStepIndex: dbRun.currentStepIndex || 0,
        totalSteps: dbRun.totalSteps || 0,
        completedSteps: dbRun.completedSteps || 0,
        summary: dbRun.summary || undefined,
        startedAt: dbRun.startedAt || undefined,
        completedAt: dbRun.completedAt || undefined,
        createdAt: dbRun.createdAt,
        updatedAt: dbRun.createdAt,
        error: dbRun.error || undefined,
        idempotencyKey: dbRun.idempotencyKey || undefined,
        metadata: plan ? { originalMessage: plan.objective } : {},
      };

      return run;
    } catch (error) {
      console.error(`[RunController] Failed to load run ${runId}:`, error);
      return null;
    }
  }

  private mapDbStatus(status: string): RunStatus {
    const statusMap: Record<string, RunStatus> = {
      pending: "queued",
      queued: "queued",
      planning: "planning",
      running: "running",
      verifying: "verifying",
      completed: "completed",
      succeeded: "completed",
      failed: "failed",
      cancelled: "cancelled",
    };
    return statusMap[status] || "queued";
  }

  private async persistRunResult(
    runId: string,
    context: ActiveRunContext,
    result: RunResultPackage
  ): Promise<void> {
    try {
      await db.update(agentModeRuns)
        .set({
          status: context.run.status === "completed" ? "succeeded" : "failed",
          startedAt: context.run.startedAt,
          completedAt: context.run.completedAt,
          error: context.run.error,
          plan: context.run.plan as any,
          artifacts: context.artifacts as any,
          summary: context.run.summary,
          totalSteps: context.run.totalSteps,
          completedSteps: context.run.completedSteps,
          currentStepIndex: context.run.currentStepIndex,
        })
        .where(eq(agentModeRuns.id, runId));

      for (const step of context.run.steps) {
        await db.insert(agentModeSteps).values({
          id: step.id,
          runId,
          stepIndex: step.stepIndex,
          toolName: step.toolName,
          toolInput: step.input || {},
          toolOutput: step.output,
          status: step.status,
          error: step.error,
          startedAt: step.startedAt,
          completedAt: step.completedAt,
          retryCount: step.retryCount,
        }).onConflictDoUpdate({
          target: [agentModeSteps.id],
          set: {
            toolOutput: step.output,
            status: step.status,
            error: step.error,
            completedAt: step.completedAt,
            retryCount: step.retryCount,
          },
        });
      }

      for (const citation of context.citations) {
        await db.insert(agentModeEvents).values({
          id: citation.id,
          runId,
          stepIndex: citation.stepIndex,
          correlationId: context.run.correlationId,
          eventType: "citation_extracted",
          payload: {
            sourceUrl: citation.sourceUrl,
            sourceTitle: citation.sourceTitle,
            excerpt: citation.excerpt,
            confidence: citation.confidence,
          },
          timestamp: citation.createdAt,
        }).onConflictDoNothing();
      }

      console.log(`[RunController] Persisted run result for ${runId}: ${context.run.steps.length} steps, ${context.artifacts.length} artifacts, ${context.citations.length} citations`);
    } catch (error) {
      console.error(`[RunController] Failed to persist run result for ${runId}:`, error);
    }
  }

  private buildRunResponse(run: Run): RunResponse {
    return {
      id: run.id,
      chatId: run.chatId,
      status: run.status,
      plan: run.plan,
      steps: run.steps.map((s) => ({
        stepIndex: s.stepIndex,
        toolName: s.toolName,
        description: s.description,
        status: s.status,
        output: s.output,
        error: s.error,
        startedAt: s.startedAt?.toISOString(),
        completedAt: s.completedAt?.toISOString(),
      })),
      artifacts: run.artifacts.map((a) => ({
        id: a.id,
        type: a.type,
        name: a.name,
        url: a.url,
      })),
      summary: run.summary,
      error: run.error,
      currentStepIndex: run.currentStepIndex,
      totalSteps: run.totalSteps,
      completedSteps: run.completedSteps,
      startedAt: run.startedAt?.toISOString(),
      completedAt: run.completedAt?.toISOString(),
      createdAt: run.createdAt.toISOString(),
    };
  }

  getActiveRunCount(): number {
    return this.activeRuns.size;
  }

  getQueuedRunCount(): number {
    return this.runQueue.length;
  }

  getConcurrency(): number {
    return this.currentConcurrency;
  }

  getMaxConcurrency(): number {
    return this.config.maxConcurrentRuns;
  }

  isRunActive(runId: string): boolean {
    return this.activeRuns.has(runId);
  }

  isRunPaused(runId: string): boolean {
    return this.pausedRuns.has(runId);
  }
}

export const runController = new RunController();
