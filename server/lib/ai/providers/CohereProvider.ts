/**
 * Cohere Provider
 *
 * Cohere's Chat API does NOT follow the OpenAI wire format, so this is a
 * full custom implementation.  Key differences:
 *
 *  1. /v2/chat endpoint — request body uses `model`, `messages`, and
 *     `tools` with a different schema format.
 *  2. Streaming returns server-sent events with typed event objects.
 *  3. Embedding is first-class — embed-v4.0 supports 1024-dim vectors,
 *     multiple input types (search_query, search_document, classification).
 *  4. Tool definitions use `parameter_definitions` instead of JSON Schema.
 *  5. Tokens reported as `billed_units.input_tokens` / `output_tokens`.
 *
 * Supported capabilities: CHAT, STREAMING, FUNCTION_CALLING, EMBEDDING, CODE
 */

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
  ModelCapability,
  ProviderStatus,
  classifyProviderError,
  ProviderError,
} from './core/types';

// ─── Default config ──────────────────────────────────────────────────────────

export function cohereDefaultConfig(apiKey?: string): IProviderConfig {
  return {
    name        : 'cohere',
    displayName : 'Cohere',
    apiKey      : apiKey ?? process.env.COHERE_API_KEY,
    baseUrl     : 'https://api.cohere.com',
    defaultModel: 'command-r-plus-08-2024',
    timeoutMs   : 90_000,
    retry: {
      maxRetries       : 3,
      baseDelayMs      : 500,
      backoffFactor    : 2,
      maxDelayMs       : 12_000,
      retryableStatuses: [429, 500, 503],
    },
    rateLimit: {
      requestsPerMinute: 60,
      tokensPerMinute  : 200_000,
      maxConcurrent    : 10,
    },
    extra: {
      capabilities:
        ModelCapability.CHAT | ModelCapability.STREAMING |
        ModelCapability.FUNCTION_CALLING | ModelCapability.EMBEDDING | ModelCapability.CODE,
    },
  };
}

// ─── Static model catalogue ──────────────────────────────────────────────────

const COHERE_MODELS: IModelInfo[] = [
  {
    id: 'command-r-plus-08-2024', provider: 'cohere', displayName: 'Command R+ (Aug 2024)',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.FUNCTION_CALLING | ModelCapability.CODE,
    contextWindow: 128_000, maxOutputTokens: 4_000,
    pricing: { inputPer1M: 2.5, outputPer1M: 10.0 },
    latencyScore: 25, reliabilityScore: 0.97, available: true,
    tags: ['flagship', 'rag', 'function-calling'],
  },
  {
    id: 'command-r-08-2024', provider: 'cohere', displayName: 'Command R (Aug 2024)',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.FUNCTION_CALLING,
    contextWindow: 128_000, maxOutputTokens: 4_000,
    pricing: { inputPer1M: 0.15, outputPer1M: 0.60 },
    latencyScore: 15, reliabilityScore: 0.97, available: true,
    tags: ['fast', 'cheap', 'rag'],
  },
  {
    id: 'command-r7b-12-2024', provider: 'cohere', displayName: 'Command R7B',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.FUNCTION_CALLING,
    contextWindow: 128_000, maxOutputTokens: 4_000,
    pricing: { inputPer1M: 0.0375, outputPer1M: 0.15 },
    latencyScore: 8, reliabilityScore: 0.96, available: true,
    tags: ['fast', 'cheap', 'small'],
  },
  {
    id: 'embed-v4.0', provider: 'cohere', displayName: 'Embed v4.0',
    capabilities: ModelCapability.EMBEDDING,
    contextWindow: 512,
    pricing: { inputPer1M: 0.1, outputPer1M: 0, embedPer1M: 0.1 },
    latencyScore: 4, reliabilityScore: 0.99, available: true,
    tags: ['embedding', '1024-dim'],
  },
  {
    id: 'embed-english-v3.0', provider: 'cohere', displayName: 'Embed English v3.0',
    capabilities: ModelCapability.EMBEDDING,
    contextWindow: 512,
    pricing: { inputPer1M: 0.1, outputPer1M: 0, embedPer1M: 0.1 },
    latencyScore: 4, reliabilityScore: 0.99, available: true,
    tags: ['embedding', '1024-dim', 'english'],
  },
  {
    id: 'embed-multilingual-v3.0', provider: 'cohere', displayName: 'Embed Multilingual v3.0',
    capabilities: ModelCapability.EMBEDDING,
    contextWindow: 512,
    pricing: { inputPer1M: 0.1, outputPer1M: 0, embedPer1M: 0.1 },
    latencyScore: 5, reliabilityScore: 0.99, available: true,
    tags: ['embedding', '1024-dim', 'multilingual'],
  },
];

// ─── Cohere wire types ────────────────────────────────────────────────────────

interface CohereMessage {
  role   : 'user' | 'assistant' | 'system' | 'tool';
  content: string | Array<{ type: string; text?: string; tool_use_id?: string; content?: string }>;
}

interface CohereChatRequest {
  model          : string;
  messages       : CohereMessage[];
  temperature?   : number;
  p?             : number;
  max_tokens?    : number;
  stop_sequences?: string[];
  tools?         : CohereToolDef[];
  response_format?: { type: 'json_object' };
  stream?        : boolean;
}

interface CohereToolDef {
  type    : 'function';
  function: {
    name       : string;
    description: string;
    parameters : Record<string, unknown>;
  };
}

interface CohereChatResponse {
  id           : string;
  message      : { role: string; content: Array<{ type: string; text?: string }> };
  finish_reason: string;
  usage        : { billed_units: { input_tokens: number; output_tokens: number }; tokens?: { input_tokens: number; output_tokens: number } };
}

interface CohereEmbedRequest {
  model      : string;
  texts      : string[];
  input_type : 'search_query' | 'search_document' | 'classification' | 'clustering';
  embedding_types?: ['float'];
  truncate?  : 'NONE' | 'START' | 'END';
}

// ─── Provider ────────────────────────────────────────────────────────────────

export class CohereProvider extends BaseProvider {
  constructor(config: Partial<IProviderConfig> = {}) {
    const defaults = cohereDefaultConfig(config.apiKey);
    super({ ...defaults, ...config });
    this.status = ProviderStatus.ACTIVE;
  }

  // ─── HTTP helpers ───────────────────────────────────────────────────────────

  private get headers(): Record<string, string> {
    return {
      'Content-Type'  : 'application/json',
      'Authorization' : `Bearer ${this.config.apiKey ?? ''}`,
      'X-Client-Name' : 'iliagpt-provider',
    };
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.config.baseUrl}${path}`;
    const res = await fetch(url, {
      method : 'POST',
      headers: this.headers,
      body   : JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw Object.assign(new Error(text || res.statusText), { status: res.status });
    }
    return res.json() as Promise<T>;
  }

  private async *postStream(path: string, body: unknown): AsyncGenerator<any> {
    const url = `${this.config.baseUrl}${path}`;
    const res = await fetch(url, {
      method : 'POST',
      headers: this.headers,
      body   : JSON.stringify({ ...body as object, stream: true }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw Object.assign(new Error(text || res.statusText), { status: res.status });
    }
    const reader  = res.body!.getReader();
    const decoder = new TextDecoder();
    let   buf     = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try { yield JSON.parse(trimmed); } catch { /* skip malformed */ }
      }
    }
  }

  // ─── Message mapping ────────────────────────────────────────────────────────

  private toCohereMessages(messages: IChatMessage[]): CohereMessage[] {
    return messages.map((m): CohereMessage => {
      if (m.role === 'tool') {
        return {
          role   : 'tool',
          content: [{
            type       : 'tool_result',
            tool_use_id: m.toolCallId!,
            content    : typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
          }],
        };
      }
      const role = m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user';
      return {
        role   : role as any,
        content: typeof m.content === 'string' ? m.content : (m.content as any[]).map(p => p.type === 'text' ? p.text : '[image]').join('\n'),
      };
    });
  }

  private parseUsage(raw: CohereChatResponse['usage']): ITokenUsage {
    const tokens = raw.tokens ?? raw.billed_units;
    return {
      promptTokens    : tokens.input_tokens,
      completionTokens: tokens.output_tokens,
      totalTokens     : tokens.input_tokens + tokens.output_tokens,
    };
  }

  // ─── _chat ──────────────────────────────────────────────────────────────────

  protected async _chat(messages: IChatMessage[], options: IChatOptions): Promise<IChatResponse> {
    const requestId = options.requestId ?? this._newRequestId();
    const start     = Date.now();

    try {
      const body: CohereChatRequest = {
        model   : options.model ?? this.config.defaultModel,
        messages: this.toCohereMessages(messages),
      };
      if (options.temperature !== undefined)     body.temperature    = options.temperature;
      if (options.topP        !== undefined)     body.p              = options.topP;
      if (options.maxTokens   !== undefined)     body.max_tokens     = options.maxTokens;
      if (options.stop)                          body.stop_sequences = Array.isArray(options.stop) ? options.stop : [options.stop];
      if (options.jsonMode)                      body.response_format = { type: 'json_object' };
      if (options.tools?.length) {
        body.tools = options.tools.map(t => ({ type: 'function', function: { name: t.function.name, description: t.function.description, parameters: t.function.parameters as any } }));
      }

      const raw = await this.post<CohereChatResponse>('/v2/chat', body);
      const textContent = raw.message.content.filter(b => b.type === 'text').map(b => b.text ?? '').join('');

      const frMap: Record<string, IChatResponse['finishReason']> = {
        COMPLETE   : 'stop',
        MAX_TOKENS : 'length',
        STOP_SEQUENCE: 'stop',
        ERROR      : 'error',
        TOOL_CALL  : 'tool_calls',
      };

      return {
        content     : textContent,
        model       : raw.id ? body.model : body.model,
        provider    : this.name,
        usage       : this.parseUsage(raw.usage),
        finishReason: frMap[raw.finish_reason] ?? 'unknown',
        latencyMs   : Date.now() - start,
        requestId,
        cached      : false,
        fromFallback: false,
        raw,
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
    let   finishReason: IChatResponse['finishReason'] = 'unknown';
    let   finalUsage  : ITokenUsage | undefined;
    const model       = options.model ?? this.config.defaultModel;

    try {
      const body: CohereChatRequest = {
        model   : model,
        messages: this.toCohereMessages(messages),
        ...(options.temperature !== undefined && { temperature: options.temperature }),
        ...(options.maxTokens   !== undefined && { max_tokens : options.maxTokens }),
      };

      for await (const event of this.postStream('/v2/chat', body)) {
        if (event.type === 'content-delta') {
          const token = event.delta?.message?.content?.text ?? '';
          if (token) {
            accumulated += token;
            await onChunk({ delta: token, accumulated, done: false, requestId });
          }
        }
        if (event.type === 'message-end') {
          const usage = event.delta?.usage;
          if (usage) {
            finalUsage = {
              promptTokens    : usage.billed_units?.input_tokens  ?? 0,
              completionTokens: usage.billed_units?.output_tokens ?? 0,
              totalTokens     : (usage.billed_units?.input_tokens ?? 0) + (usage.billed_units?.output_tokens ?? 0),
            };
          }
          const fr = event.delta?.finish_reason as string;
          const frMap: Record<string, IChatResponse['finishReason']> = { COMPLETE: 'stop', MAX_TOKENS: 'length' };
          finishReason = frMap[fr] ?? 'unknown';
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
    const model     = options.model ?? 'embed-v4.0';

    try {
      const body: CohereEmbedRequest = {
        model,
        texts,
        input_type     : 'search_document',
        embedding_types: ['float'],
        truncate       : 'END',
      };

      const raw = await this.post<any>('/v1/embed', body);
      const embeddings: number[][] = raw.embeddings?.float ?? raw.embeddings ?? [];

      return {
        embeddings,
        model,
        provider : this.name,
        usage    : {
          promptTokens: raw.meta?.billed_units?.input_tokens ?? texts.reduce((s, t) => s + Math.ceil(t.length / 4), 0),
          totalTokens : raw.meta?.billed_units?.input_tokens ?? texts.reduce((s, t) => s + Math.ceil(t.length / 4), 0),
        },
        latencyMs: Date.now() - start,
        requestId,
      };
    } catch (err) {
      throw classifyProviderError(err, this.name, requestId);
    }
  }

  protected async _listModels(): Promise<IModelInfo[]> {
    return COHERE_MODELS;
  }

  protected async _healthProbe(): Promise<void> {
    await this.post('/v2/chat', {
      model   : 'command-r-08-2024',
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
    });
  }
}
