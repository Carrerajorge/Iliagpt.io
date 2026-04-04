/**
 * ANTHROPIC PROVIDER - Claude models integration
 *
 * Supports: Claude 4 Opus, Claude 4 Sonnet, Claude 3.5, extended thinking,
 * tool use, vision, PDF analysis, and computer use.
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  BaseProvider,
  type ProviderCapabilities,
  type ModelInfo,
  type LLMRequestConfig,
  type LLMCompletionResponse,
  type StreamEvent,
  type ProviderConfig,
  type TokenUsage,
  type LLMMessage,
  type ContentPart,
} from "./BaseProvider";

export class AnthropicProvider extends BaseProvider {
  private client: Anthropic | null = null;

  constructor(config: ProviderConfig = {}) {
    super("anthropic", "Anthropic Claude", config);
  }

  private getClient(): Anthropic {
    if (!this.client) {
      this.client = new Anthropic({
        apiKey: this.config.apiKey || process.env.ANTHROPIC_API_KEY,
        maxRetries: this.config.maxRetries ?? 2,
        timeout: this.config.timeout ?? 120000,
        defaultHeaders: this.config.headers,
      });
    }
    return this.client;
  }

  isConfigured(): boolean {
    return !!(this.config.apiKey || process.env.ANTHROPIC_API_KEY);
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
      imageGeneration: false,
      audioTranscription: false,
      audioGeneration: false,
      codeExecution: true,
      webSearch: true,
      fileUpload: true,
      structuredOutput: true,
      reasoning: true,
      multimodal: true,
      batchApi: true,
      fineTuning: false,
      caching: true,
      maxContextWindow: 1000000,
      maxOutputTokens: 128000,
      supportedMediaTypes: ["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"],
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      {
        id: "claude-opus-4-20250514",
        name: "Claude Opus 4",
        provider: this.name,
        description: "Most capable model for complex tasks, coding, and extended thinking",
        contextWindow: 200000,
        maxOutputTokens: 128000,
        inputPricePerMillion: 15.00,
        outputPricePerMillion: 75.00,
        capabilities: { reasoning: true, vision: true, toolUse: true, codeExecution: true, caching: true },
        category: "reasoning",
        tier: "premium",
        tags: ["thinking", "coding", "analysis"],
      },
      {
        id: "claude-sonnet-4-20250514",
        name: "Claude Sonnet 4",
        provider: this.name,
        description: "Best balance of speed and capability with extended thinking",
        contextWindow: 200000,
        maxOutputTokens: 64000,
        inputPricePerMillion: 3.00,
        outputPricePerMillion: 15.00,
        capabilities: { reasoning: true, vision: true, toolUse: true, caching: true },
        category: "chat",
        tier: "standard",
        tags: ["balanced", "versatile"],
      },
      {
        id: "claude-haiku-4-20250514",
        name: "Claude Haiku 4",
        provider: this.name,
        description: "Fast and efficient for high-throughput tasks",
        contextWindow: 200000,
        maxOutputTokens: 8192,
        inputPricePerMillion: 0.80,
        outputPricePerMillion: 4.00,
        capabilities: { vision: true, toolUse: true },
        category: "chat",
        tier: "free",
        tags: ["fast", "efficient", "affordable"],
      },
      {
        id: "claude-3-5-sonnet-20241022",
        name: "Claude 3.5 Sonnet",
        provider: this.name,
        description: "Previous generation high-capability model",
        contextWindow: 200000,
        maxOutputTokens: 8192,
        inputPricePerMillion: 3.00,
        outputPricePerMillion: 15.00,
        capabilities: { vision: true, toolUse: true },
        category: "chat",
        tier: "standard",
        tags: ["stable", "proven"],
      },
    ];
  }

  async complete(config: LLMRequestConfig): Promise<LLMCompletionResponse> {
    const start = Date.now();
    const requestId = this.generateRequestId();
    const client = this.getClient();

    try {
      const { systemPrompt, messages } = this.extractSystem(config.messages);
      const params: any = {
        model: config.model,
        messages: this.convertMessages(messages),
        max_tokens: config.maxTokens || 8192,
      };

      if (systemPrompt) params.system = systemPrompt;
      if (config.temperature !== undefined) params.temperature = config.temperature;
      if (config.topP !== undefined) params.top_p = config.topP;
      if (config.topK !== undefined) params.top_k = config.topK;
      if (config.stop) params.stop_sequences = config.stop;

      if (config.tools?.length) {
        params.tools = config.tools.map((t) => ({
          name: t.function.name,
          description: t.function.description,
          input_schema: t.function.parameters,
        }));
        if (config.toolChoice === "auto") params.tool_choice = { type: "auto" };
        else if (config.toolChoice === "required") params.tool_choice = { type: "any" };
        else if (config.toolChoice === "none") params.tool_choice = { type: "none" };
      }

      const response = await client.messages.create(params);
      const latencyMs = Date.now() - start;
      this.recordRequest(latencyMs, true);

      let content = "";
      let thinking = "";
      const toolCalls: any[] = [];

      for (const block of response.content) {
        if (block.type === "text") content += block.text;
        else if (block.type === "thinking") thinking += (block as any).thinking;
        else if (block.type === "tool_use") {
          toolCalls.push({
            id: block.id,
            type: "function",
            function: { name: block.name, arguments: JSON.stringify(block.input) },
          });
        }
      }

      const usage: TokenUsage = {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
        cachedTokens: (response.usage as any).cache_creation_input_tokens,
      };

      return {
        id: requestId,
        content,
        model: config.model,
        provider: this.name,
        finishReason: this.mapStopReason(response.stop_reason),
        usage,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        thinking: thinking || undefined,
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
      const { systemPrompt, messages } = this.extractSystem(config.messages);
      const params: any = {
        model: config.model,
        messages: this.convertMessages(messages),
        max_tokens: config.maxTokens || 8192,
        stream: true,
      };

      if (systemPrompt) params.system = systemPrompt;
      if (config.temperature !== undefined) params.temperature = config.temperature;
      if (config.topP !== undefined) params.top_p = config.topP;
      if (config.tools?.length) {
        params.tools = config.tools.map((t) => ({
          name: t.function.name,
          description: t.function.description,
          input_schema: t.function.parameters,
        }));
      }

      const stream = await client.messages.stream(params);
      let totalContent = "";

      for await (const event of stream) {
        if (event.type === "content_block_delta") {
          const delta = event.delta as any;
          if (delta.type === "text_delta") {
            totalContent += delta.text;
            yield {
              type: "token",
              content: delta.text,
              sequenceId: sequenceId++,
              timestamp: Date.now(),
            };
          } else if (delta.type === "thinking_delta") {
            yield {
              type: "thinking",
              thinking: delta.thinking,
              sequenceId: sequenceId++,
              timestamp: Date.now(),
            };
          } else if (delta.type === "input_json_delta") {
            yield {
              type: "tool_call",
              toolCall: { function: { name: "", arguments: delta.partial_json } },
              sequenceId: sequenceId++,
              timestamp: Date.now(),
            };
          }
        } else if (event.type === "message_stop") {
          yield {
            type: "done",
            content: totalContent,
            sequenceId: sequenceId++,
            timestamp: Date.now(),
          };
        } else if (event.type === "message_delta") {
          const delta = event as any;
          if (delta.usage) {
            yield {
              type: "metadata",
              usage: {
                promptTokens: 0,
                completionTokens: delta.usage?.output_tokens || 0,
                totalTokens: delta.usage?.output_tokens || 0,
              },
              sequenceId: sequenceId++,
              timestamp: Date.now(),
            };
          }
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

  // -- Internal helpers --

  private extractSystem(messages: LLMMessage[]): { systemPrompt: string; messages: LLMMessage[] } {
    const systemMessages = messages.filter((m) => m.role === "system");
    const nonSystem = messages.filter((m) => m.role !== "system");
    const systemPrompt = systemMessages.map((m) => (typeof m.content === "string" ? m.content : "")).join("\n\n");
    return { systemPrompt, messages: nonSystem };
  }

  private convertMessages(messages: LLMMessage[]): any[] {
    return messages.map((m) => {
      if (typeof m.content === "string") {
        return { role: m.role === "tool" ? "user" : m.role, content: m.content };
      }
      const parts = (m.content as ContentPart[]).map((p) => {
        if (p.type === "text") return { type: "text", text: p.text };
        if (p.type === "image_url" && p.imageUrl) {
          if (p.imageUrl.url.startsWith("data:")) {
            const [header, data] = p.imageUrl.url.split(",");
            const mediaType = header.split(":")[1]?.split(";")[0] || "image/png";
            return { type: "image", source: { type: "base64", media_type: mediaType, data } };
          }
          return { type: "image", source: { type: "url", url: p.imageUrl.url } };
        }
        return { type: "text", text: p.text || "" };
      });
      return { role: m.role === "tool" ? "user" : m.role, content: parts };
    });
  }

  private mapStopReason(reason: string | null): LLMCompletionResponse["finishReason"] {
    if (reason === "end_turn") return "stop";
    if (reason === "max_tokens") return "length";
    if (reason === "tool_use") return "tool_calls";
    return "stop";
  }

  private wrapError(error: any): Error {
    const msg = `[Anthropic] ${error.status || "unknown"}: ${error.message}`;
    const wrapped = new Error(msg);
    (wrapped as any).status = error.status;
    (wrapped as any).provider = this.name;
    (wrapped as any).retryable = error.status === 429 || error.status === 529 || (error.status >= 500 && error.status < 600);
    return wrapped;
  }
}
