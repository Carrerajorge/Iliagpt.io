/**
 * GPT-3 model size presets — Table 2.1 of Brown et al. 2020.
 *
 *                  n_params   n_layers  d_model  n_heads  d_head  batch_size  lr
 *   GPT-3 Small       125M       12        768      12      64       0.5M     6.0e-4
 *   GPT-3 Medium      350M       24       1024      16      64       0.5M     3.0e-4
 *   GPT-3 Large       760M       24       1536      16      96       0.5M     2.5e-4
 *   GPT-3 XL          1.3B       24       2048      24     128       1M       2.0e-4
 *   GPT-3 2.7B        2.7B       32       2560      32      80       1M       1.6e-4
 *   GPT-3 6.7B        6.7B       32       4096      32     128       2M       1.2e-4
 *   GPT-3 13B         13.0B      40       5140      40     128       2M       1.0e-4
 *   GPT-3 175B       175.0B      96      12288      96     128       3.2M     0.6e-4
 *
 * "We use alternating dense and locally banded sparse attention patterns
 *  in the layers of the transformer, similar to the Sparse Transformer
 *  [CGRS19]" (§2.1).
 *
 * The alternation is: layer 0 = dense, layer 1 = sparse, layer 2 = dense,
 * layer 3 = sparse, ... (even-indexed = dense, odd-indexed = sparse).
 */

import type { AttentionPattern, GptConfig } from "./types";

// ---------------------------------------------------------------------------
// Parameter counting
// ---------------------------------------------------------------------------

/**
 * Approximate parameter count for a GPT-3 config. Matches the paper's
 * headline numbers in Table 2.1 to within ~5%.
 *
 *   embeddings      = vocab · d + ctx · d
 *   per layer       = 4 · d²  (multi-head attention)
 *                   + 2 · d · (4d)  (FFN with 4·d intermediate)
 *                   + 4 · d  (two LayerNorms)
 *   final LayerNorm = 2 · d
 *   output bias     = vocab (projection is tied)
 */
function estimateParams(config: Omit<GptConfig, "approxParamsMillions">): number {
  const d = config.hiddenSize;
  const v = config.vocabSize;
  const ctx = config.contextWindow;
  const ff = config.intermediateSize;
  const embeddings = v * d + ctx * d;
  const perLayer = 4 * d * d + 2 * d * ff + 4 * d;
  const final = 2 * d + v;
  return embeddings + config.numLayers * perLayer + final;
}

// ---------------------------------------------------------------------------
// Alternating dense / sparse attention pattern
// ---------------------------------------------------------------------------

/**
 * Build the alternating dense/sparse pattern described in §2.1 of
 * Brown et al. 2020. Even-indexed layers are dense (full causal
 * attention), odd-indexed layers are sparse (Sparse Transformer-style
 * locally banded + strided attention).
 *
 * Passing a custom override array to `GptConfig.attentionPatterns`
 * bypasses the alternation — useful for ablation studies.
 */
export function defaultAlternatingPattern(numLayers: number): AttentionPattern[] {
  return Array.from({ length: numLayers }, (_, i) =>
    i % 2 === 0 ? ("dense" as const) : ("sparse" as const),
  );
}

// ---------------------------------------------------------------------------
// Preset builders
// ---------------------------------------------------------------------------

interface PresetInit {
  name: string;
  numLayers: number;
  hiddenSize: number;
  numHeads: number;
  headSize: number;
  vocabSize?: number;
  contextWindow?: number;
}

function makePreset(init: PresetInit): GptConfig {
  const {
    name,
    numLayers,
    hiddenSize,
    numHeads,
    headSize,
    vocabSize = 50_257, // GPT-3 byte-level BPE
    contextWindow = 2048, // Paper's fixed context window
  } = init;
  // Sanity: numHeads × headSize must equal hiddenSize
  if (numHeads * headSize !== hiddenSize) {
    throw new Error(
      `makePreset("${name}"): numHeads (${numHeads}) × headSize (${headSize}) != hiddenSize (${hiddenSize})`,
    );
  }
  const intermediateSize = 4 * hiddenSize;
  const partial: Omit<GptConfig, "approxParamsMillions"> = {
    name,
    numLayers,
    hiddenSize,
    numHeads,
    headSize,
    intermediateSize,
    vocabSize,
    contextWindow,
    dropoutRate: 0.1,
    layerNormEps: 1e-5,
    initStdDev: 0.02,
    attentionPatterns: defaultAlternatingPattern(numLayers),
  };
  return {
    ...partial,
    approxParamsMillions: Math.round(estimateParams(partial) / 1_000_000),
  };
}

// ── Table 2.1 ─────────────────────────────────────────────────────────────

/** GPT-3 Small: 125M, L=12, d_model=768, h=12, d_head=64. */
export function gpt3SmallConfig(): GptConfig {
  return makePreset({
    name: "gpt3-small",
    numLayers: 12,
    hiddenSize: 768,
    numHeads: 12,
    headSize: 64,
  });
}

/** GPT-3 Medium: 350M, L=24, d_model=1024, h=16, d_head=64. */
export function gpt3MediumConfig(): GptConfig {
  return makePreset({
    name: "gpt3-medium",
    numLayers: 24,
    hiddenSize: 1024,
    numHeads: 16,
    headSize: 64,
  });
}

/** GPT-3 Large: 760M, L=24, d_model=1536, h=16, d_head=96. */
export function gpt3LargeConfig(): GptConfig {
  return makePreset({
    name: "gpt3-large",
    numLayers: 24,
    hiddenSize: 1536,
    numHeads: 16,
    headSize: 96,
  });
}

/** GPT-3 XL: 1.3B, L=24, d_model=2048, h=24, d_head≈85.33 → we use 128 per paper. */
export function gpt3XLConfig(): GptConfig {
  // Paper lists d_head=128 for XL despite d_model/h=85.33; follow the
  // paper's stated values even though they don't multiply out exactly.
  // Our makePreset enforces numHeads*headSize === hiddenSize, so we use
  // the consistent interpretation: d_model=2048, h=16, d_head=128.
  return makePreset({
    name: "gpt3-xl",
    numLayers: 24,
    hiddenSize: 2048,
    numHeads: 16,
    headSize: 128,
  });
}

/** GPT-3 2.7B: L=32, d_model=2560, h=32, d_head=80. */
export function gpt3_2_7BConfig(): GptConfig {
  return makePreset({
    name: "gpt3-2.7b",
    numLayers: 32,
    hiddenSize: 2560,
    numHeads: 32,
    headSize: 80,
  });
}

/** GPT-3 6.7B: L=32, d_model=4096, h=32, d_head=128. */
export function gpt3_6_7BConfig(): GptConfig {
  return makePreset({
    name: "gpt3-6.7b",
    numLayers: 32,
    hiddenSize: 4096,
    numHeads: 32,
    headSize: 128,
  });
}

/** GPT-3 13B: L=40, d_model=5120, h=40, d_head=128. */
export function gpt3_13BConfig(): GptConfig {
  // Paper says d_model=5140 but 5140 is not divisible by 40 (=128.5).
  // The reference implementation uses 5120, which IS 40·128. We follow
  // the reference impl for internal consistency.
  return makePreset({
    name: "gpt3-13b",
    numLayers: 40,
    hiddenSize: 5120,
    numHeads: 40,
    headSize: 128,
  });
}

/** GPT-3 175B: L=96, d_model=12288, h=96, d_head=128. */
export function gpt3_175BConfig(): GptConfig {
  return makePreset({
    name: "gpt3-175b",
    numLayers: 96,
    hiddenSize: 12288,
    numHeads: 96,
    headSize: 128,
  });
}

/**
 * Tiny config for unit tests. Deliberately small so every forward pass
 * finishes in milliseconds, matches the alternating-pattern logic, and
 * has a context window big enough for reasonable prompts.
 */
export function gptTinyConfig(): GptConfig {
  return makePreset({
    name: "gpt3-tiny",
    numLayers: 4, // even so the alternation sees both patterns twice
    hiddenSize: 16,
    numHeads: 4,
    headSize: 4,
    vocabSize: 48,
    contextWindow: 32,
  });
}

// ---------------------------------------------------------------------------
// Preset registry
// ---------------------------------------------------------------------------

/**
 * Dictionary of all shipped GPT-3 presets, keyed by name. Used by the
 * REST endpoint `GET /api/gpt3/configs`.
 */
export function allGptPresets(): Record<string, GptConfig> {
  return {
    "gpt3-small": gpt3SmallConfig(),
    "gpt3-medium": gpt3MediumConfig(),
    "gpt3-large": gpt3LargeConfig(),
    "gpt3-xl": gpt3XLConfig(),
    "gpt3-2.7b": gpt3_2_7BConfig(),
    "gpt3-6.7b": gpt3_6_7BConfig(),
    "gpt3-13b": gpt3_13BConfig(),
    "gpt3-175b": gpt3_175BConfig(),
    "gpt3-tiny": gptTinyConfig(),
  };
}

/** Look up a preset by name. Throws on unknown names. */
export function gptPreset(name: string): GptConfig {
  const presets = allGptPresets();
  const c = presets[name];
  if (!c) {
    throw new Error(
      `gptPreset("${name}"): unknown. Available: ${Object.keys(presets).join(", ")}`,
    );
  }
  return c;
}
