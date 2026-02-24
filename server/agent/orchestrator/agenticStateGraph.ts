/**
 * Agentic State Graph — Formal state machine for the orchestrator.
 *
 * States: PLAN → BROWSE → ACT → VERIFY → RETRY → ESCALATE → DONE
 *
 * The graph drives execution through the Planner → Executor → Verifier
 * loop with automatic retries, strategy switching, and human escalation.
 */

import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import {
  type TaskModel,
  type RiskLevel,
  createTaskModel,
  assessRisk,
  TaskConstraintsSchema,
  BudgetSchema,
} from "./taskModel";

/* ------------------------------------------------------------------ */
/*  State Definitions                                                 */
/* ------------------------------------------------------------------ */

export type AgenticState =
  | "IDLE"
  | "PLAN"
  | "BROWSE"
  | "ACT"
  | "VERIFY"
  | "RETRY"
  | "ESCALATE"
  | "DONE"
  | "FAILED"
  | "CANCELLED";

export type StateTransitionReason =
  | "task_received"
  | "plan_complete"
  | "browse_needed"
  | "browse_done"
  | "step_complete"
  | "step_failed"
  | "all_steps_done"
  | "verification_passed"
  | "verification_failed"
  | "retry_requested"
  | "retry_exhausted"
  | "escalation_needed"
  | "human_approved"
  | "human_rejected"
  | "budget_exceeded"
  | "cancelled"
  | "error";

/* ------------------------------------------------------------------ */
/*  Transition Table                                                  */
/* ------------------------------------------------------------------ */

type TransitionEntry = {
  to: AgenticState;
  reasons: StateTransitionReason[];
  guard?: (ctx: GraphContext) => boolean;
};

const TRANSITIONS: Record<AgenticState, TransitionEntry[]> = {
  IDLE: [
    { to: "PLAN", reasons: ["task_received"] },
    { to: "CANCELLED", reasons: ["cancelled"] },
  ],
  PLAN: [
    { to: "BROWSE", reasons: ["browse_needed"] },
    { to: "ACT", reasons: ["plan_complete"] },
    { to: "FAILED", reasons: ["error"] },
    { to: "CANCELLED", reasons: ["cancelled"] },
  ],
  BROWSE: [
    { to: "ACT", reasons: ["browse_done"] },
    { to: "PLAN", reasons: ["retry_requested"] },
    { to: "FAILED", reasons: ["error"] },
    { to: "CANCELLED", reasons: ["cancelled"] },
  ],
  ACT: [
    { to: "VERIFY", reasons: ["all_steps_done", "step_complete"] },
    { to: "BROWSE", reasons: ["browse_needed"] },
    { to: "RETRY", reasons: ["step_failed"] },
    { to: "ESCALATE", reasons: ["escalation_needed"] },
    { to: "FAILED", reasons: ["error", "budget_exceeded"] },
    { to: "CANCELLED", reasons: ["cancelled"] },
  ],
  VERIFY: [
    { to: "DONE", reasons: ["verification_passed"] },
    { to: "RETRY", reasons: ["verification_failed"] },
    { to: "ESCALATE", reasons: ["escalation_needed"] },
    { to: "FAILED", reasons: ["error"] },
    { to: "CANCELLED", reasons: ["cancelled"] },
  ],
  RETRY: [
    { to: "PLAN", reasons: ["retry_requested"], guard: (ctx) => ctx.retriesRemaining > 0 },
    { to: "ACT", reasons: ["retry_requested"], guard: (ctx) => ctx.retriesRemaining > 0 },
    { to: "ESCALATE", reasons: ["retry_exhausted"], guard: (ctx) => ctx.retriesRemaining <= 0 },
    { to: "FAILED", reasons: ["error", "budget_exceeded"] },
    { to: "CANCELLED", reasons: ["cancelled"] },
  ],
  ESCALATE: [
    { to: "ACT", reasons: ["human_approved"] },
    { to: "PLAN", reasons: ["human_approved"] },
    { to: "CANCELLED", reasons: ["human_rejected", "cancelled"] },
    { to: "FAILED", reasons: ["error"] },
  ],
  DONE: [],
  FAILED: [
    { to: "PLAN", reasons: ["retry_requested"] },
  ],
  CANCELLED: [],
};

/* ------------------------------------------------------------------ */
/*  Graph Context                                                     */
/* ------------------------------------------------------------------ */

export interface GraphContext {
  task: TaskModel;
  currentState: AgenticState;
  previousStates: Array<{ state: AgenticState; reason: StateTransitionReason; timestamp: number }>;
  retriesRemaining: number;
  replansRemaining: number;
  strategyMode: "dom" | "visual";
  currentPlan: PlanSpec | null;
  stepResults: StepResultEntry[];
  artifacts: ArtifactEntry[];
  evidence: EvidenceEntry[];
  startTime: number;
  elapsedMs: number;
}

export interface PlanSpec {
  id: string;
  objective: string;
  steps: PlanStepSpec[];
  estimatedTimeMs: number;
}

export interface PlanStepSpec {
  index: number;
  toolName: string;
  description: string;
  input: Record<string, any>;
  expectedOutput: string;
  dependsOn: number[];
}

export interface StepResultEntry {
  stepIndex: number;
  toolName: string;
  success: boolean;
  output: any;
  error?: string;
  durationMs: number;
  artifacts: ArtifactEntry[];
  evidence: EvidenceEntry[];
}

export interface ArtifactEntry {
  id: string;
  type: string;
  name: string;
  url?: string;
  data?: any;
  createdAt: number;
}

export interface EvidenceEntry {
  type: "screenshot" | "html_snippet" | "network_log" | "console_log" | "assertion_result";
  data: any;
  timestamp: number;
  stepIndex?: number;
}

/* ------------------------------------------------------------------ */
/*  Events emitted by the graph                                       */
/* ------------------------------------------------------------------ */

export interface StateGraphEvent {
  type: "state_change" | "step_start" | "step_end" | "plan_created" | "escalation" | "done" | "error";
  graphId: string;
  state: AgenticState;
  previousState?: AgenticState;
  reason?: StateTransitionReason;
  data?: any;
  timestamp: number;
}

/* ------------------------------------------------------------------ */
/*  Agentic State Graph                                               */
/* ------------------------------------------------------------------ */

export class AgenticStateGraph extends EventEmitter {
  public readonly id: string;
  private ctx: GraphContext;

  constructor(task: TaskModel) {
    super();
    this.id = randomUUID();
    this.ctx = {
      task,
      currentState: "IDLE",
      previousStates: [],
      retriesRemaining: task.budget.maxRetriesPerStep,
      replansRemaining: task.budget.maxReplans,
      strategyMode: "dom",
      currentPlan: null,
      stepResults: [],
      artifacts: [],
      evidence: [],
      startTime: Date.now(),
      elapsedMs: 0,
    };
  }

  /* -- Public API -------------------------------------------------- */

  getState(): AgenticState {
    return this.ctx.currentState;
  }

  getContext(): Readonly<GraphContext> {
    return { ...this.ctx };
  }

  getValidTransitions(): Array<{ to: AgenticState; reasons: StateTransitionReason[] }> {
    return TRANSITIONS[this.ctx.currentState].map((t) => ({
      to: t.to,
      reasons: t.reasons,
    }));
  }

  canTransitionTo(target: AgenticState, reason: StateTransitionReason): boolean {
    return TRANSITIONS[this.ctx.currentState].some(
      (t) => t.to === target && t.reasons.includes(reason) && (!t.guard || t.guard(this.ctx))
    );
  }

  /**
   * Transition to a new state. Throws if the transition is invalid.
   */
  transition(target: AgenticState, reason: StateTransitionReason, data?: any): void {
    const entry = TRANSITIONS[this.ctx.currentState].find(
      (t) => t.to === target && t.reasons.includes(reason) && (!t.guard || t.guard(this.ctx))
    );

    if (!entry) {
      throw new Error(
        `Invalid state transition: ${this.ctx.currentState} → ${target} (reason: ${reason})`
      );
    }

    const previous = this.ctx.currentState;
    this.ctx.previousStates.push({
      state: previous,
      reason,
      timestamp: Date.now(),
    });
    this.ctx.currentState = target;
    this.ctx.elapsedMs = Date.now() - this.ctx.startTime;

    const event: StateGraphEvent = {
      type: "state_change",
      graphId: this.id,
      state: target,
      previousState: previous,
      reason,
      data,
      timestamp: Date.now(),
    };

    this.emit("state_change", event);

    console.log(
      `[StateGraph:${this.id.slice(0, 8)}] ${previous} → ${target} (${reason})${
        data ? ` | ${JSON.stringify(data).slice(0, 100)}` : ""
      }`
    );
  }

  /* -- Plan management --------------------------------------------- */

  setPlan(plan: PlanSpec): void {
    this.ctx.currentPlan = plan;
    this.emitGraphEvent("plan_created", { plan });
  }

  getPlan(): PlanSpec | null {
    return this.ctx.currentPlan;
  }

  /* -- Step results ------------------------------------------------ */

  recordStepResult(result: StepResultEntry): void {
    this.ctx.stepResults.push(result);
    this.ctx.task.metrics.stepsExecuted++;
    if (result.success) {
      this.ctx.task.metrics.stepsSucceeded++;
    } else {
      this.ctx.task.metrics.stepsFailed++;
    }
    if (result.artifacts.length > 0) {
      this.ctx.artifacts.push(...result.artifacts);
      this.ctx.task.metrics.artifactsProduced += result.artifacts.length;
    }
    if (result.evidence.length > 0) {
      this.ctx.evidence.push(...result.evidence);
    }
    this.emitGraphEvent("step_end", { result });
  }

  /* -- Evidence ---------------------------------------------------- */

  addEvidence(entry: EvidenceEntry): void {
    this.ctx.evidence.push(entry);
  }

  /* -- Strategy switching ------------------------------------------ */

  switchStrategy(mode: "dom" | "visual"): void {
    this.ctx.strategyMode = mode;
    console.log(`[StateGraph:${this.id.slice(0, 8)}] Strategy switched to: ${mode}`);
  }

  /* -- Budget checking --------------------------------------------- */

  isBudgetExceeded(): boolean {
    const { budget, metrics } = this.ctx.task;
    if (this.ctx.elapsedMs > budget.maxTimeMs) return true;
    if (metrics.stepsExecuted >= budget.maxSteps) return true;
    if (budget.maxTokens && metrics.tokensUsed >= budget.maxTokens) return true;
    return false;
  }

  consumeRetry(): boolean {
    if (this.ctx.retriesRemaining <= 0) return false;
    this.ctx.retriesRemaining--;
    this.ctx.task.metrics.retries++;
    return true;
  }

  consumeReplan(): boolean {
    if (this.ctx.replansRemaining <= 0) return false;
    this.ctx.replansRemaining--;
    this.ctx.task.metrics.replans++;
    return true;
  }

  /* -- Escalation helpers ------------------------------------------ */

  shouldEscalate(action: string): boolean {
    const risk = this.ctx.task.riskLevel;
    if (risk === "critical") return true;
    if (risk === "high" && this.ctx.task.constraints.requireHumanConfirmation) return true;

    const dangerousActions = /\b(pay|transfer|delete|drop|send_email|whatsapp)\b/i;
    if (dangerousActions.test(action)) return true;

    return false;
  }

  /* -- Terminal state check ---------------------------------------- */

  isTerminal(): boolean {
    return ["DONE", "FAILED", "CANCELLED"].includes(this.ctx.currentState);
  }

  isActive(): boolean {
    return !this.isTerminal() && this.ctx.currentState !== "IDLE";
  }

  /* -- Serialization ----------------------------------------------- */

  toJSON(): Record<string, any> {
    return {
      id: this.id,
      state: this.ctx.currentState,
      task: {
        id: this.ctx.task.id,
        goal: this.ctx.task.goal,
        status: this.ctx.task.status,
        riskLevel: this.ctx.task.riskLevel,
        priority: this.ctx.task.priority,
      },
      plan: this.ctx.currentPlan
        ? {
            id: this.ctx.currentPlan.id,
            objective: this.ctx.currentPlan.objective,
            stepCount: this.ctx.currentPlan.steps.length,
          }
        : null,
      metrics: this.ctx.task.metrics,
      retriesRemaining: this.ctx.retriesRemaining,
      replansRemaining: this.ctx.replansRemaining,
      strategyMode: this.ctx.strategyMode,
      stepsCompleted: this.ctx.stepResults.length,
      artifactCount: this.ctx.artifacts.length,
      elapsedMs: this.ctx.elapsedMs,
      history: this.ctx.previousStates.slice(-20),
    };
  }

  /* -- Internal ---------------------------------------------------- */

  private emitGraphEvent(type: StateGraphEvent["type"], data?: any): void {
    const event: StateGraphEvent = {
      type,
      graphId: this.id,
      state: this.ctx.currentState,
      data,
      timestamp: Date.now(),
    };
    this.emit(type, event);
  }
}

/* ------------------------------------------------------------------ */
/*  Factory                                                           */
/* ------------------------------------------------------------------ */

export function createStateGraph(
  goal: string,
  userId: string,
  options?: {
    chatId?: string;
    runId?: string;
    userPlan?: "free" | "pro" | "admin";
    tools?: string[];
    constraints?: Record<string, any>;
    budget?: Record<string, any>;
    attachments?: Array<{ name: string; type?: string; path?: string; url?: string }>;
    conversationHistory?: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  }
): AgenticStateGraph {
  const tools = options?.tools || [];
  const riskLevel = assessRisk(goal, tools);

  const task = createTaskModel({
    goal,
    context: {
      userId,
      chatId: options?.chatId,
      runId: options?.runId,
      userPlan: options?.userPlan || "free",
      locale: "es",
      attachments: options?.attachments || [],
      conversationHistory: options?.conversationHistory || [],
    },
    constraints: TaskConstraintsSchema.parse(options?.constraints || {}),
    budget: BudgetSchema.parse(options?.budget || {}),
    riskLevel,
    definitionOfDone: {
      summary: `Complete the user's request: ${goal.slice(0, 200)}`,
      assertions: [],
      minConfidence: 0.8,
    },
  });

  return new AgenticStateGraph(task);
}
