/**
 * OpenAI Provider
 *
 * Uses the official `openai` npm SDK.  This is the reference implementation
 * for the compat family — it handles the full message format including vision
 * content parts, structured tool calls, and streaming via the SDK's async
 * iterable interface rather than raw SSE parsing.
 *
 * Supported capabilities: CHAT, STREAMING, FUNCTION_CALLING, JSON_MODE,
 *                          VISION (gpt-4o family), EMBEDDING, CODE, REASONING (o1/o3)
 */

import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionContentPart,
  ChatCompletionTool,
  ChatCompletionChunk,
} from 'openai/resources/chat/completions';
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
  classifyProviderError,
  ProviderError,
} from './core/types';

// ─── Default config factory ──────────────────────────────────────────────────

export function openAIDefaultConfig(apiKey?: string): IProviderConfig {
  return {
    name        : 'openai',
    displayName : 'OpenAI',
    apiKey      : apiKey ?? process.env.OPENAI_API_KEY,
    baseUrl     : process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    timeoutMs   : 120_000,
    retry: {
      maxRetries       : 3,
      baseDelayMs      : 500,
      backoffFactor    : 2,
      maxDelayMs       : 16_000,
      retryableStatuses: [429, 500, 502, 503, 504],
    },
    rateLimit: {
      requestsPerMinute: 500,
      tokensPerMinute  : 800_000,
      maxConcurrent    : 50,
    },
    fallbackChain: ['anthropic', 'xai'],
    extra: {
      capabilities:
        ModelCapability.CHAT |
        ModelCapability.STREAMING |
        ModelCapability.FUNCTION_CALLING |
        ModelCapability.JSON_MODE |
        ModelCapability.VISION |
        ModelCapability.EMBEDDING |
        ModelCapability.CODE |
        ModelCapability.REASONING,
    },
  };
}

// ─── Static model catalogue ──────────────────────────────────────────────────

const OPENAI_MODELS: IModelInfo[] = [
  {
    id: 'gpt-4o', provider: 'openai', displayName: 'GPT-4o',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.FUNCTION_CALLING | ModelCapability.JSON_MODE | ModelCapability.VISION | ModelCapability.CODE,
    contextWindow: 128_000, maxOutputTokens: 16_384,
    pricing: { inputPer1M: 5.0, outputPer1M: 15.0 },
    latencyScore: 25, reliabilityScore: 0.99, available: true,
    tags: ['flagship', 'vision', 'function-calling'],
  },
  {
    id: 'gpt-4o-mini', provider: 'openai', displayName: 'GPT-4o mini',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.FUNCTION_CALLING | ModelCapability.JSON_MODE | ModelCapability.VISION,
    contextWindow: 128_000, maxOutputTokens: 16_384,
    pricing: { inputPer1M: 0.15, outputPer1M: 0.60 },
    latencyScore: 10, reliabilityScore: 0.99, available: true,
    tags: ['fast', 'cheap', 'vision'],
  },
  {
    id: 'gpt-4-turbo', provider: 'openai', displayName: 'GPT-4 Turbo',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.FUNCTION_CALLING | ModelCapability.JSON_MODE | ModelCapability.VISION,
    contextWindow: 128_000, maxOutputTokens: 4_096,
    pricing: { inputPer1M: 10.0, outputPer1M: 30.0 },
    latencyScore: 30, reliabilityScore: 0.99, available: true,
    tags: ['vision', 'function-calling'],
  },
  {
    id: 'o1', provider: 'openai', displayName: 'o1',
    capabilities: ModelCapability.CHAT | ModelCapability.REASONING | ModelCapability.CODE,
    contextWindow: 200_000, maxOutputTokens: 100_000,
    pricing: { inputPer1M: 15.0, outputPer1M: 60.0 },
    latencyScore: 80, reliabilityScore: 0.98, available: true,
    tags: ['reasoning', 'flagship'],
  },
  {
    id: 'o1-mini', provider: 'openai', displayName: 'o1 mini',
    capabilities: ModelCapability.CHAT | ModelCapability.REASONING | ModelCapability.CODE,
    contextWindow: 128_000, maxOutputTokens: 65_536,
    pricing: { inputPer1M: 3.0, outputPer1M: 12.0 },
    latencyScore: 40, reliabilityScore: 0.98, available: true,
    tags: ['reasoning', 'fast'],
  },
  {
    id: 'o3-mini', provider: 'openai', displayName: 'o3 mini',
    capabilities: ModelCapability.CHAT | ModelCapability.REASONING | ModelCapability.CODE | ModelCapability.FUNCTION_CALLING,
    contextWindow: 200_000, maxOutputTokens: 100_000,
    pricing: { inputPer1M: 1.1, outputPer1M: 4.4 },
    latencyScore: 35, reliabilityScore: 0.98, available: true,
    tags: ['reasoning', 'efficient'],
  },
  {
    id: 'text-embedding-3-large', provider: 'openai', displayName: 'text-embedding-3-large',
    capabilities: ModelCapability.EMBEDDING,
    contextWindow: 8_191,
    pricing: { inputPer1M: 0.13, outputPer1M: 0, embedPer1M: 0.13 },
    latencyScore: 5, reliabilityScore: 0.999, available: true,
    tags: ['embedding', '3072-dim'],
  },
  {
    id: 'text-embedding-3-small', provider: 'openai', displayName: 'text-embedding-3-small',
    capabilities: ModelCapability.EMBEDDING,
    contextWindow: 8_191,
    pricing: { inputPer1M: 0.02, outputPer1M: 0, embedPer1M: 0.02 },
    latencyScore: 3, reliabilityScore: 0.999, available: true,
    tags: ['embedding', '1536-dim', 'cheap'],
  },
];

// ─── Provider implementation ──────────────────────────────────────────────────

export class OpenAIProvider extends BaseProvider {
  private readonly _client: OpenAI;

  constructor(config: Partial<IProviderConfig> = {}) {
    const defaults = openAIDefaultConfig(config.apiKey);
    super({ ...defaults, ...config });

    this._client = new OpenAI({
      apiKey : this.config.apiKey,
      baseURL: this.config.baseUrl,
      timeout: this.config.timeoutMs,
      maxRetries: 0, // retries managed by BaseProvider
    });

    this.status = ProviderStatus.ACTIVE;
  }

  // ─── Message format mapping ─────────────────────────────────────────────────

  private toSDKMessages(messages: IChatMessage[]): ChatCompletionMessageParam[] {
    return messages.map((m): ChatCompletionMessageParam => {
      if (m.role === 'tool') {
        return {
          role        : 'tool',
          content     : typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
          tool_call_id: m.toolCallId!,
        };
      }

      if (m.role === 'assistant') {
        const assistantMsg: ChatCompletionMessageParam = {
          role   : 'assistant',
          content: typeof m.content === 'string' ? m.content : null,
        };
        if (m.toolCalls?.length) {
          (assistantMsg as any).tool_calls = m.toolCalls;
        }
        return assistantMsg;
      }

      if (typeof m.content === 'string') {
        return { role: m.role as any, content: m.content };
      }

      // Multimodal content parts
      const parts: ChatCompletionContentPart[] = (m.content as IContentPart[]).map(part => {
        if (part.type === 'text') return { type: 'text', text: part.text };
        if (part.type === 'image_url') return { type: 'image_url', image_url: part.image_url };
        // audio parts not yet in ChatCompletionContentPart; coerce to text placeholder
        return { type: 'text', text: '[audio content]' };
      });

      return { role: m.role as any, content: parts };
    });
  }

  private toSDKTools(tools: IChatOptions['tools']): ChatCompletionTool[] | undefined {
    if (!tools?.length) return undefined;
    return tools.map(t => ({
      type    : 'function' as const,
      function: {
        name       : t.function.name,
        description: t.function.description,
        parameters : t.function.parameters as Record<string, unknown>,
      },
    }));
  }

  // ─── _chat ──────────────────────────────────────────────────────────────────

  protected async _chat(messages: IChatMessage[], options: IChatOptions): Promise<IChatResponse> {
    const requestId = options.requestId ?? this._newRequestId();
    const start     = Date.now();

    try {
      const response = await this._client.chat.completions.create({
        model      : options.model ?? this.config.defaultModel,
        messages   : this.toSDKMessages(messages),
        temperature: options.temperature,
        top_p      : options.topP,
        max_tokens : options.maxTokens,
        stop       : options.stop as any,
        tools      : this.toSDKTools(options.tools),
        tool_choice: options.toolChoice as any,
        response_format: options.jsonMode ? { type: 'json_object' } : undefined,
        stream     : false,
      });

      const choice = response.choices[0];
      const usage  = response.usage!;

      return {
        content     : choice.message.content ?? '',
        model       : response.model,
        provider    : this.name,
        usage       : {
          promptTokens    : usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens     : usage.total_tokens,
          cachedTokens    : (usage as any).prompt_tokens_details?.cached_tokens,
        },
        finishReason: (choice.finish_reason as IChatResponse['finishReason']) ?? 'unknown',
        latencyMs   : Date.now() - start,
        requestId,
        cached      : false,
        fromFallback: false,
        toolCalls   : choice.message.tool_calls?.map(tc => ({
          id      : tc.id,
          type    : 'function' as const,
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
        raw: response,
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
    let   model       = options.model ?? this.config.defaultModel;
    let   finishReason: IChatResponse['finishReason'] = 'unknown';
    let   finalUsage  : ITokenUsage | undefined;

    try {
      const stream = await this._client.chat.completions.create({
        model      : model,
        messages   : this.toSDKMessages(messages),
        temperature: options.temperature,
        top_p      : options.topP,
        max_tokens : options.maxTokens,
        tools      : this.toSDKTools(options.tools),
        tool_choice: options.toolChoice as any,
        stream     : true,
        stream_options: { include_usage: true },
      });

      for await (const chunk of stream as AsyncIterable<ChatCompletionChunk>) {
        model = chunk.model || model;

        if ((chunk as any).usage) {
          const u = (chunk as any).usage;
          finalUsage = {
            promptTokens    : u.prompt_tokens,
            completionTokens: u.completion_tokens,
            totalTokens     : u.total_tokens,
          };
        }

        const choice = chunk.choices?.[0];
        if (!choice) continue;

        if (choice.finish_reason) {
          finishReason = (choice.finish_reason as IChatResponse['finishReason']) ?? 'unknown';
        }

        const token = choice.delta?.content ?? '';
        if (token) {
          accumulated += token;
          await onChunk({ delta: token, accumulated, done: false, requestId });
        }
      }

      const usage = finalUsage ?? {
        promptTokens    : this.countMessagesTokens(messages),
        completionTokens: this.countTokens(accumulated),
        totalTokens     : this.countMessagesTokens(messages) + this.countTokens(accumulated),
      };

      await onChunk({ delta: '', accumulated, done: true, usage, finishReason, requestId });

      return { content: accumulated, model, provider: this.name, usage, finishReason, latencyMs: Date.now() - start, requestId, cached: false, fromFallback: false };
    } catch (err) {
      throw classifyProviderError(err, this.name, requestId);
    }
  }

  // ─── _embed ─────────────────────────────────────────────────────────────────

  protected async _embed(texts: string[], options: IEmbedOptions): Promise<IEmbedResponse> {
    const requestId = options.requestId ?? this._newRequestId();
    const start     = Date.now();
    const model     = options.model ?? 'text-embedding-3-small';

    try {
      const response = await this._client.embeddings.create({
        model,
        input     : texts,
        dimensions: options.dimensions,
      });

      const sorted     = [...response.data].sort((a, b) => a.index - b.index);
      const embeddings = sorted.map(d => d.embedding);

      return {
        embeddings,
        model    : response.model,
        provider : this.name,
        usage    : {
          promptTokens: response.usage.prompt_tokens,
          totalTokens : response.usage.total_tokens,
        },
        latencyMs: Date.now() - start,
        requestId,
      };
    } catch (err) {
      throw classifyProviderError(err, this.name, requestId);
    }
  }

  // ─── _listModels ─────────────────────────────────────────────────────────────

  protected async _listModels(): Promise<IModelInfo[]> {
    // Attempt live fetch; fall back to static list on error.
    try {
      const list = await this._client.models.list();
      const liveIds = new Set(list.data.map(m => m.id));
      return OPENAI_MODELS.map(m => ({ ...m, available: liveIds.has(m.id) }));
    } catch {
      Logger.warn('[openai] listModels() live fetch failed — returning static list');
      return OPENAI_MODELS;
    }
  }

  protected async _healthProbe(): Promise<void> {
    await this._client.models.retrieve('gpt-4o-mini');
  }
}
