import Anthropic from "@anthropic-ai/sdk";
import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import pino from "pino";

const logger = pino({ name: "ClaudeAgentBackbone" });

// ─── Model constants ──────────────────────────────────────────────────────────

export const CLAUDE_MODELS = {
  /** Fast, cost-efficient — routine tasks, tool calls, summaries */
  SONNET: "claude-sonnet-4-6",
  /** Most capable — complex reasoning, planning, synthesis */
  OPUS: "claude-opus-4-6",
  /** Fastest, cheapest — classification, short extractions */
  HAIKU: "claude-haiku-4-5-20251001",
} as const;

export type ClaudeModel = (typeof CLAUDE_MODELS)[keyof typeof CLAUDE_MODELS];

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentMessage {
  role: "user" | "assistant";
  content: string | Anthropic.ContentBlockParam[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Anthropic.Tool["input_schema"];
}

export interface ThinkingConfig {
  enabled: boolean;
  /** Token budget for internal reasoning (min 1024, recommend 8000-16000 for planning) */
  budgetTokens: number;
}

export interface BackboneCallOptions {
  model?: ClaudeModel;
  maxTokens?: number;
  system?: string;
  tools?: ToolDefinition[];
  thinking?: ThinkingConfig;
  temperature?: number;
  stream?: boolean;
  sessionId?: string;
}

export interface ToolCallResult {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  output: unknown;
  durationMs: number;
  error?: string;
}

export interface BackboneResponse {
  responseId: string;
  sessionId: string;
  model: ClaudeModel;
  text: string;
  thinkingContent: string;
  toolCalls: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
  }>;
  stopReason: Anthropic.Message["stop_reason"];
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    totalTokens: number;
    estimatedCostUSD: number;
  };
  durationMs: number;
}

export interface AgentLoop {
  loopId: string;
  sessionId: string;
  messages: AgentMessage[];
  totalRounds: number;
  totalTokens: number;
  totalCostUSD: number;
  finalResponse?: string;
  status: "running" | "completed" | "failed" | "max_rounds_reached";
}

// ─── Cost table (USD per 1M tokens, as of 2025) ───────────────────────────────

const COST_PER_MILLION: Record<ClaudeModel, { input: number; output: number; cacheRead: number }> = {
  [CLAUDE_MODELS.OPUS]: { input: 15.0, output: 75.0, cacheRead: 1.5 },
  [CLAUDE_MODELS.SONNET]: { input: 3.0, output: 15.0, cacheRead: 0.3 },
  [CLAUDE_MODELS.HAIKU]: { input: 0.8, output: 4.0, cacheRead: 0.08 },
};

function computeCost(
  model: ClaudeModel,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0
): number {
  const rates = COST_PER_MILLION[model] ?? COST_PER_MILLION[CLAUDE_MODELS.SONNET];
  return (
    (inputTokens / 1_000_000) * rates.input +
    (outputTokens / 1_000_000) * rates.output +
    (cacheReadTokens / 1_000_000) * rates.cacheRead
  );
}

// ─── Session state ─────────────────────────────────────────────────────────────

interface SessionState {
  sessionId: string;
  messages: AgentMessage[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUSD: number;
  createdAt: number;
  lastActiveAt: number;
}

// ─── ClaudeAgentBackbone ──────────────────────────────────────────────────────

export class ClaudeAgentBackbone extends EventEmitter {
  private readonly client: Anthropic;
  private sessions = new Map<string, SessionState>();

  constructor(apiKey?: string) {
    super();
    this.client = new Anthropic({
      apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY,
    });
    logger.info("[ClaudeAgentBackbone] Initialized");
  }

  // ── Session management ────────────────────────────────────────────────────────

  createSession(sessionId?: string): string {
    const id = sessionId ?? randomUUID();
    this.sessions.set(id, {
      sessionId: id,
      messages: [],
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUSD: 0,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    });
    return id;
  }

  getSession(sessionId: string): SessionState | undefined {
    return this.sessions.get(sessionId);
  }

  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  addUserMessage(sessionId: string, content: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session '${sessionId}' not found`);
    session.messages.push({ role: "user", content });
    session.lastActiveAt = Date.now();
  }

  // ── Core call ─────────────────────────────────────────────────────────────────

  async call(
    messages: AgentMessage[],
    opts: BackboneCallOptions = {}
  ): Promise<BackboneResponse> {
    const {
      model = CLAUDE_MODELS.SONNET,
      maxTokens = 8192,
      system,
      tools = [],
      thinking,
      sessionId = randomUUID(),
    } = opts;

    const startMs = Date.now();
    const responseId = randomUUID();

    // Build request params
    const params: Anthropic.MessageCreateParams = {
      model,
      max_tokens: maxTokens,
      messages: messages.map((m) => ({
        role: m.role,
        content:
          typeof m.content === "string"
            ? m.content
            : (m.content as Anthropic.ContentBlockParam[]),
      })),
    };

    if (system) params.system = system;

    if (tools.length > 0) {
      params.tools = tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
      }));
    }

    if (thinking?.enabled) {
      params.thinking = {
        type: "enabled",
        budget_tokens: Math.max(1024, thinking.budgetTokens),
      };
      // Extended thinking requires temperature = 1
      params.temperature = 1;
    } else if (opts.temperature !== undefined) {
      params.temperature = opts.temperature;
    }

    logger.debug(
      { model, sessionId, thinking: thinking?.enabled, tools: tools.length },
      "[ClaudeAgentBackbone] Making API call"
    );

    try {
      const response = await this.client.messages.create(params);

      // Extract content blocks
      let textContent = "";
      let thinkingContent = "";
      const toolCalls: BackboneResponse["toolCalls"] = [];

      for (const block of response.content) {
        if (block.type === "text") {
          textContent += block.text;
        } else if (block.type === "thinking") {
          thinkingContent += block.thinking;
        } else if (block.type === "tool_use") {
          toolCalls.push({
            id: block.id,
            name: block.name,
            input: block.input as Record<string, unknown>,
          });
        }
      }

      const inputTokens = response.usage.input_tokens;
      const outputTokens = response.usage.output_tokens;
      const cacheReadTokens = (response.usage as Record<string, number>).cache_read_input_tokens ?? 0;
      const cacheWriteTokens = (response.usage as Record<string, number>).cache_creation_input_tokens ?? 0;
      const costUSD = computeCost(model, inputTokens, outputTokens, cacheReadTokens);
      const durationMs = Date.now() - startMs;

      // Update session stats
      const session = this.sessions.get(sessionId);
      if (session) {
        session.totalInputTokens += inputTokens;
        session.totalOutputTokens += outputTokens;
        session.totalCostUSD += costUSD;
        session.lastActiveAt = Date.now();
        if (textContent) {
          session.messages.push({ role: "assistant", content: textContent });
        }
      }

      const result: BackboneResponse = {
        responseId,
        sessionId,
        model,
        text: textContent,
        thinkingContent,
        toolCalls,
        stopReason: response.stop_reason,
        usage: {
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheWriteTokens,
          totalTokens: inputTokens + outputTokens,
          estimatedCostUSD: costUSD,
        },
        durationMs,
      };

      this.emit("response", result);
      logger.debug(
        { responseId, tokens: result.usage.totalTokens, costUSD: costUSD.toFixed(6), durationMs },
        "[ClaudeAgentBackbone] Response received"
      );

      return result;
    } catch (err) {
      logger.error({ err, model, sessionId }, "[ClaudeAgentBackbone] API call failed");
      throw err;
    }
  }

  // ── Streaming call ────────────────────────────────────────────────────────────

  async *stream(
    messages: AgentMessage[],
    opts: BackboneCallOptions = {}
  ): AsyncGenerator<
    | { type: "text_delta"; delta: string }
    | { type: "thinking_delta"; delta: string }
    | { type: "tool_use_start"; id: string; name: string }
    | { type: "tool_input_delta"; id: string; delta: string }
    | { type: "message_stop"; response: BackboneResponse }
  > {
    const {
      model = CLAUDE_MODELS.SONNET,
      maxTokens = 8192,
      system,
      tools = [],
      thinking,
      sessionId = randomUUID(),
    } = opts;

    const startMs = Date.now();
    const responseId = randomUUID();

    const params: Anthropic.MessageStreamParams = {
      model,
      max_tokens: maxTokens,
      messages: messages.map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : (m.content as Anthropic.ContentBlockParam[]),
      })),
    };

    if (system) params.system = system;
    if (tools.length > 0) {
      params.tools = tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
      }));
    }
    if (thinking?.enabled) {
      params.thinking = { type: "enabled", budget_tokens: Math.max(1024, thinking.budgetTokens) };
      params.temperature = 1;
    }

    let accumulatedText = "";
    let accumulatedThinking = "";
    const toolCalls: BackboneResponse["toolCalls"] = [];
    const toolInputBuffers = new Map<string, string>();

    try {
      const stream = this.client.messages.stream(params);

      for await (const event of stream) {
        if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") {
            accumulatedText += event.delta.text;
            yield { type: "text_delta", delta: event.delta.text };
          } else if (event.delta.type === "thinking_delta") {
            accumulatedThinking += event.delta.thinking;
            yield { type: "thinking_delta", delta: event.delta.thinking };
          } else if (event.delta.type === "input_json_delta") {
            const current = toolInputBuffers.get(String(event.index)) ?? "";
            toolInputBuffers.set(String(event.index), current + event.delta.partial_json);
            yield {
              type: "tool_input_delta",
              id: String(event.index),
              delta: event.delta.partial_json,
            };
          }
        } else if (event.type === "content_block_start") {
          if (event.content_block.type === "tool_use") {
            toolCalls.push({
              id: event.content_block.id,
              name: event.content_block.name,
              input: {},
            });
            toolInputBuffers.set(String(event.index), "");
            yield { type: "tool_use_start", id: event.content_block.id, name: event.content_block.name };
          }
        } else if (event.type === "message_stop") {
          // Parse buffered tool inputs
          for (let i = 0; i < toolCalls.length; i++) {
            const buf = toolInputBuffers.get(String(i));
            if (buf) {
              try {
                toolCalls[i].input = JSON.parse(buf);
              } catch {
                toolCalls[i].input = { raw: buf };
              }
            }
          }
        }
      }

      const finalMsg = await stream.finalMessage();
      const inputTokens = finalMsg.usage.input_tokens;
      const outputTokens = finalMsg.usage.output_tokens;
      const cacheReadTokens = (finalMsg.usage as Record<string, number>).cache_read_input_tokens ?? 0;
      const costUSD = computeCost(model, inputTokens, outputTokens, cacheReadTokens);

      const response: BackboneResponse = {
        responseId,
        sessionId,
        model,
        text: accumulatedText,
        thinkingContent: accumulatedThinking,
        toolCalls,
        stopReason: finalMsg.stop_reason,
        usage: {
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheWriteTokens: (finalMsg.usage as Record<string, number>).cache_creation_input_tokens ?? 0,
          totalTokens: inputTokens + outputTokens,
          estimatedCostUSD: costUSD,
        },
        durationMs: Date.now() - startMs,
      };

      yield { type: "message_stop", response };
      this.emit("response", response);
    } catch (err) {
      logger.error({ err, model, sessionId }, "[ClaudeAgentBackbone] Stream failed");
      throw err;
    }
  }

  // ── Agentic tool loop ──────────────────────────────────────────────────────────

  async runAgentLoop(
    initialMessages: AgentMessage[],
    toolHandlers: Record<string, (input: Record<string, unknown>) => Promise<unknown>>,
    opts: BackboneCallOptions & { maxRounds?: number } = {}
  ): Promise<AgentLoop> {
    const { maxRounds = 15, sessionId = this.createSession(), ...callOpts } = opts;
    const loopId = randomUUID();
    const session = this.sessions.get(sessionId)!;

    const loop: AgentLoop = {
      loopId,
      sessionId,
      messages: [...initialMessages],
      totalRounds: 0,
      totalTokens: 0,
      totalCostUSD: 0,
      status: "running",
    };

    this.emit("loop:start", { loopId, sessionId });

    while (loop.totalRounds < maxRounds) {
      loop.totalRounds++;

      const response = await this.call(loop.messages, { ...callOpts, sessionId });
      loop.totalTokens += response.usage.totalTokens;
      loop.totalCostUSD += response.usage.estimatedCostUSD;

      // Add assistant message
      const assistantContent: Anthropic.ContentBlockParam[] = [];
      if (response.thinkingContent) {
        assistantContent.push({ type: "thinking" as never, thinking: response.thinkingContent } as never);
      }
      if (response.text) {
        assistantContent.push({ type: "text", text: response.text });
      }
      for (const tc of response.toolCalls) {
        assistantContent.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.input });
      }
      loop.messages.push({ role: "assistant", content: assistantContent });

      if (response.stopReason === "end_turn" || response.toolCalls.length === 0) {
        loop.finalResponse = response.text;
        loop.status = "completed";
        break;
      }

      // Execute tool calls and collect results
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const tc of response.toolCalls) {
        const handler = toolHandlers[tc.name];
        const startMs = Date.now();

        if (!handler) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: tc.id,
            content: `Error: Tool '${tc.name}' not found`,
            is_error: true,
          });
          continue;
        }

        try {
          const result = await handler(tc.input);
          const resultStr =
            typeof result === "string" ? result : JSON.stringify(result, null, 2);
          toolResults.push({
            type: "tool_result",
            tool_use_id: tc.id,
            content: resultStr,
          });

          this.emit("tool:result", {
            loopId,
            toolCallId: tc.id,
            name: tc.name,
            durationMs: Date.now() - startMs,
            success: true,
          });
        } catch (err) {
          const errMsg = (err as Error).message;
          toolResults.push({
            type: "tool_result",
            tool_use_id: tc.id,
            content: `Error: ${errMsg}`,
            is_error: true,
          });
          this.emit("tool:error", { loopId, toolCallId: tc.id, name: tc.name, error: errMsg });
        }
      }

      loop.messages.push({ role: "user", content: toolResults });
    }

    if (loop.status === "running") {
      loop.status = "max_rounds_reached";
      logger.warn({ loopId, rounds: loop.totalRounds }, "[ClaudeAgentBackbone] Max rounds reached");
    }

    this.emit("loop:end", { loopId, status: loop.status, totalTokens: loop.totalTokens });
    return loop;
  }

  // ── Utility ───────────────────────────────────────────────────────────────────

  selectModel(complexity: "low" | "medium" | "high" | "critical"): ClaudeModel {
    switch (complexity) {
      case "low": return CLAUDE_MODELS.HAIKU;
      case "medium": return CLAUDE_MODELS.SONNET;
      case "high":
      case "critical": return CLAUDE_MODELS.OPUS;
    }
  }

  getSessionCost(sessionId: string): number {
    return this.sessions.get(sessionId)?.totalCostUSD ?? 0;
  }

  getGlobalStats() {
    const sessions = Array.from(this.sessions.values());
    return {
      activeSessions: sessions.length,
      totalCostUSD: sessions.reduce((s, sess) => s + sess.totalCostUSD, 0),
      totalInputTokens: sessions.reduce((s, sess) => s + sess.totalInputTokens, 0),
      totalOutputTokens: sessions.reduce((s, sess) => s + sess.totalOutputTokens, 0),
    };
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────
let _backbone: ClaudeAgentBackbone | null = null;
export function getClaudeAgentBackbone(): ClaudeAgentBackbone {
  if (!_backbone) _backbone = new ClaudeAgentBackbone();
  return _backbone;
}
