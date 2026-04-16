import { EventEmitter } from "events";
import { Counter, Gauge, Registry } from "prom-client";
import { createLogger } from "./structuredLogger";

const logger = createLogger("backtracking-manager");

// ===== Types =====

export type CheckpointId = string;

export type FailureType = 
  | "execution_error"
  | "timeout"
  | "low_confidence"
  | "user_rejection"
  | "validation_failure"
  | "resource_exhausted";

export interface CheckpointState {
  context: Record<string, any>;
  partialOutputs: any[];
  currentPlan: PlanSnapshot | null;
  stepIndex: number;
  artifacts: ArtifactSnapshot[];
  memory: Record<string, any>;
}

export interface PlanSnapshot {
  objective: string;
  steps: PlanStepSnapshot[];
  completedSteps: number[];
  failedSteps: number[];
}

export interface PlanStepSnapshot {
  index: number;
  toolName: string;
  description: string;
  input: any;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
}

export interface ArtifactSnapshot {
  id: string;
  type: string;
  name: string;
  url?: string;
  data?: any;
}

export interface Checkpoint {
  id: CheckpointId;
  name: string;
  runId: string;
  state: CheckpointState;
  createdAt: number;
  expiresAt: number;
  isValid: boolean;
  metadata: CheckpointMetadata;
}

export interface CheckpointMetadata {
  trigger: "auto" | "manual" | "step_complete" | "tool_success" | "verification";
  stepIndex?: number;
  toolName?: string;
  confidence?: number;
  tags: string[];
}

export interface FailureInfo {
  type: FailureType;
  message: string;
  stepIndex?: number;
  toolName?: string;
  error?: Error;
  confidence?: number;
  timestamp: number;
  context?: Record<string, any>;
}

export interface BacktrackResult {
  success: boolean;
  restoredCheckpoint: Checkpoint | null;
  failureAnalysis: FailureAnalysis | null;
  newPlan: PlanSnapshot | null;
  backtrackDepth: number;
  attemptNumber: number;
  error?: string;
}

export interface FailureAnalysis {
  rootCause: string;
  failedAction: string;
  suggestedAlternatives: string[];
  avoidanceConstraints: string[];
  confidence: number;
}

export interface BacktrackingConfig {
  maxCheckpoints: number;
  checkpointTtlMs: number;
  maxBacktrackAttempts: number;
  autoCheckpointOnStepComplete: boolean;
  autoCheckpointOnToolSuccess: boolean;
  lowConfidenceThreshold: number;
}

export interface BacktrackingEvents {
  checkpoint_created: { checkpointId: CheckpointId; name: string; runId: string };
  checkpoint_expired: { checkpointId: CheckpointId; runId: string };
  checkpoint_invalidated: { checkpointId: CheckpointId; reason: string };
  backtrack_started: { runId: string; fromStep: number; toCheckpoint: CheckpointId };
  backtrack_completed: { runId: string; success: boolean; depth: number };
  backtrack_failed: { runId: string; reason: string; attemptNumber: number };
  replan_started: { runId: string; failureInfo: FailureInfo };
  replan_completed: { runId: string; success: boolean; newPlan: PlanSnapshot | null };
}

// ===== Configuration Defaults =====

const DEFAULT_CONFIG: BacktrackingConfig = {
  maxCheckpoints: 10,
  checkpointTtlMs: 30 * 60 * 1000, // 30 minutes
  maxBacktrackAttempts: 3,
  autoCheckpointOnStepComplete: true,
  autoCheckpointOnToolSuccess: true,
  lowConfidenceThreshold: 0.4,
};

// ===== Metrics =====

const metricsRegistry = new Registry();

const backtrackAttemptsCounter = new Counter({
  name: "backtracking_attempts_total",
  help: "Total number of backtrack attempts",
  labelNames: ["run_id", "failure_type", "success"],
  registers: [metricsRegistry],
});

const backtrackSuccessCounter = new Counter({
  name: "backtracking_success_total",
  help: "Total number of successful backtracks",
  labelNames: ["run_id"],
  registers: [metricsRegistry],
});

const avgBacktrackDepthGauge = new Gauge({
  name: "backtracking_avg_depth",
  help: "Average backtrack depth across runs",
  registers: [metricsRegistry],
});

const checkpointsActiveGauge = new Gauge({
  name: "backtracking_checkpoints_active",
  help: "Number of active checkpoints",
  labelNames: ["run_id"],
  registers: [metricsRegistry],
});

const replanAttemptsCounter = new Counter({
  name: "backtracking_replan_attempts_total",
  help: "Total number of replan attempts",
  labelNames: ["run_id", "success"],
  registers: [metricsRegistry],
});

// ===== Event Emitter =====

class BacktrackingEventEmitter extends EventEmitter {
  emit<K extends keyof BacktrackingEvents>(
    event: K,
    payload: BacktrackingEvents[K]
  ): boolean {
    return super.emit(event, payload);
  }

  on<K extends keyof BacktrackingEvents>(
    event: K,
    listener: (payload: BacktrackingEvents[K]) => void
  ): this {
    return super.on(event, listener);
  }

  once<K extends keyof BacktrackingEvents>(
    event: K,
    listener: (payload: BacktrackingEvents[K]) => void
  ): this {
    return super.once(event, listener);
  }
}

export const backtrackingEvents = new BacktrackingEventEmitter();

// ===== Utility Functions =====

function generateCheckpointId(): CheckpointId {
  return `chk_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

function cloneState(state: CheckpointState): CheckpointState {
  return JSON.parse(JSON.stringify(state));
}

// ===== BacktrackingManager Class =====

export class BacktrackingManager {
  private checkpoints: Map<CheckpointId, Checkpoint> = new Map();
  private checkpointOrder: CheckpointId[] = [];
  private config: BacktrackingConfig;
  private backtrackAttempts: number = 0;
  private totalBacktrackDepth: number = 0;
  private successfulBacktracks: number = 0;
  private failureHistory: FailureInfo[] = [];
  private avoidanceConstraints: Set<string> = new Set();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(
    public readonly runId: string,
    config: Partial<BacktrackingConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startCleanupTimer();
    logger.info("BacktrackingManager initialized", { runId, config: this.config });
  }

  // ===== Checkpoint Management =====

  createCheckpoint(
    name: string,
    state: CheckpointState,
    metadata: Partial<CheckpointMetadata> = {}
  ): CheckpointId {
    this.cleanupExpiredCheckpoints();

    const checkpointId = generateCheckpointId();
    const now = Date.now();

    const checkpoint: Checkpoint = {
      id: checkpointId,
      name,
      runId: this.runId,
      state: cloneState(state),
      createdAt: now,
      expiresAt: now + this.config.checkpointTtlMs,
      isValid: true,
      metadata: {
        trigger: metadata.trigger || "manual",
        stepIndex: metadata.stepIndex,
        toolName: metadata.toolName,
        confidence: metadata.confidence,
        tags: metadata.tags || [],
      },
    };

    this.checkpoints.set(checkpointId, checkpoint);
    this.checkpointOrder.push(checkpointId);

    if (this.checkpointOrder.length > this.config.maxCheckpoints) {
      const oldestId = this.checkpointOrder.shift();
      if (oldestId) {
        this.checkpoints.delete(oldestId);
        logger.debug("Removed oldest checkpoint due to limit", { 
          removedId: oldestId, 
          runId: this.runId 
        });
      }
    }

    checkpointsActiveGauge.set({ run_id: this.runId }, this.checkpoints.size);

    backtrackingEvents.emit("checkpoint_created", {
      checkpointId,
      name,
      runId: this.runId,
    });

    logger.info("Checkpoint created", {
      checkpointId,
      name,
      runId: this.runId,
      stepIndex: metadata.stepIndex,
      trigger: checkpoint.metadata.trigger,
    });

    return checkpointId;
  }

  getCheckpoint(checkpointId: CheckpointId): Checkpoint | null {
    const checkpoint = this.checkpoints.get(checkpointId);
    if (!checkpoint) return null;

    if (Date.now() > checkpoint.expiresAt) {
      this.invalidateCheckpoint(checkpointId, "expired");
      return null;
    }

    return checkpoint.isValid ? checkpoint : null;
  }

  getCheckpointHistory(): Checkpoint[] {
    this.cleanupExpiredCheckpoints();
    return this.checkpointOrder
      .map(id => this.checkpoints.get(id))
      .filter((cp): cp is Checkpoint => cp !== undefined && cp.isValid)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  getLastValidCheckpoint(): Checkpoint | null {
    for (let i = this.checkpointOrder.length - 1; i >= 0; i--) {
      const checkpoint = this.getCheckpoint(this.checkpointOrder[i]);
      if (checkpoint && checkpoint.isValid) {
        return checkpoint;
      }
    }
    return null;
  }

  findCheckpointByStep(stepIndex: number): Checkpoint | null {
    for (let i = this.checkpointOrder.length - 1; i >= 0; i--) {
      const checkpoint = this.getCheckpoint(this.checkpointOrder[i]);
      if (
        checkpoint &&
        checkpoint.isValid &&
        checkpoint.metadata.stepIndex !== undefined &&
        checkpoint.metadata.stepIndex < stepIndex
      ) {
        return checkpoint;
      }
    }
    return null;
  }

  findCheckpointByName(name: string): Checkpoint | null {
    for (let i = this.checkpointOrder.length - 1; i >= 0; i--) {
      const checkpoint = this.getCheckpoint(this.checkpointOrder[i]);
      if (checkpoint && checkpoint.isValid && checkpoint.name === name) {
        return checkpoint;
      }
    }
    return null;
  }

  invalidateCheckpoint(checkpointId: CheckpointId, reason: string): void {
    const checkpoint = this.checkpoints.get(checkpointId);
    if (checkpoint) {
      checkpoint.isValid = false;
      backtrackingEvents.emit("checkpoint_invalidated", {
        checkpointId,
        reason,
      });
      logger.info("Checkpoint invalidated", { checkpointId, reason, runId: this.runId });
    }
  }

  invalidateCheckpointsAfter(stepIndex: number): void {
    for (const checkpointId of this.checkpointOrder) {
      const checkpoint = this.checkpoints.get(checkpointId);
      if (
        checkpoint &&
        checkpoint.metadata.stepIndex !== undefined &&
        checkpoint.metadata.stepIndex > stepIndex
      ) {
        this.invalidateCheckpoint(checkpointId, `step_${stepIndex}_failed`);
      }
    }
  }

  // ===== Backtracking =====

  canBacktrack(): boolean {
    if (this.backtrackAttempts >= this.config.maxBacktrackAttempts) {
      logger.warn("Max backtrack attempts reached", {
        runId: this.runId,
        attempts: this.backtrackAttempts,
        max: this.config.maxBacktrackAttempts,
      });
      return false;
    }

    const validCheckpoint = this.getLastValidCheckpoint();
    return validCheckpoint !== null;
  }

  async backtrack(
    failureInfo: FailureInfo,
    toCheckpointId?: CheckpointId
  ): Promise<BacktrackResult> {
    this.backtrackAttempts++;
    backtrackAttemptsCounter.inc({
      run_id: this.runId,
      failure_type: failureInfo.type,
      success: "pending",
    });

    logger.info("Backtrack initiated", {
      runId: this.runId,
      failureType: failureInfo.type,
      attemptNumber: this.backtrackAttempts,
      toCheckpointId,
    });

    this.failureHistory.push(failureInfo);

    let targetCheckpoint: Checkpoint | null = null;
    let backtrackDepth = 0;

    if (toCheckpointId) {
      targetCheckpoint = this.getCheckpoint(toCheckpointId);
    } else if (failureInfo.stepIndex !== undefined) {
      targetCheckpoint = this.findCheckpointByStep(failureInfo.stepIndex);
    } else {
      targetCheckpoint = this.getLastValidCheckpoint();
    }

    if (!targetCheckpoint) {
      const result: BacktrackResult = {
        success: false,
        restoredCheckpoint: null,
        failureAnalysis: null,
        newPlan: null,
        backtrackDepth: 0,
        attemptNumber: this.backtrackAttempts,
        error: "No valid checkpoint found for backtracking",
      };

      backtrackAttemptsCounter.inc({
        run_id: this.runId,
        failure_type: failureInfo.type,
        success: "false",
      });

      backtrackingEvents.emit("backtrack_failed", {
        runId: this.runId,
        reason: "no_valid_checkpoint",
        attemptNumber: this.backtrackAttempts,
      });

      return result;
    }

    backtrackDepth = this.calculateBacktrackDepth(targetCheckpoint);
    this.totalBacktrackDepth += backtrackDepth;

    backtrackingEvents.emit("backtrack_started", {
      runId: this.runId,
      fromStep: failureInfo.stepIndex || -1,
      toCheckpoint: targetCheckpoint.id,
    });

    this.invalidateCheckpointsAfter(targetCheckpoint.metadata.stepIndex || 0);

    const failureAnalysis = await this.analyzeFailure(failureInfo);
    this.updateAvoidanceConstraints(failureAnalysis);

    const newPlan = await this.replanWithConstraints(
      targetCheckpoint.state.currentPlan,
      failureAnalysis,
      targetCheckpoint.state
    );

    if (!newPlan) {
      backtrackAttemptsCounter.inc({
        run_id: this.runId,
        failure_type: failureInfo.type,
        success: "false",
      });

      backtrackingEvents.emit("backtrack_failed", {
        runId: this.runId,
        reason: "replan_failed",
        attemptNumber: this.backtrackAttempts,
      });

      return {
        success: false,
        restoredCheckpoint: targetCheckpoint,
        failureAnalysis,
        newPlan: null,
        backtrackDepth,
        attemptNumber: this.backtrackAttempts,
        error: "Failed to generate alternative plan",
      };
    }

    this.successfulBacktracks++;
    backtrackSuccessCounter.inc({ run_id: this.runId });
    backtrackAttemptsCounter.inc({
      run_id: this.runId,
      failure_type: failureInfo.type,
      success: "true",
    });

    this.updateAvgBacktrackDepthMetric();

    backtrackingEvents.emit("backtrack_completed", {
      runId: this.runId,
      success: true,
      depth: backtrackDepth,
    });

    logger.info("Backtrack completed successfully", {
      runId: this.runId,
      checkpointId: targetCheckpoint.id,
      depth: backtrackDepth,
      attemptNumber: this.backtrackAttempts,
    });

    return {
      success: true,
      restoredCheckpoint: targetCheckpoint,
      failureAnalysis,
      newPlan,
      backtrackDepth,
      attemptNumber: this.backtrackAttempts,
    };
  }

  // ===== Failure Analysis =====

  private async analyzeFailure(failureInfo: FailureInfo): Promise<FailureAnalysis> {
    logger.debug("Analyzing failure", { runId: this.runId, failureInfo });

    const rootCause = this.determineRootCause(failureInfo);
    const failedAction = this.identifyFailedAction(failureInfo);
    const suggestedAlternatives = this.generateAlternatives(failureInfo);
    const avoidanceConstraints = this.generateAvoidanceConstraints(failureInfo);

    const analysis: FailureAnalysis = {
      rootCause,
      failedAction,
      suggestedAlternatives,
      avoidanceConstraints,
      confidence: this.calculateAnalysisConfidence(failureInfo),
    };

    logger.info("Failure analysis complete", { runId: this.runId, analysis });
    return analysis;
  }

  private determineRootCause(failureInfo: FailureInfo): string {
    switch (failureInfo.type) {
      case "execution_error":
        return failureInfo.error?.message || "Unknown execution error";
      case "timeout":
        return `Operation timed out at step ${failureInfo.stepIndex}`;
      case "low_confidence":
        return `Low confidence result (${failureInfo.confidence}) at step ${failureInfo.stepIndex}`;
      case "user_rejection":
        return "User rejected the result";
      case "validation_failure":
        return "Output validation failed";
      case "resource_exhausted":
        return "Resource limits exceeded";
      default:
        return failureInfo.message || "Unknown failure";
    }
  }

  private identifyFailedAction(failureInfo: FailureInfo): string {
    if (failureInfo.toolName) {
      return `Tool: ${failureInfo.toolName} at step ${failureInfo.stepIndex}`;
    }
    return `Step ${failureInfo.stepIndex || "unknown"}`;
  }

  private generateAlternatives(failureInfo: FailureInfo): string[] {
    const alternatives: string[] = [];

    switch (failureInfo.type) {
      case "execution_error":
        alternatives.push("Retry with different parameters");
        alternatives.push("Use alternative tool for same task");
        alternatives.push("Break task into smaller steps");
        break;
      case "timeout":
        alternatives.push("Simplify the operation");
        alternatives.push("Use cached or pre-computed results");
        alternatives.push("Skip non-essential step");
        break;
      case "low_confidence":
        alternatives.push("Gather more context before proceeding");
        alternatives.push("Use more specific tool");
        alternatives.push("Request user clarification");
        break;
      case "user_rejection":
        alternatives.push("Ask for specific feedback");
        alternatives.push("Try different approach");
        alternatives.push("Adjust output format");
        break;
      default:
        alternatives.push("Retry with modified approach");
    }

    return alternatives;
  }

  private generateAvoidanceConstraints(failureInfo: FailureInfo): string[] {
    const constraints: string[] = [];

    if (failureInfo.toolName) {
      constraints.push(`avoid_tool:${failureInfo.toolName}`);
    }

    if (failureInfo.stepIndex !== undefined) {
      constraints.push(`avoid_step_pattern:${failureInfo.stepIndex}`);
    }

    if (failureInfo.type === "timeout") {
      constraints.push("prefer_fast_operations");
    }

    if (failureInfo.type === "low_confidence") {
      constraints.push("require_high_confidence");
    }

    if (failureInfo.context) {
      const inputHash = JSON.stringify(failureInfo.context).substring(0, 50);
      constraints.push(`avoid_input:${inputHash}`);
    }

    return constraints;
  }

  private calculateAnalysisConfidence(failureInfo: FailureInfo): number {
    let confidence = 0.7;

    if (failureInfo.error) confidence += 0.1;
    if (failureInfo.toolName) confidence += 0.1;
    if (failureInfo.context) confidence += 0.1;

    const similarFailures = this.failureHistory.filter(
      f => f.type === failureInfo.type && f.toolName === failureInfo.toolName
    ).length;

    if (similarFailures > 0) {
      confidence = Math.min(confidence + 0.05 * similarFailures, 0.95);
    }

    return confidence;
  }

  private updateAvoidanceConstraints(analysis: FailureAnalysis): void {
    for (const constraint of analysis.avoidanceConstraints) {
      this.avoidanceConstraints.add(constraint);
    }
  }

  // ===== Re-planning =====

  private async replanWithConstraints(
    originalPlan: PlanSnapshot | null,
    failureAnalysis: FailureAnalysis,
    currentState: CheckpointState
  ): Promise<PlanSnapshot | null> {
    backtrackingEvents.emit("replan_started", {
      runId: this.runId,
      failureInfo: this.failureHistory[this.failureHistory.length - 1],
    });

    replanAttemptsCounter.inc({ run_id: this.runId, success: "pending" });

    logger.info("Starting replan with constraints", {
      runId: this.runId,
      constraints: Array.from(this.avoidanceConstraints),
      alternatives: failureAnalysis.suggestedAlternatives,
    });

    if (!originalPlan) {
      replanAttemptsCounter.inc({ run_id: this.runId, success: "false" });
      backtrackingEvents.emit("replan_completed", {
        runId: this.runId,
        success: false,
        newPlan: null,
      });
      return null;
    }

    try {
      const newPlan = this.generateAlternativePlan(
        originalPlan,
        failureAnalysis,
        currentState
      );

      replanAttemptsCounter.inc({ run_id: this.runId, success: "true" });
      backtrackingEvents.emit("replan_completed", {
        runId: this.runId,
        success: true,
        newPlan,
      });

      logger.info("Replan completed successfully", {
        runId: this.runId,
        newStepsCount: newPlan.steps.length,
      });

      return newPlan;
    } catch (error) {
      logger.error("Replan failed", { runId: this.runId, error });
      replanAttemptsCounter.inc({ run_id: this.runId, success: "false" });
      backtrackingEvents.emit("replan_completed", {
        runId: this.runId,
        success: false,
        newPlan: null,
      });
      return null;
    }
  }

  private generateAlternativePlan(
    originalPlan: PlanSnapshot,
    failureAnalysis: FailureAnalysis,
    currentState: CheckpointState
  ): PlanSnapshot {
    const startFromStep = currentState.stepIndex;
    const remainingSteps = originalPlan.steps.filter(
      step => step.index >= startFromStep && !originalPlan.completedSteps.includes(step.index)
    );

    const modifiedSteps: PlanStepSnapshot[] = [];
    const toolAlternatives: Record<string, string> = {
      web_search: "browse_url",
      browse_url: "web_search",
      generate_document: "write_file",
      analyze_spreadsheet: "read_file",
    };

    for (const step of remainingSteps) {
      if (this.shouldSkipStep(step, failureAnalysis)) {
        modifiedSteps.push({
          ...step,
          status: "skipped",
          description: `[SKIPPED] ${step.description}`,
        });
        continue;
      }

      if (this.shouldModifyStep(step, failureAnalysis)) {
        const alternativeTool = toolAlternatives[step.toolName] || step.toolName;
        modifiedSteps.push({
          ...step,
          toolName: alternativeTool,
          description: `[MODIFIED] ${step.description} (using ${alternativeTool})`,
          input: this.modifyStepInput(step.input, failureAnalysis),
          status: "pending",
        });
        continue;
      }

      modifiedSteps.push({
        ...step,
        status: "pending",
      });
    }

    return {
      objective: originalPlan.objective,
      steps: modifiedSteps,
      completedSteps: [...originalPlan.completedSteps],
      failedSteps: [...originalPlan.failedSteps],
    };
  }

  private shouldSkipStep(step: PlanStepSnapshot, analysis: FailureAnalysis): boolean {
    const constraints = Array.from(this.avoidanceConstraints);
    for (const constraint of constraints) {
      if (constraint === `avoid_tool:${step.toolName}`) {
        const failureCount = this.failureHistory.filter(
          f => f.toolName === step.toolName
        ).length;
        if (failureCount >= 2) return true;
      }
    }
    return false;
  }

  private shouldModifyStep(step: PlanStepSnapshot, analysis: FailureAnalysis): boolean {
    return analysis.failedAction.includes(step.toolName);
  }

  private modifyStepInput(input: any, analysis: FailureAnalysis): any {
    if (!input || typeof input !== "object") return input;

    const modified = { ...input };

    if (modified.timeout) {
      modified.timeout = Math.floor(modified.timeout * 1.5);
    }

    if (modified.maxResults && typeof modified.maxResults === "number") {
      modified.maxResults = Math.min(modified.maxResults, 5);
    }

    modified._modifiedByBacktrack = true;
    modified._backtrackAttempt = this.backtrackAttempts;

    return modified;
  }

  // ===== Metrics & Utilities =====

  private calculateBacktrackDepth(checkpoint: Checkpoint): number {
    const currentIndex = this.checkpointOrder.indexOf(checkpoint.id);
    return this.checkpointOrder.length - 1 - currentIndex;
  }

  private updateAvgBacktrackDepthMetric(): void {
    if (this.successfulBacktracks > 0) {
      const avg = this.totalBacktrackDepth / this.successfulBacktracks;
      avgBacktrackDepthGauge.set(avg);
    }
  }

  private cleanupExpiredCheckpoints(): void {
    const now = Date.now();
    const expiredIds: CheckpointId[] = [];
    const entries = Array.from(this.checkpoints.entries());

    for (const [id, checkpoint] of entries) {
      if (now > checkpoint.expiresAt) {
        expiredIds.push(id);
        backtrackingEvents.emit("checkpoint_expired", {
          checkpointId: id,
          runId: this.runId,
        });
      }
    }

    for (const id of expiredIds) {
      this.checkpoints.delete(id);
      const orderIndex = this.checkpointOrder.indexOf(id);
      if (orderIndex !== -1) {
        this.checkpointOrder.splice(orderIndex, 1);
      }
    }

    if (expiredIds.length > 0) {
      checkpointsActiveGauge.set({ run_id: this.runId }, this.checkpoints.size);
      logger.debug("Cleaned up expired checkpoints", {
        runId: this.runId,
        count: expiredIds.length,
      });
    }
  }

  private startCleanupTimer(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredCheckpoints();
    }, 60000); // Every minute
  }

  // ===== Statistics =====

  getStats(): {
    checkpointCount: number;
    backtrackAttempts: number;
    successfulBacktracks: number;
    failureHistory: FailureInfo[];
    avoidanceConstraints: string[];
    avgBacktrackDepth: number;
  } {
    return {
      checkpointCount: this.checkpoints.size,
      backtrackAttempts: this.backtrackAttempts,
      successfulBacktracks: this.successfulBacktracks,
      failureHistory: [...this.failureHistory],
      avoidanceConstraints: Array.from(this.avoidanceConstraints),
      avgBacktrackDepth:
        this.successfulBacktracks > 0
          ? this.totalBacktrackDepth / this.successfulBacktracks
          : 0,
    };
  }

  getRemainingAttempts(): number {
    return Math.max(0, this.config.maxBacktrackAttempts - this.backtrackAttempts);
  }

  getAvoidanceConstraints(): string[] {
    return Array.from(this.avoidanceConstraints);
  }

  // ===== Cleanup =====

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.checkpoints.clear();
    this.checkpointOrder.length = 0;
    this.failureHistory.length = 0;
    this.avoidanceConstraints.clear();
    checkpointsActiveGauge.set({ run_id: this.runId }, 0);
    logger.info("BacktrackingManager destroyed", { runId: this.runId });
  }
}

// ===== Global Manager Registry =====

const managerRegistry = new Map<string, BacktrackingManager>();

export function getBacktrackingManager(
  runId: string,
  config?: Partial<BacktrackingConfig>
): BacktrackingManager {
  let manager = managerRegistry.get(runId);
  if (!manager) {
    manager = new BacktrackingManager(runId, config);
    managerRegistry.set(runId, manager);
  }
  return manager;
}

export function removeBacktrackingManager(runId: string): void {
  const manager = managerRegistry.get(runId);
  if (manager) {
    manager.destroy();
    managerRegistry.delete(runId);
  }
}

// ===== Convenience Functions =====

export function createCheckpoint(
  runId: string,
  name: string,
  state: CheckpointState,
  metadata?: Partial<CheckpointMetadata>
): CheckpointId {
  const manager = getBacktrackingManager(runId);
  return manager.createCheckpoint(name, state, metadata);
}

export async function attemptBacktrack(
  runId: string,
  failureInfo: FailureInfo,
  toCheckpointId?: CheckpointId
): Promise<BacktrackResult> {
  const manager = getBacktrackingManager(runId);

  if (!manager.canBacktrack()) {
    return {
      success: false,
      restoredCheckpoint: null,
      failureAnalysis: null,
      newPlan: null,
      backtrackDepth: 0,
      attemptNumber: manager.getStats().backtrackAttempts + 1,
      error: "No backtrack attempts remaining or no valid checkpoint available",
    };
  }

  return manager.backtrack(failureInfo, toCheckpointId);
}

// ===== Agent Integration Hooks =====

export interface BacktrackingHooks {
  onStepComplete: (runId: string, stepIndex: number, state: CheckpointState) => void;
  onToolSuccess: (runId: string, toolName: string, state: CheckpointState) => void;
  onVerification: (runId: string, confidence: number, state: CheckpointState) => void;
  onError: (runId: string, error: Error, stepIndex?: number) => Promise<BacktrackResult | null>;
}

export function createBacktrackingHooks(config?: Partial<BacktrackingConfig>): BacktrackingHooks {
  return {
    onStepComplete: (runId: string, stepIndex: number, state: CheckpointState) => {
      const manager = getBacktrackingManager(runId, config);
      if (manager["config"].autoCheckpointOnStepComplete) {
        manager.createCheckpoint(`step_${stepIndex}_complete`, state, {
          trigger: "step_complete",
          stepIndex,
        });
      }
    },

    onToolSuccess: (runId: string, toolName: string, state: CheckpointState) => {
      const manager = getBacktrackingManager(runId, config);
      if (manager["config"].autoCheckpointOnToolSuccess) {
        manager.createCheckpoint(`tool_${toolName}_success`, state, {
          trigger: "tool_success",
          toolName,
        });
      }
    },

    onVerification: (runId: string, confidence: number, state: CheckpointState) => {
      const manager = getBacktrackingManager(runId, config);
      if (confidence >= 0.8) {
        manager.createCheckpoint(`verification_high_confidence`, state, {
          trigger: "verification",
          confidence,
        });
      }
    },

    onError: async (
      runId: string,
      error: Error,
      stepIndex?: number
    ): Promise<BacktrackResult | null> => {
      const manager = getBacktrackingManager(runId, config);

      if (!manager.canBacktrack()) {
        return null;
      }

      const failureInfo: FailureInfo = {
        type: "execution_error",
        message: error.message,
        stepIndex,
        error,
        timestamp: Date.now(),
      };

      return manager.backtrack(failureInfo);
    },
  };
}

// ===== Failure Detection Utilities =====

export function detectFailure(
  result: any,
  options: {
    confidenceThreshold?: number;
    expectedType?: string;
    timeout?: boolean;
    userRejected?: boolean;
  } = {}
): FailureInfo | null {
  const { confidenceThreshold = 0.4, expectedType, timeout, userRejected } = options;

  if (timeout) {
    return {
      type: "timeout",
      message: "Operation timed out",
      timestamp: Date.now(),
    };
  }

  if (userRejected) {
    return {
      type: "user_rejection",
      message: "User rejected the result",
      timestamp: Date.now(),
    };
  }

  if (result?.error) {
    return {
      type: "execution_error",
      message: result.error.message || String(result.error),
      error: result.error instanceof Error ? result.error : new Error(String(result.error)),
      timestamp: Date.now(),
    };
  }

  if (result?.confidence !== undefined && result.confidence < confidenceThreshold) {
    return {
      type: "low_confidence",
      message: `Result confidence ${result.confidence} below threshold ${confidenceThreshold}`,
      confidence: result.confidence,
      timestamp: Date.now(),
    };
  }

  if (expectedType && result?.type !== expectedType) {
    return {
      type: "validation_failure",
      message: `Expected type ${expectedType}, got ${result?.type}`,
      timestamp: Date.now(),
      context: { expected: expectedType, actual: result?.type },
    };
  }

  return null;
}

// ===== Exports =====

export {
  metricsRegistry as backtrackingMetricsRegistry,
  backtrackAttemptsCounter,
  backtrackSuccessCounter,
  avgBacktrackDepthGauge,
};
