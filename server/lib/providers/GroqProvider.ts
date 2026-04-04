/**
 * GROQ PROVIDER - Ultra-fast inference via Groq LPU
 * Supports: Llama 3.x, Mixtral, Gemma via Groq hardware acceleration
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

export class GroqProvider extends BaseProvider {
  private client: OpenAI | null = null;

  constructor(config: ProviderConfig = {}) {
    super("groq", "Groq", config);
  }

  private getClient(): OpenAI {
    if (!this.client) {
      this.client = new OpenAI({
        apiKey: this.config.apiKey || process.env.GROQ_API_KEY,
        baseURL: this.config.baseUrl || "https://api.groq.com/openai/v1",
        maxRetries: 2,
        timeout: 30000,
      });
    }
    return this.client;
  }

  isConfigured(): boolean {
    return !!(this.config.apiKey || process.env.GROQ_API_KEY);
  }

  getCapabilities(): ProviderCapabilities {
    return {
      streaming: true, functionCalling: true, vision: true, jsonMode: true,
      systemMessages: true, toolUse: true, embeddings: false, imageGeneration: false,
      audioTranscription: true, audioGeneration: false, codeExecution: false,
      webSearch: false, fileUpload: false, structuredOutput: true, reasoning: false,
      multimodal: true, batchApi: false, fineTuning: false, caching: false,
      maxContextWindow: 131072, maxOutputTokens: 32768,
      supportedMediaTypes: ["image/png", "image/jpeg", "audio/mp3", "audio/wav"],
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B", provider: this.name, description: "High-quality open model on Groq LPU", contextWindow: 131072, maxOutputTokens: 32768, inputPricePerMillion: 0.59, outputPricePerMillion: 0.79, capabilities: { functionCalling: true }, category: "chat", tier: "standard", tags: ["fast", "open-source"] },
      { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B", provider: this.name, description: "Ultra-fast inference", contextWindow: 131072, maxOutputTokens: 8192, inputPricePerMillion: 0.05, outputPricePerMillion: 0.08, capabilities: {}, category: "chat", tier: "free", tags: ["ultra-fast", "affordable"] },
      { id: "mixtral-8x7b-32768", name: "Mixtral 8x7B", provider: this.name, description: "Mixture of experts model", contextWindow: 32768, maxOutputTokens: 8192, inputPricePerMillion: 0.24, outputPricePerMillion: 0.24, capabilities: { functionCalling: true }, category: "chat", tier: "standard", tags: ["efficient", "moe"] },
      { id: "llama-3.2-90b-vision-preview", name: "Llama 3.2 90B Vision", provider: this.name, description: "Multimodal vision model", contextWindow: 8192, maxOutputTokens: 8192, inputPricePerMillion: 0.90, outputPricePerMillion: 0.90, capabilities: { vision: true, multimodal: true }, category: "vision", tier: "premium", tags: ["vision", "multimodal"] },
    ];
  }

  async complete(config: LLMRequestConfig): Promise<LLMCompletionResponse> {
    const start = Date.now();
    const requestId = this.generateRequestId();
    const client = this.getClient();
    try {
      const params: any = { model: config.model, messages: this.convertToOpenAIFormat(config.messages) };
      if (config.temperature !== undefined) params.temperature = config.temperature;
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
