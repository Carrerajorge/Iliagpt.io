/**
 * Cognitive Middleware — InHouseGptAdapter.
 *
 * Provider adapter that runs the IN-HOUSE GPT-3 implementation
 * (server/lib/transformer/gpt) instead of calling any external
 * service. Zero network. Fully deterministic given a seed.
 *
 * Why ship this:
 *
 *   1. Always available. The cognitive layer can route requests
 *      here even when every external provider is down or no API
 *      keys are configured. This is the "lights still on" fallback.
 *
 *   2. Reproducible tests. Live HTTP smoke tests need at least one
 *      real provider that doesn't depend on network or credentials.
 *      The in-house adapter is that provider.
 *
 *   3. Worked example. Demonstrates the full provider-agnostic
 *      pattern — anyone reading this file can copy it as a
 *      template for adding a new external provider.
 *
 * Trade-offs:
 *
 *   • The in-house tiny config (L=4, d=16, vocab=48) is NOT a real
 *     language model. It produces tokenized garbage that's useful
 *     for shape testing but not for actual NLP work. The point of
 *     this adapter is to exercise the cognitive pipeline end-to-end
 *     with a deterministic backend, not to replace Claude/GPT.
 *
 *   • The vocab is tiny — character-level. The adapter uses a
 *     deterministic char-code tokenizer for input and decodes the
 *     generated tokens back to a string for the response.
 */

import {
  type GptConfig,
  type GptWeights,
  initGptWeights,
  gptTinyConfig,
  gptGenerate,
  gpt3CosineSchedule,
} from "../../lib/transformer";
import { defaultAlternatingPattern } from "../../lib/transformer";
import type {
  CognitiveIntent,
  NormalizedProviderRequest,
  ProviderAdapter,
  ProviderResponse,
} from "../types";

// ---------------------------------------------------------------------------
// Capability set
// ---------------------------------------------------------------------------

/**
 * The in-house adapter advertises capability for every text intent.
 * Quality is poor (it's a 4-layer toy model) but coverage is total,
 * which is what matters for the "always-on fallback" role.
 */
const IN_HOUSE_CAPABILITIES: ReadonlySet<CognitiveIntent> = new Set<CognitiveIntent>([
  "chat",
  "qa",
  "rag_search",
  "code_generation",
  "doc_generation",
  "data_analysis",
  "tool_call",
  "agent_task",
  "summarization",
  "translation",
  "unknown",
]);

// ---------------------------------------------------------------------------
// Tokenizer (deterministic character-level)
// ---------------------------------------------------------------------------

/**
 * Convert a string to a sequence of vocab token ids. The fallback
 * GPT config uses vocab size 256, with ids 0..4 reserved for special
 * tokens (PAD, UNK, BOS, EOS, MASK). User content maps to ids
 * 5..255 by hashing each character into the available range.
 *
 * This is NOT a BPE tokenizer — it's a deterministic, vocab-safe
 * mapping designed so the model never sees out-of-range ids and
 * tests can pin token outputs to specific inputs.
 */
function tokenize(text: string, vocabSize: number): number[] {
  const ids: number[] = [];
  // Reserve ids 0..4 for specials. User content lives in [5, vocab).
  const userRangeSize = Math.max(1, vocabSize - 5);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    ids.push(5 + (code % userRangeSize));
  }
  return ids;
}

/**
 * Build a "fallback-grade" GPT config tuned for the in-house adapter's
 * runtime use case (always-on offline fallback). Bigger than the
 * `gptTinyConfig` used by the math test suite — that one has
 * vocab=48 and contextWindow=32 which is too small for any realistic
 * prompt — but still small enough to init in <100ms and serve a
 * request in single-digit milliseconds on a single CPU core.
 *
 * Why a separate config:
 *   • `gptTinyConfig` is for unit tests of the math library; its
 *     dimensions are pinned to "smallest thing that exercises every
 *     code path".
 *   • The runtime adapter needs a config that can comfortably hold
 *     a typical chat prompt (system + user + a few hundred tokens
 *     of headroom for generation).
 *   • Anything larger than this (BERT/GPT-3 base sizes) would make
 *     init too slow for an always-on fallback role — we want
 *     adapter construction to be cheap.
 *
 * Dimensions chosen:
 *   numLayers          : 4    (same as tiny — keeps init cheap)
 *   hiddenSize         : 32   (2× tiny — still tiny but more capacity)
 *   numHeads           : 4    (d_head = 8)
 *   intermediateSize   : 128  (4·H, GPT-3 paper convention)
 *   vocabSize          : 256  (covers extended ASCII; >5× tiny)
 *   contextWindow      : 512  (16× tiny — fits realistic prompts)
 *
 * Total parameter count is well under a million, so init takes
 * ~100ms on first call and inference takes ~1-5ms per token.
 */
function buildFallbackConfig(): GptConfig {
  const numLayers = 4;
  const hiddenSize = 32;
  const numHeads = 4;
  return {
    name: "in-house-fallback",
    numLayers,
    hiddenSize,
    numHeads,
    headSize: hiddenSize / numHeads,
    intermediateSize: 4 * hiddenSize,
    vocabSize: 256,
    contextWindow: 512,
    dropoutRate: 0.1,
    layerNormEps: 1e-5,
    initStdDev: 0.02,
    attentionPatterns: defaultAlternatingPattern(numLayers),
    approxParamsMillions: 0,
  };
}

/**
 * Truncate a token sequence to the most recent `maxTokens` tokens.
 * The newest tokens are kept; the oldest are dropped. This matches
 * the cancellation-safe truncation pattern used by every production
 * LLM client when a prompt overflows the context window.
 *
 * Returns the truncated sequence and the number of tokens dropped
 * from the front.
 */
function truncateToFit(
  tokens: number[],
  maxTokens: number,
): { tokens: number[]; dropped: number } {
  if (tokens.length <= maxTokens) {
    return { tokens, dropped: 0 };
  }
  const dropped = tokens.length - maxTokens;
  return { tokens: tokens.slice(dropped), dropped };
}

/**
 * Convert generated token ids back into a printable string. We use
 * a 1:1 vocab → ASCII mapping that wraps around printable range
 * (32..126). Special tokens (0..4) are skipped.
 */
function decode(ids: number[]): string {
  const out: string[] = [];
  for (const id of ids) {
    if (id < 5) continue; // skip specials
    // Map ids 5..47 → printable ASCII 32..126
    const printable = 32 + ((id - 5) % (126 - 32 + 1));
    out.push(String.fromCharCode(printable));
  }
  return out.join("");
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export interface InHouseGptAdapterOptions {
  /**
   * Override the default config. Mostly useful for tests
   * that want a specific weight set.
   */
  weights?: GptWeights;
  /**
   * Seed used for the lazy weight initialization on first call.
   * Default 42 — pinned for cross-run reproducibility.
   */
  seed?: number;
  /**
   * Maximum new tokens to generate per call. Default 16. The
   * orchestrator's `request.maxTokens` overrides this if provided
   * AND non-zero.
   */
  defaultMaxNewTokens?: number;
  /**
   * Adapter name override. Defaults to "in-house-gpt3".
   */
  name?: string;
  /**
   * If true, use the math-library's `gptTinyConfig` instead of
   * the fallback-grade runtime config. ONLY use this in tests of
   * the underlying math primitives — the tiny config has
   * vocab=48 and contextWindow=32 which are too small for any
   * realistic prompt. Default false.
   */
  useTinyConfig?: boolean;
}

export class InHouseGptAdapter implements ProviderAdapter {
  readonly name: string;
  readonly capabilities = IN_HOUSE_CAPABILITIES;
  private weights: GptWeights | null;
  private readonly seed: number;
  private readonly defaultMaxNewTokens: number;
  private readonly useTinyConfig: boolean;
  /** Number of `generate` calls served (for tests + observability). */
  callCount = 0;

  constructor(options: InHouseGptAdapterOptions = {}) {
    this.name = options.name ?? "in-house-gpt3";
    this.weights = options.weights ?? null;
    this.seed = options.seed ?? 42;
    this.defaultMaxNewTokens = options.defaultMaxNewTokens ?? 16;
    this.useTinyConfig = options.useTinyConfig ?? false;
  }

  async generate(
    request: NormalizedProviderRequest,
    signal?: AbortSignal,
  ): Promise<ProviderResponse> {
    this.callCount++;

    if (signal?.aborted) {
      return errorResponse("aborted before call", "aborted");
    }

    // Lazy init: only build weights when first needed. This keeps
    // the adapter cheap to construct (the cognitive router can
    // register it unconditionally without paying init cost upfront).
    //
    // Uses the fallback-grade config (vocab=256, contextWindow=512)
    // so realistic chat prompts fit. The math library's `gptTinyConfig`
    // is for unit tests of the math kernels, not for runtime use.
    if (!this.weights) {
      try {
        const config = this.useTinyConfig ? gptTinyConfig() : buildFallbackConfig();
        this.weights = initGptWeights(config, this.seed);
      } catch (err) {
        return errorResponse(
          `failed to init in-house GPT weights: ${err instanceof Error ? err.message : String(err)}`,
          "error",
        );
      }
    }

    // Build the prompt from the messages. We concatenate role
    // markers + content (no fancy chat template — the toy vocab
    // can't represent full ChatML anyway). Tests pin the exact
    // decoded output by providing controlled inputs.
    const concatenated = buildPromptString(request);
    const rawPromptTokens = tokenize(concatenated, this.weights.config.vocabSize);

    if (rawPromptTokens.length === 0) {
      return errorResponse(
        "in-house adapter received an empty prompt after tokenization",
        "error",
      );
    }

    // Truncate intelligently if the prompt is too long. We reserve
    // room for at least `defaultMaxNewTokens` generated tokens so
    // the model has space to actually produce a response. Anything
    // truncated comes off the FRONT (matches the standard "keep
    // most recent" policy used by every production LLM client).
    const reserveForGeneration = Math.max(1, this.defaultMaxNewTokens);
    const promptCap = Math.max(1, this.weights.config.contextWindow - reserveForGeneration);
    const { tokens: promptTokens, dropped: tokensDroppedByTruncation } = truncateToFit(
      rawPromptTokens,
      promptCap,
    );

    // Pre-allocate room for the generated tokens within the context
    // window — never exceed the model's hard limit.
    const requestedNewTokens = request.maxTokens && request.maxTokens > 0
      ? request.maxTokens
      : this.defaultMaxNewTokens;
    const headroom = this.weights.config.contextWindow - promptTokens.length;
    const maxNewTokens = Math.max(1, Math.min(requestedNewTokens, headroom));

    // Generate. Greedy decoding for determinism — temperature is
    // honored only via the orchestrator's call to a real provider.
    let generationResult: ReturnType<typeof gptGenerate>;
    try {
      generationResult = gptGenerate(this.weights, promptTokens, {
        maxNewTokens,
        sampling: { greedy: true },
      });
    } catch (err) {
      return errorResponse(
        `gptGenerate threw: ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
    }

    if (signal?.aborted) {
      // Aborted while we were spinning the CPU. Honor it.
      return errorResponse("aborted during call", "aborted");
    }

    const generatedText = decode(generationResult.generated);
    const finishReason: ProviderResponse["finishReason"] =
      generationResult.stopReason === "stop-token" ? "stop"
        : generationResult.stopReason === "max-new-tokens" ? "length"
        : generationResult.stopReason === "context-window" ? "length"
        : "stop";

    return {
      text: generatedText,
      finishReason,
      toolCalls: [],
      usage: {
        promptTokens: promptTokens.length,
        completionTokens: generationResult.generated.length,
        totalTokens: promptTokens.length + generationResult.generated.length,
      },
      raw: {
        adapter: this.name,
        stopReason: generationResult.stopReason,
        steps: generationResult.steps,
        tokensDroppedByTruncation,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildPromptString(request: NormalizedProviderRequest): string {
  const parts: string[] = [];
  if (request.systemPrompt) {
    parts.push(`system: ${request.systemPrompt}`);
  }
  for (const m of request.messages) {
    parts.push(`${m.role}: ${m.content}`);
  }
  return parts.join("\n");
}

function errorResponse(
  message: string,
  finishReason: "error" | "aborted",
): ProviderResponse {
  return {
    text: "",
    finishReason,
    toolCalls: [],
    raw: { error: message },
  };
}

// Suppress unused-export warning for a re-export that exists purely
// to keep `gpt3CosineSchedule` reachable from this module's surface.
// It's used by external evaluation scripts that import from the
// adapter file directly.
void gpt3CosineSchedule;
