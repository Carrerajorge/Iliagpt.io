/**
 * MISTRAL AI PROVIDER - Mistral models integration
 *
 * Supports: Mistral Large, Mistral Medium, Mistral Small, Codestral,
 * Pixtral (vision), and embedding models.
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

export class MistralProvider extends BaseProvider {
  private client: OpenAI | null = null;

  constructor(config: ProviderConfig = {}) {
    super("mistral", "Mistral AI", config);
  }

  private getClient(): OpenAI {
    if (!this.client) {
      this.client = new OpenAI({
        apiKey: this.config.apiKey || process.env.MISTRAL_API_KEY,
        baseURL: this.config.baseUrl || "https://api.mistral.ai/v1",
        maxRetries: this.config.maxRetries ?? 2,
        timeout: this.config.timeout ?? 60000,
      });
    }
    return this.client;
  }

  isConfigured(): boolean {
    return !!(this.config.apiKey || process.env.MISTRAL_API_KEY);
  }

  getCapabilities(): ProviderCapabilities {
    return {
      streaming: true, functionCalling: true, vision: true, jsonMode: true,
      systemMessages: true, toolUse: true, embeddings: true, imageGeneration: false,
      audioTranscription: false, audioGeneration: false, codeExecution: true,
      webSearch: false, fileUpload: false, structuredOutput: true, reasoning: false,
      multimodal: true, batchApi: true, fineTuning: true, caching: false,
      maxContextWindow: 128000, maxOutputTokens: 8192,
      supportedMediaTypes: ["image/png", "image/jpeg", "image/gif", "image/webp"],
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      { id: "mistral-large-latest", name: "Mistral Large", provider: this.name, description: "Most capable Mistral model", contextWindow: 128000, maxOutputTokens: 8192, inputPricePerMillion: 2.00, outputPricePerMillion: 6.00, capabilities: { functionCalling: true, vision: true }, category: "chat", tier: "premium", tags: ["powerful", "multilingual"] },
      { id: "mistral-medium-latest", name: "Mistral Medium", provider: this.name, description: "Balanced performance", contextWindow: 32000, maxOutputTokens: 8192, inputPricePerMillion: 2.70, outputPricePerMillion: 8.10, capabilities: { functionCalling: true }, category: "chat", tier: "standard" },
      { id: "mistral-small-latest", name: "Mistral Small", provider: this.name, description: "Fast and efficient", contextWindow: 32000, maxOutputTokens: 8192, inputPricePerMillion: 0.20, outputPricePerMillion: 0.60, capabilities: { functionCalling: true }, category: "chat", tier: "free", tags: ["fast", "efficient"] },
      { id: "codestral-latest", name: "Codestral", provider: this.name, description: "Specialized for code generation", contextWindow: 32000, maxOutputTokens: 8192, inputPricePerMillion: 0.30, outputPricePerMillion: 0.90, capabilities: { codeExecution: true }, category: "code", tier: "standard", tags: ["code", "programming"] },
      { id: "pixtral-large-latest", name: "Pixtral Large", provider: this.name, description: "Multimodal vision model", contextWindow: 128000, maxOutputTokens: 8192, inputPricePerMillion: 2.00, outputPricePerMillion: 6.00, capabilities: { vision: true, multimodal: true }, category: "vision", tier: "premium", tags: ["vision", "multimodal"] },
    ];
  }

  async complete(config: LLMRequestConfig): Promise<LLMCompletionResponse> {
    const start = Date.now();
    const requestId = this.generateRequestId();
    const client = this.getClient();
    try {
      const params: any = { model: config.model, messages: this.convertToOpenAIFormat(config.messages) };
      if (config.temperature !== undefined) params.temperature = config.temperature;
      if (config.topP !== undefined) params.top_p = config.topP;
      if (config.maxTokens) params.max_tokens = config.maxTokens;
      if (config.tools?.length) params.tools = config.tools;
      if (config.responseFormat) params.response_format = config.responseFormat;
      const response = await client.chat.completions.create(params);
      const latencyMs = Date.now() - start;
      this.recordRequest(latencyMs, true);
      const choice = response.choices[0];
      return {
        id: requestId, content: choice?.message?.content || "", model: config.model, provider: this.name,
        finishReason: (choice?.finish_reason as any) || "stop",
        usage: { promptTokens: response.usage?.prompt_tokens || 0, completionTokens: response.usage?.completion_tokens || 0, totalTokens: response.usage?.total_tokens || 0 },
        toolCalls: choice?.message?.tool_calls?.map((tc) => ({ id: tc.id, type: "function" as const, function: { name: tc.function.name, arguments: tc.function.arguments } })),
        latencyMs, cached: false,
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
      const params: any = { model: config.model, messages: this.convertToOpenAIFormat(config.messages), stream: true };
      if (config.temperature !== undefined) params.temperature = config.temperature;
      if (config.maxTokens) params.max_tokens = config.maxTokens;
      const stream = await client.chat.completions.create(params) as any;
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

  async embed(input: string | string[], model?: string): Promise<number[][]> {
    const client = this.getClient();
    const response = await (client.embeddings as any).create({
      model: model || "mistral-embed",
      input: Array.isArray(input) ? input : [input],
    });
    return response.data.map((d: any) => d.embedding);
  }
}
