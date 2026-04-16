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

// ---------------------------------------------------------------------------
// Hyperparameter constants from §A.2 and §A.3
//
// These constants do not drive any code path on their own — they are
// the paper's exact recipe exposed for training scripts, UI, and
// documentation. Every value is cited against §A.2 (pre-training) or
// §A.3 (fine-tuning) of arXiv:1810.04805.
// ---------------------------------------------------------------------------

/**
 * BERT pre-training hyperparameters (§A.2 of Devlin et al. 2018).
 *
 *   "We train with batch size of 256 sequences (256 sequences * 512
 *    tokens = 128,000 tokens/batch) for 1,000,000 steps, which is
 *    approximately 40 epochs over the 3.3 billion word corpus. We
 *    use Adam with learning rate of 1e-4, β₁ = 0.9, β₂ = 0.999, L2
 *    weight decay of 0.01, learning rate warmup over the first 10,000
 *    steps, and linear decay of the learning rate. We use a dropout
 *    probability of 0.1 on all layers."
 */
export const BERT_PRE_TRAINING_HYPERS = {
  /** Peak learning rate used by Adam. §A.2: 1e-4. */
  peakLearningRate: 1e-4,
  /** Linear warmup length. §A.2: 10,000. */
  warmupSteps: 10_000,
  /** Total training steps. §A.2: 1,000,000 (≈ 40 epochs over 3.3B words). */
  totalSteps: 1_000_000,
  /** Approximate number of epochs over the 3.3B-word pre-training corpus. */
  approximateEpochs: 40,
  /** Sequences per batch. §A.2: 256 sequences × 512 tokens = 128k tokens/batch. */
  batchSize: 256,
  /** Maximum packed sequence length (combined A+B+specials). §A.2: 512. */
  maxSeqLen: 512,
  /** Dropout rate on all layers. §A.2: 0.1. */
  dropoutRate: 0.1,
  /** MLM masking rate. §3.1: 15%. */
  maskingRate: 0.15,
  /** L2 weight decay. §A.2: 0.01. */
  weightDecay: 0.01,
} as const;

/**
 * BERT fine-tuning hyperparameter grid (§A.3 of Devlin et al. 2018).
 *
 *   "For fine-tuning, most model hyperparameters are the same as in
 *    pre-training, with the exception of the batch size, learning
 *    rate, and number of training epochs. The dropout probability was
 *    always kept at 0.1. The optimal hyperparameter values are
 *    task-specific, but we found the following range of possible
 *    values to work well across all tasks:
 *      Batch size: 16, 32
 *      Learning rate (Adam): 5e-5, 3e-5, 2e-5
 *      Number of epochs: 2, 3, 4"
 *
 * The paper's recommendation is to do a full grid search (|B| × |LR| × |E|
 * = 18 combinations) and pick the one with the best dev-set score.
 */
export const BERT_FINE_TUNING_HYPERS = {
  /** Candidate batch sizes. §A.3: {16, 32}. */
  batchSizes: [16, 32] as const,
  /** Candidate learning rates. §A.3: {5e-5, 3e-5, 2e-5}. */
  learningRates: [5e-5, 3e-5, 2e-5] as const,
  /** Candidate epoch counts. §A.3: {2, 3, 4}. */
  epochs: [2, 3, 4] as const,
  /** Dropout rate is kept fixed at 0.1 during fine-tuning. §A.3. */
  dropoutRate: 0.1,
  /**
   * Per-task observation from §A.3: larger datasets (100k+ labeled
   * examples) are much less sensitive to the hyperparameter choice
   * than small ones, so exhaustive search over this grid is only
   * really necessary for the small-data tasks.
   */
  smallDataSensitive: true,
} as const;

/**
 * Generate every (batchSize, learningRate, epochs) triple in the
 * fine-tuning grid — 2·3·3 = 18 candidate runs. Useful for writing
 * task-specific hyperparameter sweep scripts that follow the paper's
 * protocol exactly.
 */
export function bertFineTuningGrid(): Array<{
  batchSize: number;
  learningRate: number;
  epochs: number;
}> {
  const out: Array<{ batchSize: number; learningRate: number; epochs: number }> = [];
  for (const batchSize of BERT_FINE_TUNING_HYPERS.batchSizes) {
    for (const learningRate of BERT_FINE_TUNING_HYPERS.learningRates) {
      for (const epochs of BERT_FINE_TUNING_HYPERS.epochs) {
        out.push({ batchSize, learningRate, epochs });
      }
    }
  }
  return out;
}
