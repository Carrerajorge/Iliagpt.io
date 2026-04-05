/**
 * CohereProvider — Command R+, Command R, Embed v3
 * Uses Cohere's native REST API
 */

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

const COHERE_MODELS: IModelInfo[] = [
  {
    id: "command-r-plus-08-2024",
    name: "Command R+ (2024)",
    provider: "cohere",
    capabilities: [ModelCapability.CHAT, ModelCapability.CODE, ModelCapability.FUNCTION_CALLING, ModelCapability.SEARCH],
    contextWindow: 128_000,
    maxOutputTokens: 4_096,
    pricing: { inputPerMillion: 2.5, outputPerMillion: 10.0 },
  },
  {
    id: "command-r-08-2024",
    name: "Command R (2024)",
    provider: "cohere",
    capabilities: [ModelCapability.CHAT, ModelCapability.CODE, ModelCapability.SEARCH],
    contextWindow: 128_000,
    maxOutputTokens: 4_096,
    pricing: { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  },
  {
    id: "command-light",
    name: "Command Light",
    provider: "cohere",
    capabilities: [ModelCapability.CHAT],
    contextWindow: 4_096,
    pricing: { inputPerMillion: 0.3, outputPerMillion: 0.6 },
  },
  {
    id: "embed-english-v3.0",
    name: "Embed English v3",
    provider: "cohere",
    capabilities: [ModelCapability.EMBEDDING],
    contextWindow: 512,
    pricing: { inputPerMillion: 0.1, outputPerMillion: 0, embeddingPerMillion: 0.1 },
  },
  {
    id: "embed-multilingual-v3.0",
    name: "Embed Multilingual v3",
    provider: "cohere",
    capabilities: [ModelCapability.EMBEDDING],
    contextWindow: 512,
    pricing: { inputPerMillion: 0.1, outputPerMillion: 0, embeddingPerMillion: 0.1 },
  },
];

interface CohereChatMessage {
  role: "USER" | "CHATBOT" | "SYSTEM";
  message: string;
}

export class CohereProvider extends BaseProvider {
  readonly id = "cohere";
  readonly name = "Cohere";
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: Partial<IProviderConfig> & { apiKey: string }) {
    super({
      id: "cohere",
      name: "Cohere",
      defaultModel: "command-r-plus-08-2024",
      timeout: 60_000,
      maxRetries: 3,
      rateLimitRpm: 60,
      ...config,
    });

    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? "https://api.cohere.ai/v1";
    this._models = COHERE_MODELS;
  }

  isCapable(capability: ModelCapability): boolean {
    return [
      ModelCapability.CHAT,
      ModelCapability.CODE,
      ModelCapability.EMBEDDING,
      ModelCapability.FUNCTION_CALLING,
      ModelCapability.SEARCH,
    ].includes(capability);
  }

  protected async _chat(messages: IChatMessage[], options: IChatOptions): Promise<IChatResponse> {
    const start = Date.now();
    const model = options.model ?? this.config.defaultModel ?? "command-r-plus-08-2024";

    const { preamble, chatHistory, message } = this.formatMessages(messages, options.systemPrompt);

    try {
      const response = await this.request("/chat", {
        model,
        preamble,
        chat_history: chatHistory,
        message,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        p: options.topP,
        stream: false,
      });

      const usage = {
        promptTokens: response.meta?.tokens?.input_tokens ?? this.estimateTokens(message),
        completionTokens: response.meta?.tokens?.output_tokens ?? this.estimateTokens(response.text),
        totalTokens: 0,
      };
      usage.totalTokens = usage.promptTokens + usage.completionTokens;

      return {
        id: response.generation_id ?? this.generateRequestId(),
        model,
        provider: this.id,
        content: response.text ?? "",
        finishReason: response.finish_reason === "COMPLETE" ? FinishReason.STOP : FinishReason.LENGTH,
        usage,
        cost: this.calculateCost(model, usage.promptTokens, usage.completionTokens),
        latencyMs: Date.now() - start,
        createdAt: new Date(),
      };
    } catch (err) {
      throw this.mapError(err);
    }
  }

  protected async *_stream(messages: IChatMessage[], options: IChatOptions): AsyncIterable<IStreamChunk> {
    const model = options.model ?? this.config.defaultModel ?? "command-r-plus-08-2024";
    const { preamble, chatHistory, message } = this.formatMessages(messages, options.systemPrompt);
    const requestId = this.generateRequestId();

    try {
      const response = await fetch(`${this.baseUrl}/chat`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          model, preamble, chat_history: chatHistory, message,
          temperature: options.temperature, max_tokens: options.maxTokens,
          stream: true,
        }),
        signal: AbortSignal.timeout(this.config.timeout ?? 60_000),
      });

      if (!response.ok) await this.handleHttpError(response);
      if (!response.body) throw new ProviderError("No stream body", this.id, "NO_BODY");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const lines = decoder.decode(value, { stream: true }).split("\n").filter(Boolean);
        for (const line of lines) {
          try {
            const event = JSON.parse(line) as { event_type: string; text?: string; finish_reason?: string };
            if (event.event_type === "text-generation" && event.text) {
              yield { id: requestId, delta: event.text };
            } else if (event.event_type === "stream-end") {
              yield {
                id: requestId,
                delta: "",
                finishReason: event.finish_reason === "COMPLETE" ? FinishReason.STOP : FinishReason.LENGTH,
              };
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      }
    } catch (err) {
      throw this.mapError(err);
    }
  }

  protected async _embed(texts: string[], options: IEmbeddingOptions): Promise<IEmbeddingResponse> {
    const start = Date.now();
    const model = options.model ?? "embed-english-v3.0";

    try {
      const response = await this.request("/embed", {
        model,
        texts,
        input_type: "search_document",
        embedding_types: ["float"],
      });

      return {
        id: response.id ?? this.generateRequestId(),
        provider: this.id,
        model,
        embeddings: response.embeddings?.float ?? [],
        usage: { totalTokens: response.meta?.billed_units?.input_tokens ?? 0 },
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      throw this.mapError(err);
    }
  }

  protected async _listModels(): Promise<IModelInfo[]> {
    return COHERE_MODELS;
  }

  private formatMessages(
    messages: IChatMessage[],
    systemPrompt?: string,
  ): { preamble: string | undefined; chatHistory: CohereChatMessage[]; message: string } {
    const systemParts = messages
      .filter((m) => m.role === MessageRole.SYSTEM)
      .map((m) => this.normalizeContent(m.content));
    const preamble = [systemPrompt, ...systemParts].filter(Boolean).join("\n\n") || undefined;

    const nonSystem = messages.filter((m) => m.role !== MessageRole.SYSTEM);
    const lastMsg = nonSystem[nonSystem.length - 1];
    const message = this.normalizeContent(lastMsg?.content ?? "");

    const chatHistory: CohereChatMessage[] = nonSystem.slice(0, -1).map((m) => ({
      role: m.role === MessageRole.ASSISTANT ? "CHATBOT" : "USER",
      message: this.normalizeContent(m.content),
    }));

    return { preamble, chatHistory, message };
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      "Request-Source": "iliagpt",
    };
  }

  private async request(path: string, body: unknown): Promise<Record<string, unknown>> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeout ?? 60_000),
    });

    if (!response.ok) await this.handleHttpError(response);
    return response.json() as Promise<Record<string, unknown>>;
  }

  private async handleHttpError(response: Response): Promise<never> {
    const body = await response.text().catch(() => "");
    if (response.status === 401) throw new AuthenticationError(this.id);
    if (response.status === 429) throw new RateLimitError(this.id);
    throw new ProviderError(
      `HTTP ${response.status}: ${body}`,
      this.id,
      `COHERE_${response.status}`,
      response.status,
      response.status >= 500,
    );
  }

  private mapError(err: unknown): ProviderError {
    if (err instanceof ProviderError) return err;
    return new ProviderError(String(err), this.id, "UNKNOWN", undefined, true, err);
  }
}
