/**
 * OpenAI-Compatible Provider Base
 *
 * Any provider whose API follows the OpenAI REST wire format
 * (POST /v1/chat/completions, POST /v1/embeddings, GET /v1/models)
 * can extend this class instead of BaseProvider directly.
 *
 * Concrete subclasses must supply:
 *   • PROVIDER_NAME   — registry key
 *   • DEFAULT_BASE_URL — e.g. "https://api.groq.com/openai/v1"
 *   • STATIC_MODELS   — the model catalogue to return from listModels()
 *
 * They may additionally override:
 *   • buildHeaders()  — inject extra headers (e.g. OpenRouter's HTTP-Referer)
 *   • normaliseModel() — map a user-facing model id to the provider's id
 *   • _healthProbe()  — use a cheaper/specific probe endpoint
 */

import { BaseProvider } from '../core/BaseProvider';
import { Logger } from '../../../logger';
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
  type IToolCall,
  ModelCapability,
  ProviderStatus,
  classifyProviderError,
  ProviderError,
} from '../core/types';

// ─── wire types (subset of OpenAI spec) ─────────────────────────────────────

interface OAIMessage {
  role   : 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?  : string;
  tool_calls?      : OAIToolCall[];
  tool_call_id?    : string;
}

interface OAIToolCall {
  id      : string;
  type    : 'function';
  function: { name: string; arguments: string };
}

interface OAIToolDef {
  type    : 'function';
  function: { name: string; description: string; parameters: unknown };
}

interface OAIChatRequest {
  model       : string;
  messages    : OAIMessage[];
  temperature?: number;
  top_p?      : number;
  max_tokens? : number;
  stop?       : string | string[];
  stream?     : boolean;
  tools?      : OAIToolDef[];
  tool_choice?: unknown;
  response_format?: { type: 'json_object' | 'text' };
}

interface OAIChatResponse {
  id     : string;
  model  : string;
  choices: Array<{
    index        : number;
    finish_reason: string;
    message      : OAIMessage;
  }>;
  usage  : { prompt_tokens: number; completion_tokens: number; total_tokens: number; prompt_tokens_details?: { cached_tokens?: number } };
}

interface OAIStreamDelta {
  id     : string;
  model  : string;
  choices: Array<{
    index        : number;
    finish_reason: string | null;
    delta        : { role?: string; content?: string | null; tool_calls?: OAIToolCall[] };
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

interface OAIEmbedRequest {
  model  : string;
  input  : string | string[];
  dimensions?: number;
}

interface OAIEmbedResponse {
  data  : Array<{ index: number; embedding: number[] }>;
  model : string;
  usage : { prompt_tokens: number; total_tokens: number };
}

// ─── base ────────────────────────────────────────────────────────────────────

export abstract class OpenAICompatBase extends BaseProvider {
  /** Override in subclasses to inject extra HTTP headers. */
  protected buildHeaders(apiKey: string): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) h['Authorization'] = `Bearer ${apiKey}`;
    return h;
  }

  /** Override to remap model IDs (e.g. 'gpt-4o' → 'openai/gpt-4o' for OpenRouter). */
  protected normaliseModel(modelId: string): string {
    return modelId;
  }

  /** Base URL for this provider's API. Reads from config.baseUrl. */
  protected get baseUrl(): string {
    return this.config.baseUrl!;
  }

  // ─── IChatMessage → OAI wire format ───────────────────────────────────────

  protected toOAIMessages(messages: IChatMessage[]): OAIMessage[] {
    return messages.map((m): OAIMessage => {
      // Flatten multimodal content to plain text for compat providers that
      // don't explicitly support vision (callers should use a vision-capable
      // provider for image payloads).
      let content: string | null;
      if (typeof m.content === 'string') {
        content = m.content;
      } else {
        content = m.content
          .filter(p => p.type === 'text')
          .map(p => (p as any).text as string)
          .join('\n');
      }

      const msg: OAIMessage = {
        role   : m.role as OAIMessage['role'],
        content,
      };
      if (m.name)        msg.name         = m.name;
      if (m.toolCallId)  msg.tool_call_id = m.toolCallId;
      if (m.toolCalls)   msg.tool_calls   = m.toolCalls as OAIToolCall[];
      return msg;
    });
  }

  protected toOAIRequest(messages: IChatMessage[], options: IChatOptions): OAIChatRequest {
    const req: OAIChatRequest = {
      model   : this.normaliseModel(options.model ?? this.config.defaultModel),
      messages: this.toOAIMessages(messages),
    };

    if (options.temperature !== undefined) req.temperature = options.temperature;
    if (options.topP        !== undefined) req.top_p       = options.topP;
    if (options.maxTokens   !== undefined) req.max_tokens  = options.maxTokens;
    if (options.stop        !== undefined) req.stop        = options.stop;
    if (options.jsonMode)                  req.response_format = { type: 'json_object' };

    if (options.tools?.length) {
      req.tools = options.tools.map(t => ({
        type    : 'function',
        function: {
          name       : t.function.name,
          description: t.function.description,
          parameters : t.function.parameters,
        },
      }));
      if (options.toolChoice !== undefined) req.tool_choice = options.toolChoice;
    }

    return req;
  }

  protected parseUsage(raw: OAIChatResponse['usage']): ITokenUsage {
    return {
      promptTokens    : raw.prompt_tokens,
      completionTokens: raw.completion_tokens,
      totalTokens     : raw.total_tokens,
      cachedTokens    : raw.prompt_tokens_details?.cached_tokens,
    };
  }

  protected parseToolCalls(raw: OAIToolCall[] | undefined): IToolCall[] | undefined {
    if (!raw?.length) return undefined;
    return raw.map(tc => ({
      id      : tc.id,
      type    : 'function' as const,
      function: { name: tc.function.name, arguments: tc.function.arguments },
    }));
  }

  protected parseFinishReason(raw: string | null): IChatResponse['finishReason'] {
    switch (raw) {
      case 'stop'          : return 'stop';
      case 'length'        : return 'length';
      case 'tool_calls'    : return 'tool_calls';
      case 'content_filter': return 'content_filter';
      default              : return 'unknown';
    }
  }

  // ─── HTTP helpers ──────────────────────────────────────────────────────────

  protected async fetchJSON<T>(
    path     : string,
    body     : unknown,
    requestId: string,
  ): Promise<T> {
    const url     = `${this.baseUrl}${path}`;
    const apiKey  = this.config.apiKey ?? '';
    const headers = this.buildHeaders(apiKey);

    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const res = await fetch(url, {
        method : 'POST',
        headers,
        body   : JSON.stringify(body),
        signal : controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw Object.assign(new Error(text || res.statusText), {
          status: res.status,
        });
      }

      return res.json() as Promise<T>;
    } finally {
      clearTimeout(timeout);
    }
  }

  protected async *fetchStream(
    path     : string,
    body     : unknown,
    requestId: string,
  ): AsyncGenerator<string> {
    const url     = `${this.baseUrl}${path}`;
    const apiKey  = this.config.apiKey ?? '';
    const headers = this.buildHeaders(apiKey);

    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const res = await fetch(url, {
        method : 'POST',
        headers,
        body   : JSON.stringify({ ...body as object, stream: true }),
        signal : controller.signal,
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
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (trimmed.startsWith('data: ')) {
            yield trimmed.slice(6);
          }
        }
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  // ─── BaseProvider abstract implementations ─────────────────────────────────

  protected async _chat(messages: IChatMessage[], options: IChatOptions): Promise<IChatResponse> {
    const requestId = options.requestId ?? this._newRequestId();
    const start     = Date.now();

    try {
      const reqBody  = this.toOAIRequest(messages, options);
      const raw      = await this.fetchJSON<OAIChatResponse>('/chat/completions', reqBody, requestId);
      const choice   = raw.choices[0];

      return {
        content     : choice.message.content ?? '',
        model       : raw.model,
        provider    : this.name,
        usage       : this.parseUsage(raw.usage),
        finishReason: this.parseFinishReason(choice.finish_reason),
        latencyMs   : Date.now() - start,
        requestId,
        cached      : false,
        fromFallback: false,
        toolCalls   : this.parseToolCalls(choice.message.tool_calls),
        raw,
      };
    } catch (err) {
      throw classifyProviderError(err, this.name, requestId);
    }
  }

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
    let   model       = options.model ?? this.config.defaultModel;

    try {
      const reqBody = this.toOAIRequest(messages, options);

      for await (const rawLine of this.fetchStream('/chat/completions', reqBody, requestId)) {
        let delta: OAIStreamDelta;
        try { delta = JSON.parse(rawLine); } catch { continue; }

        model = delta.model || model;

        if (delta.usage) {
          finalUsage = {
            promptTokens    : delta.usage.prompt_tokens,
            completionTokens: delta.usage.completion_tokens,
            totalTokens     : delta.usage.total_tokens,
          };
        }

        const choice = delta.choices?.[0];
        if (!choice) continue;

        if (choice.finish_reason) {
          finishReason = this.parseFinishReason(choice.finish_reason);
        }

        const token = choice.delta?.content ?? '';
        if (token) {
          accumulated += token;
          const chunk: IStreamChunk = {
            delta      : token,
            accumulated,
            done       : false,
            requestId,
          };
          await onChunk(chunk);
        }
      }

      const usage = finalUsage ?? {
        promptTokens    : this.countMessagesTokens(messages),
        completionTokens: this.countTokens(accumulated),
        totalTokens     : this.countMessagesTokens(messages) + this.countTokens(accumulated),
      };

      // Final chunk
      await onChunk({ delta: '', accumulated, done: true, usage, finishReason, requestId });

      return {
        content     : accumulated,
        model,
        provider    : this.name,
        usage,
        finishReason,
        latencyMs   : Date.now() - start,
        requestId,
        cached      : false,
        fromFallback: false,
      };
    } catch (err) {
      throw classifyProviderError(err, this.name, requestId);
    }
  }

  protected async _embed(texts: string[], options: IEmbedOptions): Promise<IEmbedResponse> {
    const requestId = options.requestId ?? this._newRequestId();
    const start     = Date.now();

    try {
      const reqBody: OAIEmbedRequest = {
        model: options.model ?? this.config.defaultModel,
        input: texts,
      };
      if (options.dimensions) reqBody.dimensions = options.dimensions;

      const raw = await this.fetchJSON<OAIEmbedResponse>('/embeddings', reqBody, requestId);

      const sorted     = [...raw.data].sort((a, b) => a.index - b.index);
      const embeddings = sorted.map(d => d.embedding);

      return {
        embeddings,
        model    : raw.model,
        provider : this.name,
        usage    : { promptTokens: raw.usage.prompt_tokens, totalTokens: raw.usage.total_tokens },
        latencyMs: Date.now() - start,
        requestId,
      };
    } catch (err) {
      throw classifyProviderError(err, this.name, requestId);
    }
  }

  protected async _listModels(): Promise<IModelInfo[]> {
    return this.staticModels();
  }

  /** Subclasses return their static model catalogue here. */
  protected abstract staticModels(): IModelInfo[];
}
