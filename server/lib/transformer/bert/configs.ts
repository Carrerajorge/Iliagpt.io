/**
 * BERT configuration presets — BASE and LARGE from the paper (§3) plus
 * a TINY config for fast unit tests.
 *
 *   BERT_BASE : L=12 H=768  A=12 d_ff=3072  params ≈ 110M
 *   BERT_LARGE: L=24 H=1024 A=16 d_ff=4096  params ≈ 340M
 *
 * The 4·H relationship between hidden size and intermediate (FFN) size
 * is called out in the footnote on page 3 of the paper:
 *
 *   "In all cases we set the feed-forward/filter size to be 4H, i.e.,
 *    3072 for the H = 768 and 4096 for the H = 1024."
 */

import type { BertConfig } from "./types";

/**
 * Approximate parameter count for a BERT config — matches the paper's
 * headline numbers to within a few million once the small static
 * overheads (LayerNorm γ/β, pooler, heads) are folded in.
 *
 * Components:
 *   • embeddings    = (vocab + typeVocab + maxPos) · H + 2·H (LN)
 *   • each encoder  = 4·H² (multi-head)
 *                   + 2·H·d_ff (FFN)
 *                   + 4·H (two LayerNorms)
 *   • pooler        = H² + H
 *   • MLM head      = H² + H + 2·H + vocab   (tied projection contributes 0)
 *   • NSP head      = 2·H + 2
 */
export function estimateBertParams(config: BertConfig): number {
  const H = config.hiddenSize;
  const ff = config.intermediateSize;
  const embeddingParams =
    (config.vocabSize + config.typeVocabSize + config.maxPositionEmbeddings) * H +
    2 * H;
  const perEncoder = 4 * H * H + 2 * H * ff + 4 * H;
  const encoderParams = config.numLayers * perEncoder;
  const poolerParams = H * H + H;
  const mlmParams = H * H + H + 2 * H + config.vocabSize;
  const nspParams = 2 * H + 2;
  return embeddingParams + encoderParams + poolerParams + mlmParams + nspParams;
}

/**
 * BERT_BASE — L=12 H=768 A=12 d_ff=3072. Paper's headline "base" model,
 * matched in size to OpenAI GPT for apples-to-apples comparison.
 */
export function bertBaseConfig(): BertConfig {
  return {
    name: "bert-base",
    numLayers: 12,
    hiddenSize: 768,
    numHeads: 12,
    intermediateSize: 3072, // 4·768
    vocabSize: 30522, // WordPiece vocab from the public checkpoints
    typeVocabSize: 2,
    maxPositionEmbeddings: 512,
    dropoutRate: 0.1,
    layerNormEps: 1e-12,
    initStdDev: 0.02, // BERT's TruncatedNormal stddev
  };
}

/**
 * BERT_LARGE — L=24 H=1024 A=16 d_ff=4096. Paper's larger model,
 * achieved state-of-the-art on GLUE (+7.7 absolute over prior SOTA).
 */
export function bertLargeConfig(): BertConfig {
  return {
    name: "bert-large",
    numLayers: 24,
    hiddenSize: 1024,
    numHeads: 16,
    intermediateSize: 4096, // 4·1024
    vocabSize: 30522,
    typeVocabSize: 2,
    maxPositionEmbeddings: 512,
    dropoutRate: 0.1,
    layerNormEps: 1e-12,
    initStdDev: 0.02,
  };
}

/**
 * BERT_TINY — a deliberately small config for fast unit tests. Not from
 * the paper. Hidden size divides cleanly by the head count so tests can
 * exercise the exact same code paths as the headline sizes.
 */
export function bertTinyConfig(): BertConfig {
  return {
    name: "bert-tiny",
    numLayers: 2,
    hiddenSize: 16,
    numHeads: 4,
    intermediateSize: 32,
    vocabSize: 48,
    typeVocabSize: 2,
    maxPositionEmbeddings: 32,
    dropoutRate: 0.1,
    layerNormEps: 1e-12,
    initStdDev: 0.02,
  };
}

/**
 * Dictionary of all shipped presets, keyed by name. Used by the REST
 * endpoint `GET /api/bert/configs`.
 */
export function allBertPresets(): Record<string, BertConfig> {
  return {
    "bert-base": bertBaseConfig(),
    "bert-large": bertLargeConfig(),
    "bert-tiny": bertTinyConfig(),
  };
}

/** Look up a preset by name. Throws on unknown names. */
export function bertPreset(name: string): BertConfig {
  const presets = allBertPresets();
  const c = presets[name];
  if (!c) {
    throw new Error(
      `bertPreset("${name}"): unknown. Available: ${Object.keys(presets).join(", ")}`,
    );
  }
  return c;
}
