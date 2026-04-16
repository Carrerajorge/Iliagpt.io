/**
 * Google Gemini Provider
 *
 * Uses the `@google/genai` SDK (v1+).  Google's API differs from OpenAI's in:
 *
 *  1. Roles are 'user' / 'model' (not 'assistant').
 *  2. Messages use a `parts` array of typed content blocks.
 *  3. System instruction is a top-level GenerateContentRequest field.
 *  4. Function declarations use a different schema wrapper.
 *  5. Streaming iterates over GenerateContentChunk events.
 *  6. Embeddings are available via models.embedContent (single string)
 *     or models.batchEmbedContents.
 *  7. Safety settings can block responses — mapped to 'content_filter'.
 *
 * Supported capabilities: CHAT, STREAMING, FUNCTION_CALLING, JSON_MODE,
 *                          VISION, EMBEDDING, CODE, AUDIO_INPUT
 */

import { GoogleGenAI } from '@google/genai';
import type { Content, Part, Tool, FunctionDeclaration } from '@google/genai';
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

// ─── Default config ──────────────────────────────────────────────────────────

export function googleDefaultConfig(apiKey?: string): IProviderConfig {
  return {
    name        : 'google',
    displayName : 'Google Gemini',
    apiKey      : apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY,
    defaultModel: 'gemini-2.5-flash',
    timeoutMs   : 120_000,
    retry: {
      maxRetries       : 3,
      baseDelayMs      : 500,
      backoffFactor    : 2,
      maxDelayMs       : 16_000,
      retryableStatuses: [429, 500, 503],
    },
    rateLimit: {
      requestsPerMinute: 60,
      tokensPerMinute  : 1_000_000,
      maxConcurrent    : 20,
    },
    fallbackChain: ['openai', 'anthropic'],
    extra: {
      capabilities:
        ModelCapability.CHAT | ModelCapability.STREAMING |
        ModelCapability.FUNCTION_CALLING | ModelCapability.JSON_MODE |
        ModelCapability.VISION | ModelCapability.EMBEDDING |
        ModelCapability.CODE | ModelCapability.AUDIO_INPUT,
    },
  };
}

// ─── Static model catalogue ──────────────────────────────────────────────────

const GOOGLE_MODELS: IModelInfo[] = [
  {
    id: 'gemini-2.5-pro', provider: 'google', displayName: 'Gemini 2.5 Pro',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.FUNCTION_CALLING | ModelCapability.JSON_MODE | ModelCapability.VISION | ModelCapability.CODE | ModelCapability.REASONING,
    contextWindow: 2_000_000, maxOutputTokens: 65_536,
    pricing: { inputPer1M: 1.25, outputPer1M: 5.0 },
    latencyScore: 30, reliabilityScore: 0.98, available: true,
    tags: ['flagship', 'long-context', 'reasoning'],
  },
  {
    id: 'gemini-2.5-flash', provider: 'google', displayName: 'Gemini 2.5 Flash',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.FUNCTION_CALLING | ModelCapability.JSON_MODE | ModelCapability.VISION | ModelCapability.CODE,
    contextWindow: 1_000_000, maxOutputTokens: 8_192,
    pricing: { inputPer1M: 0.075, outputPer1M: 0.30 },
    latencyScore: 10, reliabilityScore: 0.98, available: true,
    tags: ['fast', 'cheap', 'long-context'],
  },
  {
    id: 'gemini-1.5-pro', provider: 'google', displayName: 'Gemini 1.5 Pro',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.FUNCTION_CALLING | ModelCapability.JSON_MODE | ModelCapability.VISION | ModelCapability.CODE | ModelCapability.AUDIO_INPUT,
    contextWindow: 2_000_000, maxOutputTokens: 8_192,
    pricing: { inputPer1M: 1.25, outputPer1M: 5.0 },
    latencyScore: 35, reliabilityScore: 0.97, available: true,
    tags: ['multimodal', 'long-context'],
  },
  {
    id: 'text-embedding-004', provider: 'google', displayName: 'text-embedding-004',
    capabilities: ModelCapability.EMBEDDING,
    contextWindow: 2_048,
    pricing: { inputPer1M: 0.00, outputPer1M: 0.00, embedPer1M: 0.00 }, // free tier
    latencyScore: 5, reliabilityScore: 0.99, available: true,
    tags: ['embedding', '768-dim'],
  },
];

// ─── Provider implementation ──────────────────────────────────────────────────

export class GoogleProvider extends BaseProvider {
  private readonly _genai: GoogleGenAI;

  constructor(config: Partial<IProviderConfig> = {}) {
    const defaults = googleDefaultConfig(config.apiKey);
    super({ ...defaults, ...config });

    this._genai = new GoogleGenAI({ apiKey: this.config.apiKey! });
    this.status = ProviderStatus.ACTIVE;
  }

  // ─── Message format mapping ─────────────────────────────────────────────────

  private toGoogleContents(messages: IChatMessage[]): {
    systemInstruction: string | undefined;
    contents         : Content[];
  } {
    let systemInstruction: string | undefined;
    const contents: Content[] = [];

    for (const m of messages) {
      if (m.role === 'system') {
        systemInstruction = typeof m.content === 'string'
          ? m.content
          : (m.content as IContentPart[]).filter(p => p.type === 'text').map(p => (p as any).text).join('\n');
        continue;
      }

      // Google uses 'user' / 'model' roles.
      const googleRole = m.role === 'assistant' ? 'model' : 'user';

      const parts: Part[] = [];

      if (typeof m.content === 'string') {
        if (m.content) parts.push({ text: m.content });
      } else {
        for (const part of m.content as IContentPart[]) {
          if (part.type === 'text') {
            parts.push({ text: part.text });
          } else if (part.type === 'image_url') {
            // Inline base64 or URL.
            const url = part.image_url.url;
            if (url.startsWith('data:')) {
              const [header, data] = url.split(',');
              const mimeType = header.replace('data:', '').replace(';base64', '') as any;
              parts.push({ inlineData: { mimeType, data } });
            } else {
              parts.push({ fileData: { mimeType: 'image/jpeg', fileUri: url } } as any);
            }
          }
        }
      }

      // Tool results for function-calling round-trips.
      if (m.role === 'tool' && m.toolCallId) {
        let resultVal: any;
        try { resultVal = JSON.parse(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)); }
        catch { resultVal = { result: m.content }; }

        parts.push({
          functionResponse: {
            name    : m.name ?? m.toolCallId,
            response: resultVal,
          },
        } as any);
      }

      // Tool calls from the model.
      if (m.toolCalls?.length) {
        for (const tc of m.toolCalls) {
          let args: any;
          try { args = JSON.parse(tc.function.arguments || '{}'); }
          catch { args = {}; }
          parts.push({ functionCall: { name: tc.function.name, args } } as any);
        }
      }

      if (parts.length) contents.push({ role: googleRole, parts });
    }

    return { systemInstruction, contents };
  }

  private toGoogleTools(tools: IChatOptions['tools']): Tool[] | undefined {
    if (!tools?.length) return undefined;
    const declarations: FunctionDeclaration[] = tools.map(t => ({
      name       : t.function.name,
      description: t.function.description,
      parameters : t.function.parameters as any,
    }));
    return [{ functionDeclarations: declarations }];
  }

  private parseUsage(raw: any): ITokenUsage {
    return {
      promptTokens    : raw?.promptTokenCount    ?? 0,
      completionTokens: raw?.candidatesTokenCount ?? 0,
      totalTokens     : raw?.totalTokenCount      ?? 0,
    };
  }

  // ─── _chat ──────────────────────────────────────────────────────────────────

  protected async _chat(messages: IChatMessage[], options: IChatOptions): Promise<IChatResponse> {
    const requestId = options.requestId ?? this._newRequestId();
    const start     = Date.now();

    try {
      const { systemInstruction, contents } = this.toGoogleContents(messages);
      const model = this._genai.models;

      const generationConfig: any = {};
      if (options.temperature  !== undefined) generationConfig.temperature   = options.temperature;
      if (options.topP         !== undefined) generationConfig.topP          = options.topP;
      if (options.maxTokens    !== undefined) generationConfig.maxOutputTokens = options.maxTokens;
      if (options.stop)                       generationConfig.stopSequences = Array.isArray(options.stop) ? options.stop : [options.stop];
      if (options.jsonMode)                   generationConfig.responseMimeType = 'application/json';

      const response = await model.generateContent({
        model            : options.model ?? this.config.defaultModel,
        contents,
        systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
        generationConfig,
        tools            : this.toGoogleTools(options.tools),
      });

      const candidate = response.candidates?.[0];
      const content   = candidate?.content?.parts?.map((p: any) => p.text ?? '').join('') ?? '';

      // Extract function calls if present.
      const toolCalls: IChatResponse['toolCalls'] = [];
      for (const part of candidate?.content?.parts ?? []) {
        if ((part as any).functionCall) {
          const fc = (part as any).functionCall;
          toolCalls.push({
            id      : `call_${Date.now()}`,
            type    : 'function',
            function: { name: fc.name, arguments: JSON.stringify(fc.args ?? {}) },
          });
        }
      }

      const finishReasonMap: Record<string, IChatResponse['finishReason']> = {
        STOP          : 'stop',
        MAX_TOKENS    : 'length',
        SAFETY        : 'content_filter',
        RECITATION    : 'content_filter',
        OTHER         : 'unknown',
        FUNCTION_CALL : 'tool_calls',
      };

      return {
        content,
        model       : options.model ?? this.config.defaultModel,
        provider    : this.name,
        usage       : this.parseUsage(response.usageMetadata),
        finishReason: finishReasonMap[candidate?.finishReason ?? ''] ?? 'unknown',
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
    let   finishReason: IChatResponse['finishReason'] = 'unknown';
    let   finalUsage  : ITokenUsage | undefined;
    const model       = options.model ?? this.config.defaultModel;

    try {
      const { systemInstruction, contents } = this.toGoogleContents(messages);

      const generationConfig: any = {};
      if (options.temperature !== undefined) generationConfig.temperature     = options.temperature;
      if (options.topP        !== undefined) generationConfig.topP            = options.topP;
      if (options.maxTokens   !== undefined) generationConfig.maxOutputTokens = options.maxTokens;
      if (options.jsonMode)                  generationConfig.responseMimeType = 'application/json';

      const streamResult = await this._genai.models.generateContentStream({
        model,
        contents,
        systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
        generationConfig,
      });

      for await (const chunk of streamResult) {
        const token = chunk.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

        if (chunk.usageMetadata) {
          finalUsage = this.parseUsage(chunk.usageMetadata);
        }

        const fr = chunk.candidates?.[0]?.finishReason;
        if (fr) {
          finishReason = ({ STOP: 'stop', MAX_TOKENS: 'length', SAFETY: 'content_filter' } as any)[fr] ?? 'unknown';
        }

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
    const model     = options.model ?? 'text-embedding-004';

    try {
      const embeddings: number[][] = [];
      let totalPromptTokens = 0;

      // Google's batch API batches up to 100 at a time.
      const BATCH_SIZE = 100;
      for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batch = texts.slice(i, i + BATCH_SIZE);

        const response = await this._genai.models.batchEmbedContents({
          model,
          requests: batch.map(text => ({ content: { parts: [{ text }] } })),
        } as any);

        for (const emb of (response as any).embeddings ?? []) {
          embeddings.push(emb.values ?? []);
          totalPromptTokens += Math.ceil((emb as any).statisticsMetadata?.tokenCount ?? 0);
        }
      }

      return {
        embeddings,
        model,
        provider : this.name,
        usage    : { promptTokens: totalPromptTokens, totalTokens: totalPromptTokens },
        latencyMs: Date.now() - start,
        requestId,
      };
    } catch (err) {
      throw classifyProviderError(err, this.name, requestId);
    }
  }

  protected async _listModels(): Promise<IModelInfo[]> {
    return GOOGLE_MODELS;
  }

  protected async _healthProbe(): Promise<void> {
    await this._genai.models.generateContent({
      model   : 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
      generationConfig: { maxOutputTokens: 1 },
    });
  }
}
