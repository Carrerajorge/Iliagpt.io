/**
 * AgenticLoop — The core multi-turn agent execution engine.
 *
 * Architecture:
 *   1. Receive initial messages + available tools
 *   2. Call the LLM (Anthropic / OpenAI / Gemini — auto-detected)
 *   3. If the response contains tool calls → execute them via ToolRegistry
 *   4. Append tool results to the conversation
 *   5. Call the LLM again (repeat until stop_reason == end_turn / no tool calls)
 *   6. Enforce MAX_TURNS hard cap
 *
 * Streaming:
 *   The loop emits AgenticEvent objects. Consumers SSE-forward them to the client.
 *
 * Provider support:
 *   - Anthropic  — native tool_use via @anthropic-ai/sdk
 *   - OpenAI     — native function_calling via openai sdk
 *   - Generic    — structured JSON prompting for other providers
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI    from 'openai';
import { EventEmitter }     from 'events';
import { randomUUID }       from 'crypto';
import { Logger }           from '../../lib/logger';
import { universalToolCaller, type AgentMessage, type ParsedToolCall, type ProviderName } from '../toolCalling/UniversalToolCaller';
import { type ToolRegistry, type ToolExecutionContext } from '../toolCalling/ToolRegistry';
import { globalToolRegistry }                           from '../toolCalling/ToolRegistry';
import { BUILT_IN_TOOLS }                               from '../toolCalling/BuiltInTools';

// ─── Event types streamed to caller ───────────────────────────────────────────

export type AgenticEvent =
  | { type: 'turn_start';    turn: number }
  | { type: 'content_delta'; delta: string; snapshot: string }
  | { type: 'tool_call';     callId: string; toolName: string; input: unknown }
  | { type: 'tool_result';   callId: string; toolName: string; success: boolean; output: unknown; durationMs: number }
  | { type: 'turn_end';      turn: number; stopReason: string; hasToolCalls: boolean }
  | { type: 'loop_done';     turns: number; finalAnswer: string }
  | { type: 'error';         message: string; retryable: boolean }
  | { type: 'thinking';      text: string };

// ─── Options ──────────────────────────────────────────────────────────────────

export interface AgenticLoopOptions {
  model?          : string;
  maxTurns?       : number;      // default 15
  maxTokens?      : number;      // default 4096
  temperature?    : number;
  systemPrompt?   : string;
  userId?         : string;
  chatId?         : string;
  runId?          : string;
  workspaceRoot?  : string;
  signal?         : AbortSignal;
  toolRegistry?   : ToolRegistry;
  /** If true, force generic JSON-prompt mode (no native tool calling). */
  forceGenericMode?: boolean;
  /** Provider override — normally auto-detected from model string. */
  provider?       : ProviderName;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_MAX_TURNS  = 15;
const DEFAULT_MAX_TOKENS = 4096;
const WORKSPACE_ROOT     = process.env['AGENT_WORKSPACE_ROOT'] ?? '/tmp/ilia-workspace';

// Generic JSON prompt injected when native tool calling unavailable
const GENERIC_TOOL_SYSTEM = `
When you want to use a tool, respond with ONLY a JSON block (no other text):
{"tool":"<name>","input":{...}}

After you get the tool result, continue reasoning naturally.
When you're done with tools and have the final answer, just reply normally.
`.trim();

// ─── Main class ───────────────────────────────────────────────────────────────

export class AgenticLoop extends EventEmitter {
  private anthropicClient: Anthropic | null = null;
  private openaiClient   : OpenAI    | null = null;

  private getAnthropic(): Anthropic {
    if (!this.anthropicClient) {
      this.anthropicClient = new Anthropic({
        apiKey: process.env['ANTHROPIC_API_KEY'],
      });
    }
    return this.anthropicClient;
  }

  private getOpenAI(baseURL?: string, apiKey?: string): OpenAI {
    if (!this.openaiClient) {
      this.openaiClient = new OpenAI({
        apiKey : apiKey ?? process.env['OPENAI_API_KEY'],
        baseURL: baseURL,
      });
    }
    return this.openaiClient;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Run the agentic loop. Emits AgenticEvent on `this`.
   * Resolves when the loop terminates (done, max turns, error, or abort).
   */
  async run(
    initialMessages: AgentMessage[],
    opts           : AgenticLoopOptions = {},
  ): Promise<string> {
    const model       = opts.model          ?? process.env['DEFAULT_AGENT_MODEL'] ?? 'claude-sonnet-4-6';
    const maxTurns    = opts.maxTurns       ?? DEFAULT_MAX_TURNS;
    const maxTokens   = opts.maxTokens      ?? DEFAULT_MAX_TOKENS;
    const temperature = opts.temperature    ?? 0.3;
    const registry    = opts.toolRegistry   ?? globalToolRegistry;
    const runId       = opts.runId          ?? randomUUID();
    const userId      = opts.userId         ?? 'anonymous';
    const chatId      = opts.chatId         ?? '';
    const workspace   = opts.workspaceRoot  ?? WORKSPACE_ROOT;
    const provider    = opts.provider       ?? universalToolCaller.detectProvider(model);
    const useNative   = !opts.forceGenericMode && (provider === 'anthropic' || provider === 'openai');

    // Ensure built-in tools are registered
    for (const t of BUILT_IN_TOOLS) {
      if (!registry.has(t.name)) registry.register(t);
    }

    const tools        = registry.list();
    const conversation : AgentMessage[] = [...initialMessages];
    let   finalAnswer  = '';
    let   turn         = 0;

    Logger.info('[AgenticLoop] starting', { model, provider, maxTurns, tools: tools.length, runId });

    const toolCtx: ToolExecutionContext = {
      userId,
      chatId,
      runId,
      workspaceRoot: workspace,
      signal       : opts.signal,
      onStream     : chunk => this.emit('event', { type: 'content_delta', delta: chunk, snapshot: chunk } satisfies AgenticEvent),
    };

    // Inject system prompt
    if (opts.systemPrompt) {
      const sysMsg: AgentMessage = { role: 'system', content: opts.systemPrompt };
      if (conversation[0]?.role !== 'system') conversation.unshift(sysMsg);
    }

    // Inject generic tool prompt if not using native calling
    if (!useNative && tools.length > 0) {
      const manifest = registry.toManifest();
      const genericSys = GENERIC_TOOL_SYSTEM + '\n\nAvailable tools:\n' + manifest;
      if (conversation[0]?.role === 'system') {
        (conversation[0] as { role: 'system'; content: string }).content += '\n\n' + genericSys;
      } else {
        conversation.unshift({ role: 'system', content: genericSys });
      }
    }

    while (turn < maxTurns) {
      if (opts.signal?.aborted) {
        this.emit('event', { type: 'error', message: 'Aborted', retryable: false } satisfies AgenticEvent);
        break;
      }

      this.emit('event', { type: 'turn_start', turn } satisfies AgenticEvent);
      turn++;

      try {
        const { text, toolCalls, stopReason } = useNative
          ? await this._callNative(model, provider, conversation, tools, maxTokens, temperature, opts.signal)
          : await this._callGeneric(model, conversation, maxTokens, temperature, opts.signal);

        // Append assistant reply to conversation
        const assistantMsg: AgentMessage = {
          role      : 'assistant',
          content   : text,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        };
        conversation.push(assistantMsg);

        this.emit('event', {
          type: 'turn_end', turn, stopReason, hasToolCalls: toolCalls.length > 0,
        } satisfies AgenticEvent);

        if (toolCalls.length === 0) {
          // No tool calls → done
          finalAnswer = text;
          break;
        }

        // Execute tool calls (possibly in parallel for independent calls)
        const results = await this._executeTools(toolCalls, registry, toolCtx);

        // Feed results back
        for (const { call, result } of results) {
          conversation.push(
            universalToolCaller.buildToolResultMessage(call.callId, call.toolName, result),
          );
        }

        if (stopReason === 'end_turn' && toolCalls.length === 0) break;

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        Logger.error('[AgenticLoop] error in turn', { turn, error: msg });
        this.emit('event', { type: 'error', message: msg, retryable: true } satisfies AgenticEvent);

        if (msg.includes('overloaded') || msg.includes('rate_limit')) {
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }
        break;
      }
    }

    if (turn >= maxTurns && !finalAnswer) {
      finalAnswer = `[Agent reached max turn limit (${maxTurns}). Partial progress was made.]`;
    }

    this.emit('event', { type: 'loop_done', turns: turn, finalAnswer } satisfies AgenticEvent);
    Logger.info('[AgenticLoop] complete', { turns: turn, runId });
    return finalAnswer;
  }

  // ── Native provider calls ───────────────────────────────────────────────────

  private async _callNative(
    model       : string,
    provider    : ProviderName,
    conversation: AgentMessage[],
    tools       : ReturnType<ToolRegistry['list']>,
    maxTokens   : number,
    temperature : number,
    signal?     : AbortSignal,
  ): Promise<{ text: string; toolCalls: ParsedToolCall[]; stopReason: string }> {
    if (provider === 'anthropic') {
      return this._callAnthropic(model, conversation, tools, maxTokens, temperature, signal);
    }
    return this._callOpenAI(model, conversation, tools, maxTokens, temperature, signal);
  }

  private async _callAnthropic(
    model       : string,
    conversation: AgentMessage[],
    tools       : ReturnType<ToolRegistry['list']>,
    maxTokens   : number,
    temperature : number,
    signal?     : AbortSignal,
  ): Promise<{ text: string; toolCalls: ParsedToolCall[]; stopReason: string }> {
    const { system, messages } = universalToolCaller.toProviderMessages(conversation, 'anthropic') as {
      system?: string;
      messages: Anthropic.MessageParam[];
    };

    const anthropicTools = universalToolCaller.toProviderTools(tools, 'anthropic') as Anthropic.Tool[];

    let textAcc   = '';
    const toolCalls: ParsedToolCall[] = [];
    let stopReason = 'end_turn';

    // Use streaming for better UX
    const stream = await this.getAnthropic().messages.stream({
      model,
      max_tokens : maxTokens,
      temperature,
      system,
      messages,
      tools      : anthropicTools.length > 0 ? anthropicTools : undefined,
    });

    for await (const event of stream) {
      if (signal?.aborted) break;

      if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          textAcc += event.delta.text;
          this.emit('event', {
            type: 'content_delta', delta: event.delta.text, snapshot: textAcc,
          } satisfies AgenticEvent);
        }
      } else if (event.type === 'content_block_start') {
        if (event.content_block.type === 'tool_use') {
          this.emit('event', {
            type    : 'tool_call',
            callId  : event.content_block.id,
            toolName: event.content_block.name,
            input   : null,
          } satisfies AgenticEvent);
        }
      } else if (event.type === 'message_delta') {
        stopReason = event.delta.stop_reason ?? 'end_turn';
      }
    }

    const finalMsg = await stream.finalMessage();
    const parsed   = universalToolCaller.parseResponse(finalMsg, 'anthropic');
    return parsed;
  }

  private async _callOpenAI(
    model       : string,
    conversation: AgentMessage[],
    tools       : ReturnType<ToolRegistry['list']>,
    maxTokens   : number,
    temperature : number,
    signal?     : AbortSignal,
  ): Promise<{ text: string; toolCalls: ParsedToolCall[]; stopReason: string }> {
    const messages   = universalToolCaller.toProviderMessages(conversation, 'openai') as OpenAI.ChatCompletionMessageParam[];
    const oaiTools   = universalToolCaller.toProviderTools(tools, 'openai') as OpenAI.ChatCompletionTool[];

    let textAcc   = '';
    const { StreamingToolCallAssembler } = await import('../toolCalling/UniversalToolCaller');
    const assembler = new StreamingToolCallAssembler();

    const stream = await this.getOpenAI().chat.completions.create({
      model,
      max_tokens : maxTokens,
      temperature,
      messages,
      tools      : oaiTools.length > 0 ? oaiTools : undefined,
      stream     : true,
    }, { signal });

    let finishReason = 'stop';
    for await (const chunk of stream) {
      if (signal?.aborted) break;
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        textAcc += delta.content;
        this.emit('event', {
          type: 'content_delta', delta: delta.content, snapshot: textAcc,
        } satisfies AgenticEvent);
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          assembler.push({
            index    : tc.index,
            id       : tc.id,
            name     : tc.function?.name,
            argsDelta: tc.function?.arguments ?? '',
          });
        }
      }

      finishReason = chunk.choices[0]?.finish_reason ?? finishReason;
    }

    const toolCalls = assembler.flush();
    return { text: textAcc, toolCalls, stopReason: finishReason };
  }

  // ── Generic JSON tool calling (structured prompt) ───────────────────────────

  private async _callGeneric(
    model       : string,
    conversation: AgentMessage[],
    maxTokens   : number,
    temperature : number,
    signal?     : AbortSignal,
  ): Promise<{ text: string; toolCalls: ParsedToolCall[]; stopReason: string }> {
    const { llmGateway } = await import('../../lib/llmGateway');
    const messages = (universalToolCaller.toProviderMessages(conversation, 'openai') as OpenAI.ChatCompletionMessageParam[])
      .map(m => ({ role: m.role as string, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }));

    // Build streaming response
    let textAcc = '';
    const streamGen = llmGateway.streamChat(messages as Parameters<typeof llmGateway.streamChat>[0], {
      model, maxTokens, temperature,
    });

    for await (const chunk of streamGen) {
      if (signal?.aborted) break;
      textAcc += chunk.content;
      this.emit('event', {
        type: 'content_delta', delta: chunk.content, snapshot: textAcc,
      } satisfies AgenticEvent);
      if (chunk.done) break;
    }

    // Parse JSON tool call from response
    const jsonMatch = textAcc.trim().match(/^\s*\{"tool"\s*:/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(textAcc.trim()) as { tool: string; input: unknown };
        const callId = `gc-${randomUUID()}`;
        this.emit('event', {
          type: 'tool_call', callId, toolName: parsed.tool, input: parsed.input,
        } satisfies AgenticEvent);
        return {
          text     : '',
          toolCalls: [{ callId, toolName: parsed.tool, input: parsed.input }],
          stopReason: 'tool_use',
        };
      } catch { /* not JSON, treat as text */ }
    }

    return { text: textAcc, toolCalls: [], stopReason: 'stop' };
  }

  // ── Tool execution ───────────────────────────────────────────────────────────

  private async _executeTools(
    calls   : ParsedToolCall[],
    registry: ToolRegistry,
    ctx     : ToolExecutionContext,
  ): Promise<Array<{ call: ParsedToolCall; result: import('../toolCalling/ToolRegistry').ToolResult }>> {
    // Run all tool calls in parallel
    return Promise.all(calls.map(async call => {
      this.emit('event', {
        type: 'tool_call', callId: call.callId, toolName: call.toolName, input: call.input,
      } satisfies AgenticEvent);

      const result = await registry.execute(call.toolName, call.input, ctx);

      this.emit('event', {
        type      : 'tool_result',
        callId    : call.callId,
        toolName  : call.toolName,
        success   : result.success,
        output    : result.output ?? result.error,
        durationMs: result.durationMs,
      } satisfies AgenticEvent);

      return { call, result };
    }));
  }
}

// Singleton
export const agenticLoop = new AgenticLoop();
