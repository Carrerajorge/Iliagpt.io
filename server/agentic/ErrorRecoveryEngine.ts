import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import pino from "pino";
import {
  getClaudeAgentBackbone,
  CLAUDE_MODELS,
  type AgentMessage,
} from "./ClaudeAgentBackbone.js";

const logger = pino({ name: "ErrorRecoveryEngine" });

// ─── Types ────────────────────────────────────────────────────────────────────

export type ErrorCategory =
  | "rate_limit"
  | "timeout"
  | "network"
  | "tool_not_found"
  | "tool_error"
  | "parse_error"
  | "context_too_long"
  | "authorization"
  | "resource_exhausted"
  | "invalid_input"
  | "model_error"
  | "unknown";

export type RecoveryStrategy =
  | "retry_with_backoff"
  | "retry_with_different_model"
  | "retry_with_simplified_input"
  | "use_alternative_tool"
  | "reduce_context"
  | "split_task"
  | "skip_and_continue"
  | "rollback_to_checkpoint"
  | "ask_user"
  | "abort";

export type EscalationLevel =
  | "auto_retry"       // 1 — try again silently
  | "auto_recover"     // 2 — apply strategy without user
  | "notify_user"      // 3 — inform but proceed
  | "ask_user"         // 4 — block and ask
  | "abort";           // 5 — cannot continue

export interface ErrorRecord {
  errorId: string;
  agentId: string;
  sessionId: string;
  stepId?: string;
  toolName?: string;
  category: ErrorCategory;
  message: string;
  rawError: string;
  timestamp: number;
  context?: Record<string, unknown>;
}

export interface RecoveryAttempt {
  attemptId: string;
  errorId: string;
  strategy: RecoveryStrategy;
  startedAt: number;
  completedAt?: number;
  success: boolean;
  result?: unknown;
  notes?: string;
}

export interface RecoveryPlan {
  planId: string;
  errorId: string;
  category: ErrorCategory;
  escalationLevel: EscalationLevel;
  strategies: RecoveryStrategy[]; // ordered list to try
  maxAttempts: number;
  currentAttempt: number;
  reasoning: string;
  fallbackMessage?: string; // message for user if escalating
}

export interface ErrorPattern {
  patternId: string;
  category: ErrorCategory;
  messagePattern: string; // regex
  occurrences: number;
  firstSeen: number;
  lastSeen: number;
  successfulStrategies: RecoveryStrategy[];
  failedStrategies: RecoveryStrategy[];
}

// ─── Error classifier ─────────────────────────────────────────────────────────

function classifyError(error: string | Error): ErrorCategory {
  const msg = (typeof error === "string" ? error : error.message).toLowerCase();

  if (msg.includes("rate limit") || msg.includes("429") || msg.includes("too many requests"))
    return "rate_limit";
  if (msg.includes("timeout") || msg.includes("timed out") || msg.includes("econnreset"))
    return "timeout";
  if (
    msg.includes("enotfound") ||
    msg.includes("econnrefused") ||
    msg.includes("network") ||
    msg.includes("503")
  )
    return "network";
  if (msg.includes("tool") && (msg.includes("not found") || msg.includes("unknown")))
    return "tool_not_found";
  if (msg.includes("parse") || msg.includes("json") || msg.includes("syntax"))
    return "parse_error";
  if (
    msg.includes("context") &&
    (msg.includes("too long") || msg.includes("length") || msg.includes("tokens"))
  )
    return "context_too_long";
  if (
    msg.includes("auth") ||
    msg.includes("permission") ||
    msg.includes("forbidden") ||
    msg.includes("401") ||
    msg.includes("403")
  )
    return "authorization";
  if (
    msg.includes("memory") ||
    msg.includes("quota") ||
    msg.includes("resource") ||
    msg.includes("capacity")
  )
    return "resource_exhausted";
  if (
    msg.includes("invalid") ||
    msg.includes("required") ||
    msg.includes("missing") ||
    msg.includes("bad request") ||
    msg.includes("400")
  )
    return "invalid_input";
  if (msg.includes("model") || msg.includes("overload") || msg.includes("529"))
    return "model_error";
  if (msg.includes("tool") || msg.includes("execution"))
    return "tool_error";

  return "unknown";
}

// ─── Recovery strategy matrix ─────────────────────────────────────────────────

const STRATEGY_MATRIX: Record<
  ErrorCategory,
  { strategies: RecoveryStrategy[]; escalation: EscalationLevel; maxAttempts: number }
> = {
  rate_limit: {
    strategies: ["retry_with_backoff"],
    escalation: "auto_retry",
    maxAttempts: 5,
  },
  timeout: {
    strategies: ["retry_with_backoff", "retry_with_simplified_input", "skip_and_continue"],
    escalation: "auto_recover",
    maxAttempts: 3,
  },
  network: {
    strategies: ["retry_with_backoff", "retry_with_different_model"],
    escalation: "auto_retry",
    maxAttempts: 4,
  },
  tool_not_found: {
    strategies: ["use_alternative_tool", "ask_user", "skip_and_continue"],
    escalation: "auto_recover",
    maxAttempts: 2,
  },
  tool_error: {
    strategies: [
      "retry_with_backoff",
      "retry_with_simplified_input",
      "use_alternative_tool",
      "ask_user",
    ],
    escalation: "auto_recover",
    maxAttempts: 3,
  },
  parse_error: {
    strategies: ["retry_with_simplified_input", "retry_with_different_model", "ask_user"],
    escalation: "auto_recover",
    maxAttempts: 3,
  },
  context_too_long: {
    strategies: ["reduce_context", "split_task", "retry_with_different_model"],
    escalation: "auto_recover",
    maxAttempts: 2,
  },
  authorization: {
    strategies: ["ask_user", "abort"],
    escalation: "ask_user",
    maxAttempts: 1,
  },
  resource_exhausted: {
    strategies: ["retry_with_backoff", "rollback_to_checkpoint", "ask_user"],
    escalation: "notify_user",
    maxAttempts: 2,
  },
  invalid_input: {
    strategies: ["retry_with_simplified_input", "ask_user"],
    escalation: "auto_recover",
    maxAttempts: 2,
  },
  model_error: {
    strategies: ["retry_with_backoff", "retry_with_different_model"],
    escalation: "auto_retry",
    maxAttempts: 3,
  },
  unknown: {
    strategies: [
      "retry_with_backoff",
      "retry_with_simplified_input",
      "ask_user",
      "abort",
    ],
    escalation: "notify_user",
    maxAttempts: 2,
  },
};

// ─── ErrorRecoveryEngine ──────────────────────────────────────────────────────

export class ErrorRecoveryEngine extends EventEmitter {
  private errors = new Map<string, ErrorRecord[]>(); // agentId → errors
  private attempts = new Map<string, RecoveryAttempt[]>(); // errorId → attempts
  private plans = new Map<string, RecoveryPlan>(); // errorId → plan
  private patterns: ErrorPattern[] = [];

  constructor(
    private readonly backbone = getClaudeAgentBackbone()
  ) {
    super();
    logger.info("[ErrorRecoveryEngine] Initialized");
  }

  // ── Error diagnosis ───────────────────────────────────────────────────────────

  async diagnose(
    agentId: string,
    sessionId: string,
    error: string | Error,
    context?: Record<string, unknown>
  ): Promise<RecoveryPlan> {
    const rawError =
      typeof error === "string" ? error : `${error.name}: ${error.message}`;
    const category = classifyError(error);

    const errorRecord: ErrorRecord = {
      errorId: randomUUID(),
      agentId,
      sessionId,
      category,
      message:
        typeof error === "string" ? error : error.message,
      rawError,
      timestamp: Date.now(),
      context,
    };

    const agentErrors = this.errors.get(agentId) ?? [];
    agentErrors.push(errorRecord);
    this.errors.set(agentId, agentErrors);

    // Update pattern detection
    this.updatePatterns(category, rawError);

    // Build recovery plan
    const matrix = STRATEGY_MATRIX[category];
    const recentErrors = agentErrors.slice(-10);
    const sameCategory = recentErrors.filter((e) => e.category === category);

    // Escalate if repeated failures of same category
    let escalation = matrix.escalation;
    let strategies = [...matrix.strategies];

    if (sameCategory.length >= 3) {
      // Escalate up one level
      const levels: EscalationLevel[] = [
        "auto_retry",
        "auto_recover",
        "notify_user",
        "ask_user",
        "abort",
      ];
      const currentIdx = levels.indexOf(escalation);
      escalation = levels[Math.min(currentIdx + 1, levels.length - 1)];

      // Add ask_user to strategy list if not present
      if (!strategies.includes("ask_user") && escalation !== "abort") {
        strategies = [...strategies, "ask_user"];
      }

      logger.warn(
        { agentId, category, occurrences: sameCategory.length },
        "[ErrorRecoveryEngine] Escalating due to repeated errors"
      );
    }

    // Use LLM for unknown errors or complex contexts
    let reasoning =
      `Category: ${category}. ` +
      `Recommended strategies: ${strategies.slice(0, 2).join(", ")}.`;

    if (category === "unknown" || sameCategory.length >= 2) {
      reasoning = await this.getLLMReasoning(errorRecord, agentErrors, context);
    }

    const plan: RecoveryPlan = {
      planId: randomUUID(),
      errorId: errorRecord.errorId,
      category,
      escalationLevel: escalation,
      strategies,
      maxAttempts: matrix.maxAttempts,
      currentAttempt: 0,
      reasoning,
      fallbackMessage:
        escalation === "ask_user" || escalation === "abort"
          ? `Agent encountered ${category} error and needs guidance: ${errorRecord.message}`
          : undefined,
    };

    this.plans.set(errorRecord.errorId, plan);
    this.attempts.set(errorRecord.errorId, []);

    logger.info(
      {
        errorId: errorRecord.errorId,
        category,
        escalation,
        strategies: strategies[0],
        agentId,
      },
      "[ErrorRecoveryEngine] Recovery plan created"
    );

    this.emit("recovery:planned", { plan, error: errorRecord });
    return plan;
  }

  private async getLLMReasoning(
    error: ErrorRecord,
    recentErrors: ErrorRecord[],
    context?: Record<string, unknown>
  ): Promise<string> {
    const errorHistory = recentErrors
      .slice(-5)
      .map((e) => `[${e.category}] ${e.message.slice(0, 100)}`)
      .join("\n");

    const messages: AgentMessage[] = [
      {
        role: "user",
        content: `Diagnose this agent error and suggest recovery strategy.

CURRENT ERROR: ${error.rawError.slice(0, 300)}
CATEGORY: ${error.category}

RECENT ERROR HISTORY:
${errorHistory}

CONTEXT: ${JSON.stringify(context ?? {}, null, 2).slice(0, 300)}

Output JSON: { "reasoning": "brief analysis", "suggestedStrategy": "strategy_name", "rootCause": "root cause" }
Return ONLY valid JSON.`,
      },
    ];

    try {
      const response = await this.backbone.call(messages, {
        model: CLAUDE_MODELS.HAIKU,
        maxTokens: 512,
        system:
          "You are an expert at diagnosing AI agent failures. Be concise and specific.",
      });

      const jsonMatch = response.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as {
          reasoning?: string;
          suggestedStrategy?: string;
          rootCause?: string;
        };
        return `${parsed.reasoning ?? ""} Root cause: ${parsed.rootCause ?? "unknown"}`;
      }
    } catch {
      // Fall through to default
    }

    return `Category: ${error.category}. Error: ${error.message.slice(0, 200)}`;
  }

  // ── Strategy execution ────────────────────────────────────────────────────────

  async executeRecovery(
    plan: RecoveryPlan,
    executor: (strategy: RecoveryStrategy) => Promise<unknown>
  ): Promise<{ success: boolean; result?: unknown; exhausted: boolean; nextStrategy?: RecoveryStrategy }> {
    if (plan.currentAttempt >= plan.strategies.length) {
      return { success: false, exhausted: true };
    }

    const strategy = plan.strategies[plan.currentAttempt];
    plan.currentAttempt++;

    const attempt: RecoveryAttempt = {
      attemptId: randomUUID(),
      errorId: plan.errorId,
      strategy,
      startedAt: Date.now(),
      success: false,
    };

    this.emit("recovery:attempt_started", {
      errorId: plan.errorId,
      strategy,
      attempt: plan.currentAttempt,
    });

    try {
      const result = await executor(strategy);
      attempt.success = true;
      attempt.result = result;
      attempt.completedAt = Date.now();

      const errorAttempts = this.attempts.get(plan.errorId) ?? [];
      errorAttempts.push(attempt);
      this.attempts.set(plan.errorId, errorAttempts);

      // Update pattern with successful strategy
      this.recordStrategySuccess(plan.category, strategy);

      logger.info(
        { errorId: plan.errorId, strategy, attempt: plan.currentAttempt },
        "[ErrorRecoveryEngine] Recovery succeeded"
      );

      this.emit("recovery:success", {
        errorId: plan.errorId,
        strategy,
        result,
      });

      return { success: true, result, exhausted: false };
    } catch (err) {
      attempt.success = false;
      attempt.notes = String(err);
      attempt.completedAt = Date.now();

      const errorAttempts = this.attempts.get(plan.errorId) ?? [];
      errorAttempts.push(attempt);
      this.attempts.set(plan.errorId, errorAttempts);

      // Record failed strategy
      this.recordStrategyFailure(plan.category, strategy);

      logger.warn(
        { errorId: plan.errorId, strategy, error: String(err) },
        "[ErrorRecoveryEngine] Recovery strategy failed"
      );

      this.emit("recovery:strategy_failed", {
        errorId: plan.errorId,
        strategy,
        error: String(err),
      });

      const exhausted = plan.currentAttempt >= plan.strategies.length;
      const nextStrategy = exhausted
        ? undefined
        : plan.strategies[plan.currentAttempt];

      return { success: false, exhausted, nextStrategy };
    }
  }

  // ── Backoff calculator ────────────────────────────────────────────────────────

  getBackoffDelay(attemptNumber: number, category: ErrorCategory): number {
    const baseDelay = category === "rate_limit" ? 2_000 : 500;
    const maxDelay = category === "rate_limit" ? 60_000 : 10_000;

    // Exponential backoff with jitter
    const exponential = baseDelay * Math.pow(2, attemptNumber - 1);
    const jitter = Math.random() * 1_000;
    return Math.min(exponential + jitter, maxDelay);
  }

  // ── Pattern tracking ──────────────────────────────────────────────────────────

  private updatePatterns(category: ErrorCategory, rawError: string): void {
    const existing = this.patterns.find((p) => p.category === category);
    if (existing) {
      existing.occurrences++;
      existing.lastSeen = Date.now();
    } else {
      this.patterns.push({
        patternId: randomUUID(),
        category,
        messagePattern: rawError.slice(0, 50),
        occurrences: 1,
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        successfulStrategies: [],
        failedStrategies: [],
      });
    }

    // Emit pattern alert for high-frequency errors
    const pattern = this.patterns.find((p) => p.category === category)!;
    if (pattern.occurrences === 5 || pattern.occurrences % 10 === 0) {
      this.emit("pattern:detected", pattern);
      logger.warn(
        { category, occurrences: pattern.occurrences },
        "[ErrorRecoveryEngine] Recurring error pattern detected"
      );
    }
  }

  private recordStrategySuccess(
    category: ErrorCategory,
    strategy: RecoveryStrategy
  ): void {
    const pattern = this.patterns.find((p) => p.category === category);
    if (pattern && !pattern.successfulStrategies.includes(strategy)) {
      pattern.successfulStrategies.push(strategy);
    }
  }

  private recordStrategyFailure(
    category: ErrorCategory,
    strategy: RecoveryStrategy
  ): void {
    const pattern = this.patterns.find((p) => p.category === category);
    if (pattern && !pattern.failedStrategies.includes(strategy)) {
      pattern.failedStrategies.push(strategy);
    }
  }

  // ── Queries ───────────────────────────────────────────────────────────────────

  getErrors(agentId: string, limit = 50): ErrorRecord[] {
    return (this.errors.get(agentId) ?? []).slice(-limit).reverse();
  }

  getAttempts(errorId: string): RecoveryAttempt[] {
    return this.attempts.get(errorId) ?? [];
  }

  getRecoveryPlan(errorId: string): RecoveryPlan | null {
    return this.plans.get(errorId) ?? null;
  }

  getPatterns(): ErrorPattern[] {
    return [...this.patterns].sort((a, b) => b.occurrences - a.occurrences);
  }

  getErrorSummary(agentId: string) {
    const agentErrors = this.errors.get(agentId) ?? [];
    const byCat = new Map<ErrorCategory, number>();
    for (const e of agentErrors) {
      byCat.set(e.category, (byCat.get(e.category) ?? 0) + 1);
    }

    const totalAttempts = [...this.attempts.values()].flat();
    const agentAttempts = totalAttempts.filter((a) => {
      const plan = this.plans.get(a.errorId);
      const err = agentErrors.find((e) => e.errorId === a.errorId);
      return !!err;
    });

    return {
      agentId,
      totalErrors: agentErrors.length,
      byCategory: Object.fromEntries(byCat.entries()),
      totalRecoveryAttempts: agentAttempts.length,
      successfulRecoveries: agentAttempts.filter((a) => a.success).length,
      mostRecentError: agentErrors.at(-1)?.message ?? null,
    };
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

let _instance: ErrorRecoveryEngine | null = null;

export function getErrorRecoveryEngine(): ErrorRecoveryEngine {
  if (!_instance) _instance = new ErrorRecoveryEngine();
  return _instance;
}
