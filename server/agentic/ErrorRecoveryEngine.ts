/**
 * ErrorRecoveryEngine — Diagnose errors, select recovery strategies,
 * execute them, detect patterns, and generate debug reports.
 */

import Anthropic from "@anthropic-ai/sdk";
import { Logger } from "../lib/logger";
import { FAST_MODEL } from "./ClaudeAgentBackbone";
import type { ToolCallRequest } from "./ClaudeAgentBackbone";

// ─── Error classification ──────────────────────────────────────────────────────
export type ErrorType =
  | "network"
  | "auth"
  | "rate_limit"
  | "invalid_input"
  | "tool_bug"
  | "timeout"
  | "permission"
  | "not_found"
  | "server_error"
  | "unknown";

export type RecoveryStrategy =
  | "retry_immediately"
  | "retry_with_backoff"
  | "refresh_token"
  | "fix_input"
  | "use_alternative_tool"
  | "checkpoint_and_defer"
  | "ask_user"
  | "abort";

export type EscalationLevel = "auto_fix" | "retry" | "alternative_tool" | "ask_user" | "abort";

export interface DiagnosedError {
  type: ErrorType;
  message: string;
  retryable: boolean;
  strategy: RecoveryStrategy;
  escalationLevel: EscalationLevel;
  details?: Record<string, unknown>;
}

export interface RecoveryAttempt {
  attemptNumber: number;
  strategy: RecoveryStrategy;
  timestamp: Date;
  succeeded: boolean;
  resultSummary: string;
}

export interface ErrorPattern {
  errorType: ErrorType;
  toolName: string;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
  strategiesTriedAndFailed: RecoveryStrategy[];
}

export interface ErrorReport {
  sessionId: string;
  toolName: string;
  errorType: ErrorType;
  attempts: RecoveryAttempt[];
  finalOutcome: "resolved" | "unresolved" | "escalated";
  recommendation: string;
  generatedAt: Date;
}

export interface RecoveryContext {
  sessionId: string;
  toolCall: ToolCallRequest;
  error: Error;
  attemptNumber: number;
  availableAlternativeTools?: string[];
  signal?: AbortSignal;
}

export interface RecoveryResult {
  recovered: boolean;
  strategy: RecoveryStrategy;
  revisedInput?: Record<string, unknown>;
  alternativeTool?: string;
  waitMs?: number;
  userMessage?: string;
}

// ─── Diagnosis rules ───────────────────────────────────────────────────────────
function classifyError(err: Error): DiagnosedError {
  const msg = err.message.toLowerCase();
  const status = (err as any)?.status ?? (err as any)?.statusCode ?? 0;

  // Rate limit
  if (status === 429 || msg.includes("rate limit") || msg.includes("too many requests")) {
    return {
      type: "rate_limit",
      message: err.message,
      retryable: true,
      strategy: "retry_with_backoff",
      escalationLevel: "retry",
    };
  }

  // Auth
  if (status === 401 || status === 403 || msg.includes("unauthorized") || msg.includes("forbidden") || msg.includes("invalid api key")) {
    return {
      type: "auth",
      message: err.message,
      retryable: true,
      strategy: "refresh_token",
      escalationLevel: "auto_fix",
    };
  }

  // Network
  if (
    msg.includes("econnrefused") ||
    msg.includes("etimedout") ||
    msg.includes("enotfound") ||
    msg.includes("network") ||
    msg.includes("fetch failed") ||
    status === 503 ||
    status === 502
  ) {
    return {
      type: "network",
      message: err.message,
      retryable: true,
      strategy: "retry_with_backoff",
      escalationLevel: "retry",
    };
  }

  // Timeout
  if (msg.includes("timeout") || msg.includes("timed out") || status === 504) {
    return {
      type: "timeout",
      message: err.message,
      retryable: true,
      strategy: "checkpoint_and_defer",
      escalationLevel: "retry",
    };
  }

  // Not found
  if (status === 404 || msg.includes("not found") || msg.includes("does not exist")) {
    return {
      type: "not_found",
      message: err.message,
      retryable: false,
      strategy: "fix_input",
      escalationLevel: "auto_fix",
    };
  }

  // Invalid input / validation
  if (
    status === 400 ||
    msg.includes("invalid") ||
    msg.includes("validation") ||
    msg.includes("required") ||
    msg.includes("expected")
  ) {
    return {
      type: "invalid_input",
      message: err.message,
      retryable: true,
      strategy: "fix_input",
      escalationLevel: "auto_fix",
    };
  }

  // Server error
  if (status >= 500) {
    return {
      type: "server_error",
      message: err.message,
      retryable: true,
      strategy: "retry_with_backoff",
      escalationLevel: "retry",
    };
  }

  // Permission
  if (msg.includes("permission") || msg.includes("access denied")) {
    return {
      type: "permission",
      message: err.message,
      retryable: false,
      strategy: "ask_user",
      escalationLevel: "ask_user",
    };
  }

  return {
    type: "unknown",
    message: err.message,
    retryable: false,
    strategy: "ask_user",
    escalationLevel: "ask_user",
  };
}

// ─── Backoff helper ────────────────────────────────────────────────────────────
function computeBackoffMs(attempt: number, base = 1000, max = 30_000): number {
  return Math.min(max, base * Math.pow(2, attempt - 1) + Math.random() * 500);
}

// ─── ErrorRecoveryEngine ───────────────────────────────────────────────────────
export class ErrorRecoveryEngine {
  private readonly client: Anthropic;
  private readonly maxRetries: number;
  private readonly onEscalation?: (report: ErrorReport) => Promise<void>;

  // Pattern tracking: toolName → errorType → ErrorPattern
  private patterns = new Map<string, Map<ErrorType, ErrorPattern>>();

  // Per-call attempt history: `${sessionId}:${callId}` → attempts
  private attemptHistory = new Map<string, RecoveryAttempt[]>();

  constructor(options: {
    maxRetries?: number;
    onEscalation?: (report: ErrorReport) => Promise<void>;
  } = {}) {
    this.client = new Anthropic();
    this.maxRetries = options.maxRetries ?? 3;
    this.onEscalation = options.onEscalation;
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  /** Primary recovery entry point. Returns a RecoveryResult with what to do next. */
  async recover(ctx: RecoveryContext): Promise<RecoveryResult> {
    const key = `${ctx.sessionId}:${ctx.toolCall.id}`;
    const attempts = this.attemptHistory.get(key) ?? [];

    const diagnosed = classifyError(ctx.error);
    this.trackPattern(ctx.toolCall.name, diagnosed.type, attempts);

    Logger.info("[ErrorRecovery] Diagnosing error", {
      sessionId: ctx.sessionId,
      tool: ctx.toolCall.name,
      errorType: diagnosed.type,
      attempt: ctx.attemptNumber,
      strategy: diagnosed.strategy,
    });

    // If same error repeating 3x, escalate strategy
    const pattern = this.getPattern(ctx.toolCall.name, diagnosed.type);
    const effectiveStrategy =
      pattern && pattern.count >= 3 && !pattern.strategiesTriedAndFailed.includes(diagnosed.strategy)
        ? this.escalateStrategy(diagnosed.strategy)
        : diagnosed.strategy;

    let result: RecoveryResult;

    switch (effectiveStrategy) {
      case "retry_with_backoff": {
        const waitMs = computeBackoffMs(ctx.attemptNumber);
        result = { recovered: false, strategy: effectiveStrategy, waitMs };
        break;
      }

      case "retry_immediately":
        result = { recovered: false, strategy: effectiveStrategy, waitMs: 0 };
        break;

      case "refresh_token":
        result = { recovered: false, strategy: effectiveStrategy, waitMs: 500 };
        break;

      case "fix_input": {
        const fixed = await this.fixInput(ctx.toolCall, ctx.error);
        result = fixed
          ? { recovered: true, strategy: effectiveStrategy, revisedInput: fixed }
          : { recovered: false, strategy: "ask_user", userMessage: `Cannot auto-fix input for ${ctx.toolCall.name}: ${ctx.error.message}` };
        break;
      }

      case "use_alternative_tool": {
        const alt = this.findAlternative(ctx.toolCall.name, ctx.availableAlternativeTools ?? []);
        result = alt
          ? { recovered: true, strategy: effectiveStrategy, alternativeTool: alt }
          : { recovered: false, strategy: "ask_user", userMessage: `No alternative found for ${ctx.toolCall.name}` };
        break;
      }

      case "checkpoint_and_defer":
        result = {
          recovered: false,
          strategy: effectiveStrategy,
          userMessage: `Task paused due to timeout on "${ctx.toolCall.name}". It will resume from the last checkpoint.`,
        };
        break;

      case "ask_user":
        result = {
          recovered: false,
          strategy: effectiveStrategy,
          userMessage: `Tool "${ctx.toolCall.name}" failed with error: ${ctx.error.message}. Please review.`,
        };
        break;

      case "abort":
        result = {
          recovered: false,
          strategy: effectiveStrategy,
          userMessage: `Aborting: repeated failure on "${ctx.toolCall.name}" — ${ctx.error.message}`,
        };
        break;

      default:
        result = { recovered: false, strategy: "ask_user" };
    }

    const attempt: RecoveryAttempt = {
      attemptNumber: ctx.attemptNumber,
      strategy: effectiveStrategy,
      timestamp: new Date(),
      succeeded: result.recovered,
      resultSummary: result.recovered ? "Auto-recovered" : result.userMessage ?? "Not recovered",
    };

    attempts.push(attempt);
    this.attemptHistory.set(key, attempts);

    if (!result.recovered && pattern) {
      pattern.strategiesTriedAndFailed.push(effectiveStrategy);
    }

    // Escalate to user if max retries exceeded or abort strategy
    if (ctx.attemptNumber >= this.maxRetries || effectiveStrategy === "abort") {
      await this.escalate(ctx, diagnosed, attempts);
    }

    return result;
  }

  /** Generate a structured error report for debugging. */
  generateReport(
    sessionId: string,
    toolCall: ToolCallRequest,
    diagnosed: DiagnosedError,
    attempts: RecoveryAttempt[]
  ): ErrorReport {
    const succeeded = attempts.some((a) => a.succeeded);
    const finalOutcome = succeeded ? "resolved" : attempts.some((a) => a.strategy === "ask_user") ? "escalated" : "unresolved";

    return {
      sessionId,
      toolName: toolCall.name,
      errorType: diagnosed.type,
      attempts,
      finalOutcome,
      recommendation: this.buildRecommendation(diagnosed, attempts),
      generatedAt: new Date(),
    };
  }

  /** Get all detected error patterns. */
  getPatterns(): ErrorPattern[] {
    const result: ErrorPattern[] = [];
    for (const toolMap of this.patterns.values()) {
      for (const pattern of toolMap.values()) {
        result.push(pattern);
      }
    }
    return result.sort((a, b) => b.count - a.count);
  }

  /** Clear attempt history for a session. */
  clearSession(sessionId: string): void {
    for (const key of this.attemptHistory.keys()) {
      if (key.startsWith(`${sessionId}:`)) {
        this.attemptHistory.delete(key);
      }
    }
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private async fixInput(
    call: ToolCallRequest,
    error: Error
  ): Promise<Record<string, unknown> | null> {
    try {
      const prompt = `A tool call failed due to invalid input. Suggest a corrected input.

TOOL NAME: ${call.name}
ORIGINAL INPUT: ${JSON.stringify(call.input, null, 2)}
ERROR: ${error.message}

Return JSON with the corrected input fields only:
{ "corrected_input": { ... } }

If the input cannot be automatically fixed, return: { "corrected_input": null }`;

      const response = await this.client.messages.create({
        model: FAST_MODEL,
        max_tokens: 512,
        messages: [{ role: "user", content: prompt }],
      });

      const textBlock = response.content.find((b) => b.type === "text");
      const text = textBlock?.type === "text" ? textBlock.text : "{}";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

      return parsed.corrected_input ?? null;
    } catch {
      return null;
    }
  }

  private findAlternative(toolName: string, available: string[]): string | null {
    // Simple name-based heuristic
    const alternatives: Record<string, string[]> = {
      web_search: ["fetch_url", "browse_and_act"],
      fetch_url: ["web_search", "browse_and_act"],
      create_document: ["create_presentation", "bash"],
      bash: ["code_execution"],
    };

    const alts = alternatives[toolName] ?? [];
    return alts.find((a) => available.includes(a)) ?? null;
  }

  private escalateStrategy(current: RecoveryStrategy): RecoveryStrategy {
    const chain: RecoveryStrategy[] = [
      "retry_immediately",
      "retry_with_backoff",
      "fix_input",
      "use_alternative_tool",
      "ask_user",
      "abort",
    ];
    const idx = chain.indexOf(current);
    return idx >= 0 && idx < chain.length - 1 ? chain[idx + 1] : "ask_user";
  }

  private trackPattern(toolName: string, errorType: ErrorType, attempts: RecoveryAttempt[]): void {
    if (!this.patterns.has(toolName)) {
      this.patterns.set(toolName, new Map());
    }
    const toolMap = this.patterns.get(toolName)!;
    const existing = toolMap.get(errorType);

    if (existing) {
      existing.count++;
      existing.lastSeen = new Date();
    } else {
      toolMap.set(errorType, {
        errorType,
        toolName,
        count: 1,
        firstSeen: new Date(),
        lastSeen: new Date(),
        strategiesTriedAndFailed: [],
      });
    }
  }

  private getPattern(toolName: string, errorType: ErrorType): ErrorPattern | null {
    return this.patterns.get(toolName)?.get(errorType) ?? null;
  }

  private async escalate(
    ctx: RecoveryContext,
    diagnosed: DiagnosedError,
    attempts: RecoveryAttempt[]
  ): Promise<void> {
    const report = this.generateReport(ctx.sessionId, ctx.toolCall, diagnosed, attempts);
    Logger.warn("[ErrorRecovery] Escalating to user", {
      sessionId: ctx.sessionId,
      tool: ctx.toolCall.name,
      errorType: diagnosed.type,
      attempts: attempts.length,
    });
    await this.onEscalation?.(report);
  }

  private buildRecommendation(diagnosed: DiagnosedError, attempts: RecoveryAttempt[]): string {
    const typeMessages: Partial<Record<ErrorType, string>> = {
      rate_limit: "Increase retry delays or reduce request frequency.",
      auth: "Check API keys and token expiry. Ensure credentials are correctly configured.",
      network: "Verify network connectivity and DNS resolution. Consider a fallback endpoint.",
      invalid_input: "Review tool input schema. The input provided does not match expected format.",
      tool_bug: "This tool may have a bug. Consider reporting it or using an alternative.",
      timeout: "Increase timeout limits or break the task into smaller chunks.",
    };
    return typeMessages[diagnosed.type] ?? `Unresolved error after ${attempts.length} attempts. Manual investigation required.`;
  }
}
