/**
 * DEEPSEEK PROVIDER - DeepSeek models (Chat & Reasoner)
 * Uses OpenAI-compatible API format.
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
  type TokenUsage,
} from "./BaseProvider";

export class DeepSeekProvider extends BaseProvider {
  private client: OpenAI | null = null;

  constructor(config: ProviderConfig = {}) {
    super("deepseek", "DeepSeek", config);
  }

  private getClient(): OpenAI {
    if (!this.client) {
      this.client = new OpenAI({
        apiKey: this.config.apiKey || process.env.DEEPSEEK_API_KEY,
        baseURL: this.config.baseUrl || process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
        maxRetries: this.config.maxRetries ?? 2,
        timeout: this.config.timeout ?? 120000,
      });
    }
    return this.client;
  }

  isConfigured(): boolean {
    return !!(this.config.apiKey || process.env.DEEPSEEK_API_KEY);
  }

  getCapabilities(): ProviderCapabilities {
    return {
      streaming: true, functionCalling: true, vision: false, jsonMode: true,
      systemMessages: true, toolUse: true, embeddings: false, imageGeneration: false,
      audioTranscription: false, audioGeneration: false, codeExecution: false,
      webSearch: false, fileUpload: false, structuredOutput: true, reasoning: true,
      multimodal: false, batchApi: false, fineTuning: true, caching: true,
      maxContextWindow: 128000, maxOutputTokens: 8192,
      supportedMediaTypes: [],
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      { id: "deepseek-chat", name: "DeepSeek Chat", provider: this.name, description: "General-purpose chat model with 128K context", contextWindow: 128000, maxOutputTokens: 8192, inputPricePerMillion: 0.14, outputPricePerMillion: 0.28, capabilities: { functionCalling: true, jsonMode: true }, category: "chat", tier: "free", tags: ["affordable", "fast"] },
      { id: "deepseek-reasoner", name: "DeepSeek Reasoner", provider: this.name, description: "Advanced reasoning with chain-of-thought", contextWindow: 128000, maxOutputTokens: 8192, inputPricePerMillion: 0.55, outputPricePerMillion: 2.19, capabilities: { reasoning: true }, category: "reasoning", tier: "standard", tags: ["reasoning", "thinking", "math"] },
    ];
  }

  async complete(config: LLMRequestConfig): Promise<LLMCompletionResponse> {
    const start = Date.now();
    const requestId = this.generateRequestId();
    const client = this.getClient();

    try {
      const params: any = {
        model: config.model,
        messages: this.convertToOpenAIFormat(config.messages),
      };
      if (config.temperature !== undefined) params.temperature = config.temperature;
      if (config.maxTokens) params.max_tokens = config.maxTokens;
      if (config.tools?.length) params.tools = config.tools;
      if (config.responseFormat) params.response_format = config.responseFormat;

      const response = await client.chat.completions.create(params);
      const latencyMs = Date.now() - start;
      this.recordRequest(latencyMs, true);
      const choice = response.choices[0];

      return {
        id: requestId,
        content: choice?.message?.content || "",
        model: config.model,
        provider: this.name,
        finishReason: (choice?.finish_reason as any) || "stop",
        usage: {
          promptTokens: response.usage?.prompt_tokens || 0,
          completionTokens: response.usage?.completion_tokens || 0,
          totalTokens: response.usage?.total_tokens || 0,
        },
        toolCalls: choice?.message?.tool_calls?.map((tc) => ({
          id: tc.id, type: "function" as const,
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
        latencyMs,
        cached: false,
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
      const params: any = {
        model: config.model,
        messages: this.convertToOpenAIFormat(config.messages),
        stream: true,
      };
      if (config.temperature !== undefined) params.temperature = config.temperature;
      if (config.maxTokens) params.max_tokens = config.maxTokens;

      const stream = await client.chat.completions.create(params) as any;
      let total = "";

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta;
        if (delta?.reasoning_content) {
          yield { type: "thinking", thinking: delta.reasoning_content, sequenceId: seq++, timestamp: Date.now() };
        }
        if (delta?.content) {
          total += delta.content;
          yield { type: "token", content: delta.content, sequenceId: seq++, timestamp: Date.now() };
        }
        if (chunk.choices?.[0]?.finish_reason) {
          yield { type: "done", content: total, sequenceId: seq++, timestamp: Date.now() };
        }
      }
      this.recordRequest(Date.now() - start, true);
    } catch (error: any) {
      this.recordRequest(Date.now() - start, false);
      yield { type: "error", error: error.message, sequenceId: seq++, timestamp: Date.now() };
    }
  }
}
