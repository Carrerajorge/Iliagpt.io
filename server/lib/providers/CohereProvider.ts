/**
 * COHERE PROVIDER - Command R+ and embedding models
 *
 * Supports: Command R+, Command R, Embed v3, Rerank v3
 */

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
} from "./BaseProvider";

export class CohereProvider extends BaseProvider {
  private apiKey: string | null = null;
  private baseUrl: string;

  constructor(config: ProviderConfig = {}) {
    super("cohere", "Cohere", config);
    this.baseUrl = config.baseUrl || "https://api.cohere.ai/v2";
  }

  private getApiKey(): string {
    if (!this.apiKey) this.apiKey = this.config.apiKey || process.env.COHERE_API_KEY || "";
    return this.apiKey;
  }

  isConfigured(): boolean {
    return !!(this.config.apiKey || process.env.COHERE_API_KEY);
  }

  getCapabilities(): ProviderCapabilities {
    return {
      streaming: true, functionCalling: true, vision: false, jsonMode: true,
      systemMessages: true, toolUse: true, embeddings: true, imageGeneration: false,
      audioTranscription: false, audioGeneration: false, codeExecution: false,
      webSearch: true, fileUpload: false, structuredOutput: true, reasoning: false,
      multimodal: false, batchApi: false, fineTuning: true, caching: false,
      maxContextWindow: 128000, maxOutputTokens: 4096,
      supportedMediaTypes: [],
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      { id: "command-r-plus", name: "Command R+", provider: this.name, description: "Most capable Cohere model with RAG", contextWindow: 128000, maxOutputTokens: 4096, inputPricePerMillion: 2.50, outputPricePerMillion: 10.00, capabilities: { webSearch: true, functionCalling: true }, category: "chat", tier: "premium", tags: ["rag", "enterprise"] },
      { id: "command-r", name: "Command R", provider: this.name, description: "Balanced model optimized for RAG", contextWindow: 128000, maxOutputTokens: 4096, inputPricePerMillion: 0.15, outputPricePerMillion: 0.60, capabilities: { webSearch: true }, category: "chat", tier: "standard", tags: ["rag", "affordable"] },
      { id: "command-light", name: "Command Light", provider: this.name, description: "Fast and efficient", contextWindow: 4096, maxOutputTokens: 4096, inputPricePerMillion: 0.30, outputPricePerMillion: 0.60, capabilities: {}, category: "chat", tier: "free", tags: ["fast"] },
    ];
  }

  async complete(config: LLMRequestConfig): Promise<LLMCompletionResponse> {
    const start = Date.now();
    const requestId = this.generateRequestId();
    try {
      const messages = this.convertMessages(config.messages);
      const body: any = { model: config.model, messages };
      if (config.temperature !== undefined) body.temperature = config.temperature;
      if (config.maxTokens) body.max_tokens = config.maxTokens;
      if (config.tools?.length) {
        body.tools = config.tools.map((t) => ({
          type: "function",
          function: { name: t.function.name, description: t.function.description, parameters: t.function.parameters },
        }));
      }

      const res = await fetch(`${this.baseUrl}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.getApiKey()}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120000),
      });

      if (!res.ok) throw new Error(`Cohere API error ${res.status}: ${await res.text()}`);
      const data = await res.json() as any;
      const latencyMs = Date.now() - start;
      this.recordRequest(latencyMs, true);

      const content = data.message?.content?.map((c: any) => c.text).join("") || "";
      const toolCalls = data.message?.tool_calls?.map((tc: any) => ({
        id: tc.id, type: "function" as const,
        function: { name: tc.function.name, arguments: JSON.stringify(tc.function.arguments) },
      }));

      return {
        id: requestId, content, model: config.model, provider: this.name,
        finishReason: data.finish_reason === "COMPLETE" ? "stop" : "stop",
        usage: { promptTokens: data.usage?.billed_units?.input_tokens || 0, completionTokens: data.usage?.billed_units?.output_tokens || 0, totalTokens: (data.usage?.billed_units?.input_tokens || 0) + (data.usage?.billed_units?.output_tokens || 0) },
        toolCalls, latencyMs, cached: false,
      };
    } catch (error: any) {
      this.recordRequest(Date.now() - start, false);
      throw error;
    }
  }

  async *stream(config: LLMRequestConfig): AsyncGenerator<StreamEvent> {
    const start = Date.now();
    let seq = 0;
    try {
      const messages = this.convertMessages(config.messages);
      const body: any = { model: config.model, messages, stream: true };
      if (config.temperature !== undefined) body.temperature = config.temperature;
      if (config.maxTokens) body.max_tokens = config.maxTokens;

      const res = await fetch(`${this.baseUrl}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.getApiKey()}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(300000),
      });

      if (!res.ok) throw new Error(`Cohere stream error ${res.status}`);
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";
      let total = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "content-delta" && data.delta?.message?.content?.text) {
              total += data.delta.message.content.text;
              yield { type: "token", content: data.delta.message.content.text, sequenceId: seq++, timestamp: Date.now() };
            }
          } catch { /* skip */ }
        }
      }
      yield { type: "done", content: total, sequenceId: seq++, timestamp: Date.now() };
      this.recordRequest(Date.now() - start, true);
    } catch (error: any) {
      this.recordRequest(Date.now() - start, false);
      yield { type: "error", error: error.message, sequenceId: seq++, timestamp: Date.now() };
    }
  }

  async embed(input: string | string[], model?: string): Promise<number[][]> {
    const texts = Array.isArray(input) ? input : [input];
    const res = await fetch(`${this.baseUrl}/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.getApiKey()}` },
      body: JSON.stringify({ model: model || "embed-v4.0", texts, input_type: "search_document", embedding_types: ["float"] }),
    });
    const data = await res.json() as any;
    return data.embeddings?.float || [];
  }

  private convertMessages(messages: LLMMessage[]): any[] {
    return messages.map((m) => ({
      role: m.role === "system" ? "system" : m.role === "assistant" ? "assistant" : "user",
      content: typeof m.content === "string" ? m.content : (m.content as any[]).map((p) => p.text).join(""),
    }));
  }
}
