/**
 * OPENAI PROVIDER - Handles OpenAI and any OpenAI-compatible API
 *
 * Supports: GPT-4o, GPT-4, GPT-3.5, o1, o3, o4-mini, DALL-E, Whisper,
 * and any OpenAI-compatible API (OpenRouter, Together, Fireworks, Groq, etc.)
 */

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
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

export class OpenAIProvider extends BaseProvider {
  private client: OpenAI | null = null;

  constructor(config: ProviderConfig = {}) {
    super("openai", "OpenAI", config);
  }

  private getClient(): OpenAI {
    if (!this.client) {
      this.client = new OpenAI({
        apiKey: this.config.apiKey || process.env.OPENAI_API_KEY,
        baseURL: this.config.baseUrl || process.env.OPENAI_BASE_URL || undefined,
        organization: this.config.organization,
        maxRetries: this.config.maxRetries ?? 2,
        timeout: this.config.timeout ?? 60000,
        defaultHeaders: this.config.headers,
      });
    }
    return this.client;
  }

  isConfigured(): boolean {
    return !!(this.config.apiKey || process.env.OPENAI_API_KEY || process.env.OPENAI_BASE_URL);
  }

  getCapabilities(): ProviderCapabilities {
    return {
      streaming: true,
      functionCalling: true,
      vision: true,
      jsonMode: true,
      systemMessages: true,
      toolUse: true,
      embeddings: true,
      imageGeneration: true,
      audioTranscription: true,
      audioGeneration: true,
      codeExecution: false,
      webSearch: false,
      fileUpload: true,
      structuredOutput: true,
      reasoning: true,
      multimodal: true,
      batchApi: true,
      fineTuning: true,
      caching: false,
      maxContextWindow: 128000,
      maxOutputTokens: 16384,
      supportedMediaTypes: ["image/png", "image/jpeg", "image/gif", "image/webp", "audio/mp3", "audio/wav"],
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const client = this.getClient();
      const response = await client.models.list();
      return response.data
        .filter((m) => m.id.startsWith("gpt") || m.id.startsWith("o") || m.id.startsWith("chatgpt"))
        .map((m) => ({
          id: m.id,
          name: m.id,
          provider: this.name,
          description: `OpenAI ${m.id}`,
          contextWindow: this.getContextWindow(m.id),
          maxOutputTokens: this.getMaxOutput(m.id),
          inputPricePerMillion: this.getInputPrice(m.id),
          outputPricePerMillion: this.getOutputPrice(m.id),
          capabilities: this.getModelCapabilities(m.id),
          category: this.getModelCategory(m.id),
          tier: this.getModelTier(m.id),
          tags: this.getModelTags(m.id),
        }));
    } catch {
      return this.getStaticModelList();
    }
  }

  async complete(config: LLMRequestConfig): Promise<LLMCompletionResponse> {
    const start = Date.now();
    const requestId = this.generateRequestId();
    const client = this.getClient();

    try {
      const params = this.buildParams(config);
      const response = await client.chat.completions.create(params as any);

      const latencyMs = Date.now() - start;
      this.recordRequest(latencyMs, true);

      const choice = (response as any).choices[0];
      const usage: TokenUsage = {
        promptTokens: (response as any).usage?.prompt_tokens || 0,
        completionTokens: (response as any).usage?.completion_tokens || 0,
        totalTokens: (response as any).usage?.total_tokens || 0,
        cachedTokens: (response as any).usage?.prompt_tokens_details?.cached_tokens,
        reasoningTokens: (response as any).usage?.completion_tokens_details?.reasoning_tokens,
      };

      return {
        id: requestId,
        content: choice?.message?.content || "",
        model: config.model,
        provider: this.name,
        finishReason: this.mapFinishReason(choice?.finish_reason),
        usage,
        toolCalls: choice?.message?.tool_calls?.map((tc: any) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
        latencyMs,
        cached: false,
      };
    } catch (error: any) {
      const latencyMs = Date.now() - start;
      this.recordRequest(latencyMs, false);
      throw this.wrapError(error);
    }
  }

  async *stream(config: LLMRequestConfig): AsyncGenerator<StreamEvent> {
    const start = Date.now();
    const client = this.getClient();
    let sequenceId = 0;

    try {
      const params = this.buildParams(config);
      const stream = await client.chat.completions.create({ ...params, stream: true, stream_options: { include_usage: true } } as any);

      let totalContent = "";
      let toolCallBuffers: Map<number, { id: string; name: string; args: string }> = new Map();

      for await (const chunk of stream as any) {
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) {
          if (chunk.usage) {
            yield {
              type: "metadata",
              usage: {
                promptTokens: chunk.usage.prompt_tokens || 0,
                completionTokens: chunk.usage.completion_tokens || 0,
                totalTokens: chunk.usage.total_tokens || 0,
              },
              sequenceId: sequenceId++,
              timestamp: Date.now(),
            };
          }
          continue;
        }

        if (delta.content) {
          totalContent += delta.content;
          yield {
            type: "token",
            content: delta.content,
            sequenceId: sequenceId++,
            timestamp: Date.now(),
          };
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!toolCallBuffers.has(idx)) {
              toolCallBuffers.set(idx, { id: tc.id || "", name: "", args: "" });
            }
            const buf = toolCallBuffers.get(idx)!;
            if (tc.id) buf.id = tc.id;
            if (tc.function?.name) buf.name += tc.function.name;
            if (tc.function?.arguments) buf.args += tc.function.arguments;

            yield {
              type: "tool_call",
              toolCall: {
                id: buf.id,
                type: "function",
                function: { name: buf.name, arguments: buf.args },
              },
              sequenceId: sequenceId++,
              timestamp: Date.now(),
            };
          }
        }

        if (chunk.choices?.[0]?.finish_reason) {
          yield {
            type: "done",
            content: totalContent,
            sequenceId: sequenceId++,
            timestamp: Date.now(),
          };
        }
      }

      this.recordRequest(Date.now() - start, true);
    } catch (error: any) {
      this.recordRequest(Date.now() - start, false);
      yield {
        type: "error",
        error: error.message,
        sequenceId: sequenceId++,
        timestamp: Date.now(),
      };
    }
  }

  async embed(input: string | string[], model?: string): Promise<number[][]> {
    const client = this.getClient();
    const response = await client.embeddings.create({
      model: model || "text-embedding-3-small",
      input: Array.isArray(input) ? input : [input],
    });
    return response.data.map((d) => d.embedding);
  }

  async generateImage(prompt: string, options?: Record<string, unknown>): Promise<{ url: string; revisedPrompt?: string }> {
    const client = this.getClient();
    const response = await client.images.generate({
      model: (options?.model as string) || "dall-e-3",
      prompt,
      n: 1,
      size: (options?.size as any) || "1024x1024",
      quality: (options?.quality as any) || "standard",
    });
    return {
      url: response.data[0]?.url || "",
      revisedPrompt: response.data[0]?.revised_prompt,
    };
  }

  // -- Internal helpers --

  private buildParams(config: LLMRequestConfig): Record<string, unknown> {
    const params: Record<string, unknown> = {
      model: config.model,
      messages: this.convertToOpenAIFormat(config.messages),
    };
    if (config.temperature !== undefined) params.temperature = config.temperature;
    if (config.topP !== undefined) params.top_p = config.topP;
    if (config.maxTokens !== undefined) params.max_tokens = config.maxTokens;
    if (config.stop) params.stop = config.stop;
    if (config.seed !== undefined) params.seed = config.seed;
    if (config.frequencyPenalty !== undefined) params.frequency_penalty = config.frequencyPenalty;
    if (config.presencePenalty !== undefined) params.presence_penalty = config.presencePenalty;
    if (config.tools?.length) {
      params.tools = config.tools;
      if (config.toolChoice) params.tool_choice = config.toolChoice;
    }
    if (config.responseFormat) params.response_format = config.responseFormat;
    if (config.user) params.user = config.user;
    return params;
  }

  private mapFinishReason(reason: string): LLMCompletionResponse["finishReason"] {
    const map: Record<string, LLMCompletionResponse["finishReason"]> = {
      stop: "stop",
      length: "length",
      tool_calls: "tool_calls",
      content_filter: "content_filter",
      function_call: "tool_calls",
    };
    return map[reason] || "stop";
  }

  private wrapError(error: any): Error {
    if (error instanceof OpenAI.APIError) {
      const msg = `[OpenAI] ${error.status}: ${error.message}`;
      const wrapped = new Error(msg);
      (wrapped as any).status = error.status;
      (wrapped as any).provider = this.name;
      (wrapped as any).retryable = error.status === 429 || error.status >= 500;
      return wrapped;
    }
    return error;
  }

  private getContextWindow(modelId: string): number {
    if (modelId.includes("gpt-4o")) return 128000;
    if (modelId.includes("gpt-4-turbo")) return 128000;
    if (modelId.includes("gpt-4")) return 8192;
    if (modelId.includes("o1") || modelId.includes("o3") || modelId.includes("o4")) return 200000;
    return 128000;
  }

  private getMaxOutput(modelId: string): number {
    if (modelId.includes("o1") || modelId.includes("o3")) return 100000;
    if (modelId.includes("gpt-4o")) return 16384;
    return 4096;
  }

  private getInputPrice(modelId: string): number {
    if (modelId.includes("gpt-4o-mini")) return 0.15;
    if (modelId.includes("gpt-4o")) return 2.50;
    if (modelId.includes("o1-mini")) return 3.00;
    if (modelId.includes("o1")) return 15.00;
    if (modelId.includes("o3-mini")) return 1.10;
    if (modelId.includes("o4-mini")) return 1.10;
    return 5.00;
  }

  private getOutputPrice(modelId: string): number {
    if (modelId.includes("gpt-4o-mini")) return 0.60;
    if (modelId.includes("gpt-4o")) return 10.00;
    if (modelId.includes("o1-mini")) return 12.00;
    if (modelId.includes("o1")) return 60.00;
    if (modelId.includes("o3-mini")) return 4.40;
    if (modelId.includes("o4-mini")) return 4.40;
    return 15.00;
  }

  private getModelCapabilities(modelId: string): Partial<ProviderCapabilities> {
    return {
      streaming: true,
      functionCalling: true,
      vision: modelId.includes("gpt-4o") || modelId.includes("o") || modelId.includes("4-turbo"),
      jsonMode: true,
      reasoning: modelId.startsWith("o"),
      multimodal: modelId.includes("gpt-4o") || modelId.includes("o"),
    };
  }

  private getModelCategory(modelId: string): ModelInfo["category"] {
    if (modelId.startsWith("o")) return "reasoning";
    if (modelId.includes("vision")) return "vision";
    return "chat";
  }

  private getModelTier(modelId: string): ModelInfo["tier"] {
    if (modelId.includes("mini")) return "standard";
    if (modelId.startsWith("o1") || modelId.startsWith("o3")) return "premium";
    if (modelId.includes("gpt-4o")) return "standard";
    return "standard";
  }

  private getModelTags(modelId: string): string[] {
    const tags: string[] = [];
    if (modelId.includes("mini")) tags.push("fast", "efficient");
    if (modelId.startsWith("o")) tags.push("reasoning", "thinking");
    if (modelId.includes("gpt-4o")) tags.push("multimodal", "versatile");
    return tags;
  }

  private getStaticModelList(): ModelInfo[] {
    return [
      { id: "gpt-4o", name: "GPT-4o", provider: this.name, description: "Most capable multimodal model", contextWindow: 128000, maxOutputTokens: 16384, inputPricePerMillion: 2.50, outputPricePerMillion: 10.00, capabilities: { vision: true, multimodal: true }, category: "chat", tier: "standard" },
      { id: "gpt-4o-mini", name: "GPT-4o Mini", provider: this.name, description: "Fast and affordable", contextWindow: 128000, maxOutputTokens: 16384, inputPricePerMillion: 0.15, outputPricePerMillion: 0.60, capabilities: { vision: true }, category: "chat", tier: "free" },
      { id: "o4-mini", name: "o4-mini", provider: this.name, description: "Fast reasoning model", contextWindow: 200000, maxOutputTokens: 100000, inputPricePerMillion: 1.10, outputPricePerMillion: 4.40, capabilities: { reasoning: true }, category: "reasoning", tier: "standard" },
      { id: "o3", name: "o3", provider: this.name, description: "Advanced reasoning", contextWindow: 200000, maxOutputTokens: 100000, inputPricePerMillion: 10.00, outputPricePerMillion: 40.00, capabilities: { reasoning: true }, category: "reasoning", tier: "premium" },
    ];
  }
}
