import { z } from "zod";

export const RunStatusSchema = z.enum([
  "queued",
  "planning",
  "running",
  "verifying",
  "replanning",
  "awaiting_confirmation",
  "cancelling",
  "completed",
  "failed",
  "cancelled",
  "paused",
  "compensated"
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const StepStatusSchema = z.enum([
  "pending",
  "running",
  "verifying",
  "succeeded",
  "failed",
  "skipped",
  "cancelled",
  "compensated"
]);
export type StepStatus = z.infer<typeof StepStatusSchema>;

const RUN_TRANSITIONS: Record<RunStatus, RunStatus[]> = {
  queued: ["planning", "cancelled", "failed"],
  planning: ["running", "failed", "cancelled"],
  running: ["verifying", "failed", "cancelled", "paused"],
  verifying: ["completed", "failed", "cancelled"],
  replanning: ["running", "failed", "cancelled"],
  awaiting_confirmation: ["running", "cancelled", "failed"],
  cancelling: ["cancelled", "failed", "compensated"],
  completed: [],
  failed: ["queued", "compensated"],
  cancelled: ["queued", "compensated"],
  paused: ["running", "cancelled"],
  compensated: [],
};

const STEP_TRANSITIONS: Record<StepStatus, StepStatus[]> = {
  pending: ["running", "skipped", "cancelled"],
  running: ["succeeded", "failed", "cancelled", "verifying"],
  verifying: ["succeeded", "failed"],
  succeeded: ["compensated"], // A succeeded step can be compensated during run rollback
  failed: ["running", "compensated"],
  skipped: [],
  cancelled: ["compensated"],
  compensated: [],
};

export interface TransitionGuard {
  condition: (context: TransitionContext) => boolean;
  message: string;
}

export interface TransitionContext {
  runId: string;
  fromStatus: RunStatus;
  toStatus: RunStatus;
  metadata?: Record<string, any>;
}

const RUN_TRANSITION_GUARDS: Partial<Record<RunStatus, Partial<Record<RunStatus, TransitionGuard[]>>>> = {
  queued: {
    planning: [{
      condition: (ctx) => ctx.metadata?.userId !== undefined,
      message: "userId required to start planning"
    }],
    cancelled: [{
      condition: () => true,
      message: "Cancellation always allowed from queued"
    }],
  },
  planning: {
    running: [{
      condition: (ctx) => ctx.metadata?.planGenerated !== false,
      message: "Plan must be generated before running"
    }, {
      condition: (ctx) => (ctx.metadata?.stepCount ?? 0) > 0,
      message: "Plan must have at least one step"
    }],
  },
  running: {
    verifying: [{
      condition: (ctx) => ctx.metadata?.allStepsCompleted !== false,
      message: "Cannot verify until all steps are completed"
    }],
    paused: [{
      condition: (ctx) => ctx.metadata?.canPause !== false,
      message: "Run cannot be paused at this moment"
    }],
  },
  verifying: {
    completed: [{
      condition: (ctx) => ctx.metadata?.verificationPassed !== false,
      message: "Verification must pass before completing"
    }],
  },
  failed: {
    queued: [{
      condition: (ctx) => ctx.metadata?.retryable !== false,
      message: "Run is not retryable"
    }, {
      condition: (ctx) => (ctx.metadata?.retryCount ?? 0) < (ctx.metadata?.maxRetries ?? 3),
      message: "Maximum retry count exceeded"
    }],
  },
  paused: {
    running: [{
      condition: (ctx) => ctx.metadata?.canResume !== false,
      message: "Run cannot be resumed"
    }],
  },
};

export class StateMachineError extends Error {
  constructor(
    public readonly entityType: "run" | "step",
    public readonly entityId: string,
    public readonly currentStatus: string,
    public readonly targetStatus: string
  ) {
    super(`Invalid ${entityType} transition: ${currentStatus} -> ${targetStatus} for ${entityId}`);
    this.name = "StateMachineError";
  }
}

export class RunStateMachine {
  private status: RunStatus;
  private readonly runId: string;
  private transitionHistory: Array<{
    from: RunStatus;
    to: RunStatus;
    timestamp: number;
    reason?: string;
  }> = [];
  private readonly maxHistorySize: number;
  private readonly onTransition?: (targetStatus: RunStatus, metadata?: Record<string, any>) => void | Promise<void>;

  constructor(
    runId: string,
    initialStatus: RunStatus = "queued",
    maxHistorySize: number = 100,
    onTransition?: (targetStatus: RunStatus, metadata?: Record<string, any>) => void | Promise<void>
  ) {
    this.runId = runId;
    this.status = initialStatus;
    this.maxHistorySize = maxHistorySize;
    this.onTransition = onTransition;
    this.transitionHistory.push({
      from: initialStatus,
      to: initialStatus,
      timestamp: Date.now(),
      reason: "initialization"
    });
  }

  getStatus(): RunStatus {
    return this.status;
  }

  getHistory() {
    return [...this.transitionHistory];
  }

  canTransitionTo(targetStatus: RunStatus): boolean {
    return RUN_TRANSITIONS[this.status].includes(targetStatus);
  }

  getValidTransitions(): RunStatus[] {
    return [...RUN_TRANSITIONS[this.status]];
  }

  transition(targetStatus: RunStatus, reason?: string): void {
    if (!this.canTransitionTo(targetStatus)) {
      throw new StateMachineError("run", this.runId, this.status, targetStatus);
    }

    const previousStatus = this.status;
    this.status = targetStatus;
    this.transitionHistory.push({
      from: previousStatus,
      to: targetStatus,
      timestamp: Date.now(),
      reason
    });

    if (this.transitionHistory.length > this.maxHistorySize) {
      this.transitionHistory.shift();
    }

    console.log(`[StateMachine] Run ${this.runId}: ${previousStatus} -> ${targetStatus}${reason ? ` (${reason})` : ""}`);

    if (this.onTransition) {
      // Fire-and-forget hook for db persistence
      void Promise.resolve(this.onTransition(targetStatus, { reason })).catch(err => {
        console.error(`[StateMachine] Error in onTransition hook for run ${this.runId}:`, err);
      });
    }
  }

  rollback(reason?: string): void {
    if (this.canTransitionTo("compensated")) {
      this.transition("compensated", reason || "Rollback initiated");
    } else {
      throw new Error(`Cannot rollback run ${this.runId} from status ${this.status}`);
    }
  }

  isTerminal(): boolean {
    return ["completed", "failed", "cancelled", "compensated"].includes(this.status);
  }

  isActive(): boolean {
    return ["queued", "planning", "running", "verifying", "paused"].includes(this.status);
  }

  transitionWithGuards(targetStatus: RunStatus, metadata?: Record<string, any>): void {
    if (!this.canTransitionTo(targetStatus)) {
      throw new StateMachineError("run", this.runId, this.status, targetStatus);
    }

    const guards = RUN_TRANSITION_GUARDS[this.status]?.[targetStatus];
    if (guards) {
      const context: TransitionContext = {
        runId: this.runId,
        fromStatus: this.status,
        toStatus: targetStatus,
        metadata
      };
      for (const guard of guards) {
        if (!guard.condition(context)) {
          throw new StateMachineError("run", this.runId, this.status, targetStatus);
        }
      }
    }

    this.transition(targetStatus, metadata?.reason);
  }

  getBlockedReason(targetStatus: RunStatus, metadata?: Record<string, any>): string | null {
    if (!this.canTransitionTo(targetStatus)) {
      return `Transition from ${this.status} to ${targetStatus} is not allowed`;
    }

    const guards = RUN_TRANSITION_GUARDS[this.status]?.[targetStatus];
    if (guards) {
      const context: TransitionContext = {
        runId: this.runId,
        fromStatus: this.status,
        toStatus: targetStatus,
        metadata
      };
      for (const guard of guards) {
        if (!guard.condition(context)) {
          return guard.message;
        }
      }
    }

    return null;
  }
}

export class StepStateMachine {
  private status: StepStatus;
  private readonly stepId: string;
  private retryCount: number = 0;
  private readonly maxRetries: number;
  private transitionHistory: Array<{
    from: StepStatus;
    to: StepStatus;
    timestamp: number;
    reason?: string;
  }> = [];
  private readonly onTransition?: (targetStatus: StepStatus, metadata?: Record<string, any>) => void | Promise<void>;

  constructor(
    stepId: string,
    initialStatus: StepStatus = "pending",
    maxRetries: number = 3,
    onTransition?: (targetStatus: StepStatus, metadata?: Record<string, any>) => void | Promise<void>
  ) {
    this.stepId = stepId;
    this.status = initialStatus;
    this.maxRetries = maxRetries;
    this.onTransition = onTransition;
    this.transitionHistory.push({
      from: initialStatus,
      to: initialStatus,
      timestamp: Date.now(),
      reason: "initialization"
    });
  }

  getStatus(): StepStatus {
    return this.status;
  }

  getRetryCount(): number {
    return this.retryCount;
  }

  canRetry(): boolean {
    return this.status === "failed" && this.retryCount < this.maxRetries;
  }

  getHistory() {
    return [...this.transitionHistory];
  }

  canTransitionTo(targetStatus: StepStatus): boolean {
    return STEP_TRANSITIONS[this.status].includes(targetStatus);
  }

  getValidTransitions(): StepStatus[] {
    return [...STEP_TRANSITIONS[this.status]];
  }

  transition(targetStatus: StepStatus, reason?: string): void {
    if (!this.canTransitionTo(targetStatus)) {
      throw new StateMachineError("step", this.stepId, this.status, targetStatus);
    }

    const previousStatus = this.status;
    this.status = targetStatus;

    if (previousStatus === "failed" && targetStatus === "running") {
      this.retryCount++;
    }

    this.transitionHistory.push({
      from: previousStatus,
      to: targetStatus,
      timestamp: Date.now(),
      reason
    });

    console.log(`[StateMachine] Step ${this.stepId}: ${previousStatus} -> ${targetStatus}${reason ? ` (${reason})` : ""} (retries: ${this.retryCount})`);

    if (this.onTransition) {
      void Promise.resolve(this.onTransition(targetStatus, { reason, retryCount: this.retryCount })).catch(err => {
        console.error(`[StateMachine] Error in onTransition hook for step ${this.stepId}:`, err);
      });
    }
  }

  rollback(reason?: string): void {
    if (this.canTransitionTo("compensated")) {
      this.transition("compensated", reason || "Rollback initiated");
    } else {
      throw new Error(`Cannot rollback step ${this.stepId} from status ${this.status}`);
    }
  }

  isTerminal(): boolean {
    return ["succeeded", "failed", "skipped", "cancelled", "compensated"].includes(this.status);
  }

  isActive(): boolean {
    return this.status === "running" || this.status === "verifying";
  }
}

export function validateRunTransition(from: RunStatus, to: RunStatus): boolean {
  return RUN_TRANSITIONS[from]?.includes(to) ?? false;
}

export function validateStepTransition(from: StepStatus, to: StepStatus): boolean {
  return STEP_TRANSITIONS[from]?.includes(to) ?? false;
}
