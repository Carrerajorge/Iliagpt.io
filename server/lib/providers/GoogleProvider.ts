/**
 * GOOGLE GEMINI PROVIDER - Full Gemini API integration
 *
 * Supports: Gemini 2.5/3.x Pro/Flash, multimodal, code execution,
 * grounding with Google Search, structured output, and long context.
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
  type ContentPart,
} from "./BaseProvider";

export class GoogleProvider extends BaseProvider {
  private apiKey: string | null = null;
  private baseUrl: string;

  constructor(config: ProviderConfig = {}) {
    super("gemini", "Google Gemini", config);
    this.baseUrl = config.baseUrl || "https://generativelanguage.googleapis.com/v1beta";
  }

  private getApiKey(): string {
    if (!this.apiKey) {
      this.apiKey = this.config.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
    }
    return this.apiKey;
  }

  isConfigured(): boolean {
    return !!(this.config.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
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
      codeExecution: true,
      webSearch: true,
      fileUpload: true,
      structuredOutput: true,
      reasoning: true,
      multimodal: true,
      batchApi: false,
      fineTuning: true,
      caching: true,
      maxContextWindow: 2000000,
      maxOutputTokens: 65536,
      supportedMediaTypes: ["image/png", "image/jpeg", "image/gif", "image/webp", "audio/mp3", "audio/wav", "video/mp4", "application/pdf"],
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const key = this.getApiKey();
      const res = await fetch(`${this.baseUrl}/models?key=${key}`);
      if (!res.ok) return this.getStaticModels();
      const data = await res.json() as any;
      return (data.models || [])
        .filter((m: any) => m.name.includes("gemini"))
        .map((m: any) => {
          const id = m.name.replace("models/", "");
          return {
            id,
            name: m.displayName || id,
            provider: this.name,
            description: m.description || "",
            contextWindow: m.inputTokenLimit || 1000000,
            maxOutputTokens: m.outputTokenLimit || 8192,
            inputPricePerMillion: this.getPrice(id, "input"),
            outputPricePerMillion: this.getPrice(id, "output"),
            capabilities: { vision: true, multimodal: true, codeExecution: true },
            category: "chat" as const,
            tier: id.includes("pro") ? "premium" as const : "standard" as const,
          };
        });
    } catch {
      return this.getStaticModels();
    }
  }

  async complete(config: LLMRequestConfig): Promise<LLMCompletionResponse> {
    const start = Date.now();
    const requestId = this.generateRequestId();
    const key = this.getApiKey();

    try {
      const body = this.buildRequestBody(config);
      const url = `${this.baseUrl}/models/${config.model}:generateContent?key=${key}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.maxTokens && config.maxTokens > 16000 ? 300000 : 120000),
      });

      if (!res.ok) {
        const errorBody = await res.text();
        throw new Error(`Gemini API error ${res.status}: ${errorBody}`);
      }

      const data = await res.json() as any;
      const latencyMs = Date.now() - start;
      this.recordRequest(latencyMs, true);

      const candidate = data.candidates?.[0];
      let content = "";
      const toolCalls: any[] = [];

      if (candidate?.content?.parts) {
        for (const part of candidate.content.parts) {
          if (part.text) content += part.text;
          if (part.functionCall) {
            toolCalls.push({
              id: `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              type: "function",
              function: { name: part.functionCall.name, arguments: JSON.stringify(part.functionCall.args || {}) },
            });
          }
        }
      }

      const usage: TokenUsage = {
        promptTokens: data.usageMetadata?.promptTokenCount || 0,
        completionTokens: data.usageMetadata?.candidatesTokenCount || 0,
        totalTokens: data.usageMetadata?.totalTokenCount || 0,
        cachedTokens: data.usageMetadata?.cachedContentTokenCount,
      };

      return {
        id: requestId,
        content,
        model: config.model,
        provider: this.name,
        finishReason: this.mapFinishReason(candidate?.finishReason),
        usage,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
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
    const key = this.getApiKey();
    let sequenceId = 0;

    try {
      const body = this.buildRequestBody(config);
      const url = `${this.baseUrl}/models/${config.model}:streamGenerateContent?alt=sse&key=${key}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(300000),
      });

      if (!res.ok) {
        throw new Error(`Gemini stream error ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body for streaming");

      const decoder = new TextDecoder();
      let buffer = "";
      let totalContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr || jsonStr === "[DONE]") continue;

          try {
            const data = JSON.parse(jsonStr);
            const parts = data.candidates?.[0]?.content?.parts;
            if (!parts) continue;

            for (const part of parts) {
              if (part.text) {
                totalContent += part.text;
                yield {
                  type: "token",
                  content: part.text,
                  sequenceId: sequenceId++,
                  timestamp: Date.now(),
                };
              }
              if (part.functionCall) {
                yield {
                  type: "tool_call",
                  toolCall: {
                    id: `tool_${Date.now()}`,
                    type: "function",
                    function: { name: part.functionCall.name, arguments: JSON.stringify(part.functionCall.args || {}) },
                  },
                  sequenceId: sequenceId++,
                  timestamp: Date.now(),
                };
              }
            }

            if (data.usageMetadata) {
              yield {
                type: "metadata",
                usage: {
                  promptTokens: data.usageMetadata.promptTokenCount || 0,
                  completionTokens: data.usageMetadata.candidatesTokenCount || 0,
                  totalTokens: data.usageMetadata.totalTokenCount || 0,
                },
                sequenceId: sequenceId++,
                timestamp: Date.now(),
              };
            }
          } catch {
            // Skip malformed JSON chunks
          }
        }
      }

      yield {
        type: "done",
        content: totalContent,
        sequenceId: sequenceId++,
        timestamp: Date.now(),
      };

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
    const key = this.getApiKey();
    const embedModel = model || "text-embedding-004";
    const texts = Array.isArray(input) ? input : [input];
    const results: number[][] = [];

    for (const text of texts) {
      const res = await fetch(`${this.baseUrl}/models/${embedModel}:embedContent?key=${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: { parts: [{ text }] } }),
      });
      const data = await res.json() as any;
      results.push(data.embedding?.values || []);
    }
    return results;
  }

  // -- Internal helpers --

  private buildRequestBody(config: LLMRequestConfig): Record<string, unknown> {
    const systemInstruction = config.messages.find((m) => m.role === "system");
    const contents = config.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: this.convertParts(m),
      }));

    const body: Record<string, unknown> = { contents };

    if (systemInstruction) {
      const text = typeof systemInstruction.content === "string" ? systemInstruction.content : "";
      body.systemInstruction = { parts: [{ text }] };
    }

    const genConfig: Record<string, unknown> = {};
    if (config.temperature !== undefined) genConfig.temperature = config.temperature;
    if (config.topP !== undefined) genConfig.topP = config.topP;
    if (config.topK !== undefined) genConfig.topK = config.topK;
    if (config.maxTokens) genConfig.maxOutputTokens = config.maxTokens;
    if (config.stop) genConfig.stopSequences = config.stop;
    if (config.responseFormat?.type === "json_object") genConfig.responseMimeType = "application/json";
    if (config.seed !== undefined) genConfig.seed = config.seed;
    if (Object.keys(genConfig).length) body.generationConfig = genConfig;

    if (config.tools?.length) {
      body.tools = [{
        functionDeclarations: config.tools.map((t) => ({
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        })),
      }];
    }

    return body;
  }

  private convertParts(message: LLMMessage): any[] {
    if (typeof message.content === "string") {
      return [{ text: message.content }];
    }
    return (message.content as ContentPart[]).map((p) => {
      if (p.type === "text") return { text: p.text };
      if (p.type === "image_url" && p.imageUrl) {
        if (p.imageUrl.url.startsWith("data:")) {
          const [header, data] = p.imageUrl.url.split(",");
          const mimeType = header.split(":")[1]?.split(";")[0] || "image/png";
          return { inlineData: { mimeType, data } };
        }
        return { fileData: { fileUri: p.imageUrl.url } };
      }
      return { text: p.text || "" };
    });
  }

  private mapFinishReason(reason: string): LLMCompletionResponse["finishReason"] {
    if (reason === "STOP") return "stop";
    if (reason === "MAX_TOKENS") return "length";
    if (reason === "SAFETY") return "content_filter";
    return "stop";
  }

  private wrapError(error: any): Error {
    const msg = `[Gemini] ${error.message}`;
    const wrapped = new Error(msg);
    (wrapped as any).provider = this.name;
    (wrapped as any).retryable = error.message?.includes("429") || error.message?.includes("500") || error.message?.includes("503");
    return wrapped;
  }

  private getPrice(modelId: string, type: "input" | "output"): number {
    const prices: Record<string, [number, number]> = {
      "gemini-2.5-flash": [0.075, 0.30],
      "gemini-2.5-pro": [1.25, 5.00],
      "gemini-2.0-flash": [0.10, 0.40],
      "gemini-3.1-pro": [1.25, 5.00],
      "gemini-3.1-flash": [0.075, 0.30],
    };
    for (const [key, [inp, out]] of Object.entries(prices)) {
      if (modelId.includes(key)) return type === "input" ? inp : out;
    }
    return type === "input" ? 0.50 : 2.00;
  }

  private getStaticModels(): ModelInfo[] {
    return [
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: this.name, description: "Fast and efficient", contextWindow: 1000000, maxOutputTokens: 65536, inputPricePerMillion: 0.075, outputPricePerMillion: 0.30, capabilities: { vision: true, codeExecution: true, webSearch: true }, category: "chat", tier: "free" },
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", provider: this.name, description: "Most capable Gemini model", contextWindow: 1000000, maxOutputTokens: 65536, inputPricePerMillion: 1.25, outputPricePerMillion: 5.00, capabilities: { vision: true, reasoning: true, codeExecution: true }, category: "reasoning", tier: "premium" },
      { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro", provider: this.name, description: "Next-gen pro model", contextWindow: 2000000, maxOutputTokens: 65536, inputPricePerMillion: 1.25, outputPricePerMillion: 5.00, capabilities: { vision: true, reasoning: true }, category: "reasoning", tier: "premium" },
      { id: "gemini-3.1-flash", name: "Gemini 3.1 Flash", provider: this.name, description: "Next-gen fast model", contextWindow: 2000000, maxOutputTokens: 65536, inputPricePerMillion: 0.075, outputPricePerMillion: 0.30, capabilities: { vision: true }, category: "chat", tier: "standard" },
    ];
  }
}
