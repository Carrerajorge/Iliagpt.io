/**
 * Provider Adapters — Unified interface for multi-provider AI chat.
 * Each adapter creates ephemeral clients using OAuth tokens (not cached env-var keys).
 */

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ProviderModel {
  id: string;
  name: string;
  provider: string;
  modelId: string;
  description: string;
  modelType: string;
  contextWindow: number | null;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatResponse {
  content: string;
  model: string;
  provider: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface StreamChunk {
  content: string;
  done: boolean;
}

export interface ProviderAdapter {
  readonly providerId: "openai" | "gemini" | "anthropic";
  fetchModels(accessToken: string): Promise<ProviderModel[]>;
  chat(
    accessToken: string,
    model: string,
    messages: ChatMessage[],
  ): Promise<ChatResponse>;
  streamChat(
    accessToken: string,
    model: string,
    messages: ChatMessage[],
  ): AsyncGenerator<StreamChunk>;
}

// ─── OpenAI Adapter ──────────────────────────────────────────────────────────

export class OpenAIAdapter implements ProviderAdapter {
  readonly providerId = "openai" as const;

  private createClient(token: string): OpenAI {
    return new OpenAI({ apiKey: token });
  }

  async fetchModels(accessToken: string): Promise<ProviderModel[]> {
    try {
      const client = this.createClient(accessToken);
      const response = await client.models.list();
      const models: ProviderModel[] = [];

      for await (const m of response) {
        // Only include chat-capable models
        if (
          m.id.startsWith("gpt") ||
          m.id.startsWith("o") ||
          m.id.startsWith("chatgpt") ||
          m.id.startsWith("codex-mini")
        ) {
          models.push({
            id: `oauth-openai-${m.id}`,
            name: m.id,
            provider: "openai",
            modelId: m.id,
            description: `OpenAI ${m.id}`,
            modelType: "TEXT",
            contextWindow: null,
          });
        }
      }

      return models.length > 0
        ? models
        : this.getDefaultModels();
    } catch (error: any) {
      console.error("[OpenAIAdapter] fetchModels error:", error.message);
      return this.getDefaultModels();
    }
  }

  private getDefaultModels(): ProviderModel[] {
    return [
      {
        id: "oauth-openai-gpt-4o",
        name: "GPT-4o",
        provider: "openai",
        modelId: "gpt-4o",
        description: "Modelo multimodal de OpenAI",
        modelType: "TEXT",
        contextWindow: 128000,
      },
      {
        id: "oauth-openai-gpt-4o-mini",
        name: "GPT-4o Mini",
        provider: "openai",
        modelId: "gpt-4o-mini",
        description: "Modelo rápido y económico",
        modelType: "TEXT",
        contextWindow: 128000,
      },
    ];
  }

  async chat(
    accessToken: string,
    model: string,
    messages: ChatMessage[],
  ): Promise<ChatResponse> {
    const client = this.createClient(accessToken);
    const response = await client.chat.completions.create({
      model,
      messages: messages.map((m) => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
      })),
    });

    return {
      content: response.choices[0]?.message?.content || "",
      model: response.model,
      provider: "openai",
      usage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : undefined,
    };
  }

  async *streamChat(
    accessToken: string,
    model: string,
    messages: ChatMessage[],
  ): AsyncGenerator<StreamChunk> {
    const client = this.createClient(accessToken);
    const stream = await client.chat.completions.create({
      model,
      messages: messages.map((m) => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
      })),
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || "";
      const done = chunk.choices[0]?.finish_reason !== null;
      if (content || done) {
        yield { content, done };
      }
    }
  }
}

// ─── Gemini Adapter ──────────────────────────────────────────────────────────

export class GeminiAdapter implements ProviderAdapter {
  readonly providerId = "gemini" as const;

  private createClient(token: string): GoogleGenAI {
    return new GoogleGenAI({ apiKey: token });
  }

  async fetchModels(accessToken: string): Promise<ProviderModel[]> {
    try {
      // Use REST API to list models with OAuth token
      const response = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models?key=" +
          encodeURIComponent(accessToken),
      );

      if (!response.ok) {
        console.error(
          "[GeminiAdapter] fetchModels HTTP error:",
          response.status,
        );
        return this.getDefaultModels();
      }

      const data = (await response.json()) as {
        models?: Array<{
          name: string;
          displayName: string;
          description: string;
          inputTokenLimit?: number;
          supportedGenerationMethods?: string[];
        }>;
      };
      const models: ProviderModel[] = [];

      for (const m of data.models || []) {
        // Only include models that support generateContent
        if (m.supportedGenerationMethods?.includes("generateContent")) {
          const modelId = m.name.replace("models/", "");
          models.push({
            id: `oauth-gemini-${modelId}`,
            name: m.displayName || modelId,
            provider: "gemini",
            modelId,
            description: m.description || `Google ${m.displayName}`,
            modelType: "TEXT",
            contextWindow: m.inputTokenLimit || null,
          });
        }
      }

      return models.length > 0 ? models : this.getDefaultModels();
    } catch (error: any) {
      console.error("[GeminiAdapter] fetchModels error:", error.message);
      return this.getDefaultModels();
    }
  }

  private getDefaultModels(): ProviderModel[] {
    return [
      {
        id: "oauth-gemini-gemini-2.5-flash",
        name: "Gemini 2.5 Flash",
        provider: "gemini",
        modelId: "gemini-2.5-flash",
        description: "Rápido y eficiente",
        modelType: "TEXT",
        contextWindow: 1000000,
      },
      {
        id: "oauth-gemini-gemini-2.5-pro",
        name: "Gemini 2.5 Pro",
        provider: "gemini",
        modelId: "gemini-2.5-pro",
        description: "El más capaz de Google",
        modelType: "TEXT",
        contextWindow: 1000000,
      },
    ];
  }

  async chat(
    accessToken: string,
    model: string,
    messages: ChatMessage[],
  ): Promise<ChatResponse> {
    const client = this.createClient(accessToken);

    // Separate system prompt from messages
    const systemMessages = messages.filter((m) => m.role === "system");
    const chatMessages = messages.filter((m) => m.role !== "system");

    const contents = chatMessages.map((m) => ({
      role: m.role === "assistant" ? ("model" as const) : ("user" as const),
      parts: [{ text: m.content }],
    }));

    const response = await client.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction: systemMessages.length > 0
          ? systemMessages.map((m) => m.content).join("\n")
          : undefined,
      },
    });

    return {
      content: response.text || "",
      model,
      provider: "gemini",
      usage: response.usageMetadata
        ? {
            promptTokens: response.usageMetadata.promptTokenCount || 0,
            completionTokens: response.usageMetadata.candidatesTokenCount || 0,
            totalTokens: response.usageMetadata.totalTokenCount || 0,
          }
        : undefined,
    };
  }

  async *streamChat(
    accessToken: string,
    model: string,
    messages: ChatMessage[],
  ): AsyncGenerator<StreamChunk> {
    const client = this.createClient(accessToken);

    const systemMessages = messages.filter((m) => m.role === "system");
    const chatMessages = messages.filter((m) => m.role !== "system");

    const contents = chatMessages.map((m) => ({
      role: m.role === "assistant" ? ("model" as const) : ("user" as const),
      parts: [{ text: m.content }],
    }));

    const response = await client.models.generateContentStream({
      model,
      contents,
      config: {
        systemInstruction: systemMessages.length > 0
          ? systemMessages.map((m) => m.content).join("\n")
          : undefined,
      },
    });

    for await (const chunk of response) {
      const text = chunk.text || "";
      if (text) {
        yield { content: text, done: false };
      }
    }
    yield { content: "", done: true };
  }
}

// ─── Anthropic Adapter ───────────────────────────────────────────────────────

export class AnthropicAdapter implements ProviderAdapter {
  readonly providerId = "anthropic" as const;

  private createClient(token: string): Anthropic {
    return new Anthropic({ apiKey: token });
  }

  async fetchModels(_accessToken: string): Promise<ProviderModel[]> {
    // Anthropic does not have a public models list API — return known models
    return [
      {
        id: "oauth-anthropic-claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        provider: "anthropic",
        modelId: "claude-sonnet-4-6-20250514",
        description: "Modelo equilibrado de Anthropic",
        modelType: "TEXT",
        contextWindow: 200000,
      },
      {
        id: "oauth-anthropic-claude-haiku-4-5",
        name: "Claude Haiku 4.5",
        provider: "anthropic",
        modelId: "claude-haiku-4-5-20251001",
        description: "Modelo rápido y económico",
        modelType: "TEXT",
        contextWindow: 200000,
      },
      {
        id: "oauth-anthropic-claude-opus-4-6",
        name: "Claude Opus 4.6",
        provider: "anthropic",
        modelId: "claude-opus-4-6-20250515",
        description: "El modelo más potente de Anthropic",
        modelType: "TEXT",
        contextWindow: 200000,
      },
    ];
  }

  async chat(
    accessToken: string,
    model: string,
    messages: ChatMessage[],
  ): Promise<ChatResponse> {
    const client = this.createClient(accessToken);

    // Extract system messages
    const systemMessages = messages.filter((m) => m.role === "system");
    const chatMessages = messages.filter((m) => m.role !== "system");

    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system:
        systemMessages.length > 0
          ? systemMessages.map((m) => m.content).join("\n")
          : undefined,
      messages: chatMessages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    });

    const content = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    return {
      content,
      model: response.model,
      provider: "anthropic",
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens:
          response.usage.input_tokens + response.usage.output_tokens,
      },
    };
  }

  async *streamChat(
    accessToken: string,
    model: string,
    messages: ChatMessage[],
  ): AsyncGenerator<StreamChunk> {
    const client = this.createClient(accessToken);

    const systemMessages = messages.filter((m) => m.role === "system");
    const chatMessages = messages.filter((m) => m.role !== "system");

    const stream = client.messages.stream({
      model,
      max_tokens: 4096,
      system:
        systemMessages.length > 0
          ? systemMessages.map((m) => m.content).join("\n")
          : undefined,
      messages: chatMessages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    });

    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        yield { content: event.delta.text, done: false };
      }
    }
    yield { content: "", done: true };
  }
}

// ─── Adapter Registry ────────────────────────────────────────────────────────

export type OAuthProvider = "openai" | "gemini" | "anthropic";

const adapters: Record<OAuthProvider, ProviderAdapter> = {
  openai: new OpenAIAdapter(),
  gemini: new GeminiAdapter(),
  anthropic: new AnthropicAdapter(),
};

export function getProviderAdapter(provider: OAuthProvider): ProviderAdapter {
  return adapters[provider];
}

export function detectProviderFromModelId(modelId: string): OAuthProvider | null {
  const lower = modelId.toLowerCase();
  if (lower.startsWith("gpt") || lower.startsWith("o1") || lower.startsWith("o3") || lower.startsWith("o4") || lower.startsWith("chatgpt")) return "openai";
  if (lower.startsWith("gemini")) return "gemini";
  if (lower.startsWith("claude")) return "anthropic";
  return null;
}
