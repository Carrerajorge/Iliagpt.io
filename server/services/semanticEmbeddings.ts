import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import crypto from "crypto";
import { Logger } from "../lib/logger";
import { withRetry } from "../utils/retry";

export type SemanticEmbeddingProvider = "openai" | "gemini" | "xai" | "hash";

export interface SemanticEmbeddingOptions {
  dimensions?: number;
  maxChars?: number;
  purpose?: "document" | "query";
  cacheNamespace?: string;
}

export interface SemanticEmbeddingResult {
  embedding: number[];
  provider: SemanticEmbeddingProvider;
  model: string;
  cached: boolean;
}

const DEFAULT_DIMENSIONS = 1536;
const DEFAULT_MAX_CHARS = 8_000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const OPENAI_EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
const GEMINI_EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001";
const XAI_EMBEDDING_MODEL = process.env.XAI_EMBEDDING_MODEL || OPENAI_EMBEDDING_MODEL;

type CacheEntry = {
  expiresAt: number;
  result: SemanticEmbeddingResult;
};

const embeddingCache = new Map<string, CacheEntry>();

let openAiClient: OpenAI | null = null;
let xAiClient: OpenAI | null = null;
let geminiClient: GoogleGenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openAiClient) {
    openAiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "missing" });
  }
  return openAiClient;
}

function getXaiClient(): OpenAI {
  if (!xAiClient) {
    xAiClient = new OpenAI({
      baseURL: "https://api.x.ai/v1",
      apiKey: process.env.XAI_API_KEY || "missing",
    });
  }
  return xAiClient;
}

function getGeminiClient(): GoogleGenAI | null {
  if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) {
    return null;
  }
  if (!geminiClient) {
    geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY! });
  }
  return geminiClient;
}

function normalizeText(text: string, maxChars: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, maxChars);
}

function buildCacheKey(text: string, dimensions: number, options: SemanticEmbeddingOptions): string {
  const normalized = normalizeText(text, options.maxChars || DEFAULT_MAX_CHARS);
  const ns = options.cacheNamespace || "default";
  return `${ns}:${dimensions}:${options.purpose || "document"}:${crypto.createHash("sha256").update(normalized).digest("hex")}`;
}

function normalizeVector(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(norm) || norm <= 0) {
    return vector;
  }
  return vector.map((value) => value / norm);
}

function resizeVector(vector: number[], dimensions: number): number[] {
  if (dimensions <= 0) return [];
  if (vector.length === dimensions) {
    return normalizeVector(vector.slice());
  }

  const resized = new Array<number>(dimensions).fill(0);
  const sourceLength = Math.max(vector.length, 1);

  for (let idx = 0; idx < vector.length; idx++) {
    const targetIdx = Math.min(
      dimensions - 1,
      Math.floor((idx / sourceLength) * dimensions),
    );
    resized[targetIdx] += vector[idx];
  }

  return normalizeVector(resized);
}

function generateHashEmbedding(text: string, dimensions: number): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  const words = normalizeText(text, DEFAULT_MAX_CHARS)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2);

  for (let wordIdx = 0; wordIdx < words.length; wordIdx++) {
    const word = words[wordIdx];
    let hash = 2166136261;
    for (let i = 0; i < word.length; i++) {
      hash ^= word.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    vector[Math.abs(hash) % dimensions] += 1 / Math.sqrt(wordIdx + 1);
  }

  return normalizeVector(vector);
}

function isRetryableEmbeddingError(error: Error): boolean {
  return /429|timeout|timed out|rate|temporar|network|econn|fetch failed|5\d\d/i.test(error.message);
}

async function embedWithOpenAI(text: string, dimensions: number, maxChars: number): Promise<number[]> {
  const response = await withRetry(
    async () =>
      getOpenAIClient().embeddings.create({
        model: OPENAI_EMBEDDING_MODEL,
        input: normalizeText(text, maxChars),
        dimensions,
      }),
    {
      maxRetries: 2,
      baseDelay: 400,
      maxDelay: 4_000,
      shouldRetry: isRetryableEmbeddingError,
    },
  );

  return response.data[0]?.embedding || [];
}

async function embedWithXai(text: string, maxChars: number): Promise<number[]> {
  const response = await withRetry(
    async () =>
      getXaiClient().embeddings.create({
        model: XAI_EMBEDDING_MODEL,
        input: normalizeText(text, maxChars),
      }),
    {
      maxRetries: 1,
      baseDelay: 500,
      maxDelay: 3_000,
      shouldRetry: isRetryableEmbeddingError,
    },
  );

  return response.data[0]?.embedding || [];
}

async function embedWithGemini(text: string, maxChars: number): Promise<number[]> {
  const client = getGeminiClient();
  if (!client) {
    return [];
  }

  const response = await withRetry(
    async () =>
      client.models.embedContent({
        model: GEMINI_EMBEDDING_MODEL,
        contents: [
          {
            role: "user",
            parts: [{ text: normalizeText(text, maxChars) }],
          },
        ],
      }),
    {
      maxRetries: 2,
      baseDelay: 400,
      maxDelay: 4_000,
      shouldRetry: isRetryableEmbeddingError,
    },
  );

  const vector =
    (response as any)?.embedding?.values ||
    (response as any)?.embeddings?.[0]?.values ||
    (response as any)?.embeddings?.values ||
    [];

  return Array.isArray(vector) ? vector : [];
}

export async function getSemanticEmbedding(
  text: string,
  options: SemanticEmbeddingOptions = {},
): Promise<SemanticEmbeddingResult> {
  const dimensions = options.dimensions || DEFAULT_DIMENSIONS;
  const maxChars = options.maxChars || DEFAULT_MAX_CHARS;
  const cacheKey = buildCacheKey(text, dimensions, options);
  const cached = embeddingCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return {
      ...cached.result,
      cached: true,
    };
  }

  const providers: Array<{
    name: SemanticEmbeddingProvider;
    enabled: boolean;
    model: string;
    run: () => Promise<number[]>;
  }> = [
    {
      name: "openai",
      enabled: Boolean(process.env.OPENAI_API_KEY),
      model: OPENAI_EMBEDDING_MODEL,
      run: () => embedWithOpenAI(text, dimensions, maxChars),
    },
    {
      name: "gemini",
      enabled: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
      model: GEMINI_EMBEDDING_MODEL,
      run: () => embedWithGemini(text, maxChars),
    },
    {
      name: "xai",
      enabled: Boolean(process.env.XAI_API_KEY),
      model: XAI_EMBEDDING_MODEL,
      run: () => embedWithXai(text, maxChars),
    },
  ];

  for (const provider of providers) {
    if (!provider.enabled) continue;

    try {
      const vector = await provider.run();
      if (vector.length === 0) {
        throw new Error(`Provider ${provider.name} returned an empty embedding`);
      }

      const result: SemanticEmbeddingResult = {
        embedding: resizeVector(vector, dimensions),
        provider: provider.name,
        model: provider.model,
        cached: false,
      };

      embeddingCache.set(cacheKey, {
        expiresAt: Date.now() + CACHE_TTL_MS,
        result,
      });

      return result;
    } catch (error) {
      Logger.warn("[Embeddings] Provider failed, trying next provider", {
        provider: provider.name,
        model: provider.model,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const fallback: SemanticEmbeddingResult = {
    embedding: generateHashEmbedding(text, dimensions),
    provider: "hash",
    model: "hash-fallback",
    cached: false,
  };

  embeddingCache.set(cacheKey, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    result: fallback,
  });

  return fallback;
}

export async function getSemanticEmbeddingVector(
  text: string,
  options: SemanticEmbeddingOptions = {},
): Promise<number[]> {
  const result = await getSemanticEmbedding(text, options);
  return result.embedding;
}
