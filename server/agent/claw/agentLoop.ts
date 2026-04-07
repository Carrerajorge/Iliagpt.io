/**
 * ClawAgentLoop — Core think-act-observe cycle for the Claw agent system.
 *
 * Inspired by claw-code's ConversationRuntime, rewritten in TypeScript
 * for the IliaGPT multi-agent platform. The loop sends messages to the LLM,
 * parses tool calls from the response, executes them, feeds results back,
 * and repeats until the model signals completion or limits are reached.
 */
import { EventEmitter } from "events";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { llmGateway } from "../../lib/llmGateway";
import type { LLMRequestOptions } from "../../lib/llmGateway";

export interface ClawTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (input: unknown) => Promise<unknown>;
}

export interface ClawAgentOptions {
  model?: string;
  userId: string;
  chatId: string;
  tools: ClawTool[];
  maxIterations?: number;
  maxTokens?: number;
  /** AbortSignal for external cancellation. */
  signal?: AbortSignal;
}

export interface ToolResult {
  name: string;
  output: unknown;
  error?: string;
  durationMs: number;
}

export interface StepResult {
  content: string;
  toolCalls: Array<{ name: string; input: unknown }>;
  toolResults: ToolResult[];
  tokensUsed: number;
  done: boolean;
}

export interface ClawAgentResult {
  finalContent: string;
  iterations: number;
  totalTokensUsed: number;
  toolsExecuted: ToolResult[];
  aborted: boolean;
}

interface ParsedToolCall {
  name: string;
  input: unknown;
}

const DEFAULT_MAX_ITERATIONS = 25;
const DEFAULT_MAX_TOKENS = 16_384;
const TOKEN_COMPACTION_THRESHOLD = 100_000;
const COMPACTION_SUMMARY_MAX_TOKENS = 2_048;

export class ClawAgentLoop extends EventEmitter {
  private readonly options: Required<
    Pick<ClawAgentOptions, "model" | "userId" | "chatId" | "maxIterations" | "maxTokens">
  > & { tools: ClawTool[]; signal?: AbortSignal };
  private readonly toolMap: Map<string, ClawTool>;
  private aborted = false;
  private totalTokensUsed = 0;

  constructor(options: ClawAgentOptions) {
    super();
    this.options = {
      model: options.model ?? "grok-3-mini",
      userId: options.userId,
      chatId: options.chatId,
      tools: options.tools,
      maxIterations: options.maxIterations ?? DEFAULT_MAX_ITERATIONS,
      maxTokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      signal: options.signal,
    };
    this.toolMap = new Map(options.tools.map((t) => [t.name, t]));
    if (this.options.signal) {
      this.options.signal.addEventListener("abort", () => this.abort(), { once: true });
    }
  }

  /**
   * Run the full think-act-observe loop until the model signals completion,
   * the iteration budget is exhausted, or the loop is aborted.
   */
  async run(instruction: string): Promise<ClawAgentResult> {
    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: this.buildSystemPrompt() },
      { role: "user", content: instruction },
    ];
    const allToolResults: ToolResult[] = [];
    let iterations = 0;
    let finalContent = "";

    try {
      while (iterations < this.options.maxIterations && !this.aborted) {
        iterations++;
        if (this.totalTokensUsed > TOKEN_COMPACTION_THRESHOLD) {
          await this.compactMessages(messages);
        }
        const step = await this.executeStep(messages);
        finalContent = step.content || finalContent;
        allToolResults.push(...step.toolResults);
        if (step.done) break;
      }
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.emit("error", error);
      throw error;
    }

    const result: ClawAgentResult = {
      finalContent,
      iterations,
      totalTokensUsed: this.totalTokensUsed,
      toolsExecuted: allToolResults,
      aborted: this.aborted,
    };
    this.emit("done", result);
    return result;
  }

  /**
   * Execute a single think-act-observe step: call the LLM, parse tool calls,
   * execute tools, and append results to the conversation history.
   */
  async executeStep(messages: ChatCompletionMessageParam[]): Promise<StepResult> {
    this.emit("thinking");

    const llmOptions: LLMRequestOptions = {
      model: this.options.model,
      userId: this.options.userId,
      maxTokens: this.options.maxTokens,
    };
    let fullContent = "";
    const stream = llmGateway.streamChat(messages, llmOptions);
    for await (const chunk of stream) {
      if (this.aborted) break;
      fullContent += chunk.content;
      if (chunk.content) this.emit("content", chunk.content);
    }

    const stepTokens = Math.ceil(fullContent.length / 4);
    this.totalTokensUsed += stepTokens;
    const toolCalls = this.parseToolCalls(fullContent);
    messages.push({ role: "assistant", content: fullContent });

    if (toolCalls.length === 0) {
      return { content: fullContent, toolCalls: [], toolResults: [], tokensUsed: stepTokens, done: true };
    }

    // Execute each tool call
    const toolResults: ToolResult[] = [];
    for (const call of toolCalls) {
      if (this.aborted) break;
      this.emit("tool_call", { name: call.name, input: call.input });
      const result = await this.executeTool(call.name, call.input);
      toolResults.push(result);
      this.emit("tool_result", { name: result.name, result: result.output, error: result.error });
    }

    // Feed tool results back as an observation message
    const toolResultContent = toolResults
      .map((r) => {
        const status = r.error ? `ERROR: ${r.error}` : "OK";
        const output = typeof r.output === "string" ? r.output : JSON.stringify(r.output, null, 2);
        return `[Tool: ${r.name}] (${status}, ${r.durationMs}ms)\n${output}`;
      })
      .join("\n\n");
    messages.push({ role: "user", content: `Tool results:\n\n${toolResultContent}` });

    return { content: fullContent, toolCalls, toolResults, tokensUsed: stepTokens, done: false };
  }

  /** Signal the loop to stop after the current step completes. */
  abort(): void {
    this.aborted = true;
    this.emit("error", new Error("Agent loop aborted"));
  }

  /** Dispatch a tool call to the registered handler. */
  private async executeTool(name: string, input: unknown): Promise<ToolResult> {
    const start = Date.now();
    const tool = this.toolMap.get(name);
    if (!tool) {
      return { name, output: null, error: `Unknown tool: ${name}`, durationMs: Date.now() - start };
    }
    try {
      const output = await tool.execute(input);
      return { name, output, durationMs: Date.now() - start };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { name, output: null, error: msg, durationMs: Date.now() - start };
    }
  }

  /**
   * Parse tool calls from the LLM response. Supports structured JSON blocks,
   * XML-style tags, and inline tool_calls JSON objects.
   */
  private parseToolCalls(content: string): ParsedToolCall[] {
    const calls: ParsedToolCall[] = [];
    let match: RegExpExecArray | null;

    // Pattern 1: ```tool_call JSON blocks
    const jsonBlockRe = /```tool_call\s*\n([\s\S]*?)```/g;
    while ((match = jsonBlockRe.exec(content)) !== null) {
      try {
        const parsed = JSON.parse(match[1]);
        if (parsed.name) calls.push({ name: parsed.name, input: parsed.input ?? parsed.parameters ?? {} });
      } catch { /* skip malformed */ }
    }

    // Pattern 2: <tool_call name="...">JSON</tool_call>
    const xmlRe = /<tool_call\s+name="([^"]+)">([\s\S]*?)<\/tool_call>/g;
    while ((match = xmlRe.exec(content)) !== null) {
      try {
        calls.push({ name: match[1], input: JSON.parse(match[2].trim()) });
      } catch {
        calls.push({ name: match[1], input: {} });
      }
    }

    // Pattern 3: {"tool_calls": [...]} JSON object
    const objRe = /\{"tool_calls"\s*:\s*\[[\s\S]*?\]\s*\}/g;
    while ((match = objRe.exec(content)) !== null) {
      try {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed.tool_calls)) {
          for (const tc of parsed.tool_calls) {
            if (tc.name && !calls.some((c) => c.name === tc.name)) {
              calls.push({ name: tc.name, input: tc.input ?? tc.parameters ?? {} });
            }
          }
        }
      } catch { /* skip */ }
    }
    return calls;
  }

  /** Build the system prompt including the tool registry. */
  private buildSystemPrompt(): string {
    const toolDescs = this.options.tools
      .map((t) => `### ${t.name}\n${t.description}\nParameters:\n\`\`\`json\n${JSON.stringify(t.parameters, null, 2)}\n\`\`\``)
      .join("\n\n");

    return [
      "You are Claw, an autonomous AI agent within the IliaGPT platform.",
      "You operate in a think-act-observe loop. On each turn you may call one or more tools,",
      "then observe the results. When the task is complete, respond with your final answer",
      "without any tool calls.",
      "",
      "## Available Tools",
      "", toolDescs, "",
      "## Tool Call Format",
      "To call a tool, include a fenced block in your response:",
      "```tool_call",
      '{"name": "tool_name", "input": { ... }}',
      "```",
      "",
      "You may include multiple tool_call blocks in a single response.",
      "When you are done, respond normally without any tool_call blocks.",
    ].join("\n");
  }

  /**
   * Auto-compaction: summarize older messages to stay within token budget.
   * Keeps the system prompt and the most recent 4 messages intact.
   */
  private async compactMessages(messages: ChatCompletionMessageParam[]): Promise<void> {
    if (messages.length <= 6) return;

    const summaryText = messages.slice(1, -4)
      .map((m) => `[${m.role}]: ${typeof m.content === "string" ? m.content.slice(0, 500) : "..."}`)
      .join("\n");

    const summaryPrompt: ChatCompletionMessageParam[] = [
      { role: "system", content: "Summarize the following conversation concisely, preserving key facts, tool results, and decisions." },
      { role: "user", content: summaryText },
    ];

    let summary = "";
    const stream = llmGateway.streamChat(summaryPrompt, {
      model: this.options.model,
      userId: this.options.userId,
      maxTokens: COMPACTION_SUMMARY_MAX_TOKENS,
    });
    for await (const chunk of stream) {
      summary += chunk.content;
    }

    const systemMsg = messages[0];
    const recentMessages = messages.slice(-4);
    messages.length = 0;
    messages.push(systemMsg, { role: "user", content: `[Conversation summary]\n${summary}` }, ...recentMessages);
    this.totalTokensUsed = Math.ceil(summary.length / 4);
  }
}
