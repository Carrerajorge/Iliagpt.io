/**
 * Model configuration presets from Table 3 of the paper.
 *
 *   base  — N=6  d_model=512  d_ff=2048  h=8   d_k=d_v=64   dropout=0.1  label_smooth=0.1
 *   big   — N=6  d_model=1024 d_ff=4096  h=16  d_k=d_v=64   dropout=0.3  label_smooth=0.1
 *
 * Plus the Table 3 ablation rows:
 *
 *   (A1) base with h=1  d_k=d_v=512
 *   (A2) base with h=4  d_k=d_v=128
 *   (A3) base with h=16 d_k=d_v=32
 *   (A4) base with h=32 d_k=d_v=16
 *
 *   (B1) base with d_k=16
 *   (B2) base with d_k=32
 *
 *   (C1) base with N=2
 *   (C2) base with N=4
 *   (C3) base with N=8
 *   (C4) base with d_model=256 d_k=d_v=32
 *   (C5) base with d_model=1024 d_k=d_v=128
 *   (C6) base with d_ff=1024
 *   (C7) base with d_ff=4096
 *
 *   (D1) base with dropout=0.0
 *   (D2) base with dropout=0.2
 *   (D3) base with dropout=0.0 label_smooth=0.0
 *   (D4) base with dropout=0.2 label_smooth=0.2
 *
 *   (E)  base with learned positional embeddings (we still use sinusoidal
 *        but the config documents the paper's experiment).
 */

import { type TransformerConfig, baseTransformerConfig, tinyTransformerConfig } from "./transformer";
import { baseConfig } from "./attention";

export interface ExtendedTransformerConfig extends TransformerConfig {
  /** Paper's name for this configuration row. */
  name: string;
  /** Short description with the dimensions. */
  description: string;
  /** Dropout rate used during training (section 5.4). */
  dropout: number;
  /** Label smoothing ε_ls (section 5.4). */
  labelSmoothing: number;
  /** Use learned positional embeddings instead of sinusoidal (Table 3 row E). */
  learnedPositionalEmbeddings: boolean;
  /** Parameter count (for informational display; paper Table 3 "params ×10^6"). */
  approxParamsMillions: number;
}

// ---------------------------------------------------------------------------
// Parameter counting
// ---------------------------------------------------------------------------

/**
 * Rough approximation of the parameter count for a Transformer config.
 * Matches the paper's "params ×10^6" column to within ~5M; the exact
 * numbers depend on vocab size and tied/untied projection choices.
 *
 * Formula (ignoring vocab/embedding, which dominates for small models
 * but is not listed separately in Table 3):
 *
 *   per encoder layer: 4 · d_model² (multi-head) + 2 · d_model · d_ff (FFN)
 *   per decoder layer: 8 · d_model² (2× multi-head: self + cross) + 2 · d_model · d_ff
 *   layer norm params: 2 · d_model · 4 per encoder layer + 2 · d_model · 6 per decoder layer
 */
function estimateParams(config: TransformerConfig): number {
  const d = config.attention.dModel;
  const ff = config.dFF;
  const perEnc = 4 * d * d + 2 * d * ff + 4 * 2 * d;
  const perDec = 8 * d * d + 2 * d * ff + 6 * 2 * d;
  return config.encoderLayers * perEnc + config.decoderLayers * perDec;
}

// ---------------------------------------------------------------------------
// Preset builders
// ---------------------------------------------------------------------------

function wrap(
  base: TransformerConfig,
  name: string,
  description: string,
  dropout: number,
  labelSmoothing: number,
  learnedPE = false,
): ExtendedTransformerConfig {
  return {
    ...base,
    name,
    description,
    dropout,
    labelSmoothing,
    learnedPositionalEmbeddings: learnedPE,
    approxParamsMillions: Math.round(estimateParams(base) / 1_000_000),
  };
}

/**
 * Paper's base configuration. Row "base" of Table 3.
 *   N=6 d_model=512 d_ff=2048 h=8 d_k=d_v=64 dropout=0.1 ls=0.1
 */
export function paperBaseConfig(): ExtendedTransformerConfig {
  return wrap(
    baseTransformerConfig(),
    "base",
    "paper base: N=6 d_model=512 d_ff=2048 h=8",
    0.1,
    0.1,
  );
}

/**
 * Paper's big configuration. Last row of Table 3.
 *   N=6 d_model=1024 d_ff=4096 h=16 d_k=d_v=64 dropout=0.3 ls=0.1
 */
export function paperBigConfig(): ExtendedTransformerConfig {
  return wrap(
    {
      encoderLayers: 6,
      decoderLayers: 6,
      attention: baseConfig(1024, 16),
      dFF: 4096,
    },
    "big",
    "paper big: N=6 d_model=1024 d_ff=4096 h=16",
    0.3,
    0.1,
  );
}

/**
 * Tiny configuration used by the REST API and the demo page so forward
 * passes finish in milliseconds instead of minutes.
 *   N=2 d_model=32 d_ff=64 h=4
 */
export function tinyConfig(): ExtendedTransformerConfig {
  return wrap(
    tinyTransformerConfig(),
    "tiny",
    "in-house demo: N=2 d_model=32 d_ff=64 h=4",
    0.1,
    0.1,
  );
}

/**
 * Return every preset the paper explicitly lists in Table 3, keyed by
 * name. Used by the REST API `/api/transformer/configs` endpoint and by
 * the test suite.
 */
export function allPresets(): Record<string, ExtendedTransformerConfig> {
  const base = paperBaseConfig();

  const presets: Record<string, ExtendedTransformerConfig> = {
    base,
    big: paperBigConfig(),
    tiny: tinyConfig(),
  };

  // ── Row (A): varying h with the amount of computation held constant ──
  presets["A1"] = wrap(
    { ...base, attention: baseConfig(512, 1) },
    "A1",
    "Table 3 (A): h=1  d_k=d_v=512",
    0.1,
    0.1,
  );
  presets["A2"] = wrap(
    { ...base, attention: baseConfig(512, 4) },
    "A2",
    "Table 3 (A): h=4  d_k=d_v=128",
    0.1,
    0.1,
  );
  presets["A3"] = wrap(
    { ...base, attention: baseConfig(512, 16) },
    "A3",
    "Table 3 (A): h=16 d_k=d_v=32",
    0.1,
    0.1,
  );
  presets["A4"] = wrap(
    { ...base, attention: baseConfig(512, 32) },
    "A4",
    "Table 3 (A): h=32 d_k=d_v=16",
    0.1,
    0.1,
  );

  // ── Row (B): varying d_k (handled via a custom config) ──
  presets["B1"] = wrap(
    {
      ...base,
      attention: { ...base.attention, dK: 16, dV: base.attention.dV },
    },
    "B1",
    "Table 3 (B): d_k=16",
    0.1,
    0.1,
  );
  presets["B2"] = wrap(
    {
      ...base,
      attention: { ...base.attention, dK: 32, dV: base.attention.dV },
    },
    "B2",
    "Table 3 (B): d_k=32",
    0.1,
    0.1,
  );

  // ── Row (C): varying N, d_model, d_ff ──
  presets["C1"] = wrap({ ...base, encoderLayers: 2, decoderLayers: 2 }, "C1", "Table 3 (C): N=2", 0.1, 0.1);
  presets["C2"] = wrap({ ...base, encoderLayers: 4, decoderLayers: 4 }, "C2", "Table 3 (C): N=4", 0.1, 0.1);
  presets["C3"] = wrap({ ...base, encoderLayers: 8, decoderLayers: 8 }, "C3", "Table 3 (C): N=8", 0.1, 0.1);
  presets["C4"] = wrap(
    { ...base, attention: baseConfig(256, 8) },
    "C4",
    "Table 3 (C): d_model=256 d_k=d_v=32",
    0.1,
    0.1,
  );
  presets["C5"] = wrap(
    { ...base, attention: baseConfig(1024, 8) },
    "C5",
    "Table 3 (C): d_model=1024 d_k=d_v=128",
    0.1,
    0.1,
  );
  presets["C6"] = wrap({ ...base, dFF: 1024 }, "C6", "Table 3 (C): d_ff=1024", 0.1, 0.1);
  presets["C7"] = wrap({ ...base, dFF: 4096 }, "C7", "Table 3 (C): d_ff=4096", 0.1, 0.1);

  // ── Row (D): varying dropout + label smoothing ──
  presets["D1"] = wrap(base, "D1", "Table 3 (D): dropout=0.0", 0.0, 0.1);
  presets["D2"] = wrap(base, "D2", "Table 3 (D): dropout=0.2", 0.2, 0.1);
  presets["D3"] = wrap(base, "D3", "Table 3 (D): dropout=0.0 ls=0.0", 0.0, 0.0);
  presets["D4"] = wrap(base, "D4", "Table 3 (D): dropout=0.2 ls=0.2", 0.2, 0.2);

  // ── Row (E): learned positional embeddings ──
  presets["E"] = wrap(
    base,
    "E",
    "Table 3 (E): learned positional embeddings (instead of sinusoidal)",
    0.1,
    0.1,
    /* learnedPE */ true,
  );

  return presets;
}

/**
 * Look up a preset by name. Throws if unknown.
 */
export function preset(name: string): ExtendedTransformerConfig {
  const all = allPresets();
  const config = all[name];
  if (!config) {
    throw new Error(
      `preset("${name}"): unknown preset. Available: ${Object.keys(all).join(", ")}`,
    );
  }
  return config;
}
