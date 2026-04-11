/**
 * Shared types for the in-house BERT implementation.
 *
 * Devlin, Chang, Lee, Toutanova 2018 — "BERT: Pre-training of Deep
 * Bidirectional Transformers for Language Understanding".
 *
 * BERT is an *encoder-only* Transformer stack trained on two unsupervised
 * objectives:
 *
 *   1. Masked Language Model (MLM, §3.1 Task #1): 15% of input tokens are
 *      masked and the model predicts the original vocabulary id at each
 *      masked position.
 *
 *   2. Next Sentence Prediction (NSP, §3.1 Task #2): a binary classifier
 *      on top of the [CLS] pooled representation predicts whether
 *      sentence B follows sentence A in the source corpus.
 *
 * The encoder is the same mathematical object as the Vaswani et al. 2017
 * encoder — bidirectional multi-head self-attention + position-wise FFN
 * + residual + LayerNorm — but with three implementation differences the
 * paper calls out in §A.2:
 *
 *   • GELU activation in the FFN (not ReLU)
 *   • LEARNED positional embeddings (not sinusoidal)
 *   • Three input embedding tables summed together
 *     (token + segment/type + position), followed by LayerNorm + dropout
 *
 * This module reuses `runEncoder()` from the Vaswani stack with
 * `ffnActivation="gelu"` to stay paper-faithful on all counts.
 */

import type { Matrix } from "../matrix";
import type { EncoderLayerWeights } from "../transformer";

// ---------------------------------------------------------------------------
// Special token ids
//
// BERT's reserved tokens (Figure 2 + §3). Our in-house vocab convention
// places them at contiguous low ids for readability; any real tokenizer
// must pin these five to the same values or the pre-trained weights will
// collapse.
// ---------------------------------------------------------------------------

export const BERT_SPECIAL_TOKENS = {
  /** Padding token — never contributes to loss, never attended to. */
  PAD: 0,
  /** Unknown / out-of-vocabulary token. */
  UNK: 1,
  /** Classification token — prepended to every sequence. Its final hidden
   *  state is pooled for sentence-level tasks (§3, §3.1). */
  CLS: 2,
  /** Sentence separator — between two packed sentences and at the end of
   *  every sequence (Figure 2). */
  SEP: 3,
  /** Mask token — substituted in for 80% of masked positions in MLM
   *  pre-training (§3.1 Task #1). */
  MASK: 4,
} as const;

export type BertSpecialTokenId =
  (typeof BERT_SPECIAL_TOKENS)[keyof typeof BERT_SPECIAL_TOKENS];

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * Full BERT hyperparameter record.
 *
 * Paper constants for the two headline sizes (§3):
 *
 *   BERT_BASE : L=12  H=768  A=12  d_ff=3072  params≈110M
 *   BERT_LARGE: L=24  H=1024 A=16  d_ff=4096  params≈340M
 *
 * `intermediateSize` is set to `4H` everywhere in the paper — we keep
 * that as the default in `configs.ts` but allow callers to override for
 * ablation studies.
 */
export interface BertConfig {
  /** Name for logging / presets (e.g. "bert-base", "bert-large", "bert-tiny"). */
  name: string;
  /** Number of encoder layers L. */
  numLayers: number;
  /** Hidden size H (= d_model in Vaswani). */
  hiddenSize: number;
  /** Number of attention heads A. Must divide `hiddenSize`. */
  numHeads: number;
  /** Intermediate FFN size. Paper: 4·H. */
  intermediateSize: number;
  /** Vocabulary size. Paper (WordPiece): 30,522. Our tests use tiny vocabs. */
  vocabSize: number;
  /** Number of segment/type ids. Paper: 2 (sentence A / sentence B). */
  typeVocabSize: number;
  /** Max absolute position supported by the learned position embedding. Paper: 512. */
  maxPositionEmbeddings: number;
  /** Residual + attention dropout rate during training. Paper: 0.1 on all layers. */
  dropoutRate: number;
  /** ε added to the variance inside LayerNorm. Paper: 1e-12 (we keep 1e-12 to match). */
  layerNormEps: number;
  /** Initializer stddev for Xavier-like random weights. */
  initStdDev: number;
}

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------

/**
 * The three embedding tables BERT sums on input (Figure 2):
 *
 *   token    : (vocabSize,            hiddenSize)
 *   segment  : (typeVocabSize = 2,    hiddenSize)
 *   position : (maxPositionEmbeddings, hiddenSize)   — LEARNED, not sinusoidal
 *
 * Plus the input-LayerNorm γ/β that is applied to the sum before the
 * residual stream enters the encoder.
 */
export interface BertEmbeddingWeights {
  tokenEmbeddings: Matrix;
  segmentEmbeddings: Matrix;
  positionEmbeddings: Matrix;
  /** LayerNorm scale γ, shape (1, hiddenSize). */
  layerNormGamma: Matrix;
  /** LayerNorm shift β, shape (1, hiddenSize). */
  layerNormBeta: Matrix;
}

// ---------------------------------------------------------------------------
// Heads
// ---------------------------------------------------------------------------

/**
 * Pooler: `tanh(dense(sequenceOutput[0]))`. BERT uses the final hidden
 * state of the [CLS] token, passed through one dense layer + tanh, as
 * the aggregate "pooled" sentence representation (§3).
 */
export interface BertPoolerWeights {
  /** Dense W, shape (hiddenSize, hiddenSize). */
  weight: Matrix;
  /** Dense bias, shape (1, hiddenSize). */
  bias: Matrix;
}

/**
 * Masked-LM head (§3.1 Task #1, §A.2): Dense → GELU → LayerNorm → tied
 * projection to vocabulary + bias.
 *
 * The output projection weight is TIED to the token embedding table —
 * we reuse `BertEmbeddingWeights.tokenEmbeddings` transposed — so only
 * the `transform` dense, its LayerNorm, and the output bias need to be
 * stored here.
 */
export interface BertMLMHeadWeights {
  /** Transform dense W, shape (hiddenSize, hiddenSize). */
  transformWeight: Matrix;
  /** Transform dense bias, shape (1, hiddenSize). */
  transformBias: Matrix;
  /** Post-transform LayerNorm γ, shape (1, hiddenSize). */
  layerNormGamma: Matrix;
  /** Post-transform LayerNorm β, shape (1, hiddenSize). */
  layerNormBeta: Matrix;
  /** Vocabulary bias, shape (1, vocabSize). Added after the tied projection. */
  outputBias: Matrix;
}

/**
 * Next-Sentence-Prediction head (§3.1 Task #2): a single dense layer
 * mapping the pooled [CLS] representation to 2 logits (isNext / notNext).
 */
export interface BertNSPHeadWeights {
  /** Dense W, shape (hiddenSize, 2). */
  weight: Matrix;
  /** Dense bias, shape (1, 2). */
  bias: Matrix;
}

// ---------------------------------------------------------------------------
// Full model
// ---------------------------------------------------------------------------

/**
 * Complete BERT weights — everything needed for both pre-training
 * (`bertForwardWithHeads`) and feature extraction (`bertForward`).
 *
 * The encoder layer stack is the SAME type used by the Vaswani encoder,
 * which lets us reuse `runEncoder()` with `ffnActivation="gelu"` and
 * keep paper-faithfulness on both papers simultaneously.
 */
export interface BertWeights {
  config: BertConfig;
  embeddings: BertEmbeddingWeights;
  encoder: EncoderLayerWeights[];
  pooler: BertPoolerWeights;
  mlmHead: BertMLMHeadWeights;
  nspHead: BertNSPHeadWeights;
}

// ---------------------------------------------------------------------------
// Forward-pass result
// ---------------------------------------------------------------------------

/**
 * Result of running `bertForward()` — the two tensors downstream tasks
 * consume. `sequenceOutput[i]` is `T_i` in the paper's notation; the
 * pooled output is the `C` vector used for classification.
 */
export interface BertForwardResult {
  /** Full sequence of contextual token representations, shape (seqLen, hiddenSize). */
  sequenceOutput: Matrix;
  /** Pooled [CLS] representation after pooler, shape (1, hiddenSize). */
  pooledOutput: Matrix;
}
