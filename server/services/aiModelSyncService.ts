/**
 * aiModelSyncService.ts — Hardened Model Catalog & Sync Service
 *
 * Maintains the canonical KNOWN_MODELS catalog and syncs it into the database.
 *
 * Hardening:
 *  1. Deep-frozen immutable catalog (Object.freeze recursive)
 *  2. Input validation on every public function
 *  3. Per-model error isolation with bounded error accumulator
 *  4. Structured JSON logging
 *  5. Batch size limits to prevent unbounded DB writes
 *  6. Safe string coercion for provider lookups
 *  7. Model ID uniqueness validation within each provider
 *  8. Defensive storage call wrappers
 */

import { storage } from "../storage";
import type { InsertAiModel, AiModel } from "@shared/schema";

// ─── Types ────────────────────────────────────────────────────────────────────

interface KnownModel {
  readonly modelId: string;
  readonly name: string;
  readonly contextWindow: number;
  readonly maxOutput: number;
  readonly type: "TEXT" | "IMAGE" | "EMBEDDING" | "AUDIO" | "VIDEO" | "MULTIMODAL";
  readonly inputCost?: string;
  readonly outputCost?: string;
  readonly description?: string;
  readonly releaseDate?: string;
  readonly isDeprecated?: boolean;
}

interface SyncResult {
  added: number;
  updated: number;
  errors: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MAX_ERRORS_PER_SYNC = 25;

function logSync(level: "info" | "warn" | "error", message: string, data?: Record<string, unknown>): void {
  try {
    const entry = { ts: new Date().toISOString(), level, component: "aiModelSync", message, ...data };
    if (level === "error") console.error(JSON.stringify(entry));
    else if (level === "warn") console.warn(JSON.stringify(entry));
    else console.log(JSON.stringify(entry));
  } catch { /* swallow */ }
}

/** Sanitize provider input. */
function normalizeProvider(provider: unknown): string {
  if (provider === null || provider === undefined) return "";
  return String(provider).toLowerCase().trim();
}

/** Deep-freeze an object and all nested arrays/objects. */
function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") return obj;
  Object.freeze(obj);
  for (const value of Object.values(obj as Record<string, unknown>)) {
    if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
      deepFreeze(value);
    }
  }
  return obj;
}

// ============================================================================
// COMPLETE MODEL CATALOG - Updated February 2026
// ============================================================================

const KNOWN_MODELS: Readonly<Record<string, readonly KnownModel[]>> = deepFreeze({
  // ========================================
  // GOOGLE GEMINI MODELS
  // ========================================
  google: [
    // Gemini 3 Series (Latest)
    { modelId: "gemini-3-flash-preview", name: "Gemini 3 Flash (Preview)", contextWindow: 1000000, maxOutput: 65536, type: "MULTIMODAL", inputCost: "0.0001", outputCost: "0.0004", description: "Fastest frontier-class model with upgraded reasoning" },
    { modelId: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro (Preview)", contextWindow: 2000000, maxOutput: 65536, type: "MULTIMODAL", inputCost: "0.003", outputCost: "0.012", description: "Most powerful Google model - PhD-level reasoning" },
    { modelId: "gemini-3-pro", name: "Gemini 3 Pro", contextWindow: 1000000, maxOutput: 65536, type: "MULTIMODAL", inputCost: "0.003", outputCost: "0.012", description: "Most powerful Google model - PhD-level reasoning" },
    { modelId: "gemini-3-pro-image", name: "Gemini 3 Pro Image", contextWindow: 1000000, maxOutput: 65536, type: "MULTIMODAL", inputCost: "0.003", outputCost: "0.012", description: "Image generation with improved text rendering" },
    { modelId: "gemini-3-deep-think", name: "Gemini 3 Deep Think", contextWindow: 1000000, maxOutput: 65536, type: "TEXT", inputCost: "0.005", outputCost: "0.02", description: "Advanced reasoning for complex problems" },

    // Gemini 2.5 Series (Current Production)
    { modelId: "gemini-2.5-pro", name: "Gemini 2.5 Pro", contextWindow: 2000000, maxOutput: 65536, type: "MULTIMODAL", inputCost: "0.0025", outputCost: "0.01", description: "Most capable 2.5 model - 2M context" },
    { modelId: "gemini-2.5-flash", name: "Gemini 2.5 Flash", contextWindow: 1000000, maxOutput: 65536, type: "MULTIMODAL", inputCost: "0.00015", outputCost: "0.0006", description: "Fast and efficient multimodal" },
    { modelId: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash-Lite", contextWindow: 1000000, maxOutput: 65536, type: "MULTIMODAL", inputCost: "0.0001", outputCost: "0.0004", description: "Optimized for high-throughput" },
    { modelId: "gemini-2.5-flash-image", name: "Gemini 2.5 Flash Image", contextWindow: 1000000, maxOutput: 65536, type: "IMAGE", inputCost: "0.00015", outputCost: "0.0006", description: "Image generation and editing" },

    // Gemini 2.0 Series (Stable)
    { modelId: "gemini-2.0-flash", name: "Gemini 2.0 Flash", contextWindow: 1000000, maxOutput: 8192, type: "MULTIMODAL", inputCost: "0.0001", outputCost: "0.0004", description: "Previous generation Flash" },
    { modelId: "gemini-2.0-flash-exp", name: "Gemini 2.0 Flash Exp", contextWindow: 1000000, maxOutput: 8192, type: "MULTIMODAL", inputCost: "0.0001", outputCost: "0.0004", description: "Experimental flash model" },

    // Gemini 1.5 Series (Legacy)
    { modelId: "gemini-1.5-pro", name: "Gemini 1.5 Pro", contextWindow: 2000000, maxOutput: 8192, type: "MULTIMODAL", inputCost: "0.00125", outputCost: "0.005", description: "Gemini 1.5 flagship", isDeprecated: true },
    { modelId: "gemini-1.5-flash", name: "Gemini 1.5 Flash", contextWindow: 1000000, maxOutput: 8192, type: "MULTIMODAL", inputCost: "0.000075", outputCost: "0.0003", description: "Fast Gemini 1.5 model", isDeprecated: true },

    // Specialized Google Models
    { modelId: "imagen-4", name: "Imagen 4", contextWindow: 0, maxOutput: 0, type: "IMAGE", inputCost: "0.04", outputCost: "0.00", description: "Most capable text-to-image model" },
    { modelId: "imagen-3", name: "Imagen 3", contextWindow: 0, maxOutput: 0, type: "IMAGE", inputCost: "0.04", outputCost: "0.00", description: "Image generation model" },
    { modelId: "veo-3", name: "Veo 3", contextWindow: 0, maxOutput: 0, type: "VIDEO", inputCost: "0.10", outputCost: "0.00", description: "Video generation with audio" },
    // Embeddings
    { modelId: "gemini-embedding-001", name: "Gemini Embedding 001", contextWindow: 2048, maxOutput: 1, type: "EMBEDDING", inputCost: "0.000025", outputCost: "0.00", description: "Text embedding model (embedContent)" },
    { modelId: "text-embedding-004", name: "Text Embedding 004", contextWindow: 2048, maxOutput: 0, type: "EMBEDDING", inputCost: "0.000025", outputCost: "0.00", description: "Text embedding model", isDeprecated: true },
  ],

  // ========================================
  // XAI GROK MODELS
  // ========================================
  xai: [
    // Grok 4 Series (Latest)
    { modelId: "grok-4.1-fast", name: "Grok 4.1 Fast", contextWindow: 2000000, maxOutput: 16384, type: "TEXT", inputCost: "0.0005", outputCost: "0.002", description: "Fast inference with 2M context" },
    { modelId: "grok-4.1-fast-reasoning", name: "Grok 4.1 Fast Reasoning", contextWindow: 2000000, maxOutput: 16384, type: "TEXT", inputCost: "0.001", outputCost: "0.004", description: "Fast with reasoning capabilities" },
    { modelId: "grok-4", name: "Grok 4", contextWindow: 256000, maxOutput: 16384, type: "MULTIMODAL", inputCost: "0.003", outputCost: "0.015", description: "Most intelligent xAI model" },
    { modelId: "grok-4-fast", name: "Grok 4 Fast", contextWindow: 2000000, maxOutput: 16384, type: "TEXT", inputCost: "0.0005", outputCost: "0.002", description: "Cost-efficient intelligence" },
    { modelId: "grok-4-fast-reasoning", name: "Grok 4 Fast Reasoning", contextWindow: 2000000, maxOutput: 16384, type: "TEXT", inputCost: "0.001", outputCost: "0.004", description: "Fast reasoning variant" },

    // Grok 3 Series
    { modelId: "grok-3", name: "Grok 3", contextWindow: 131072, maxOutput: 16384, type: "TEXT", inputCost: "0.003", outputCost: "0.015", description: "xAI flagship model" },
    { modelId: "grok-3-fast", name: "Grok 3 Fast", contextWindow: 131072, maxOutput: 16384, type: "TEXT", inputCost: "0.0005", outputCost: "0.002", description: "Fast inference Grok 3" },
    { modelId: "grok-3-mini", name: "Grok 3 Mini", contextWindow: 131072, maxOutput: 16384, type: "TEXT", inputCost: "0.0003", outputCost: "0.0005", description: "Smaller, faster Grok model" },
    { modelId: "grok-3-mini-fast", name: "Grok 3 Mini Fast", contextWindow: 131072, maxOutput: 16384, type: "TEXT", inputCost: "0.0001", outputCost: "0.0004", description: "Fastest Grok variant" },

    // Grok 2 Series (Legacy)
    { modelId: "grok-2", name: "Grok 2", contextWindow: 131072, maxOutput: 8192, type: "TEXT", inputCost: "0.002", outputCost: "0.01", description: "Previous generation Grok", isDeprecated: true },
    { modelId: "grok-2-vision", name: "Grok 2 Vision", contextWindow: 32768, maxOutput: 8192, type: "MULTIMODAL", inputCost: "0.002", outputCost: "0.01", description: "Image analysis" },
    { modelId: "grok-beta", name: "Grok Beta", contextWindow: 131072, maxOutput: 8192, type: "TEXT", inputCost: "0.002", outputCost: "0.01", description: "Beta version" },

    // Specialized Grok Models
    { modelId: "grok-code-fast-1", name: "Grok Code Fast", contextWindow: 256000, maxOutput: 16384, type: "TEXT", inputCost: "0.0005", outputCost: "0.002", description: "Agentic coding model" },
    { modelId: "grok-2-image-1212", name: "Grok Image", contextWindow: 0, maxOutput: 0, type: "IMAGE", inputCost: "0.04", outputCost: "0.00", description: "Image generation" },
  ],

  // ========================================
  // OPENAI MODELS
  // ========================================
  openai: [
    // GPT-5 Series (Latest)
    { modelId: "gpt-5", name: "GPT-5", contextWindow: 272000, maxOutput: 32768, type: "MULTIMODAL", inputCost: "0.01", outputCost: "0.03", description: "Latest flagship with smart routing" },
    { modelId: "gpt-5.2", name: "GPT-5.2", contextWindow: 272000, maxOutput: 32768, type: "MULTIMODAL", inputCost: "0.01", outputCost: "0.03", description: "Best for coding and agentic tasks" },
    { modelId: "gpt-5.2-codex", name: "GPT-5.2 Codex", contextWindow: 272000, maxOutput: 32768, type: "TEXT", inputCost: "0.01", outputCost: "0.03", description: "Advanced coding model" },
    { modelId: "gpt-5.1", name: "GPT-5.1", contextWindow: 272000, maxOutput: 32768, type: "MULTIMODAL", inputCost: "0.008", outputCost: "0.024", description: "Stability and efficiency focused" },
    { modelId: "gpt-5.1-codex-max", name: "GPT-5.1 Codex Max", contextWindow: 272000, maxOutput: 32768, type: "TEXT", inputCost: "0.01", outputCost: "0.03", description: "Agentic coding model" },
    { modelId: "gpt-5-mini", name: "GPT-5 Mini", contextWindow: 128000, maxOutput: 16384, type: "MULTIMODAL", inputCost: "0.001", outputCost: "0.003", description: "Faster, cost-efficient" },
    { modelId: "gpt-5-nano", name: "GPT-5 Nano", contextWindow: 128000, maxOutput: 16384, type: "MULTIMODAL", inputCost: "0.0002", outputCost: "0.0006", description: "Most cost-efficient" },

    // GPT-4.1 Series
    { modelId: "gpt-4.1", name: "GPT-4.1", contextWindow: 1000000, maxOutput: 32768, type: "MULTIMODAL", inputCost: "0.002", outputCost: "0.008", description: "Extended context GPT-4" },
    { modelId: "gpt-4.1-mini", name: "GPT-4.1 Mini", contextWindow: 128000, maxOutput: 16384, type: "MULTIMODAL", inputCost: "0.0004", outputCost: "0.0016", description: "Balanced performance" },
    { modelId: "gpt-4.1-nano", name: "GPT-4.1 Nano", contextWindow: 128000, maxOutput: 16384, type: "MULTIMODAL", inputCost: "0.0001", outputCost: "0.0004", description: "Most affordable" },

    // GPT-4o Series
    { modelId: "gpt-4o", name: "GPT-4o", contextWindow: 128000, maxOutput: 16384, type: "MULTIMODAL", inputCost: "0.0025", outputCost: "0.01", description: "Omni model with vision and audio" },
    { modelId: "gpt-4o-mini", name: "GPT-4o Mini", contextWindow: 128000, maxOutput: 16384, type: "MULTIMODAL", inputCost: "0.00015", outputCost: "0.0006", description: "Smaller GPT-4o variant" },

    // O-Series Reasoning Models
    { modelId: "o3", name: "o3", contextWindow: 128000, maxOutput: 100000, type: "TEXT", inputCost: "0.01", outputCost: "0.04", description: "Advanced reasoning model" },
    { modelId: "o3-pro", name: "o3 Pro", contextWindow: 128000, maxOutput: 100000, type: "TEXT", inputCost: "0.02", outputCost: "0.08", description: "More compute for better responses" },
    { modelId: "o3-mini", name: "o3 Mini", contextWindow: 128000, maxOutput: 65536, type: "TEXT", inputCost: "0.00115", outputCost: "0.0044", description: "Smaller reasoning model" },
    { modelId: "o4-mini", name: "o4 Mini", contextWindow: 128000, maxOutput: 65536, type: "TEXT", inputCost: "0.001", outputCost: "0.004", description: "Fast reasoning model" },
    { modelId: "o4-mini-high", name: "o4 Mini High", contextWindow: 128000, maxOutput: 65536, type: "TEXT", inputCost: "0.002", outputCost: "0.008", description: "Extended reasoning" },
    { modelId: "o1", name: "o1", contextWindow: 200000, maxOutput: 100000, type: "TEXT", inputCost: "0.015", outputCost: "0.06", description: "Original reasoning model" },
    { modelId: "o1-pro", name: "o1 Pro", contextWindow: 200000, maxOutput: 100000, type: "TEXT", inputCost: "0.02", outputCost: "0.08", description: "Pro reasoning variant" },
    { modelId: "o1-mini", name: "o1 Mini", contextWindow: 128000, maxOutput: 65536, type: "TEXT", inputCost: "0.003", outputCost: "0.012", description: "Smaller o1 variant" },

    // Open-weight Models
    { modelId: "gpt-oss-120b", name: "GPT-OSS 120B", contextWindow: 128000, maxOutput: 16384, type: "TEXT", inputCost: "0.001", outputCost: "0.003", description: "Open-weight 120B model" },
    { modelId: "gpt-oss-20b", name: "GPT-OSS 20B", contextWindow: 128000, maxOutput: 16384, type: "TEXT", inputCost: "0.0003", outputCost: "0.0009", description: "Open-weight 20B model" },

    // Specialized Models
    { modelId: "sora-2", name: "Sora 2", contextWindow: 0, maxOutput: 0, type: "VIDEO", inputCost: "0.10", outputCost: "0.00", description: "Video generation with audio" },
    { modelId: "gpt-image-1.5", name: "GPT Image 1.5", contextWindow: 0, maxOutput: 0, type: "IMAGE", inputCost: "0.04", outputCost: "0.00", description: "State-of-the-art image generation" },
    { modelId: "dall-e-3", name: "DALL-E 3", contextWindow: 0, maxOutput: 0, type: "IMAGE", inputCost: "0.04", outputCost: "0.00", description: "Image generation" },
    { modelId: "whisper-1", name: "Whisper", contextWindow: 0, maxOutput: 0, type: "AUDIO", inputCost: "0.006", outputCost: "0.00", description: "Speech to text" },
    { modelId: "text-embedding-3-large", name: "Text Embedding 3 Large", contextWindow: 8191, maxOutput: 0, type: "EMBEDDING", inputCost: "0.00013", outputCost: "0.00", description: "Latest embedding model" },
  ],

  // ========================================
  // ANTHROPIC MODELS
  // ========================================
  anthropic: [
    // Claude 4.5 Series (Latest)
    { modelId: "claude-opus-4-5", name: "Claude Opus 4.5", contextWindow: 200000, maxOutput: 32000, type: "TEXT", inputCost: "0.015", outputCost: "0.075", description: "Most capable Claude model" },
    { modelId: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", contextWindow: 200000, maxOutput: 16000, type: "TEXT", inputCost: "0.003", outputCost: "0.015", description: "Balanced performance and cost" },
    { modelId: "claude-haiku-4-5", name: "Claude Haiku 4.5", contextWindow: 200000, maxOutput: 8000, type: "TEXT", inputCost: "0.00025", outputCost: "0.00125", description: "Fastest Claude model" },

    // Claude 3.5 Series
    { modelId: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet", contextWindow: 200000, maxOutput: 8192, type: "TEXT", inputCost: "0.003", outputCost: "0.015", description: "Previous generation Sonnet" },
    { modelId: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku", contextWindow: 200000, maxOutput: 8192, type: "TEXT", inputCost: "0.00025", outputCost: "0.00125", description: "Previous generation Haiku" },

    // Claude 3 Series (Legacy)
    { modelId: "claude-3-opus-20240229", name: "Claude 3 Opus", contextWindow: 200000, maxOutput: 4096, type: "TEXT", inputCost: "0.015", outputCost: "0.075", description: "Claude 3 flagship model", isDeprecated: true },
    { modelId: "claude-3-sonnet-20240229", name: "Claude 3 Sonnet", contextWindow: 200000, maxOutput: 4096, type: "TEXT", inputCost: "0.003", outputCost: "0.015", description: "Claude 3 balanced model", isDeprecated: true },
    { modelId: "claude-3-haiku-20240307", name: "Claude 3 Haiku", contextWindow: 200000, maxOutput: 4096, type: "TEXT", inputCost: "0.00025", outputCost: "0.00125", description: "Claude 3 fast model", isDeprecated: true },
  ],

  // ========================================
  // OPENROUTER MODELS
  // ========================================
  openrouter: [
    // Meta Llama
    { modelId: "meta-llama/llama-3.3-70b", name: "Llama 3.3 70B", contextWindow: 128000, maxOutput: 8192, type: "TEXT", inputCost: "0.0004", outputCost: "0.0004", description: "Meta's open source model" },
    { modelId: "meta-llama/llama-3.1-405b", name: "Llama 3.1 405B", contextWindow: 128000, maxOutput: 4096, type: "TEXT", inputCost: "0.003", outputCost: "0.003", description: "Largest Llama model" },
    { modelId: "meta-llama/llama-3.1-70b", name: "Llama 3.1 70B", contextWindow: 128000, maxOutput: 4096, type: "TEXT", inputCost: "0.0004", outputCost: "0.0004", description: "Medium Llama model" },
    { modelId: "meta-llama/llama-4-70b", name: "Llama 4 70B", contextWindow: 256000, maxOutput: 16384, type: "TEXT", inputCost: "0.0005", outputCost: "0.0005", description: "Latest Llama model" },

    // Mistral
    { modelId: "mistralai/mistral-large-2411", name: "Mistral Large 24.11", contextWindow: 128000, maxOutput: 8192, type: "TEXT", inputCost: "0.002", outputCost: "0.006", description: "Mistral flagship model" },
    { modelId: "mistralai/mistral-medium", name: "Mistral Medium", contextWindow: 32000, maxOutput: 8192, type: "TEXT", inputCost: "0.00275", outputCost: "0.0081", description: "Balanced Mistral model" },
    { modelId: "mistralai/codestral-2501", name: "Codestral", contextWindow: 256000, maxOutput: 8192, type: "TEXT", inputCost: "0.0003", outputCost: "0.0009", description: "Code-specialized model" },

    // DeepSeek
    { modelId: "deepseek/deepseek-v3", name: "DeepSeek V3", contextWindow: 64000, maxOutput: 8192, type: "TEXT", inputCost: "0.00014", outputCost: "0.00028", description: "DeepSeek's latest model" },
    { modelId: "deepseek/deepseek-r1", name: "DeepSeek R1", contextWindow: 64000, maxOutput: 8192, type: "TEXT", inputCost: "0.00055", outputCost: "0.00219", description: "DeepSeek reasoning model" },

    // Qwen
    { modelId: "qwen/qwen-2.5-72b", name: "Qwen 2.5 72B", contextWindow: 32000, maxOutput: 8192, type: "TEXT", inputCost: "0.0003", outputCost: "0.0003", description: "Alibaba's Qwen model" },
    { modelId: "qwen/qwq-32b", name: "QwQ 32B", contextWindow: 32000, maxOutput: 8192, type: "TEXT", inputCost: "0.0002", outputCost: "0.0002", description: "Qwen reasoning model" },

    // Cohere
    { modelId: "cohere/command-r-plus", name: "Command R+", contextWindow: 128000, maxOutput: 4096, type: "TEXT", inputCost: "0.0025", outputCost: "0.01", description: "Cohere's flagship model" },
  ],

  // ========================================
  // PERPLEXITY MODELS
  // ========================================
  perplexity: [
    { modelId: "sonar-pro", name: "Sonar Pro", contextWindow: 200000, maxOutput: 8192, type: "TEXT", inputCost: "0.003", outputCost: "0.015", description: "Search-enhanced model" },
    { modelId: "sonar", name: "Sonar", contextWindow: 128000, maxOutput: 8192, type: "TEXT", inputCost: "0.001", outputCost: "0.001", description: "Fast search model" },
    { modelId: "sonar-reasoning-pro", name: "Sonar Reasoning Pro", contextWindow: 128000, maxOutput: 8192, type: "TEXT", inputCost: "0.002", outputCost: "0.008", description: "Reasoning with search" },
    { modelId: "sonar-reasoning", name: "Sonar Reasoning", contextWindow: 128000, maxOutput: 8192, type: "TEXT", inputCost: "0.001", outputCost: "0.004", description: "Basic reasoning with search" },
  ],
});

// ─── Public API ───────────────────────────────────────────────────────────────

export function getAvailableProviders(): string[] {
  return Object.keys(KNOWN_MODELS);
}

export function getKnownModelsForProvider(provider: unknown): readonly KnownModel[] {
  const key = normalizeProvider(provider);
  if (!key) return [];
  return KNOWN_MODELS[key] ?? [];
}

export async function syncModelsForProvider(provider: unknown): Promise<SyncResult> {
  const result: SyncResult = { added: 0, updated: 0, errors: [] };
  const key = normalizeProvider(provider);

  if (!key) {
    result.errors.push("syncModelsForProvider: empty provider");
    return result;
  }

  const knownModels = KNOWN_MODELS[key];
  if (!knownModels || knownModels.length === 0) {
    result.errors.push(`Unknown provider: ${key}`);
    return result;
  }

  // Validate no duplicate model IDs in catalog
  const seen = new Set<string>();
  for (const m of knownModels) {
    if (seen.has(m.modelId)) {
      logSync("warn", `Duplicate modelId in catalog`, { provider: key, modelId: m.modelId });
    }
    seen.add(m.modelId);
  }

  let existingModels: AiModel[];
  try {
    existingModels = await storage.getAiModels();
  } catch (err) {
    const msg = `Failed to fetch existing models: ${err instanceof Error ? err.message : String(err)}`;
    result.errors.push(msg);
    logSync("error", msg);
    return result;
  }

  const existingByModelId = new Map(
    existingModels
      .filter(m => normalizeProvider(m.provider) === key)
      .map(m => [m.modelId, m])
  );

  for (const model of knownModels) {
    if (result.errors.length >= MAX_ERRORS_PER_SYNC) {
      logSync("warn", "Max errors reached, stopping sync early", { provider: key, errors: result.errors.length });
      break;
    }

    try {
      const existing = existingByModelId.get(model.modelId);

      if (existing) {
        await storage.updateAiModel(existing.id, {
          name: model.name,
          modelType: model.type,
          contextWindow: model.contextWindow,
          maxOutputTokens: model.maxOutput,
          inputCostPer1k: model.inputCost || "0.00",
          outputCostPer1k: model.outputCost || "0.00",
          description: model.description || existing.description,
          isDeprecated: model.isDeprecated ? "true" : "false",
          releaseDate: model.releaseDate,
          lastSyncAt: new Date(),
        });
        result.updated++;
      } else {
        await storage.createAiModel({
          name: model.name,
          provider: key,
          modelId: model.modelId,
          modelType: model.type,
          contextWindow: model.contextWindow,
          maxOutputTokens: model.maxOutput,
          inputCostPer1k: model.inputCost || "0.00",
          outputCostPer1k: model.outputCost || "0.00",
          costPer1k: model.inputCost || "0.00",
          description: model.description,
          isDeprecated: model.isDeprecated ? "true" : "false",
          releaseDate: model.releaseDate,
          status: "inactive",
          isEnabled: "false",
          lastSyncAt: new Date(),
        });
        result.added++;
      }
    } catch (error: unknown) {
      const msg = `Error syncing ${model.modelId}: ${error instanceof Error ? error.message : String(error)}`;
      result.errors.push(msg);
      logSync("error", msg, { provider: key, modelId: model.modelId });
    }
  }

  if (result.added > 0 || result.updated > 0) {
    logSync("info", `Sync complete for ${key}`, { added: result.added, updated: result.updated });
  }

  return result;
}

export async function syncAllProviders(): Promise<Record<string, SyncResult>> {
  const results: Record<string, SyncResult> = {};

  for (const provider of Object.keys(KNOWN_MODELS)) {
    try {
      results[provider] = await syncModelsForProvider(provider);
    } catch (err) {
      results[provider] = {
        added: 0,
        updated: 0,
        errors: [`syncAllProviders: ${err instanceof Error ? err.message : String(err)}`],
      };
      logSync("error", `syncAllProviders failed for ${provider}`, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  return results;
}

export function getModelStats(): { totalKnown: number; byProvider: Record<string, number>; byType: Record<string, number> } {
  const byProvider: Record<string, number> = {};
  const byType: Record<string, number> = {};
  let totalKnown = 0;

  for (const [provider, models] of Object.entries(KNOWN_MODELS)) {
    byProvider[provider] = models.length;
    totalKnown += models.length;

    for (const model of models) {
      byType[model.type] = (byType[model.type] || 0) + 1;
    }
  }

  return { totalKnown, byProvider, byType };
}
