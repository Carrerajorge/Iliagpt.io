/**
 * PERPLEXITY PROVIDER - Search-augmented AI responses
 * Supports: Sonar, Sonar Pro with real-time web search
 */

import OpenAI from "openai";
import {
  BaseProvider,
  type ProviderCapabilities,
  type ModelInfo,
  type LLMRequestConfig,
  type LLMCompletionResponse,
  type StreamEvent,
  type ProviderConfig,
} from "./BaseProvider";

export class PerplexityProvider extends BaseProvider {
  private client: OpenAI | null = null;

  constructor(config: ProviderConfig = {}) {
    super("perplexity", "Perplexity", config);
  }

  private getClient(): OpenAI {
    if (!this.client) {
      this.client = new OpenAI({
        apiKey: this.config.apiKey || process.env.PERPLEXITY_API_KEY,
        baseURL: this.config.baseUrl || "https://api.perplexity.ai",
        maxRetries: 2, timeout: 60000,
      });
    }
    return this.client;
  }

  isConfigured(): boolean {
    return !!(this.config.apiKey || process.env.PERPLEXITY_API_KEY);
  }

  getCapabilities(): ProviderCapabilities {
    return {
      streaming: true, functionCalling: false, vision: false, jsonMode: false,
      systemMessages: true, toolUse: false, embeddings: false, imageGeneration: false,
      audioTranscription: false, audioGeneration: false, codeExecution: false,
      webSearch: true, fileUpload: false, structuredOutput: false, reasoning: true,
      multimodal: false, batchApi: false, fineTuning: false, caching: false,
      maxContextWindow: 128000, maxOutputTokens: 4096,
      supportedMediaTypes: [],
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      { id: "sonar-pro", name: "Sonar Pro", provider: this.name, description: "Advanced search-augmented reasoning with citations", contextWindow: 200000, maxOutputTokens: 8192, inputPricePerMillion: 3.00, outputPricePerMillion: 15.00, capabilities: { webSearch: true, reasoning: true }, category: "reasoning", tier: "premium", tags: ["search", "citations", "research"] },
      { id: "sonar", name: "Sonar", provider: this.name, description: "Fast search-augmented responses", contextWindow: 128000, maxOutputTokens: 4096, inputPricePerMillion: 1.00, outputPricePerMillion: 1.00, capabilities: { webSearch: true }, category: "chat", tier: "standard", tags: ["search", "fast"] },
      { id: "sonar-reasoning-pro", name: "Sonar Reasoning Pro", provider: this.name, description: "Deep reasoning with web search", contextWindow: 128000, maxOutputTokens: 8192, inputPricePerMillion: 2.00, outputPricePerMillion: 8.00, capabilities: { webSearch: true, reasoning: true }, category: "reasoning", tier: "premium", tags: ["reasoning", "search", "deep-analysis"] },
    ];
  }

  async complete(config: LLMRequestConfig): Promise<LLMCompletionResponse> {
    const start = Date.now();
    const requestId = this.generateRequestId();
    const client = this.getClient();
    try {
      const response = await client.chat.completions.create({
        model: config.model,
        messages: this.convertToOpenAIFormat(config.messages) as any,
        ...(config.temperature !== undefined && { temperature: config.temperature }),
        ...(config.maxTokens && { max_tokens: config.maxTokens }),
      });
      const latencyMs = Date.now() - start;
      this.recordRequest(latencyMs, true);
      const choice = response.choices[0];
      const citations = (response as any).citations;
      return {
        id: requestId, content: choice?.message?.content || "", model: config.model, provider: this.name,
        finishReason: "stop",
        usage: { promptTokens: response.usage?.prompt_tokens || 0, completionTokens: response.usage?.completion_tokens || 0, totalTokens: response.usage?.total_tokens || 0 },
        latencyMs, cached: false,
        metadata: citations ? { citations } : undefined,
      };
    } catch (error: any) {
      this.recordRequest(Date.now() - start, false);
      throw error;
    }
  }

  async *stream(config: LLMRequestConfig): AsyncGenerator<StreamEvent> {
    const start = Date.now();
    const client = this.getClient();
    let seq = 0;
    try {
      const stream = await client.chat.completions.create({
        model: config.model, messages: this.convertToOpenAIFormat(config.messages) as any, stream: true,
        ...(config.temperature !== undefined && { temperature: config.temperature }),
        ...(config.maxTokens && { max_tokens: config.maxTokens }),
      }) as any;
      let total = "";
      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta;
        if (delta?.content) { total += delta.content; yield { type: "token", content: delta.content, sequenceId: seq++, timestamp: Date.now() }; }
        if (chunk.choices?.[0]?.finish_reason) yield { type: "done", content: total, sequenceId: seq++, timestamp: Date.now() };
      }
      this.recordRequest(Date.now() - start, true);
    } catch (error: any) {
      this.recordRequest(Date.now() - start, false);
      yield { type: "error", error: error.message, sequenceId: seq++, timestamp: Date.now() };
    }
  }
}
