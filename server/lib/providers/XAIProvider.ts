/**
 * XAI (GROK) PROVIDER - Full Grok model integration
 *
 * Supports: Grok 4.1, Grok 4, Grok 3, Grok Code, Grok Vision
 * via OpenAI-compatible API.
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
import { XAI_MODELS, MODEL_PRICING_REGISTRY } from "../modelRegistry";

export class XAIProvider extends BaseProvider {
  private client: OpenAI | null = null;

  constructor(config: ProviderConfig = {}) {
    super("xai", "xAI Grok", config);
  }

  private getClient(): OpenAI {
    if (!this.client) {
      this.client = new OpenAI({
        apiKey: this.config.apiKey || process.env.XAI_API_KEY,
        baseURL: this.config.baseUrl || "https://api.x.ai/v1",
        maxRetries: this.config.maxRetries ?? 2,
        timeout: this.config.timeout ?? 60000,
      });
    }
    return this.client;
  }

  isConfigured(): boolean {
    return !!(this.config.apiKey || process.env.XAI_API_KEY);
  }

  getCapabilities(): ProviderCapabilities {
    return {
      streaming: true,
      functionCalling: true,
      vision: true,
      jsonMode: true,
      systemMessages: true,
      toolUse: true,
      embeddings: false,
      imageGeneration: true,
      audioTranscription: false,
      audioGeneration: false,
      codeExecution: false,
      webSearch: true,
      fileUpload: false,
      structuredOutput: true,
      reasoning: true,
      multimodal: true,
      batchApi: false,
      fineTuning: false,
      caching: false,
      maxContextWindow: 2000000,
      maxOutputTokens: 131072,
      supportedMediaTypes: ["image/png", "image/jpeg", "image/gif", "image/webp"],
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    return Object.entries(XAI_MODELS).map(([key, id]) => {
      const pricing = MODEL_PRICING_REGISTRY[id] || { inputPerMillion: 1.0, outputPerMillion: 4.0 };
      return {
        id,
        name: this.formatModelName(key),
        provider: this.name,
        description: this.getModelDescription(key),
        contextWindow: id.includes("4-1") || id.includes("4-0") ? 2000000 : 131072,
        maxOutputTokens: 131072,
        inputPricePerMillion: pricing.inputPerMillion,
        outputPricePerMillion: pricing.outputPerMillion,
        capabilities: {
          reasoning: key.includes("REASONING"),
          vision: key.includes("VISION"),
          streaming: true,
          functionCalling: true,
        },
        category: key.includes("REASONING") ? "reasoning" as const : key.includes("CODE") ? "code" as const : key.includes("VISION") ? "vision" as const : "chat" as const,
        tier: key.includes("PREMIUM") ? "premium" as const : "standard" as const,
        tags: this.getModelTags(key),
      };
    });
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
      if (config.topP !== undefined) params.top_p = config.topP;
      if (config.maxTokens) params.max_tokens = config.maxTokens;
      if (config.stop) params.stop = config.stop;
      if (config.tools?.length) {
        params.tools = config.tools;
        if (config.toolChoice) params.tool_choice = config.toolChoice;
      }
      if (config.responseFormat) params.response_format = config.responseFormat;

      const response = await client.chat.completions.create(params);
      const latencyMs = Date.now() - start;
      this.recordRequest(latencyMs, true);

      const choice = response.choices[0];
      const usage: TokenUsage = {
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
      };

      return {
        id: requestId,
        content: choice?.message?.content || "",
        model: config.model,
        provider: this.name,
        finishReason: (choice?.finish_reason as any) || "stop",
        usage,
        toolCalls: choice?.message?.tool_calls?.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
        latencyMs,
        cached: false,
      };
    } catch (error: any) {
      this.recordRequest(Date.now() - start, false);
      throw this.wrapError(error);
    }
  }

  async *stream(config: LLMRequestConfig): AsyncGenerator<StreamEvent> {
    const start = Date.now();
    const client = this.getClient();
    let sequenceId = 0;

    try {
      const params: any = {
        model: config.model,
        messages: this.convertToOpenAIFormat(config.messages),
        stream: true,
      };
      if (config.temperature !== undefined) params.temperature = config.temperature;
      if (config.maxTokens) params.max_tokens = config.maxTokens;
      if (config.tools?.length) params.tools = config.tools;

      const stream = await client.chat.completions.create(params) as any;
      let totalContent = "";

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta;
        if (delta?.content) {
          totalContent += delta.content;
          yield { type: "token", content: delta.content, sequenceId: sequenceId++, timestamp: Date.now() };
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            yield {
              type: "tool_call",
              toolCall: { id: tc.id, type: "function", function: { name: tc.function?.name || "", arguments: tc.function?.arguments || "" } },
              sequenceId: sequenceId++,
              timestamp: Date.now(),
            };
          }
        }
        if (chunk.choices?.[0]?.finish_reason) {
          yield { type: "done", content: totalContent, sequenceId: sequenceId++, timestamp: Date.now() };
        }
      }
      this.recordRequest(Date.now() - start, true);
    } catch (error: any) {
      this.recordRequest(Date.now() - start, false);
      yield { type: "error", error: error.message, sequenceId: sequenceId++, timestamp: Date.now() };
    }
  }

  private formatModelName(key: string): string {
    return key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
  }

  private getModelDescription(key: string): string {
    if (key.includes("REASONING")) return "Advanced reasoning with step-by-step thinking";
    if (key.includes("VISION")) return "Image understanding and analysis";
    if (key.includes("CODE")) return "Specialized for code generation";
    if (key.includes("PREMIUM")) return "Premium high-quality model";
    if (key.includes("FAST")) return "Fast and efficient responses";
    if (key.includes("MINI")) return "Compact and cost-effective";
    return "General-purpose AI model";
  }

  private getModelTags(key: string): string[] {
    const tags: string[] = [];
    if (key.includes("FAST")) tags.push("fast");
    if (key.includes("REASONING")) tags.push("reasoning", "thinking");
    if (key.includes("VISION")) tags.push("vision", "multimodal");
    if (key.includes("CODE")) tags.push("code", "programming");
    if (key.includes("PREMIUM")) tags.push("premium", "high-quality");
    return tags;
  }

  private wrapError(error: any): Error {
    const msg = `[xAI] ${error.status || "unknown"}: ${error.message}`;
    const wrapped = new Error(msg);
    (wrapped as any).provider = this.name;
    (wrapped as any).retryable = error.status === 429 || error.status >= 500;
    return wrapped;
  }
}
