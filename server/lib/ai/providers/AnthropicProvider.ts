/**
 * Anthropic Provider
 *
 * Uses the official `@anthropic-ai/sdk`.  Anthropic's API differs from
 * OpenAI's in several important ways that require a custom implementation:
 *
 *  1. System messages are a top-level field, NOT part of the messages array.
 *  2. The assistant role uses "model" internally but the SDK handles that.
 *  3. Tool definitions use `input_schema` (JSON Schema) instead of `parameters`.
 *  4. Tool results are sent as content blocks `{ type: "tool_result", … }`.
 *  5. Streaming emits typed events: message_start, content_block_delta, etc.
 *  6. No native embedding API — callers must use a different provider for embeds.
 *
 * Supported capabilities: CHAT, STREAMING, FUNCTION_CALLING, JSON_MODE,
 *                          VISION, CODE, REASONING (claude-3-7-sonnet thinking)
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  MessageParam,
  ContentBlockParam,
  ToolUseBlock,
  TextBlock,
} from '@anthropic-ai/sdk/resources/messages';
import { BaseProvider } from './core/BaseProvider';
import { Logger } from '../../logger';
import {
  type IProviderConfig,
  type IChatMessage,
  type IChatOptions,
  type IChatResponse,
  type IStreamChunk,
  type StreamHandler,
  type IEmbedOptions,
  type IEmbedResponse,
  type IModelInfo,
  type ITokenUsage,
  type IContentPart,
  ModelCapability,
  ProviderStatus,
  ProviderError,
  classifyProviderError,
} from './core/types';

// ─── Default config ──────────────────────────────────────────────────────────

export function anthropicDefaultConfig(apiKey?: string): IProviderConfig {
  return {
    name        : 'anthropic',
    displayName : 'Anthropic',
    apiKey      : apiKey ?? process.env.ANTHROPIC_API_KEY,
    baseUrl     : 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-4-6',
    timeoutMs   : 120_000,
    retry: {
      maxRetries       : 3,
      baseDelayMs      : 500,
      backoffFactor    : 2,
      maxDelayMs       : 16_000,
      retryableStatuses: [429, 500, 502, 503, 529],
    },
    rateLimit: {
      requestsPerMinute: 50,
      tokensPerMinute  : 400_000,
      maxConcurrent    : 20,
    },
    fallbackChain: ['openai', 'xai'],
    extra: {
      capabilities:
        ModelCapability.CHAT | ModelCapability.STREAMING |
        ModelCapability.FUNCTION_CALLING | ModelCapability.JSON_MODE |
        ModelCapability.VISION | ModelCapability.CODE | ModelCapability.REASONING,
    },
  };
}

// ─── Static model catalogue ──────────────────────────────────────────────────

const ANTHROPIC_MODELS: IModelInfo[] = [
  {
    id: 'claude-opus-4-6', provider: 'anthropic', displayName: 'Claude Opus 4.6',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.FUNCTION_CALLING | ModelCapability.JSON_MODE | ModelCapability.VISION | ModelCapability.CODE | ModelCapability.REASONING,
    contextWindow: 200_000, maxOutputTokens: 32_000,
    pricing: { inputPer1M: 15.0, outputPer1M: 75.0 },
    latencyScore: 40, reliabilityScore: 0.99, available: true,
    tags: ['flagship', 'vision', 'reasoning'],
  },
  {
    id: 'claude-sonnet-4-6', provider: 'anthropic', displayName: 'Claude Sonnet 4.6',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.FUNCTION_CALLING | ModelCapability.JSON_MODE | ModelCapability.VISION | ModelCapability.CODE,
    contextWindow: 200_000, maxOutputTokens: 16_000,
    pricing: { inputPer1M: 3.0, outputPer1M: 15.0 },
    latencyScore: 25, reliabilityScore: 0.99, available: true,
    tags: ['balanced', 'vision'],
  },
  {
    id: 'claude-haiku-4-5', provider: 'anthropic', displayName: 'Claude Haiku 4.5',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.FUNCTION_CALLING | ModelCapability.JSON_MODE | ModelCapability.VISION,
    contextWindow: 200_000, maxOutputTokens: 8_192,
    pricing: { inputPer1M: 0.25, outputPer1M: 1.25 },
    latencyScore: 8, reliabilityScore: 0.99, available: true,
    tags: ['fast', 'cheap', 'vision'],
  },
  {
    id: 'claude-3-5-sonnet-20241022', provider: 'anthropic', displayName: 'Claude 3.5 Sonnet',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.FUNCTION_CALLING | ModelCapability.JSON_MODE | ModelCapability.VISION | ModelCapability.CODE,
    contextWindow: 200_000, maxOutputTokens: 8_192,
    pricing: { inputPer1M: 3.0, outputPer1M: 15.0 },
    latencyScore: 28, reliabilityScore: 0.99, available: true,
    tags: ['balanced', 'vision', 'legacy'],
  },
];

// ─── Provider implementation ──────────────────────────────────────────────────

export class AnthropicProvider extends BaseProvider {
  private readonly _client: Anthropic;

  constructor(config: Partial<IProviderConfig> = {}) {
    const defaults = anthropicDefaultConfig(config.apiKey);
    super({ ...defaults, ...config });

    this._client = new Anthropic({
      apiKey    : this.config.apiKey,
      maxRetries: 0, // managed by BaseProvider
      timeout   : this.config.timeoutMs,
    });

    this.status = ProviderStatus.ACTIVE;
  }

  // ─── Message format mapping ─────────────────────────────────────────────────

  /**
   * Anthropic requires the system message to be extracted from the array and
   * passed as a top-level `system` field.  Returns { system, messages }.
   */
  private toAnthropicMessages(messages: IChatMessage[]): {
    system  : string | undefined;
    messages: MessageParam[];
  } {
    let system: string | undefined;
    const anthropicMsgs: MessageParam[] = [];

    for (const m of messages) {
      if (m.role === 'system') {
        system = typeof m.content === 'string'
          ? m.content
          : (m.content as IContentPart[])
              .filter(p => p.type === 'text')
              .map(p => (p as any).text)
              .join('\n');
        continue;
      }

      if (m.role === 'tool') {
        // Tool results go as a user message with type=tool_result.
        anthropicMsgs.push({
          role   : 'user',
          content: [{
            type        : 'tool_result',
            tool_use_id : m.toolCallId!,
            content     : typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
          }] as ContentBlockParam[],
        });
        continue;
      }

      if (m.role === 'assistant' && m.toolCalls?.length) {
        const blocks: ContentBlockParam[] = [];
        if (typeof m.content === 'string' && m.content) {
          blocks.push({ type: 'text', text: m.content });
        }
        for (const tc of m.toolCalls) {
          blocks.push({
            type    : 'tool_use',
            id      : tc.id,
            name    : tc.function.name,
            input   : JSON.parse(tc.function.arguments || '{}'),
          });
        }
        anthropicMsgs.push({ role: 'assistant', content: blocks });
        continue;
      }

      // Plain text or multimodal user message.
      if (typeof m.content === 'string') {
        anthropicMsgs.push({ role: m.role as 'user' | 'assistant', content: m.content });
      } else {
        const blocks: ContentBlockParam[] = (m.content as IContentPart[]).map(part => {
          if (part.type === 'text') return { type: 'text', text: part.text };
          if (part.type === 'image_url') {
            // Anthropic expects base64 or URL — pass through the URL variant.
            return {
              type  : 'image',
              source: { type: 'url', url: part.image_url.url },
            } as any;
          }
          return { type: 'text', text: '[unsupported content part]' };
        });
        anthropicMsgs.push({ role: m.role as 'user' | 'assistant', content: blocks });
      }
    }

    return { system, messages: anthropicMsgs };
  }

  private toAnthropicTools(tools: IChatOptions['tools']) {
    if (!tools?.length) return undefined;
    return tools.map(t => ({
      name        : t.function.name,
      description : t.function.description,
      input_schema: t.function.parameters as any,
    }));
  }

  private parseUsage(raw: { input_tokens: number; output_tokens: number }): ITokenUsage {
    return {
      promptTokens    : raw.input_tokens,
      completionTokens: raw.output_tokens,
      totalTokens     : raw.input_tokens + raw.output_tokens,
    };
  }

  // ─── _chat ──────────────────────────────────────────────────────────────────

  protected async _chat(messages: IChatMessage[], options: IChatOptions): Promise<IChatResponse> {
    const requestId = options.requestId ?? this._newRequestId();
    const start     = Date.now();

    try {
      const { system, messages: anthropicMsgs } = this.toAnthropicMessages(messages);

      const response = await this._client.messages.create({
        model     : options.model ?? this.config.defaultModel,
        system,
        messages  : anthropicMsgs,
        max_tokens: options.maxTokens ?? 4096,
        temperature: options.temperature as any,
        top_p     : options.topP,
        stop_sequences: Array.isArray(options.stop) ? options.stop : options.stop ? [options.stop] : undefined,
        tools     : this.toAnthropicTools(options.tools),
        tool_choice: options.toolChoice
          ? (() => {
              if (options.toolChoice === 'auto')     return { type: 'auto' as const };
              if (options.toolChoice === 'required') return { type: 'any'  as const };
              if (options.toolChoice === 'none')     return { type: 'auto' as const };
              const tc = options.toolChoice as any;
              return { type: 'tool' as const, name: tc.function?.name ?? '' };
            })()
          : undefined,
      });

      // Extract text and tool_use blocks.
      let content = '';
      const toolCalls: IChatResponse['toolCalls'] = [];

      for (const block of response.content) {
        if (block.type === 'text') {
          content += (block as TextBlock).text;
        } else if (block.type === 'tool_use') {
          const tu = block as ToolUseBlock;
          toolCalls.push({
            id      : tu.id,
            type    : 'function',
            function: { name: tu.name, arguments: JSON.stringify(tu.input) },
          });
        }
      }

      const finishMap: Record<string, IChatResponse['finishReason']> = {
        end_turn          : 'stop',
        max_tokens        : 'length',
        tool_use          : 'tool_calls',
        stop_sequence     : 'stop',
        content_filtered  : 'content_filter',
      };

      return {
        content,
        model       : response.model,
        provider    : this.name,
        usage       : this.parseUsage(response.usage),
        finishReason: finishMap[response.stop_reason ?? ''] ?? 'unknown',
        latencyMs   : Date.now() - start,
        requestId,
        cached      : false,
        fromFallback: false,
        toolCalls   : toolCalls.length ? toolCalls : undefined,
        raw         : response,
      };
    } catch (err) {
      throw classifyProviderError(err, this.name, requestId);
    }
  }

  // ─── _stream ────────────────────────────────────────────────────────────────

  protected async _stream(
    messages: IChatMessage[],
    onChunk : StreamHandler,
    options : IChatOptions,
  ): Promise<IChatResponse> {
    const requestId   = options.requestId ?? this._newRequestId();
    const start       = Date.now();
    let   accumulated = '';
    let   inputTokens = 0;
    let   outputTokens= 0;
    let   model       = options.model ?? this.config.defaultModel;
    let   finishReason: IChatResponse['finishReason'] = 'unknown';

    try {
      const { system, messages: anthropicMsgs } = this.toAnthropicMessages(messages);

      const stream = this._client.messages.stream({
        model     : model,
        system,
        messages  : anthropicMsgs,
        max_tokens: options.maxTokens ?? 4096,
        temperature: options.temperature as any,
        tools     : this.toAnthropicTools(options.tools),
      });

      for await (const event of stream) {
        if (event.type === 'message_start') {
          model       = event.message.model;
          inputTokens = event.message.usage.input_tokens;
        }
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          const token = event.delta.text;
          accumulated += token;
          await onChunk({ delta: token, accumulated, done: false, requestId });
        }
        if (event.type === 'message_delta') {
          outputTokens = event.usage.output_tokens;
          const stopMap: Record<string, IChatResponse['finishReason']> = {
            end_turn   : 'stop',
            max_tokens : 'length',
            tool_use   : 'tool_calls',
          };
          finishReason = stopMap[event.delta.stop_reason ?? ''] ?? 'unknown';
        }
      }

      const usage: ITokenUsage = {
        promptTokens    : inputTokens,
        completionTokens: outputTokens,
        totalTokens     : inputTokens + outputTokens,
      };

      await onChunk({ delta: '', accumulated, done: true, usage, finishReason, requestId });

      return { content: accumulated, model, provider: this.name, usage, finishReason, latencyMs: Date.now() - start, requestId, cached: false, fromFallback: false };
    } catch (err) {
      throw classifyProviderError(err, this.name, requestId);
    }
  }

  // ─── _embed (not supported) ─────────────────────────────────────────────────

  protected async _embed(_texts: string[], options: IEmbedOptions): Promise<IEmbedResponse> {
    throw new ProviderError({
      message  : '[anthropic] Anthropic does not provide an embedding API. Use OpenAI or Cohere for embeddings.',
      provider : this.name,
      requestId: options.requestId ?? 'embed',
      retryable: false,
      statusCode: 501,
    });
  }

  protected async _listModels(): Promise<IModelInfo[]> {
    return ANTHROPIC_MODELS;
  }

  protected async _healthProbe(): Promise<void> {
    // Use a minimal message — Anthropic has no /models endpoint that's free.
    await this._client.messages.create({
      model     : 'claude-haiku-4-5',
      max_tokens: 1,
      messages  : [{ role: 'user', content: 'ping' }],
    });
  }
}
