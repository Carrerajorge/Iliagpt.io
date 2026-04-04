/**
 * GoogleProvider — Gemini 2.5 Flash, Gemini 2.5 Pro, Gemini 1.5 Pro
 */

import { GoogleGenerativeAI, type GenerateContentStreamResult } from "@google/genai";
import { BaseProvider } from "../core/BaseProvider.js";
import {
  AuthenticationError,
  FinishReason,
  type IChatMessage,
  type IChatOptions,
  type IChatResponse,
  type IEmbeddingOptions,
  type IEmbeddingResponse,
  type IModelInfo,
  type IProviderConfig,
  type IStreamChunk,
  MessageRole,
  ModelCapability,
  ProviderError,
  RateLimitError,
} from "../core/types.js";

// ─────────────────────────────────────────────
// Model Catalog
// ─────────────────────────────────────────────

const GOOGLE_MODELS: IModelInfo[] = [
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    provider: "google",
    capabilities: [
      ModelCapability.CHAT,
      ModelCapability.VISION,
      ModelCapability.CODE,
      ModelCapability.REASONING,
      ModelCapability.FUNCTION_CALLING,
      ModelCapability.LONG_CONTEXT,
    ],
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    pricing: { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  },
  {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    provider: "google",
    capabilities: [
      ModelCapability.CHAT,
      ModelCapability.VISION,
      ModelCapability.CODE,
      ModelCapability.REASONING,
      ModelCapability.FUNCTION_CALLING,
      ModelCapability.LONG_CONTEXT,
    ],
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    pricing: { inputPerMillion: 1.25, outputPerMillion: 10.0 },
  },
  {
    id: "gemini-1.5-flash",
    name: "Gemini 1.5 Flash",
    provider: "google",
    capabilities: [
      ModelCapability.CHAT,
      ModelCapability.VISION,
      ModelCapability.CODE,
      ModelCapability.FUNCTION_CALLING,
      ModelCapability.LONG_CONTEXT,
    ],
    contextWindow: 1_000_000,
    maxOutputTokens: 8_192,
    pricing: { inputPerMillion: 0.075, outputPerMillion: 0.3 },
  },
  {
    id: "gemini-1.5-pro",
    name: "Gemini 1.5 Pro",
    provider: "google",
    capabilities: [
      ModelCapability.CHAT,
      ModelCapability.VISION,
      ModelCapability.CODE,
      ModelCapability.FUNCTION_CALLING,
      ModelCapability.LONG_CONTEXT,
    ],
    contextWindow: 2_000_000,
    maxOutputTokens: 8_192,
    pricing: { inputPerMillion: 1.25, outputPerMillion: 5.0 },
  },
  {
    id: "text-embedding-004",
    name: "Text Embedding 004",
    provider: "google",
    capabilities: [ModelCapability.EMBEDDING],
    contextWindow: 2_048,
    pricing: { inputPerMillion: 0.00025, outputPerMillion: 0, embeddingPerMillion: 0.00025 },
  },
];

// ─────────────────────────────────────────────
// GoogleProvider
// ─────────────────────────────────────────────

export class GoogleProvider extends BaseProvider {
  readonly id = "google";
  readonly name = "Google AI";

  private readonly client: GoogleGenerativeAI;

  constructor(config: Partial<IProviderConfig> & { apiKey: string }) {
    super({
      id: "google",
      name: "Google AI",
      defaultModel: "gemini-2.5-flash",
      timeout: 120_000,
      maxRetries: 3,
      rateLimitRpm: 60,
      ...config,
    });

    this.client = new GoogleGenerativeAI(config.apiKey);
    this._models = GOOGLE_MODELS;
  }

  isCapable(capability: ModelCapability): boolean {
    return [
      ModelCapability.CHAT,
      ModelCapability.VISION,
      ModelCapability.CODE,
      ModelCapability.REASONING,
      ModelCapability.FUNCTION_CALLING,
      ModelCapability.EMBEDDING,
      ModelCapability.LONG_CONTEXT,
    ].includes(capability);
  }

  protected async _chat(
    messages: IChatMessage[],
    options: IChatOptions,
  ): Promise<IChatResponse> {
    const start = Date.now();
    const modelId = options.model ?? this.config.defaultModel ?? "gemini-2.5-flash";

    const model = this.client.getGenerativeModel({ model: modelId });
    const { systemInstruction, history, lastUserMessage } =
      this.toGeminiMessages(messages, options.systemPrompt);

    try {
      const chat = model.startChat({
        history,
        systemInstruction,
        generationConfig: {
          temperature: options.temperature,
          maxOutputTokens: options.maxTokens,
          topP: options.topP,
          stopSequences: options.stop,
        },
      });

      const result = await chat.sendMessage(lastUserMessage);
      const response = result.response;
      const text = response.text();

      const usage = {
        promptTokens: response.usageMetadata?.promptTokenCount ?? 0,
        completionTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
        totalTokens: response.usageMetadata?.totalTokenCount ?? 0,
      };

      return {
        id: this.generateRequestId(),
        model: modelId,
        provider: this.id,
        content: text,
        finishReason: this.mapFinishReason(
          response.candidates?.[0]?.finishReason?.toString() ?? null,
        ),
        usage,
        cost: this.calculateCost(modelId, usage.promptTokens, usage.completionTokens),
        latencyMs: Date.now() - start,
        createdAt: new Date(),
      };
    } catch (err) {
      throw this.mapError(err);
    }
  }

  protected async *_stream(
    messages: IChatMessage[],
    options: IChatOptions,
  ): AsyncIterable<IStreamChunk> {
    const modelId = options.model ?? this.config.defaultModel ?? "gemini-2.5-flash";
    const model = this.client.getGenerativeModel({ model: modelId });
    const { systemInstruction, history, lastUserMessage } =
      this.toGeminiMessages(messages, options.systemPrompt);
    const requestId = this.generateRequestId();

    try {
      const chat = model.startChat({
        history,
        systemInstruction,
        generationConfig: {
          temperature: options.temperature,
          maxOutputTokens: options.maxTokens,
        },
      });

      const streamResult: GenerateContentStreamResult =
        await chat.sendMessageStream(lastUserMessage);

      for await (const chunk of streamResult.stream) {
        const text = chunk.text?.() ?? "";
        if (text) yield { id: requestId, delta: text };
      }

      const finalResponse = await streamResult.response;
      const usage = {
        promptTokens: finalResponse.usageMetadata?.promptTokenCount ?? 0,
        completionTokens: finalResponse.usageMetadata?.candidatesTokenCount ?? 0,
        totalTokens: finalResponse.usageMetadata?.totalTokenCount ?? 0,
      };

      yield {
        id: requestId,
        delta: "",
        finishReason: this.mapFinishReason(
          finalResponse.candidates?.[0]?.finishReason?.toString() ?? null,
        ),
        usage,
      };
    } catch (err) {
      throw this.mapError(err);
    }
  }

  protected async _embed(
    texts: string[],
    options: IEmbeddingOptions,
  ): Promise<IEmbeddingResponse> {
    const start = Date.now();
    const modelId = options.model ?? "text-embedding-004";
    const model = this.client.getGenerativeModel({ model: modelId });

    try {
      const results = await Promise.all(
        texts.map((text) => model.embedContent(text)),
      );

      const embeddings = results.map((r) => r.embedding.values ?? []);
      const totalTokens = texts.reduce((acc, t) => acc + this.estimateTokens(t), 0);

      return {
        id: this.generateRequestId(),
        provider: this.id,
        model: modelId,
        embeddings,
        usage: { totalTokens },
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      throw this.mapError(err);
    }
  }

  protected async _listModels(): Promise<IModelInfo[]> {
    return GOOGLE_MODELS;
  }

  // ─── Format Conversion ───

  private toGeminiMessages(
    messages: IChatMessage[],
    systemPrompt?: string,
  ): {
    systemInstruction?: string;
    history: Array<{ role: string; parts: Array<{ text: string }> }>;
    lastUserMessage: string;
  } {
    const systemParts = messages
      .filter((m) => m.role === MessageRole.SYSTEM)
      .map((m) => this.normalizeContent(m.content));
    const systemInstruction =
      [systemPrompt, ...systemParts].filter(Boolean).join("\n\n") || undefined;

    const nonSystemMessages = messages.filter((m) => m.role !== MessageRole.SYSTEM);
    if (nonSystemMessages.length === 0) {
      return { systemInstruction, history: [], lastUserMessage: "" };
    }

    const lastMsg = nonSystemMessages[nonSystemMessages.length - 1];
    const lastUserMessage = this.normalizeContent(lastMsg.content);
    const history = nonSystemMessages.slice(0, -1).map((m) => ({
      role: m.role === MessageRole.ASSISTANT ? "model" : "user",
      parts: [{ text: this.normalizeContent(m.content) }],
    }));

    return { systemInstruction, history, lastUserMessage };
  }

  private mapFinishReason(reason: string | null): FinishReason {
    switch (reason?.toUpperCase()) {
      case "STOP": return FinishReason.STOP;
      case "MAX_TOKENS": return FinishReason.LENGTH;
      case "SAFETY": return FinishReason.CONTENT_FILTER;
      default: return FinishReason.STOP;
    }
  }

  private mapError(err: unknown): ProviderError {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("API_KEY") || message.includes("401")) {
      return new AuthenticationError(this.id, err);
    }
    if (message.includes("429") || message.includes("quota")) {
      return new RateLimitError(this.id, undefined, err);
    }
    const isRetryable = message.includes("500") || message.includes("503");
    return new ProviderError(message, this.id, "GOOGLE_ERROR", undefined, isRetryable, err);
  }
}
