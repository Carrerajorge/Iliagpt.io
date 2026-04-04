/**
 * Google Gemini Provider
 * Uses @google/genai SDK. Supports: Gemini 2.0 Flash, Gemini 1.5 Pro, embeddings
 */

import { GoogleGenAI, Content, Part } from '@google/genai';
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
} from '../core/types';
import { BaseProvider } from '../core/BaseProvider';

// ─── Static model catalogue ────────────────────────────────────────────────────

const GOOGLE_MODELS: IModelInfo[] = [
  {
    id: 'gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    provider: 'google',
    capabilities: [ModelCapability.Chat, ModelCapability.FunctionCalling, ModelCapability.Streaming, ModelCapability.ImageUnderstanding, ModelCapability.JsonMode, ModelCapability.LongContext],
    contextWindow: 1_048_576,
    maxOutputTokens: 8_192,
    pricing: { inputPerMillion: 0.1, outputPerMillion: 0.4 },
    latencyClass: 'ultra_fast',
    qualityScore: 0.85,
  },
  {
    id: 'gemini-2.0-flash-thinking-exp',
    name: 'Gemini 2.0 Flash Thinking',
    provider: 'google',
    capabilities: [ModelCapability.Chat, ModelCapability.Reasoning, ModelCapability.Streaming, ModelCapability.LongContext],
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    pricing: { inputPerMillion: 0.1, outputPerMillion: 0.4 },
    latencyClass: 'medium',
    qualityScore: 0.90,
  },
  {
    id: 'gemini-1.5-pro',
    name: 'Gemini 1.5 Pro',
    provider: 'google',
    capabilities: [ModelCapability.Chat, ModelCapability.FunctionCalling, ModelCapability.Streaming, ModelCapability.ImageUnderstanding, ModelCapability.JsonMode, ModelCapability.LongContext, ModelCapability.AudioTranscription],
    contextWindow: 2_097_152,
    maxOutputTokens: 8_192,
    pricing: { inputPerMillion: 1.25, outputPerMillion: 5 },
    latencyClass: 'medium',
    qualityScore: 0.91,
  },
  {
    id: 'text-embedding-004',
    name: 'Text Embedding 004',
    provider: 'google',
    capabilities: [ModelCapability.Embedding],
    contextWindow: 2_048,
    maxOutputTokens: 0,
    pricing: { inputPerMillion: 0.00, outputPerMillion: 0 },
    latencyClass: 'ultra_fast',
    qualityScore: 0.80,
  },
];

// ─── Provider ─────────────────────────────────────────────────────────────────

export class GoogleProvider extends BaseProvider {
  private client!: GoogleGenAI;

  get name(): string {
    return 'google';
  }

  override async initialize(config: IProviderConfig): Promise<void> {
    await super.initialize(config);
    this.client = new GoogleGenAI({ apiKey: config.apiKey });
  }

  private _toGoogleContents(messages: IChatMessage[]): { systemInstruction?: string; contents: Content[] } {
    let systemInstruction: string | undefined;
    const contents: Content[] = [];

    for (const msg of messages) {
      if (msg.role === MessageRole.System) {
        systemInstruction = typeof msg.content === 'string'
          ? msg.content
          : msg.content.map((c) => c.text ?? '').join(' ');
        continue;
      }

      const parts: Part[] = typeof msg.content === 'string'
        ? [{ text: msg.content }]
        : msg.content.flatMap((c): Part[] => {
            if (c.type === 'text' && c.text) return [{ text: c.text }];
            if (c.type === 'image_base64' && c.image_base64) {
              return [{
                inlineData: {
                  mimeType: c.image_base64.media_type,
                  data: c.image_base64.data,
                },
              }];
            }
            return [];
          });

      contents.push({
        role: msg.role === MessageRole.User ? 'user' : 'model',
        parts,
      });
    }

    return { systemInstruction, contents };
  }

  protected async _chat(request: IChatRequest): Promise<IChatResponse> {
    const modelId = request.model ?? this.config.defaultModel ?? 'gemini-2.0-flash';
    const { systemInstruction, contents } = this._toGoogleContents(request.messages);

    try {
      const response = await this.client.models.generateContent({
        model: modelId,
        systemInstruction,
        contents,
        config: {
          temperature: request.temperature,
          topP: request.topP,
          maxOutputTokens: request.maxTokens,
          stopSequences: Array.isArray(request.stop) ? request.stop : request.stop ? [request.stop] : undefined,
          responseMimeType: request.responseFormat?.type === 'json_object' ? 'application/json' : 'text/plain',
        },
      });

      const text = response.text ?? '';
      const usage = response.usageMetadata;
      const promptTokens = usage?.promptTokenCount ?? this.getMessagesTokenCount(request.messages);
      const completionTokens = usage?.candidatesTokenCount ?? this.getTokenCount(text);

      const modelInfo = GOOGLE_MODELS.find((m) => m.id === modelId);
      const builtUsage = this.buildUsage(promptTokens, completionTokens);
      const cost = modelInfo ? this.calculateCost(builtUsage, modelInfo.pricing) : undefined;

      return {
        id: this.generateId('google'),
        content: text,
        role: MessageRole.Assistant,
        model: modelId,
        provider: this.name,
        usage: builtUsage,
        finishReason: this.normalizeFinishReason(response.candidates?.[0]?.finishReason?.toString() ?? null),
        latencyMs: 0,
        cost,
      };
    } catch (err: any) {
      throw this._mapError(err);
    }
  }

  protected async *_stream(request: IChatRequest): AsyncGenerator<IStreamChunk> {
    const modelId = request.model ?? this.config.defaultModel ?? 'gemini-2.0-flash';
    const { systemInstruction, contents } = this._toGoogleContents(request.messages);
    const id = this.generateId('google');

    try {
      const stream = this.client.models.generateContentStream({
        model: modelId,
        systemInstruction,
        contents,
        config: {
          temperature: request.temperature,
          maxOutputTokens: request.maxTokens,
        },
      });

      for await (const chunk of await stream) {
        const text = chunk.text;
        if (text) {
          yield { type: 'delta', id, model: modelId, provider: this.name, delta: text, finishReason: null };
        }
        const finishReason = chunk.candidates?.[0]?.finishReason?.toString();
        if (finishReason && finishReason !== 'FINISH_REASON_UNSPECIFIED') {
          const usage = chunk.usageMetadata;
          if (usage) {
            yield {
              type: 'usage',
              id, model: modelId, provider: this.name,
              usage: this.buildUsage(usage.promptTokenCount ?? 0, usage.candidatesTokenCount ?? 0),
              finishReason: this.normalizeFinishReason(finishReason) ?? 'stop',
            };
          }
          yield { type: 'done', id, model: modelId, provider: this.name, finishReason: this.normalizeFinishReason(finishReason) };
        }
      }
    } catch (err: any) {
      yield { type: 'error', id, model: modelId, provider: this.name, error: err.message, finishReason: null };
      throw this._mapError(err);
    }
  }

  protected async _embed(request: IEmbedRequest): Promise<IEmbedResponse> {
    const model = request.model ?? 'text-embedding-004';
    const inputs = Array.isArray(request.input) ? request.input : [request.input];

    try {
      const embeddings: number[][] = [];
      let totalTokens = 0;

      for (const text of inputs) {
        const result = await this.client.models.embedContent({
          model,
          contents: [{ role: 'user', parts: [{ text }] }],
        });
        embeddings.push(result.embeddings?.[0]?.values ?? []);
        totalTokens += this.getTokenCount(text);
      }

      return {
        embeddings,
        model,
        provider: this.name,
        usage: { promptTokens: totalTokens, totalTokens },
      };
    } catch (err: any) {
      throw this._mapError(err);
    }
  }

  async listModels(): Promise<IModelInfo[]> {
    return GOOGLE_MODELS;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.models.get({ model: 'gemini-2.0-flash' });
      return true;
    } catch {
      return false;
    }
  }

  private _mapError(err: any): Error {
    if (err instanceof ProviderError) return err;
    const msg: string = err.message ?? '';
    if (msg.includes('API key') || msg.includes('UNAUTHENTICATED')) return new AuthenticationError(this.name);
    if (msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED')) return new RateLimitError(this.name);
    const retryable = msg.includes('INTERNAL') || msg.includes('UNAVAILABLE');
    return new ProviderError(msg || 'Unknown Google error', this.name, 'GOOGLE_ERROR', retryable);
  }
}
