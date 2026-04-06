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
import { detectProvider as detectConfiguredProvider }   from '../../integration/modelWiring';

// ─── Event types streamed to caller ───────────────────────────────────────────

export type AgenticEvent =
  | { type: 'turn_start';    turn: number }
  | { type: 'content_delta'; delta: string; snapshot: string }
  | { type: 'tool_call';     callId: string; toolName: string; input: unknown }
  | { type: 'tool_result';   callId: string; toolName: string; success: boolean; output: unknown; durationMs: number }
  | { type: 'turn_end';      turn: number; stopReason: string; hasToolCalls: boolean; conversationSnapshot?: AgentMessage[] }
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

type OpenAICompatibleConfig = {
  apiKey?: string;
  baseURL?: string;
};

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function resolveOpenAICompatibleConfig(model: string): OpenAICompatibleConfig {
  const provider = detectConfiguredProvider(model);

  switch (provider) {
    case 'xai':
      return {
        apiKey: readEnv('XAI_API_KEY') ?? readEnv('OPENAI_API_KEY'),
        baseURL: readEnv('XAI_BASE_URL') ?? readEnv('OPENAI_BASE_URL') ?? 'https://api.x.ai/v1',
      };
    case 'deepseek':
      return {
        apiKey: readEnv('DEEPSEEK_API_KEY') ?? readEnv('OPENAI_API_KEY'),
        baseURL: readEnv('DEEPSEEK_BASE_URL') ?? readEnv('OPENAI_BASE_URL') ?? 'https://api.deepseek.com/v1',
      };
    case 'openai':
    default:
      return {
        apiKey: readEnv('OPENROUTER_API_KEY') ?? readEnv('OPENAI_API_KEY'),
        baseURL: readEnv('OPENAI_BASE_URL'),
      };
  }
}

function maybeParseJsonString(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
    return value;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function extractBalancedJsonCandidates(text: string): string[] {
  const candidates: string[] = [];
  let startIndex = -1;
  const stack: string[] = [];
  let inString = false;
  let escapeNext = false;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];

    if (inString) {
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (char === '\\') {
        escapeNext = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{' || char === '[') {
      if (stack.length === 0) {
        startIndex = index;
      }
      stack.push(char);
      continue;
    }

    if ((char === '}' || char === ']') && stack.length > 0) {
      const expected = char === '}' ? '{' : '[';
      if (stack[stack.length - 1] !== expected) {
        stack.length = 0;
        startIndex = -1;
        continue;
      }

      stack.pop();
      if (stack.length === 0 && startIndex >= 0) {
        candidates.push(text.slice(startIndex, index + 1));
        startIndex = -1;
      }
    }
  }

  return candidates;
}

function cloneConversationSnapshot(conversation: AgentMessage[]): AgentMessage[] {
  try {
    return structuredClone(conversation);
  } catch {
    return conversation.map((message) => ({
      ...message,
      tool_calls: message.tool_calls ? JSON.parse(JSON.stringify(message.tool_calls)) : undefined,
    }));
  }
}

function normalizeGenericToolCallCandidate(candidate: unknown): Array<{ toolName: string; input: unknown }> {
  if (!candidate) {
    return [];
  }

  if (Array.isArray(candidate)) {
    return candidate.flatMap((entry) => normalizeGenericToolCallCandidate(entry));
  }

  if (typeof candidate !== 'object') {
    return [];
  }

  const record = candidate as Record<string, unknown>;
  const nestedCollections = ['tools', 'toolCalls', 'tool_calls', 'actions', 'calls'];
  for (const key of nestedCollections) {
    if (Array.isArray(record[key])) {
      return normalizeGenericToolCallCandidate(record[key]);
    }
  }

  if (record['call']) {
    return normalizeGenericToolCallCandidate(record['call']);
  }
  if (record['action']) {
    return normalizeGenericToolCallCandidate(record['action']);
  }

  const rawFunction = record['function'];
  const rawToolName = typeof rawFunction === 'object' && rawFunction
    ? (rawFunction as Record<string, unknown>)['name'] ?? record['tool'] ?? record['toolName'] ?? record['name']
    : record['tool'] ?? record['toolName'] ?? record['name'];

  const toolName = typeof rawToolName === 'string' ? rawToolName.trim() : '';
  if (!toolName) {
    return [];
  }

  let input = record['input'] ?? record['args'] ?? record['arguments'] ?? record['parameters'];
  if (input === undefined && typeof rawFunction === 'object' && rawFunction) {
    input = (rawFunction as Record<string, unknown>)['arguments'] ?? (rawFunction as Record<string, unknown>)['args'];
  }

  return [{
    toolName,
    input: maybeParseJsonString(input ?? {}),
  }];
}

export function parseGenericToolCallsFromText(text: string): ParsedToolCall[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }

  const rawCandidates = new Set<string>();
  rawCandidates.add(trimmed);

  const fencedBlocks = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/gi) || [];
  for (const block of fencedBlocks) {
    const unwrapped = block
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    if (unwrapped) {
      rawCandidates.add(unwrapped);
    }
  }

  for (const slice of extractBalancedJsonCandidates(trimmed)) {
    rawCandidates.add(slice.trim());
  }

  const toolCalls: ParsedToolCall[] = [];
  const seen = new Set<string>();

  for (const candidate of rawCandidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }

    for (const normalized of normalizeGenericToolCallCandidate(parsed)) {
      const signature = `${normalized.toolName}:${JSON.stringify(normalized.input ?? {})}`;
      if (seen.has(signature)) {
        continue;
      }
      seen.add(signature);
      toolCalls.push({
        callId: `gc-${randomUUID()}`,
        toolName: normalized.toolName,
        input: normalized.input ?? {},
      });
    }
  }

  return toolCalls;
}

// ─── Main class ───────────────────────────────────────────────────────────────

export class AgenticLoop extends EventEmitter {
  private anthropicClient: Anthropic | null = null;
  private openaiClient   : OpenAI    | null = null;
  private openaiClientConfigKey      : string | null = null;

  private getAnthropic(): Anthropic {
    if (!this.anthropicClient) {
      this.anthropicClient = new Anthropic({
        apiKey: process.env['ANTHROPIC_API_KEY'],
      });
    }
    return this.anthropicClient;
  }

  private getOpenAI(baseURL?: string, apiKey?: string): OpenAI {
    const configKey = `${baseURL ?? ''}|${apiKey ?? ''}`;
    if (!this.openaiClient || this.openaiClientConfigKey !== configKey) {
      this.openaiClient = new OpenAI({
        apiKey : apiKey ?? process.env['OPENAI_API_KEY'],
        baseURL: baseURL,
      });
      this.openaiClientConfigKey = configKey;
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
    const runtimeProvider = detectConfiguredProvider(model);
    const provider =
      opts.provider ??
      (runtimeProvider === 'anthropic'
        ? 'anthropic'
        : runtimeProvider === 'gemini' || runtimeProvider === 'local'
          ? 'generic'
          : 'openai');
    const useNative   = !opts.forceGenericMode && (provider === 'anthropic' || provider === 'openai');

    // Ensure built-in tools are registered
    for (const t of BUILT_IN_TOOLS) {
      if (!registry.has(t.name)) registry.register(t);
    }

    const tools        = registry.list();
    const conversation : AgentMessage[] = [...initialMessages];
    let   finalAnswer  = '';
    let   turn         = 0;

    // ── Reliability guards ─────────────────────────────────────────────────────
    let rateLimitRetries = 0;                       // cap at 3 retries
    let noOutputTurns    = 0;                       // detect silent hang turns
    const toolCallHistory: string[] = [];           // detect stuck loops

    Logger.info('[AgenticLoop] starting', {
      model,
      provider,
      runtimeProvider,
      maxTurns,
      tools: tools.length,
      runId,
    });

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
        const systemMessage = conversation[0] as { role: 'system'; content: string };
        if (!systemMessage.content.includes(GENERIC_TOOL_SYSTEM)) {
          systemMessage.content += '\n\n' + genericSys;
        }
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
        // ── Per-turn 60 s timeout via AbortController ────────────────────────
        const turnController = new AbortController();
        const turnTimer = setTimeout(() => turnController.abort(), 60_000);
        const turnSignal = opts.signal
          ? (AbortSignal as unknown as { any: (s: AbortSignal[]) => AbortSignal }).any
            ? (AbortSignal as unknown as { any: (s: AbortSignal[]) => AbortSignal }).any([opts.signal, turnController.signal])
            : turnController.signal
          : turnController.signal;

        let text: string;
        let toolCalls: ParsedToolCall[];
        let stopReason: string;
        try {
          ({ text, toolCalls, stopReason } = useNative
            ? await this._callNative(model, provider, conversation, tools, maxTokens, temperature, turnSignal)
            : await this._callGeneric(model, conversation, maxTokens, temperature, turnSignal));
        } finally {
          clearTimeout(turnTimer);
        }

        // ── No-output stuck detection ────────────────────────────────────────
        if (!text && toolCalls.length === 0) {
          noOutputTurns++;
          if (noOutputTurns >= 3) {
            Logger.warn('[AgenticLoop] 3 consecutive empty turns — aborting loop', { runId });
            finalAnswer = '[Agent produced no output for 3 consecutive turns. Stopping.]';
            break;
          }
        } else {
          noOutputTurns = 0;
        }

        // Append assistant reply to conversation
        const assistantMsg: AgentMessage = {
          role      : 'assistant',
          content   : text,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        };
        conversation.push(assistantMsg);

        if (toolCalls.length === 0) {
          finalAnswer = text;
          this.emit('event', {
            type: 'turn_end',
            turn,
            stopReason,
            hasToolCalls: false,
            conversationSnapshot: cloneConversationSnapshot(conversation),
          } satisfies AgenticEvent);
          break;
        }

        // ── Stuck-loop detection: same tool+args 3× in a row ─────────────────
        for (const call of toolCalls) {
          const sig = `${call.toolName}:${JSON.stringify(call.input)}`;
          toolCallHistory.push(sig);
          const last3 = toolCallHistory.slice(-3);
          if (last3.length === 3 && last3.every(s => s === sig)) {
            Logger.warn('[AgenticLoop] stuck loop — same call repeated 3×', { tool: call.toolName, runId });
            this.emit('event', { type: 'error', message: `Stuck loop: ${call.toolName} called identically 3 times`, retryable: false } satisfies AgenticEvent);
            finalAnswer = `[Agent stuck in loop calling '${call.toolName}' repeatedly. Stopping.]`;
            return finalAnswer;
          }
        }

        // Execute tool calls (possibly in parallel for independent calls)
        const results = await this._executeTools(toolCalls, registry, toolCtx);

        // Feed results back
        for (const { call, result } of results) {
          conversation.push(
            universalToolCaller.buildToolResultMessage(call.callId, call.toolName, result),
          );
        }

        this.emit('event', {
          type: 'turn_end',
          turn,
          stopReason,
          hasToolCalls: true,
          conversationSnapshot: cloneConversationSnapshot(conversation),
        } satisfies AgenticEvent);

        if (stopReason === 'end_turn' && toolCalls.length === 0) break;

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        Logger.error('[AgenticLoop] error in turn', { turn, error: msg });
        this.emit('event', { type: 'error', message: msg, retryable: true } satisfies AgenticEvent);

        // ── Exponential backoff for rate limits — max 3 retries (2s/4s/8s) ──
        if (msg.includes('overloaded') || msg.includes('rate_limit')) {
          if (rateLimitRetries >= 3) {
            Logger.warn('[AgenticLoop] rate-limit retry cap reached', { runId });
            break;
          }
          const delayMs = Math.pow(2, rateLimitRetries + 1) * 1000; // 2s, 4s, 8s
          rateLimitRetries++;
          Logger.info('[AgenticLoop] rate limit — backing off', { delayMs, attempt: rateLimitRetries, runId });
          await new Promise(r => setTimeout(r, delayMs));
          turn--; // don't consume a turn for the retry
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
    const { apiKey, baseURL } = resolveOpenAICompatibleConfig(model);

    let textAcc   = '';
    const { StreamingToolCallAssembler } = await import('../toolCalling/UniversalToolCaller');
    const assembler = new StreamingToolCallAssembler();

    const stream = await this.getOpenAI(baseURL, apiKey).chat.completions.create({
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

    const toolCalls = parseGenericToolCallsFromText(textAcc);
    if (toolCalls.length > 0) {
      for (const toolCall of toolCalls) {
        this.emit('event', {
          type: 'tool_call',
          callId: toolCall.callId,
          toolName: toolCall.toolName,
          input: toolCall.input,
        } satisfies AgenticEvent);
      }

      return {
        text: '',
        toolCalls,
        stopReason: 'tool_use',
      };
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
