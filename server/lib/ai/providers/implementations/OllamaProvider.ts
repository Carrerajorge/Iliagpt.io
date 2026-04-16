/**
 * OllamaProvider — Local models via Ollama (runs on localhost)
 * Supports any model available in Ollama's library
 */

import { BaseProvider } from "../core/BaseProvider.js";
import {
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
} from "../core/types.js";

interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
  details: { parameter_size?: string; family?: string };
}

interface OllamaChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  images?: string[];
}

interface OllamaGenerateResponse {
  model: string;
  created_at: string;
  message: { role: string; content: string };
  done: boolean;
  done_reason?: string;
  eval_count?: number;
  prompt_eval_count?: number;
  total_duration?: number;
}

export class OllamaProvider extends BaseProvider {
  readonly id = "ollama";
  readonly name = "Ollama (Local)";
  private readonly baseUrl: string;
  private modelsCachedAt = 0;

  constructor(config: Partial<IProviderConfig> = {}) {
    super({
      id: "ollama",
      name: "Ollama (Local)",
      defaultModel: "llama3.2",
      baseUrl: "http://localhost:11434",
      timeout: 300_000,  // Local models can be slow on first load
      maxRetries: 1,
      ...config,
    });

    this.baseUrl = this.config.baseUrl ?? "http://localhost:11434";
  }

  isCapable(capability: ModelCapability): boolean {
    return [
      ModelCapability.CHAT,
      ModelCapability.CODE,
      ModelCapability.EMBEDDING,
    ].includes(capability);
  }

  protected async _chat(messages: IChatMessage[], options: IChatOptions): Promise<IChatResponse> {
    const start = Date.now();
    const model = options.model ?? this.config.defaultModel ?? "llama3.2";

    const ollamaMessages = this.formatMessages(messages, options.systemPrompt);

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: ollamaMessages,
          stream: false,
          options: {
            temperature: options.temperature,
            num_predict: options.maxTokens,
            top_p: options.topP,
            stop: options.stop,
          },
        }),
        signal: AbortSignal.timeout(this.config.timeout ?? 300_000),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new ProviderError(
          `Ollama HTTP ${response.status}: ${text}`,
          this.id,
          `OLLAMA_${response.status}`,
          response.status,
          response.status >= 500,
        );
      }

      const data = await response.json() as OllamaGenerateResponse;
      const usage = {
        promptTokens: data.prompt_eval_count ?? 0,
        completionTokens: data.eval_count ?? 0,
        totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
      };

      return {
        id: this.generateRequestId(),
        model: data.model,
        provider: this.id,
        content: data.message.content,
        finishReason: data.done_reason === "stop" ? FinishReason.STOP : FinishReason.LENGTH,
        usage,
        cost: 0, // Local — no cost
        latencyMs: data.total_duration ? data.total_duration / 1_000_000 : Date.now() - start,
        createdAt: new Date(data.created_at),
      };
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      const isConnectionRefused =
        err instanceof Error && (err.message.includes("ECONNREFUSED") || err.message.includes("fetch failed"));
      throw new ProviderError(
        isConnectionRefused
          ? "Ollama is not running. Start it with: ollama serve"
          : String(err),
        this.id,
        isConnectionRefused ? "OLLAMA_NOT_RUNNING" : "UNKNOWN",
        undefined,
        false,
        err,
      );
    }
  }

  protected async *_stream(messages: IChatMessage[], options: IChatOptions): AsyncIterable<IStreamChunk> {
    const model = options.model ?? this.config.defaultModel ?? "llama3.2";
    const ollamaMessages = this.formatMessages(messages, options.systemPrompt);
    const requestId = this.generateRequestId();

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: ollamaMessages,
          stream: true,
          options: {
            temperature: options.temperature,
            num_predict: options.maxTokens,
          },
        }),
        signal: AbortSignal.timeout(this.config.timeout ?? 300_000),
      });

      if (!response.ok || !response.body) {
        throw new ProviderError(`Ollama stream failed: HTTP ${response.status}`, this.id, `OLLAMA_${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const lines = decoder.decode(value, { stream: true }).split("\n").filter(Boolean);
        for (const line of lines) {
          try {
            const event = JSON.parse(line) as OllamaGenerateResponse;
            yield {
              id: requestId,
              delta: event.message?.content ?? "",
              finishReason: event.done ? FinishReason.STOP : undefined,
              usage: event.done
                ? {
                    promptTokens: event.prompt_eval_count ?? 0,
                    completionTokens: event.eval_count ?? 0,
                    totalTokens: (event.prompt_eval_count ?? 0) + (event.eval_count ?? 0),
                  }
                : undefined,
            };
          } catch {
            // Skip malformed JSON
          }
        }
      }
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(String(err), this.id, "UNKNOWN", undefined, true, err);
    }
  }

  protected async _embed(texts: string[], options: IEmbeddingOptions): Promise<IEmbeddingResponse> {
    const start = Date.now();
    const model = options.model ?? "nomic-embed-text";

    try {
      const embeddings: number[][] = [];
      for (const text of texts) {
        const response = await fetch(`${this.baseUrl}/api/embeddings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, prompt: text }),
          signal: AbortSignal.timeout(30_000),
        });

        if (!response.ok) throw new ProviderError(`Ollama embed HTTP ${response.status}`, this.id, "EMBED_ERROR");
        const data = await response.json() as { embedding: number[] };
        embeddings.push(data.embedding);
      }

      return {
        id: this.generateRequestId(),
        provider: this.id,
        model,
        embeddings,
        usage: { totalTokens: 0 },
        cost: 0,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(String(err), this.id, "UNKNOWN", undefined, true, err);
    }
  }

  protected async _listModels(): Promise<IModelInfo[]> {
    const now = Date.now();
    if (this._models.length > 0 && now - this.modelsCachedAt < 30_000) {
      return this._models;
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5_000),
      });

      if (!response.ok) return [];
      const data = await response.json() as { models: OllamaModel[] };

      this._models = data.models.map((m): IModelInfo => ({
        id: m.name,
        name: m.name,
        provider: this.id,
        capabilities: this.inferCapabilities(m),
        contextWindow: 8_192, // Ollama doesn't expose this in tags API
        pricing: { inputPerMillion: 0, outputPerMillion: 0 },
        description: m.details?.parameter_size ? `${m.details.parameter_size} parameters` : undefined,
      }));

      this.modelsCachedAt = now;
      return this._models;
    } catch {
      return [];
    }
  }

  private inferCapabilities(model: OllamaModel): ModelCapability[] {
    const caps: ModelCapability[] = [ModelCapability.CHAT];
    const name = model.name.toLowerCase();

    if (name.includes("code") || name.includes("coder") || name.includes("starcoder")) {
      caps.push(ModelCapability.CODE);
    }
    if (name.includes("embed") || name.includes("nomic")) {
      caps.push(ModelCapability.EMBEDDING);
    }
    if (name.includes("vision") || name.includes("llava") || name.includes("bakllava")) {
      caps.push(ModelCapability.VISION);
    }

    return caps;
  }

  private formatMessages(messages: IChatMessage[], systemPrompt?: string): OllamaChatMessage[] {
    const result: OllamaChatMessage[] = [];
    if (systemPrompt) result.push({ role: "system", content: systemPrompt });
    for (const m of messages) {
      if (m.role === MessageRole.SYSTEM) result.push({ role: "system", content: this.normalizeContent(m.content) });
      else if (m.role === MessageRole.USER) result.push({ role: "user", content: this.normalizeContent(m.content) });
      else if (m.role === MessageRole.ASSISTANT) result.push({ role: "assistant", content: this.normalizeContent(m.content) });
    }
    return result;
  }
}
