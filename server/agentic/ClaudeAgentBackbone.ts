/**
 * ClaudeAgentBackbone — Core integration with Anthropic Claude API for agentic workflows.
 *
 * Manages multi-turn tool_use conversations with Claude, extended thinking,
 * streaming, cost tracking, and model selection.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageParam,
  Tool,
  ToolUseBlock,
  TextBlock,
  ThinkingBlock,
  Message,
  RawMessageStreamEvent,
} from "@anthropic-ai/sdk/resources/messages";
import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { Logger } from "../lib/logger";
import type { ToolContext, ToolResult } from "../agent/toolTypes";

// ─── Model constants ──────────────────────────────────────────────────────────
export const FAST_MODEL = "claude-sonnet-4-6";
export const REASONING_MODEL = "claude-opus-4-6";

// Per-model pricing (USD per million tokens, as of 2025)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  [FAST_MODEL]: { input: 3.0, output: 15.0 },
  [REASONING_MODEL]: { input: 15.0, output: 75.0 },
};

// ─── Types ─────────────────────────────────────────────────────────────────────
export type AgentModelChoice = "fast" | "reasoning" | "auto";

export interface AgentSessionConfig {
  sessionId?: string;
  model?: AgentModelChoice;
  systemPrompt?: string;
  maxIterations?: number;
  thinkingBudget?: number; // tokens for extended thinking (0 = disabled)
  tools?: Tool[];
  onEvent?: (event: AgentEvent) => void;
  abortSignal?: AbortSignal;
}

export interface AgentEvent {
  type:
    | "thinking"
    | "text"
    | "tool_call"
    | "tool_result"
    | "cost_update"
    | "iteration"
    | "done"
    | "error";
  sessionId: string;
  iteration: number;
  payload: unknown;
  timestamp: Date;
}

export interface ToolCallRequest {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AgentCostSummary {
  sessionId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  totalCostUsd: number;
  iterations: number;
}

export interface AgentSessionResult {
  sessionId: string;
  finalText: string;
  iterations: number;
  toolCallsMade: number;
  cost: AgentCostSummary;
  stoppedReason: "end_turn" | "max_iterations" | "tool_limit" | "user_abort" | "error";
}

export interface ToolExecutor {
  execute(call: ToolCallRequest, ctx: ToolContext): Promise<ToolResult>;
}

// ─── System prompt ─────────────────────────────────────────────────────────────
const DEFAULT_SYSTEM_PROMPT = `You are an expert AI assistant capable of autonomous task execution.
You have access to a set of tools. Use them proactively to accomplish the user's goal.

Guidelines:
- Break complex tasks into clear steps; reason about which tools to call and in what order.
- Always verify your progress after each tool call before proceeding.
- If a tool fails, diagnose the error and try an alternative approach.
- When you have gathered enough information, synthesize a clear, concise final answer.
- Never fabricate information — use tools to verify facts.
- Be transparent about uncertainty. If you are not sure, say so.

Response format:
- Use tools when action is needed.
- Provide a final text response once the task is complete.`;

// ─── ClaudeAgentBackbone ───────────────────────────────────────────────────────
export class ClaudeAgentBackbone extends EventEmitter {
  private readonly client: Anthropic;
  private readonly sessionId: string;
  private readonly config: Required<
    Omit<AgentSessionConfig, "onEvent" | "abortSignal" | "sessionId">
  >;
  private readonly onEvent?: (event: AgentEvent) => void;
  private readonly abortSignal?: AbortSignal;

  private conversationHistory: MessageParam[] = [];
  private iterationCount = 0;
  private toolCallCount = 0;
  private costTracker: AgentCostSummary;

  constructor(config: AgentSessionConfig = {}) {
    super();
    this.client = new Anthropic();
    this.sessionId = config.sessionId ?? randomUUID();
    this.onEvent = config.onEvent;
    this.abortSignal = config.abortSignal;

    this.config = {
      model: config.model ?? "auto",
      systemPrompt: config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
      maxIterations: config.maxIterations ?? 20,
      thinkingBudget: config.thinkingBudget ?? 0,
      tools: config.tools ?? [],
    };

    this.costTracker = {
      sessionId: this.sessionId,
      model: this.resolveModel("auto"),
      inputTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0,
      totalCostUsd: 0,
      iterations: 0,
    };

    Logger.info("[ClaudeAgentBackbone] Session initialised", {
      sessionId: this.sessionId,
      model: this.config.model,
      thinkingBudget: this.config.thinkingBudget,
    });
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /** Run the agent until completion or max iterations. */
  async run(
    userMessage: string,
    toolExecutor: ToolExecutor,
    toolContext: ToolContext
  ): Promise<AgentSessionResult> {
    this.appendUserMessage(userMessage);

    let stoppedReason: AgentSessionResult["stoppedReason"] = "end_turn";

    try {
      while (this.iterationCount < this.config.maxIterations) {
        if (this.abortSignal?.aborted) {
          stoppedReason = "user_abort";
          break;
        }

        this.iterationCount++;
        this.emit("iteration", this.iterationCount);
        this.emitEvent("iteration", { count: this.iterationCount });

        const response = await this.callClaude();
        this.trackCost(response);

        const toolCalls = this.extractToolCalls(response);
        const textBlocks = this.extractTextBlocks(response);
        const thinkingBlocks = this.extractThinkingBlocks(response);

        // Emit thinking / text events
        for (const t of thinkingBlocks) {
          this.emitEvent("thinking", { thinking: t.thinking });
        }
        for (const t of textBlocks) {
          this.emitEvent("text", { text: t.text });
        }

        // Record assistant turn
        this.conversationHistory.push({ role: "assistant", content: response.content });

        if (response.stop_reason === "end_turn" || toolCalls.length === 0) {
          stoppedReason = "end_turn";
          break;
        }

        if (response.stop_reason === "tool_use") {
          const toolResults = await this.executeTools(toolCalls, toolExecutor, toolContext);
          this.conversationHistory.push({ role: "user", content: toolResults });
        }
      }

      if (this.iterationCount >= this.config.maxIterations) {
        stoppedReason = "max_iterations";
        Logger.warn("[ClaudeAgentBackbone] Max iterations reached", {
          sessionId: this.sessionId,
          iterations: this.iterationCount,
        });
      }
    } catch (err) {
      stoppedReason = "error";
      this.emitEvent("error", { error: String(err) });
      Logger.error("[ClaudeAgentBackbone] Unhandled error in run loop", err);
    }

    const finalText = this.extractLastText();
    this.costTracker.iterations = this.iterationCount;
    this.emitEvent("done", { finalText, stoppedReason, cost: this.costTracker });

    Logger.info("[ClaudeAgentBackbone] Session complete", {
      sessionId: this.sessionId,
      stoppedReason,
      cost: this.costTracker,
    });

    return {
      sessionId: this.sessionId,
      finalText,
      iterations: this.iterationCount,
      toolCallsMade: this.toolCallCount,
      cost: this.costTracker,
      stoppedReason,
    };
  }

  /** Stream the agent run — yields events as they arrive. */
  async *stream(
    userMessage: string,
    toolExecutor: ToolExecutor,
    toolContext: ToolContext
  ): AsyncGenerator<AgentEvent> {
    const events: AgentEvent[] = [];
    let done = false;

    const originalOnEvent = this.onEvent;
    // Capture events into a local buffer
    const captureEvent = (ev: AgentEvent) => {
      events.push(ev);
      originalOnEvent?.(ev);
    };
    (this as any).onEvent = captureEvent;

    // Run in background
    const runPromise = this.run(userMessage, toolExecutor, toolContext);

    // Yield events as they are captured
    while (!done) {
      if (events.length > 0) {
        yield events.shift()!;
      } else {
        await new Promise<void>((r) => setImmediate(r));
        const result = await Promise.race([
          runPromise.then(() => "done"),
          new Promise<"pending">((r) => setTimeout(() => r("pending"), 50)),
        ]);
        if (result === "done") {
          done = true;
        }
      }
    }

    // Drain remaining events
    while (events.length > 0) {
      yield events.shift()!;
    }

    // Restore
    (this as any).onEvent = originalOnEvent;
  }

  /** Append a raw message (useful for injecting tool results externally). */
  appendUserMessage(content: string): void {
    this.conversationHistory.push({ role: "user", content });
  }

  /** Reset conversation but keep config. */
  resetConversation(): void {
    this.conversationHistory = [];
    this.iterationCount = 0;
    this.toolCallCount = 0;
  }

  getCostSummary(): AgentCostSummary {
    return { ...this.costTracker };
  }

  getConversationHistory(): MessageParam[] {
    return [...this.conversationHistory];
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private resolveModel(choice: AgentModelChoice): string {
    switch (choice) {
      case "fast":
        return FAST_MODEL;
      case "reasoning":
        return REASONING_MODEL;
      case "auto":
      default:
        return this.iterationCount > 5 ? FAST_MODEL : FAST_MODEL;
    }
  }

  private async callClaude(): Promise<Message> {
    const model = this.resolveModel(this.config.model);

    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model,
      max_tokens: this.config.thinkingBudget > 0 ? 16000 : 8096,
      system: this.config.systemPrompt,
      messages: this.conversationHistory,
      tools: this.config.tools.length > 0 ? this.config.tools : undefined,
    };

    if (this.config.thinkingBudget > 0) {
      (params as any).thinking = {
        type: "enabled",
        budget_tokens: this.config.thinkingBudget,
      };
    }

    try {
      const response = await this.client.messages.create(params);
      return response;
    } catch (err: any) {
      Logger.error("[ClaudeAgentBackbone] Claude API call failed", {
        sessionId: this.sessionId,
        iteration: this.iterationCount,
        error: err?.message,
        status: err?.status,
      });
      throw err;
    }
  }

  private extractToolCalls(message: Message): ToolCallRequest[] {
    return message.content
      .filter((b): b is ToolUseBlock => b.type === "tool_use")
      .map((b) => ({ id: b.id, name: b.name, input: b.input as Record<string, unknown> }));
  }

  private extractTextBlocks(message: Message): TextBlock[] {
    return message.content.filter((b): b is TextBlock => b.type === "text");
  }

  private extractThinkingBlocks(message: Message): ThinkingBlock[] {
    return message.content.filter((b): b is ThinkingBlock => b.type === "thinking");
  }

  private async executeTools(
    calls: ToolCallRequest[],
    executor: ToolExecutor,
    ctx: ToolContext
  ): Promise<Anthropic.ToolResultBlockParam[]> {
    const results: Anthropic.ToolResultBlockParam[] = [];

    for (const call of calls) {
      this.toolCallCount++;
      this.emitEvent("tool_call", { id: call.id, name: call.name, input: call.input });

      try {
        const result = await executor.execute(call, ctx);
        const content = result.success
          ? JSON.stringify(result.output)
          : `Error: ${result.error?.message ?? "Unknown error"}`;

        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content,
          is_error: !result.success,
        });

        this.emitEvent("tool_result", {
          id: call.id,
          name: call.name,
          success: result.success,
          content,
        });
      } catch (err: any) {
        const msg = err?.message ?? String(err);
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: `Execution error: ${msg}`,
          is_error: true,
        });
        this.emitEvent("tool_result", { id: call.id, name: call.name, success: false, error: msg });
        Logger.error("[ClaudeAgentBackbone] Tool execution threw", {
          sessionId: this.sessionId,
          tool: call.name,
          error: msg,
        });
      }
    }

    return results;
  }

  private trackCost(response: Message): void {
    const usage = response.usage;
    const model = (response as any).model ?? this.resolveModel(this.config.model);
    const pricing = MODEL_PRICING[model] ?? MODEL_PRICING[FAST_MODEL];

    const input = usage.input_tokens;
    const output = usage.output_tokens;
    const thinking = (usage as any).thinking_tokens ?? 0;

    this.costTracker.inputTokens += input;
    this.costTracker.outputTokens += output;
    this.costTracker.thinkingTokens += thinking;

    const cost =
      (input / 1_000_000) * pricing.input + (output / 1_000_000) * pricing.output;
    this.costTracker.totalCostUsd += cost;
    this.costTracker.model = model;

    this.emitEvent("cost_update", {
      iteration: this.iterationCount,
      delta: cost,
      total: this.costTracker.totalCostUsd,
      tokens: { input, output, thinking },
    });
  }

  private extractLastText(): string {
    for (let i = this.conversationHistory.length - 1; i >= 0; i--) {
      const msg = this.conversationHistory[i];
      if (msg.role === "assistant" && Array.isArray(msg.content)) {
        const textBlock = (msg.content as any[]).find((b) => b.type === "text");
        if (textBlock) return textBlock.text as string;
      }
    }
    return "";
  }

  private emitEvent(type: AgentEvent["type"], payload: unknown): void {
    const event: AgentEvent = {
      type,
      sessionId: this.sessionId,
      iteration: this.iterationCount,
      payload,
      timestamp: new Date(),
    };
    this.emit("agent_event", event);
    this.onEvent?.(event);
  }
}

// ─── Factory ───────────────────────────────────────────────────────────────────
export function createAgentSession(config: AgentSessionConfig = {}): ClaudeAgentBackbone {
  return new ClaudeAgentBackbone(config);
}
