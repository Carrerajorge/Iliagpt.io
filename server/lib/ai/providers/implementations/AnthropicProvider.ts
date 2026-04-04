/**
 * Anthropic Provider
 * Supports: Claude 3.5 Sonnet, Claude 3 Opus/Haiku, Claude 3.5 Haiku, embeddings via Voyage
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  IProviderConfig,
  IChatRequest,
  IChatResponse,
  IStreamChunk,
  IEmbedRequest,
  IEmbedResponse,
  IModelInfo,
  IChatMessage,
  ModelCapability,
  MessageRole,
  ProviderError,
  AuthenticationError,
  RateLimitError,
  ModelNotFoundError,
} from '../core/types';
import { BaseProvider } from '../core/BaseProvider';

// ─── Static model catalogue ────────────────────────────────────────────────────

const ANTHROPIC_MODELS: IModelInfo[] = [
  {
    id: 'claude-opus-4-5',
    name: 'Claude Opus 4.5',
    provider: 'anthropic',
    capabilities: [ModelCapability.Chat, ModelCapability.FunctionCalling, ModelCapability.Streaming, ModelCapability.ImageUnderstanding, ModelCapability.CodeGeneration, ModelCapability.Reasoning, ModelCapability.LongContext],
    contextWindow: 200_000,
    maxOutputTokens: 32_000,
    pricing: { inputPerMillion: 15, outputPerMillion: 75 },
    latencyClass: 'slow',
    qualityScore: 0.98,
  },
  {
    id: 'claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5',
    provider: 'anthropic',
    capabilities: [ModelCapability.Chat, ModelCapability.FunctionCalling, ModelCapability.Streaming, ModelCapability.ImageUnderstanding, ModelCapability.CodeGeneration, ModelCapability.LongContext],
    contextWindow: 200_000,
    maxOutputTokens: 16_000,
    pricing: { inputPerMillion: 3, outputPerMillion: 15 },
    latencyClass: 'fast',
    qualityScore: 0.93,
  },
  {
    id: 'claude-haiku-4-5-20251001',
    name: 'Claude Haiku 4.5',
    provider: 'anthropic',
    capabilities: [ModelCapability.Chat, ModelCapability.FunctionCalling, ModelCapability.Streaming, ModelCapability.ImageUnderstanding],
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    pricing: { inputPerMillion: 0.8, outputPerMillion: 4 },
    latencyClass: 'ultra_fast',
    qualityScore: 0.79,
  },
  {
    id: 'claude-3-5-sonnet-20241022',
    name: 'Claude 3.5 Sonnet',
    provider: 'anthropic',
    capabilities: [ModelCapability.Chat, ModelCapability.FunctionCalling, ModelCapability.Streaming, ModelCapability.ImageUnderstanding, ModelCapability.CodeGeneration, ModelCapability.LongContext],
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    pricing: { inputPerMillion: 3, outputPerMillion: 15 },
    latencyClass: 'fast',
    qualityScore: 0.93,
  },
];

// ─── Provider ─────────────────────────────────────────────────────────────────

export class AnthropicProvider extends BaseProvider {
  private client!: Anthropic;

  get name(): string {
    return 'anthropic';
  }

  override async initialize(config: IProviderConfig): Promise<void> {
    await super.initialize(config);
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      timeout: config.timeout ?? 60_000,
      maxRetries: 0,
      defaultHeaders: config.headers,
    });
  }

  private _toAnthropicMessages(messages: IChatMessage[]): {
    system?: string;
    messages: Anthropic.MessageParam[];
  } {
    let system: string | undefined;
    const anthropicMessages: Anthropic.MessageParam[] = [];

    for (const msg of messages) {
      if (msg.role === MessageRole.System) {
        system = typeof msg.content === 'string' ? msg.content : msg.content.map((c) => c.text ?? '').join(' ');
        continue;
      }

      const content: Anthropic.ContentBlockParam[] = typeof msg.content === 'string'
        ? [{ type: 'text', text: msg.content }]
        : msg.content.flatMap((c): Anthropic.ContentBlockParam[] => {
            if (c.type === 'text' && c.text) return [{ type: 'text', text: c.text }];
            if (c.type === 'image_url' && c.image_url) {
              return [{
                type: 'image',
                source: { type: 'url', url: c.image_url.url },
              } as Anthropic.ImageBlockParam];
            }
            if (c.type === 'image_base64' && c.image_base64) {
              return [{
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: c.image_base64.media_type as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                  data: c.image_base64.data,
                },
              } as Anthropic.ImageBlockParam];
            }
            return [];
          });

      anthropicMessages.push({
        role: msg.role === MessageRole.User ? 'user' : 'assistant',
        content,
      });
    }

    return { system, messages: anthropicMessages };
  }

  protected async _chat(request: IChatRequest): Promise<IChatResponse> {
    const model = request.model ?? this.config.defaultModel ?? 'claude-haiku-4-5-20251001';
    const { system, messages } = this._toAnthropicMessages(request.messages);

    try {
      const response = await this.client.messages.create({
        model,
        system,
        messages,
        max_tokens: request.maxTokens ?? 4096,
        temperature: request.temperature,
        top_p: request.topP,
        stop_sequences: Array.isArray(request.stop) ? request.stop : request.stop ? [request.stop] : undefined,
        tools: request.tools?.map((t) => ({
          name: t.function.name,
          description: t.function.description,
          input_schema: t.function.parameters as Anthropic.Tool['input_schema'],
        })),
        stream: false,
      });

      const textContent = response.content
        .filter((c): c is Anthropic.TextBlock => c.type === 'text')
        .map((c) => c.text)
        .join('');

      const toolUseBlocks = response.content.filter(
        (c): c is Anthropic.ToolUseBlock => c.type === 'tool_use',
      );

      const modelInfo = ANTHROPIC_MODELS.find((m) => m.id === model);
      const usage = this.buildUsage(response.usage.input_tokens, response.usage.output_tokens, {
        cachedTokens: (response.usage as any).cache_read_input_tokens,
      });
      const cost = modelInfo ? this.calculateCost(usage, modelInfo.pricing) : undefined;

      return {
        id: response.id,
        content: textContent,
        role: MessageRole.Assistant,
        model: response.model,
        provider: this.name,
        usage,
        finishReason: this.normalizeFinishReason(response.stop_reason),
        toolCalls: toolUseBlocks.map((tb) => ({
          id: tb.id,
          type: 'function' as const,
          function: { name: tb.name, arguments: JSON.stringify(tb.input) },
        })),
        latencyMs: 0,
        cost,
      };
    } catch (err: any) {
      throw this._mapError(err);
    }
  }

  protected async *_stream(request: IChatRequest): AsyncGenerator<IStreamChunk> {
    const model = request.model ?? this.config.defaultModel ?? 'claude-haiku-4-5-20251001';
    const { system, messages } = this._toAnthropicMessages(request.messages);
    const id = this.generateId('anthropic');

    try {
      const stream = this.client.messages.stream({
        model,
        system,
        messages,
        max_tokens: request.maxTokens ?? 4096,
        temperature: request.temperature,
      });

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield {
            type: 'delta',
            id,
            model,
            provider: this.name,
            delta: event.delta.text,
            finishReason: null,
          };
        } else if (event.type === 'message_delta' && event.usage) {
          // We don't have input tokens at this point — estimate from totals
          yield {
            type: 'usage',
            id,
            model,
            provider: this.name,
            usage: this.buildUsage(0, event.usage.output_tokens),
            finishReason: this.normalizeFinishReason(event.delta.stop_reason ?? null) ?? 'stop',
          };
        } else if (event.type === 'message_stop') {
          yield { type: 'done', id, model, provider: this.name, finishReason: 'stop' };
        }
      }
    } catch (err: any) {
      yield { type: 'error', id, model, provider: this.name, error: err.message, finishReason: null };
      throw this._mapError(err);
    }
  }

  protected async _embed(_request: IEmbedRequest): Promise<IEmbedResponse> {
    // Anthropic does not natively provide embeddings; placeholder for Voyage via SDK
    throw new ProviderError(
      'Anthropic does not support embeddings natively. Use a dedicated embedding provider.',
      this.name,
      'NOT_SUPPORTED',
      false,
    );
  }

  async listModels(): Promise<IModelInfo[]> {
    return ANTHROPIC_MODELS;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.models.list();
      return true;
    } catch {
      return false;
    }
  }

  private _mapError(err: any): Error {
    if (err instanceof ProviderError) return err;
    const status = err.status ?? err.statusCode;
    if (status === 401) return new AuthenticationError(this.name);
    if (status === 429) return new RateLimitError(this.name);
    if (status === 404) return new ModelNotFoundError(this.name, 'unknown');
    return new ProviderError(err.message ?? 'Unknown Anthropic error', this.name, 'ANTHROPIC_ERROR', status >= 500);
  }
}
