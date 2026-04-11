/**
 * Transformer primitives — pure TypeScript implementation of "Attention Is
 * All You Need" (Vaswani et al. 2017), end-to-end.
 *
 * Zero external dependencies. Pure Float64Array math. This module covers
 * ALL sections of the paper:
 *
 *   - Section 3: Model architecture
 *     - Scaled dot-product + multi-head attention (Eq. 1)
 *     - Positional encoding (sinusoidal, section 3.5)
 *     - Token embedding with √d_model scaling (section 3.4)
 *     - Position-wise feed-forward (Eq. 2)
 *     - Encoder / decoder stacks with residuals + layer norm
 *     - Tied output projection with softmax for next-token probs (section 3.4)
 *
 *   - Section 5: Training
 *     - Adam optimizer β1=0.9 β2=0.98 ε=1e-9 (section 5.3)
 *     - Noam LR schedule (Eq. 3) with warmup=4000
 *     - Residual dropout P_drop=0.1 (section 5.4)
 *     - Label smoothing ε_ls=0.1 (section 5.4)
 *     - Cross-entropy loss with label smoothing
 *     - Finite-difference gradients + end-to-end training step
 *
 *   - Section 6: Results / inference
 *     - Greedy auto-regressive decoding
 *     - Beam search (beam size 4, length penalty α=0.6)
 *     - BLEU-4 metric (sentence + corpus level)
 *
 *   - Table 3: All config variants (base, big, A/B/C/D/E ablation rows)
 *   - Serialization: JSON save/load with forward-pass determinism
 */

// ─── Numerical primitives ──────────────────────────────────────────────────
export * from "./matrix";

// ─── Attention (Eq 1 + multi-head, section 3.2) ────────────────────────────
export {
  type AttentionResult,
  type MultiHeadConfig,
  type MultiHeadWeights,
  type MultiHeadResult,
  scaledDotProductAttention,
  multiHeadAttention,
  initMultiHeadWeights,
  baseConfig,
  splitHeads,
} from "./attention";

// ─── Positional encoding + embeddings (section 3.4, 3.5) ───────────────────
export {
  type EmbeddingTable,
  positionalEncoding,
  addPositional,
  initEmbeddingTable,
  embedTokens,
} from "./encoding";

// ─── Position-wise feed-forward (Eq 2, section 3.3) ────────────────────────
export {
  type FFNWeights,
  type FFNActivation,
  feedForward,
  initFFNWeights,
} from "./feedForward";

// ─── Encoder/decoder layers + full stack (section 3.1) ─────────────────────
export {
  type LayerNormParams,
  type EncoderLayerWeights,
  type DecoderLayerWeights,
  type TransformerConfig,
  type TransformerWeights,
  type TransformerForwardResult,
  encoderLayer,
  decoderLayer,
  runEncoder,
  runDecoder,
  initEncoderLayerWeights,
  initDecoderLayerWeights,
  initTransformerWeights,
  baseTransformerConfig,
  tinyTransformerConfig,
  transformerForward,
  embeddingDropout,
} from "./transformer";

// ─── Output projection + softmax (section 3.4) ─────────────────────────────
export {
  type UntiedOutputProjection,
  tiedOutputLogits,
  initUntiedOutputProjection,
  untiedOutputLogits,
  logitsToProbs,
  argmaxTokens,
  topK,
} from "./outputProjection";

// ─── Dropout (section 5.4) ─────────────────────────────────────────────────
export { type DropoutConfig, dropout, identityDropout, observedKeepRate } from "./dropout";

// ─── Loss / label smoothing (section 5.4) ──────────────────────────────────
export {
  type LabelSmoothingConfig,
  type LossResult,
  logSoftmax,
  smoothTargets,
  crossEntropyLoss,
  paperDefaultLoss,
  klSmoothed,
} from "./loss";

// ─── Adam optimizer + LR schedules (Noam, BERT linear, GPT-3 cosine) ───────
export {
  type AdamHyperparameters,
  type AdamState,
  type NoamConfig,
  type BertLinearScheduleConfig,
  type Gpt3CosineScheduleConfig,
  PAPER_ADAM,
  BERT_ADAM,
  BERT_WEIGHT_DECAY,
  GPT3_ADAM,
  GPT3_WEIGHT_DECAY,
  GPT3_GRADIENT_CLIP_NORM,
  GPT3_PRE_TRAINING_HYPERS,
  noamLearningRate,
  noamPeakLearningRate,
  bertLinearSchedule,
  gpt3CosineSchedule,
  createAdamState,
  adamUpdate,
  AdamOptimizer,
  clipGradientNorm,
} from "./optimizer";

// ─── Auto-regressive decoding (section 6.1) ────────────────────────────────
export {
  type DecodeContext,
  type GreedyConfig,
  type GreedyResult,
  type BeamSearchConfig,
  type BeamSearchResult,
  type BeamHypothesis,
  nextTokenLogits,
  greedyDecode,
  beamSearchDecode,
} from "./decoding";

// ─── BLEU metric (section 6.1) ─────────────────────────────────────────────
export {
  ngramCounts,
  modifiedPrecision,
  brevityPenalty,
  corpusBleu,
  sentenceBleu,
  bleu4,
  corpusBleu4,
} from "./bleu";

// ─── Configs / Table 3 presets ─────────────────────────────────────────────
export {
  type ExtendedTransformerConfig,
  paperBaseConfig,
  paperBigConfig,
  tinyConfig,
  allPresets,
  preset,
} from "./configs";

// ─── Serialization ─────────────────────────────────────────────────────────
export {
  type TransformerCheckpointJSON,
  type TransformerCheckpointInput,
  embeddingTableToJSON,
  embeddingTableFromJSON,
  checkpointToJSON,
  checkpointToString,
  checkpointFromJSON,
  checkpointFromString,
} from "./serialization";

// ─── Training loop (copy task + finite-difference gradients) ───────────────
export {
  PAD_ID,
  BOS_ID,
  EOS_ID,
  type CopyTaskExample,
  type CopyTaskConfig,
  generateCopyTaskBatch,
} from "./copyTask";

export {
  type TrainingBatch,
  type TrainingSetup,
  type TrainingStepResult,
  type FDConfig,
  FD_DEFAULTS,
  computeLoss,
  finiteDifferenceGradient,
  trainingStep,
  registerSetupWithOptimizer,
} from "./training";

// ─── BERT (Devlin et al. 2018, bidirectional encoder) ──────────────────────
export * from "./bert";

// ─── GPT-3 (Brown et al. 2020, decoder-only autoregressive) ────────────────
export * from "./gpt";
