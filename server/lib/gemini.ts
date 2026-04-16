import { GoogleGenAI } from "@google/genai";
import { secretManager } from "../services/secretManager";

let _client: GoogleGenAI | null = null;

function getGeminiApiKey(): string | null {
  try {
    return secretManager.getLLMProviderKey("gemini");
  } catch {
    return null;
  }
}

export function getGeminiClient(): GoogleGenAI | null {
  const apiKey = getGeminiApiKey();
  if (!apiKey) return null;
  if (!_client) {
    _client = new GoogleGenAI({ apiKey });
  }
  return _client;
}

export function getGeminiClientOrThrow(): GoogleGenAI {
  const client = getGeminiClient();
  if (!client) {
    throw new Error("GEMINI_API_KEY is not configured");
  }
  return client;
}

export const GEMINI_MODELS = {
  PRO_31: "gemini-3.1-pro",
  FLASH_31: "gemini-3.1-flash",
  FLASH_PREVIEW: "gemini-3-flash-preview",
  PRO_PREVIEW: "gemini-3.1-pro-preview",
  FLASH: "gemini-2.5-flash",
  PRO: "gemini-2.5-pro",
} as const;

export type GeminiModelType = typeof GEMINI_MODELS[keyof typeof GEMINI_MODELS];

export interface GeminiChatMessage {
  role: "user" | "model";
  parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>;
}

export interface GeminiChatOptions {
  model?: GeminiModelType;
  systemInstruction?: string;
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  responseModalities?: ("text" | "image")[];
}

export interface GeminiResponse {
  content: string;
  model: string;
}

export async function geminiChat(
  messages: GeminiChatMessage[],
  options: GeminiChatOptions = {}
): Promise<GeminiResponse> {
  const ai = getGeminiClientOrThrow();
  // Default to a stable, fast model. Preview models can be rate-limited or unavailable.
  const model = options.model || GEMINI_MODELS.FLASH;

  const contents = messages.map(msg => ({
    role: msg.role,
    parts: msg.parts
  }));

  try {
    const result = await ai.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction: options.systemInstruction,
        temperature: options.temperature,
        topP: options.topP,
        maxOutputTokens: options.maxOutputTokens,
        responseModalities: options.responseModalities,
      },
    });

    const text = result.text ?? "";

    return {
      content: text,
      model,
    };
  } catch (error: any) {
    console.error("[Gemini] Error generating content:", error.message);
    throw new Error(`Gemini API error: ${error.message}`);
  }
}

export async function* geminiStreamChat(
  messages: GeminiChatMessage[],
  options: GeminiChatOptions = {}
): AsyncGenerator<{ content: string; done: boolean }, void, unknown> {
  const ai = getGeminiClientOrThrow();
  // Default to a stable, fast model. Preview models can be rate-limited or unavailable.
  const model = options.model || GEMINI_MODELS.FLASH;

  const contents = messages.map(msg => ({
    role: msg.role,
    parts: msg.parts
  }));

  try {
    const response = await ai.models.generateContentStream({
      model,
      contents,
      config: {
        systemInstruction: options.systemInstruction,
        temperature: options.temperature,
        topP: options.topP,
        maxOutputTokens: options.maxOutputTokens,
        responseModalities: options.responseModalities,
      },
    });

    for await (const chunk of response) {
      const text = chunk.text ?? "";
      if (text) {
        yield { content: text, done: false };
      }
    }

    yield { content: "", done: true };
  } catch (error: any) {
    console.error("[Gemini] Stream error:", error.message);
    throw new Error(`Gemini API error: ${error.message}`);
  }
}
