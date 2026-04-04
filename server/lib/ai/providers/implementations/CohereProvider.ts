/**
 * Cohere Provider — REST API (not OpenAI-compatible)
 * Uses native fetch. Models: Command R+, Command R, embed-english
 */

import {
  IProviderConfig, IChatRequest, IChatResponse, IStreamChunk,
  IEmbedRequest, IEmbedResponse, IModelInfo, IChatMessage,
  ModelCapability, MessageRole, ProviderError, AuthenticationError, RateLimitError,
} from '../core/types';
import { BaseProvider } from '../core/BaseProvider';

const COHERE_MODELS: IModelInfo[] = [
  {
    id: 'command-r-plus-08-2024',
    name: 'Command R+',
    provider: 'cohere',
    capabilities: [ModelCapability.Chat, ModelCapability.FunctionCalling, ModelCapability.Streaming, ModelCapability.LongContext, ModelCapability.Reasoning],
    contextWindow: 128_000,
    maxOutputTokens: 4_096,
    pricing: { inputPerMillion: 2.5, outputPerMillion: 10 },
    latencyClass: 'medium',
    qualityScore: 0.85,
  },
  {
    id: 'command-r-08-2024',
    name: 'Command R',
    provider: 'cohere',
    capabilities: [ModelCapability.Chat, ModelCapability.FunctionCalling, ModelCapability.Streaming],
    contextWindow: 128_000,
    maxOutputTokens: 4_096,
    pricing: { inputPerMillion: 0.15, outputPerMillion: 0.6 },
    latencyClass: 'fast',
    qualityScore: 0.77,
  },
  {
    id: 'embed-english-v3.0',
    name: 'Embed English v3',
    provider: 'cohere',
    capabilities: [ModelCapability.Embedding],
    contextWindow: 512,
    maxOutputTokens: 0,
    pricing: { inputPerMillion: 0.1, outputPerMillion: 0 },
    latencyClass: 'ultra_fast',
    qualityScore: 0.82,
  },
];

interface CohereMessage { role: 'USER' | 'CHATBOT' | 'SYSTEM'; message: string; }

export class CohereProvider extends BaseProvider {
  private _baseUrl = 'https://api.cohere.ai/v1';
  private _headers: Record<string, string> = {};

  get name(): string { return 'cohere'; }

  override async initialize(config: IProviderConfig): Promise<void> {
    await super.initialize(config);
    this._baseUrl = config.baseUrl ?? 'https://api.cohere.ai/v1';
    this._headers = {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      ...config.headers,
    };
  }

  private _buildMessages(messages: IChatMessage[]): { preamble?: string; chatHistory: CohereMessage[]; message: string } {
    let preamble: string | undefined;
    const chatHistory: CohereMessage[] = [];
    let lastUserMessage = '';

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const content = typeof msg.content === 'string' ? msg.content : msg.content.map((c) => c.text ?? '').join(' ');

      if (msg.role === MessageRole.System) {
        preamble = content;
      } else if (msg.role === MessageRole.User) {
        if (i === messages.length - 1) {
          lastUserMessage = content;
        } else {
          chatHistory.push({ role: 'USER', message: content });
        }
      } else if (msg.role === MessageRole.Assistant) {
        chatHistory.push({ role: 'CHATBOT', message: content });
      }
    }

    return { preamble, chatHistory, message: lastUserMessage };
  }

  protected async _chat(request: IChatRequest): Promise<IChatResponse> {
    const model = request.model ?? this.config.defaultModel ?? 'command-r-08-2024';
    const { preamble, chatHistory, message } = this._buildMessages(request.messages);

    try {
      const body: Record<string, unknown> = {
        model, message, chat_history: chatHistory, preamble,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        p: request.topP,
      };

      const res = await fetch(`${this._baseUrl}/chat`, {
        method: 'POST',
        headers: this._headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeout ?? 60_000),
      });

      if (!res.ok) throw await this._httpError(res);

      const data = await res.json();
      const usage = this.buildUsage(data.meta?.tokens?.input_tokens ?? 0, data.meta?.tokens?.output_tokens ?? 0);
      const modelInfo = COHERE_MODELS.find((m) => m.id === model);

      return {
        id: data.generation_id ?? this.generateId('cohere'),
        content: data.text ?? '',
        role: MessageRole.Assistant,
        model, provider: this.name, usage,
        finishReason: this.normalizeFinishReason(data.finish_reason),
        latencyMs: 0,
        cost: modelInfo ? this.calculateCost(usage, modelInfo.pricing) : undefined,
      };
    } catch (err: any) { throw this._mapError(err); }
  }

  protected async *_stream(request: IChatRequest): AsyncGenerator<IStreamChunk> {
    const model = request.model ?? this.config.defaultModel ?? 'command-r-08-2024';
    const { preamble, chatHistory, message } = this._buildMessages(request.messages);
    const id = this.generateId('cohere');

    try {
      const res = await fetch(`${this._baseUrl}/chat`, {
        method: 'POST',
        headers: this._headers,
        body: JSON.stringify({ model, message, chat_history: chatHistory, preamble, stream: true }),
        signal: AbortSignal.timeout(this.config.timeout ?? 60_000),
      });

      if (!res.ok) throw await this._httpError(res);

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            if (event.event_type === 'text-generation' && event.text) {
              yield { type: 'delta', id, model, provider: this.name, delta: event.text, finishReason: null };
            } else if (event.event_type === 'stream-end') {
              const usage = this.buildUsage(event.response?.meta?.tokens?.input_tokens ?? 0, event.response?.meta?.tokens?.output_tokens ?? 0);
              yield { type: 'usage', id, model, provider: this.name, usage, finishReason: this.normalizeFinishReason(event.finish_reason) ?? 'stop' };
              yield { type: 'done', id, model, provider: this.name, finishReason: this.normalizeFinishReason(event.finish_reason) };
            }
          } catch { /* partial JSON */ }
        }
      }
    } catch (err: any) {
      yield { type: 'error', id, model, provider: this.name, error: err.message, finishReason: null };
      throw this._mapError(err);
    }
  }

  protected async _embed(request: IEmbedRequest): Promise<IEmbedResponse> {
    const model = request.model ?? 'embed-english-v3.0';
    const inputs = Array.isArray(request.input) ? request.input : [request.input];

    try {
      const res = await fetch(`${this._baseUrl}/embed`, {
        method: 'POST',
        headers: this._headers,
        body: JSON.stringify({ model, texts: inputs, input_type: 'search_document' }),
      });
      if (!res.ok) throw await this._httpError(res);
      const data = await res.json();
      return {
        embeddings: data.embeddings,
        model, provider: this.name,
        usage: { promptTokens: data.meta?.billed_units?.input_tokens ?? 0, totalTokens: data.meta?.billed_units?.input_tokens ?? 0 },
      };
    } catch (err: any) { throw this._mapError(err); }
  }

  async listModels(): Promise<IModelInfo[]> { return COHERE_MODELS; }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this._baseUrl}/models`, { headers: this._headers });
      return res.ok;
    } catch { return false; }
  }

  private async _httpError(res: Response): Promise<ProviderError> {
    const body = await res.json().catch(() => ({}));
    const msg = body.message ?? body.error ?? `HTTP ${res.status}`;
    if (res.status === 401) return new AuthenticationError(this.name);
    if (res.status === 429) return new RateLimitError(this.name);
    return new ProviderError(msg, this.name, 'COHERE_ERROR', res.status >= 500, res.status);
  }

  private _mapError(err: any): Error {
    if (err instanceof ProviderError) return err;
    return new ProviderError(err.message ?? 'Cohere error', this.name, 'COHERE_ERROR', false);
  }
}
