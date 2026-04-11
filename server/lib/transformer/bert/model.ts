/**
 * Full BERT forward pass — embeddings → encoder (bidirectional, GELU FFN)
 * → pooler (tanh over [CLS]).
 *
 * The encoder stack is the SAME `runEncoder()` from the Vaswani module,
 * called with `ffnActivation="gelu"` to match BERT's Appendix A.2.
 * There is no causal mask: self-attention is fully bidirectional, which
 * is the entire point of the paper (§1 and Figure 3).
 */

import { type Matrix, zeros, xavier, matmul, addBias, sliceRows } from "../matrix";
import {
  initEncoderLayerWeights,
  runEncoder,
  type EncoderLayerWeights,
} from "../transformer";
import { baseConfig as attentionConfig, type MultiHeadConfig } from "../attention";
import type { DropoutConfig } from "../dropout";
import type {
  BertConfig,
  BertWeights,
  BertPoolerWeights,
  BertForwardResult,
  BertMLMHeadWeights,
  BertNSPHeadWeights,
} from "./types";
import { initBertEmbeddingWeights, bertEmbeddingForward, bertPaddingMask } from "./embeddings";
import { BERT_SPECIAL_TOKENS } from "./types";

// ---------------------------------------------------------------------------
// Weight initialization
// ---------------------------------------------------------------------------

/**
 * Build a BERT multi-head attention config from a BertConfig. Shares the
 * underlying `MultiHeadConfig` shape with the Vaswani encoder so we can
 * reuse `initEncoderLayerWeights` / `runEncoder` verbatim.
 */
export function bertAttentionConfig(config: BertConfig): MultiHeadConfig {
  return attentionConfig(config.hiddenSize, config.numHeads);
}

/**
 * Initialize the encoder stack for a BERT config. `L` layers, each with
 * its own seed offset so every layer's weights are independent.
 */
export function initBertEncoderLayers(
  config: BertConfig,
  seed = 1000,
): EncoderLayerWeights[] {
  const attn = bertAttentionConfig(config);
  const layers: EncoderLayerWeights[] = [];
  for (let i = 0; i < config.numLayers; i++) {
    layers.push(initEncoderLayerWeights(attn, config.intermediateSize, seed + i * 100));
  }
  return layers;
}

/**
 * Initialize the pooler dense layer (W, b). γ/β are not needed — the
 * pooler is just Dense → tanh with no LayerNorm.
 */
export function initBertPooler(config: BertConfig, seed = 9000): BertPoolerWeights {
  return {
    weight: xavier(config.hiddenSize, config.hiddenSize, seed),
    bias: zeros(1, config.hiddenSize),
  };
}

/**
 * Initialize the MLM head. `transformWeight` and `transformBias` do the
 * Dense transform; γ and β drive the post-transform LayerNorm; the
 * output projection is TIED to the token embedding table so we only
 * need to store the per-vocabulary `outputBias`.
 */
export function initBertMLMHead(config: BertConfig, seed = 12000): BertMLMHeadWeights {
  const H = config.hiddenSize;
  const g = zeros(1, H);
  g.data.fill(1);
  return {
    transformWeight: xavier(H, H, seed),
    transformBias: zeros(1, H),
    layerNormGamma: g,
    layerNormBeta: zeros(1, H),
    outputBias: zeros(1, config.vocabSize),
  };
}

/**
 * Initialize the Next-Sentence-Prediction head (binary classifier over
 * the pooled [CLS] representation).
 */
export function initBertNSPHead(config: BertConfig, seed = 15000): BertNSPHeadWeights {
  return {
    weight: xavier(config.hiddenSize, 2, seed),
    bias: zeros(1, 2),
  };
}

/**
 * Initialize a complete BERT model from a config. Every component gets
 * a distinct seed derived from the caller's master seed so forward
 * passes are reproducible.
 */
export function initBertWeights(config: BertConfig, masterSeed = 42): BertWeights {
  return {
    config,
    embeddings: initBertEmbeddingWeights(config, masterSeed + 100),
    encoder: initBertEncoderLayers(config, masterSeed + 500),
    pooler: initBertPooler(config, masterSeed + 9000),
    mlmHead: initBertMLMHead(config, masterSeed + 12000),
    nspHead: initBertNSPHead(config, masterSeed + 15000),
  };
}

// ---------------------------------------------------------------------------
// Pooler
// ---------------------------------------------------------------------------

/**
 * Apply the BERT pooler to a sequence output:
 *
 *   pooled = tanh( dense(sequenceOutput[0]) )
 *
 * i.e. take the final hidden state at position 0 ([CLS]), push it
 * through one dense layer, then tanh. The result is a single
 * (1, hiddenSize) vector used as the aggregate sentence representation
 * for classification tasks.
 */
export function bertPool(
  sequenceOutput: Matrix,
  pooler: BertPoolerWeights,
): Matrix {
  if (sequenceOutput.rows === 0) {
    throw new Error("bertPool: sequenceOutput is empty");
  }
  // Pull the [CLS] row (index 0)
  const cls = sliceRows(sequenceOutput, 0, 1); // shape (1, H)
  const projected = addBias(matmul(cls, pooler.weight), pooler.bias);
  // tanh in place (new matrix to stay immutable)
  const out: Matrix = {
    rows: 1,
    cols: projected.cols,
    data: new Float64Array(projected.cols),
  };
  for (let j = 0; j < projected.cols; j++) {
    out.data[j] = Math.tanh(projected.data[j]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main forward pass
// ---------------------------------------------------------------------------

/**
 * Full BERT forward pass:
 *
 *   1. sum(token, segment, position) → LayerNorm → dropout
 *   2. runEncoder with ffnActivation="gelu" (bidirectional, padding mask
 *      derived from [PAD] tokens)
 *   3. pool([CLS]) → dense + tanh
 *
 * Returns `{ sequenceOutput, pooledOutput }` ready to be consumed by
 * downstream heads (MLM, NSP, classification, token tagging, span
 * prediction, etc.).
 *
 * Parameters:
 *   - `tokenIds`    : the packed [CLS] sentA [SEP] sentB [SEP] [PAD]... sequence.
 *   - `segmentIds`  : 0 for sentence A, 1 for sentence B. Defaults to zeros.
 *   - `dropoutConfig`: optional; pass during training, omit for inference.
 */
export function bertForward(
  weights: BertWeights,
  tokenIds: number[],
  segmentIds?: number[],
  dropoutConfig?: DropoutConfig,
): BertForwardResult {
  const config = weights.config;

  // 1. Input embeddings (token + segment + position + LN + dropout)
  const inputEmbeddings = bertEmbeddingForward(
    weights.embeddings,
    tokenIds,
    segmentIds,
    undefined,
    dropoutConfig,
  );

  // 2. Encoder stack (bidirectional self-attention, GELU FFN).
  //    Build a padding mask so [PAD] positions never get attended to.
  const paddingMask = bertPaddingMask(tokenIds, BERT_SPECIAL_TOKENS.PAD);
  const sequenceOutput = runEncoder(
    inputEmbeddings,
    weights.encoder,
    bertAttentionConfig(config),
    paddingMask,
    dropoutConfig,
    "gelu",
  );

  // 3. Pool [CLS] for sentence-level tasks
  const pooledOutput = bertPool(sequenceOutput, weights.pooler);

  return { sequenceOutput, pooledOutput };
}
